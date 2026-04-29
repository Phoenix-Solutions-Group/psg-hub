'use client'

import { useEffect, useMemo, useRef, useState } from 'react'
import maplibregl, {
  type GeoJSONSource,
  type LngLatBoundsLike,
  type Map as MapLibreMap,
  type MapGeoJSONFeature,
  type StyleSpecification,
} from 'maplibre-gl'
import type {
  MarketMapData,
  MarketMapPoint,
  MarketViewportIntelligence,
  ShopCompetitorPoint,
} from '@/types'

const QUICK_STATES = ['CA', 'TX', 'FL', 'NY', 'IL', 'PA', 'NJ', 'MN', 'NE', 'MO']
const NATIONAL_DIRECTORY_LIMIT = 5000
const STATE_DIRECTORY_LIMIT = 12000
const EMPTY_COLLECTION: PointFeatureCollection = { type: 'FeatureCollection', features: [] }
const USA_BOUNDS: LngLatBoundsLike = [[-124.8, 24.5], [-66.9, 49.5]]

const MAP_STYLE: StyleSpecification = {
  version: 8,
  glyphs: 'https://demotiles.maplibre.org/font/{fontstack}/{range}.pbf',
  sources: {
    carto: {
      type: 'raster',
      tiles: [
        'https://a.basemaps.cartocdn.com/light_all/{z}/{x}/{y}.png',
        'https://b.basemaps.cartocdn.com/light_all/{z}/{x}/{y}.png',
        'https://c.basemaps.cartocdn.com/light_all/{z}/{x}/{y}.png',
      ],
      tileSize: 256,
      attribution:
        '&copy; OpenStreetMap contributors &copy; CARTO',
    },
  },
  layers: [
    {
      id: 'carto',
      type: 'raster',
      source: 'carto',
      paint: {
        'raster-opacity': 0.96,
      },
    },
  ],
}

type PointFeature = {
  type: 'Feature'
  id: string
  properties: {
    key: string
    id: string
    layer: MarketMapPoint['layer'] | 'competitor_shop'
    shopName: string
  }
  geometry: {
    type: 'Point'
    coordinates: [number, number]
  }
}

type PointFeatureCollection = {
  type: 'FeatureCollection'
  features: PointFeature[]
}

function compact(value: number) {
  return Intl.NumberFormat('en-US', {
    notation: value >= 10000 ? 'compact' : 'standard',
    maximumFractionDigits: 1,
  }).format(value)
}

function pointKey(point: Pick<MarketMapPoint, 'layer' | 'id'>) {
  return `${point.layer}:${point.id}`
}

function pointLabel(point: MarketMapPoint) {
  if (point.layer === 'psg_customer') {
    return `${point.shop_name}${point.psg_id ? ` | ${point.psg_id}` : ''}`
  }
  return point.shop_name
}

function toFeature(point: MarketMapPoint): PointFeature {
  return {
    type: 'Feature',
    id: pointKey(point),
    properties: {
      key: pointKey(point),
      id: point.id,
      layer: point.layer,
      shopName: point.shop_name,
    },
    geometry: {
      type: 'Point',
      coordinates: [point.longitude, point.latitude],
    },
  }
}

function toFeatureCollection(points: MarketMapPoint[]): PointFeatureCollection {
  return {
    type: 'FeatureCollection',
    features: points.map(toFeature),
  }
}

function competitorKey(point: ShopCompetitorPoint) {
  return `competitor:${point.place_id || point.shop_name}:${point.distance_miles}`
}

function competitorToFeature(point: ShopCompetitorPoint): PointFeature {
  return {
    type: 'Feature',
    id: competitorKey(point),
    properties: {
      key: competitorKey(point),
      id: point.place_id || point.shop_name,
      layer: 'competitor_shop',
      shopName: point.shop_name,
    },
    geometry: {
      type: 'Point',
      coordinates: [point.longitude, point.latitude],
    },
  }
}

function toCompetitorFeatureCollection(points: ShopCompetitorPoint[]): PointFeatureCollection {
  return {
    type: 'FeatureCollection',
    features: points.map(competitorToFeature),
  }
}

function source(map: MapLibreMap, id: string) {
  return map.getSource(id) as GeoJSONSource | undefined
}

function fitPoints(map: MapLibreMap | null, points: MarketMapPoint[], selectedState: string) {
  if (!map) return

  if (!points.length) {
    map.fitBounds(USA_BOUNDS, { padding: 24, duration: 500 })
    return
  }

  const bounds = new maplibregl.LngLatBounds()
  for (const point of points) {
    bounds.extend([point.longitude, point.latitude])
  }
  map.fitBounds(bounds, {
    padding: { top: 60, right: 56, bottom: 56, left: 56 },
    maxZoom: selectedState ? 8.5 : 4.25,
    duration: 650,
  })
}

function featureKey(feature: MapGeoJSONFeature) {
  const key = feature.properties?.key
  return typeof key === 'string' ? key : ''
}

function focusOnPoint(map: MapLibreMap | null, point: MarketMapPoint) {
  if (!map) return

  map.easeTo({
    center: [point.longitude, point.latitude],
    zoom: Math.max(map.getZoom(), point.layer === 'psg_customer' ? 6 : 8),
    duration: 550,
  })
}

function fitCompetitorOverlay(map: MapLibreMap | null, points: ShopCompetitorPoint[]) {
  if (!map || !points.length) return

  const bounds = new maplibregl.LngLatBounds()
  for (const point of points) {
    bounds.extend([point.longitude, point.latitude])
  }
  map.fitBounds(bounds, {
    padding: { top: 76, right: 64, bottom: 64, left: 64 },
    maxZoom: 11,
    duration: 650,
  })
}

function formatDistance(value: number) {
  if (value === 0) return 'Here'
  return `${value.toFixed(value < 10 ? 1 : 0)} mi`
}

function viewportIntelligenceUrl(map: MapLibreMap) {
  const bounds = map.getBounds()
  const params = new URLSearchParams({
    west: bounds.getWest().toFixed(6),
    south: bounds.getSouth().toFixed(6),
    east: bounds.getEast().toFixed(6),
    north: bounds.getNorth().toFixed(6),
    zoom: map.getZoom().toFixed(2),
  })
  return `/api/market-map/intelligence?${params.toString()}`
}

export default function MarketMapDashboard() {
  const mapNodeRef = useRef<HTMLDivElement | null>(null)
  const mapRef = useRef<MapLibreMap | null>(null)
  const pointLookupRef = useRef<Map<string, MarketMapPoint>>(new Map())
  const [data, setData] = useState<MarketMapData | null>(null)
  const [isLoading, setIsLoading] = useState(true)
  const [isMapReady, setIsMapReady] = useState(false)
  const [error, setError] = useState('')
  const [selectedState, setSelectedState] = useState('')
  const [showPsg, setShowPsg] = useState(true)
  const [showDirectory, setShowDirectory] = useState(true)
  const [selectedPoint, setSelectedPoint] = useState<MarketMapPoint | null>(null)
  const [competitorOverlay, setCompetitorOverlay] = useState<ShopCompetitorPoint[]>([])
  const [isCompetitorLoading, setIsCompetitorLoading] = useState(false)
  const [competitorError, setCompetitorError] = useState('')
  const [viewportIntel, setViewportIntel] = useState<MarketViewportIntelligence | null>(null)
  const [isViewportIntelLoading, setIsViewportIntelLoading] = useState(false)
  const [viewportIntelError, setViewportIntelError] = useState('')

  useEffect(() => {
    if (!mapNodeRef.current || mapRef.current) return

    const map = new maplibregl.Map({
      container: mapNodeRef.current,
      style: MAP_STYLE,
      bounds: USA_BOUNDS,
      fitBoundsOptions: { padding: 18 },
      attributionControl: false,
    })

    map.addControl(new maplibregl.NavigationControl({ visualizePitch: false }), 'top-right')
    map.addControl(new maplibregl.AttributionControl({ compact: true }), 'bottom-right')

    map.on('load', () => {
      map.addSource('directory-points-source', {
        type: 'geojson',
        data: EMPTY_COLLECTION,
        cluster: true,
        clusterMaxZoom: 9,
        clusterRadius: 42,
      })
      map.addSource('psg-points-source', {
        type: 'geojson',
        data: EMPTY_COLLECTION,
      })
      map.addSource('competitor-points-source', {
        type: 'geojson',
        data: EMPTY_COLLECTION,
      })
      map.addSource('selected-market-point', {
        type: 'geojson',
        data: EMPTY_COLLECTION,
      })

      map.addLayer({
        id: 'directory-clusters',
        type: 'circle',
        source: 'directory-points-source',
        filter: ['has', 'point_count'],
        paint: {
          'circle-color': [
            'step',
            ['get', 'point_count'],
            '#DCE8EC',
            50,
            '#AFC9D2',
            250,
            '#7FA8B8',
            1000,
            '#527F95',
          ],
          'circle-opacity': 0.86,
          'circle-radius': [
            'step',
            ['get', 'point_count'],
            14,
            50,
            19,
            250,
            25,
            1000,
            32,
          ],
          'circle-stroke-color': '#FFFFFF',
          'circle-stroke-width': 1.5,
        },
      })

      map.addLayer({
        id: 'directory-cluster-count',
        type: 'symbol',
        source: 'directory-points-source',
        filter: ['has', 'point_count'],
        layout: {
          'text-field': ['get', 'point_count_abbreviated'],
          'text-font': ['Noto Sans Regular'],
          'text-size': 11,
        },
        paint: {
          'text-color': '#1E3A52',
        },
      })

      map.addLayer({
        id: 'directory-points',
        type: 'circle',
        source: 'directory-points-source',
        filter: ['!', ['has', 'point_count']],
        paint: {
          'circle-color': '#1E3A52',
          'circle-opacity': ['interpolate', ['linear'], ['zoom'], 3, 0.25, 8, 0.45],
          'circle-radius': ['interpolate', ['linear'], ['zoom'], 3, 2, 7, 3.6, 11, 6],
          'circle-stroke-color': '#FFFFFF',
          'circle-stroke-opacity': 0.55,
          'circle-stroke-width': ['interpolate', ['linear'], ['zoom'], 5, 0, 9, 0.8],
        },
      })

      map.addLayer({
        id: 'psg-points',
        type: 'circle',
        source: 'psg-points-source',
        paint: {
          'circle-color': '#B8483E',
          'circle-opacity': 0.95,
          'circle-radius': ['interpolate', ['linear'], ['zoom'], 3, 5, 7, 7, 11, 10],
          'circle-stroke-color': '#FFFFFF',
          'circle-stroke-width': 1.8,
        },
      })

      map.addLayer({
        id: 'competitor-points',
        type: 'circle',
        source: 'competitor-points-source',
        paint: {
          'circle-color': '#D4A847',
          'circle-opacity': 0.96,
          'circle-radius': ['interpolate', ['linear'], ['zoom'], 5, 4.5, 9, 7, 12, 9],
          'circle-stroke-color': '#FFFFFF',
          'circle-stroke-width': 1.6,
        },
      })

      map.addLayer({
        id: 'selected-point-halo',
        type: 'circle',
        source: 'selected-market-point',
        paint: {
          'circle-color': '#0EA5A5',
          'circle-opacity': 0.18,
          'circle-radius': ['interpolate', ['linear'], ['zoom'], 3, 12, 8, 22, 12, 34],
          'circle-stroke-color': '#0EA5A5',
          'circle-stroke-opacity': 0.9,
          'circle-stroke-width': 2,
        },
      })

      const handleClick = (event: maplibregl.MapLayerMouseEvent) => {
        const key = event.features?.[0] ? featureKey(event.features[0]) : ''
        const point = pointLookupRef.current.get(key)
        if (point) setSelectedPoint(point)
      }
      const handleClusterClick = async (event: maplibregl.MapLayerMouseEvent) => {
        const feature = event.features?.[0]
        const clusterId = feature?.properties?.cluster_id
        const geometry = feature?.geometry
        if (typeof clusterId !== 'number' || !geometry || geometry.type !== 'Point') return

        const directorySource = source(map, 'directory-points-source')
        const zoom = await directorySource?.getClusterExpansionZoom(clusterId)
        if (typeof zoom !== 'number') return

        map.easeTo({
          center: geometry.coordinates as [number, number],
          zoom,
          duration: 550,
        })
      }
      const setPointer = () => {
        map.getCanvas().style.cursor = 'pointer'
      }
      const clearPointer = () => {
        map.getCanvas().style.cursor = ''
      }

      map.on('click', 'directory-clusters', handleClusterClick)
      map.on('mouseenter', 'directory-clusters', setPointer)
      map.on('mouseleave', 'directory-clusters', clearPointer)

      for (const layer of ['psg-points', 'directory-points']) {
        map.on('click', layer, handleClick)
        map.on('mouseenter', layer, setPointer)
        map.on('mouseleave', layer, clearPointer)
      }

      setIsMapReady(true)
    })

    mapRef.current = map

    return () => {
      map.remove()
      mapRef.current = null
    }
  }, [])

  useEffect(() => {
    let isActive = true

    async function load() {
      setIsLoading(true)
      setError('')
      try {
        const params = new URLSearchParams({
          limit: String(selectedState ? STATE_DIRECTORY_LIMIT : NATIONAL_DIRECTORY_LIMIT),
        })
        if (selectedState) params.set('state', selectedState)
        const response = await fetch(`/api/market-map?${params.toString()}`)
        if (!response.ok) {
          throw new Error(`Map request failed: ${response.status}`)
        }
        const nextData = (await response.json()) as MarketMapData
        if (isActive) {
          setData(nextData)
          setSelectedPoint(null)
        }
      } catch (err) {
        if (isActive) setError(err instanceof Error ? err.message : 'Map request failed')
      } finally {
        if (isActive) setIsLoading(false)
      }
    }

    load()
    return () => {
      isActive = false
    }
  }, [selectedState])

  const filteredPoints = useMemo(() => {
    const points = data?.points || []
    return points.filter((point) => {
      if (point.layer === 'psg_customer' && !showPsg) return false
      if (point.layer === 'directory_shop' && !showDirectory) return false
      return true
    })
  }, [data?.points, showDirectory, showPsg])

  const filteredPsg = useMemo(
    () => filteredPoints.filter((point) => point.layer === 'psg_customer'),
    [filteredPoints]
  )
  const filteredDirectory = useMemo(
    () => filteredPoints.filter((point) => point.layer === 'directory_shop'),
    [filteredPoints]
  )
  const states = Array.from(new Set([...QUICK_STATES, ...(data?.summary.states || [])]))
    .sort((a, b) => a.localeCompare(b))
  const topCustomers = [...filteredPsg]
    .sort((a, b) => (b.survey_count || 0) - (a.survey_count || 0))
    .slice(0, 12)
  const competitors = useMemo(
    () => competitorOverlay.filter((point) => !point.is_anchor),
    [competitorOverlay]
  )
  const competitorAnchor = useMemo(
    () => competitorOverlay.find((point) => point.is_anchor),
    [competitorOverlay]
  )

  useEffect(() => {
    pointLookupRef.current = new Map(filteredPoints.map((point) => [pointKey(point), point]))
  }, [filteredPoints])

  useEffect(() => {
    if (selectedPoint?.layer !== 'psg_customer') {
      setCompetitorOverlay([])
      setCompetitorError('')
      setIsCompetitorLoading(false)
      return
    }

    const point = selectedPoint
    const controller = new AbortController()
    let isActive = true

    async function loadCompetitors() {
      setIsCompetitorLoading(true)
      setCompetitorError('')
      try {
        const response = await fetch(
          `/api/shops/${encodeURIComponent(point.shop_name)}/competitors?radiusMiles=25&limit=25`,
          { signal: controller.signal }
        )
        if (!response.ok) {
          throw new Error(`Competitor request failed: ${response.status}`)
        }
        const rows = (await response.json()) as ShopCompetitorPoint[]
        if (isActive) {
          setCompetitorOverlay(rows)
          fitCompetitorOverlay(mapRef.current, rows)
        }
      } catch (err) {
        if (controller.signal.aborted || !isActive) return
        setCompetitorOverlay([])
        setCompetitorError(err instanceof Error ? err.message : 'Competitor request failed')
      } finally {
        if (isActive) setIsCompetitorLoading(false)
      }
    }

    loadCompetitors()
    return () => {
      isActive = false
      controller.abort()
    }
  }, [selectedPoint])

  useEffect(() => {
    const map = mapRef.current
    if (!map || !isMapReady) return

    source(map, 'directory-points-source')?.setData(toFeatureCollection(filteredDirectory))
    source(map, 'psg-points-source')?.setData(toFeatureCollection(filteredPsg))
    fitPoints(map, filteredPoints, selectedState)
  }, [filteredDirectory, filteredPoints, filteredPsg, isMapReady, selectedState])

  useEffect(() => {
    const map = mapRef.current
    if (!map || !isMapReady) return

    source(map, 'selected-market-point')?.setData(
      selectedPoint ? toFeatureCollection([selectedPoint]) : EMPTY_COLLECTION
    )
  }, [isMapReady, selectedPoint])

  useEffect(() => {
    const map = mapRef.current
    if (!map || !isMapReady) return

    source(map, 'competitor-points-source')?.setData(toCompetitorFeatureCollection(competitors))
  }, [competitors, isMapReady])

  useEffect(() => {
    const map = mapRef.current
    if (!map || !isMapReady) return

    const activeMap = map
    let timeout: ReturnType<typeof setTimeout> | null = null
    let controller: AbortController | null = null

    async function loadViewportIntelligence() {
      controller?.abort()
      const activeController = new AbortController()
      controller = activeController
      setIsViewportIntelLoading(true)
      setViewportIntelError('')
      try {
        const response = await fetch(viewportIntelligenceUrl(activeMap), {
          signal: activeController.signal,
        })
        if (!response.ok) {
          throw new Error(`Viewport request failed: ${response.status}`)
        }
        setViewportIntel(await response.json() as MarketViewportIntelligence)
      } catch (err) {
        if (activeController.signal.aborted) return
        setViewportIntelError(err instanceof Error ? err.message : 'Viewport request failed')
      } finally {
        if (!activeController.signal.aborted) setIsViewportIntelLoading(false)
      }
    }

    function scheduleViewportIntelligence() {
      if (timeout) clearTimeout(timeout)
      timeout = setTimeout(loadViewportIntelligence, 240)
    }

    activeMap.on('moveend', scheduleViewportIntelligence)
    scheduleViewportIntelligence()

    return () => {
      if (timeout) clearTimeout(timeout)
      controller?.abort()
      activeMap.off('moveend', scheduleViewportIntelligence)
    }
  }, [isMapReady])

  return (
    <div className="space-y-6">
      <section className="rounded-lg border border-iron/20 bg-white">
        <div className="grid gap-5 p-5 xl:grid-cols-[1fr_420px] xl:items-end">
          <div>
            <p className="text-xs font-semibold uppercase tracking-wide text-clarity">
              Customer geography
            </p>
            <h2 className="mt-1 font-heading text-2xl font-bold text-navy">
              PSG Customers vs Directory Shops
            </h2>
            <p className="mt-2 max-w-3xl text-sm leading-6 text-iron">
              PSG customers are anchored from Invoiced IDs and displayed against the
              national body shop directory.
            </p>
          </div>

          <div className="grid grid-cols-2 gap-2 sm:grid-cols-[1fr_auto_auto]">
            <select
              value={selectedState}
              onChange={(event) => {
                setSelectedState(event.target.value)
                setSelectedPoint(null)
                setCompetitorOverlay([])
              }}
              className="rounded-lg border border-iron/20 px-3 py-2 text-sm text-navy focus:border-clarity focus:outline-none"
            >
              <option value="">All states</option>
              {states.map((state) => (
                <option key={state} value={state}>{state}</option>
              ))}
            </select>
            <button
              type="button"
              onClick={() => setShowPsg((value) => !value)}
              className={`rounded-lg px-3 py-2 text-sm font-medium ring-1 ring-iron/15 ${
                showPsg ? 'bg-navy text-white' : 'bg-white text-iron'
              }`}
            >
              PSG
            </button>
            <button
              type="button"
              onClick={() => setShowDirectory((value) => !value)}
              className={`rounded-lg px-3 py-2 text-sm font-medium ring-1 ring-iron/15 ${
                showDirectory ? 'bg-clarity text-white' : 'bg-white text-iron'
              }`}
            >
              Directory
            </button>
          </div>
        </div>
        {error && (
          <div className="border-t border-phoenix-red/20 bg-phoenix-red/5 px-5 py-3 text-sm text-phoenix-red">
            {error}
          </div>
        )}
      </section>

      <section className="grid grid-cols-1 gap-4 md:grid-cols-4">
        <Metric label="Mapped PSG Customers" value={compact(filteredPsg.length)} />
        <Metric
          label="Surveyed PSG Customers"
          value={compact(filteredPsg.filter((point) => (point.survey_count || 0) > 0).length)}
        />
        <Metric label="Directory Shops" value={compact(filteredDirectory.length)} />
        <Metric
          label="States"
          value={compact(new Set(filteredPoints.map((point) => point.state).filter(Boolean)).size)}
        />
      </section>

      <section className="grid grid-cols-1 gap-6 xl:grid-cols-[1fr_360px]">
        <div className="overflow-hidden rounded-lg border border-iron/20 bg-white">
          <div className="flex items-center justify-between border-b border-iron/10 px-5 py-3 text-xs text-iron">
            <div className="flex flex-wrap items-center gap-4">
              <span className="inline-flex items-center gap-2">
                <span className="h-3 w-3 rounded-full bg-phoenix-red" />
                PSG customers
              </span>
              <span className="inline-flex items-center gap-2">
                <span className="h-3 w-3 rounded-full bg-navy/30" />
                Directory shops
              </span>
              <span className="inline-flex items-center gap-2">
                <span className="h-3 w-3 rounded-full bg-catalyst" />
                Selected competitors
              </span>
            </div>
            <span>{isLoading ? 'Loading map...' : `${compact(filteredPoints.length)} points`}</span>
          </div>
          <div className="relative h-[620px] w-full bg-canvas">
            <div ref={mapNodeRef} className="h-full w-full" />
            {isLoading && (
              <div className="absolute inset-x-4 top-4 rounded-md border border-iron/10 bg-white/90 px-4 py-3 text-sm font-medium text-navy shadow-sm backdrop-blur">
                Loading geography
              </div>
            )}
          </div>
        </div>

        <aside className="rounded-lg border border-iron/20 bg-white">
          <div className="border-b border-iron/10 p-4">
            <div className="flex items-start justify-between gap-3">
              <div>
                <p className="text-xs font-semibold uppercase tracking-wide text-clarity">
                  Map Intelligence
                </p>
                <h3 className="mt-2 font-heading text-base font-bold text-navy">
                  {viewportIntel?.viewport_label || 'Current view'}
                </h3>
              </div>
              <span className="rounded-md bg-horizon px-2 py-1 text-xs font-semibold text-navy">
                {isViewportIntelLoading ? 'Updating' : `z${Math.round(viewportIntel?.zoom || mapRef.current?.getZoom() || 0)}`}
              </span>
            </div>
            {viewportIntelError && (
              <p className="mt-2 text-xs leading-5 text-phoenix-red">{viewportIntelError}</p>
            )}
            <div className="mt-4 grid grid-cols-2 gap-2">
              <SmallMetric label="PSG" value={compact(viewportIntel?.psg_customer_count || filteredPsg.length)} />
              <SmallMetric label="Directory" value={compact(viewportIntel?.directory_shop_count || filteredDirectory.length)} />
              <SmallMetric label="Crashes" value={compact(viewportIntel?.crash_count || 0)} />
              <SmallMetric label="Storms" value={compact(viewportIntel?.storm_event_count || 0)} />
            </div>
          </div>

          <div className="border-b border-iron/10 p-4">
            <p className="text-xs font-semibold uppercase tracking-wide text-clarity">
              Selected Point
            </p>
            {selectedPoint ? (
              <div className="mt-2">
                <h3 className="font-heading text-base font-bold text-navy">
                  {pointLabel(selectedPoint)}
                </h3>
                {selectedPoint.address && (
                  <p className="mt-1 text-sm leading-5 text-iron">{selectedPoint.address}</p>
                )}
                <div className="mt-2 flex flex-wrap gap-2 text-xs text-iron">
                  {selectedPoint.invoiced_id && <span>Invoiced {selectedPoint.invoiced_id}</span>}
                  {selectedPoint.avg_emi_pct !== null && <span>{selectedPoint.avg_emi_pct}% EMI</span>}
                  {selectedPoint.survey_count !== null && <span>{selectedPoint.survey_count} surveys</span>}
                  {selectedPoint.rating !== null && <span>{selectedPoint.rating.toFixed(1)} rating</span>}
                </div>
                <button
                  type="button"
                  onClick={() => {
                    setSelectedPoint(null)
                    setCompetitorOverlay([])
                    fitPoints(mapRef.current, filteredPoints, selectedState)
                  }}
                  className="mt-3 rounded-md border border-iron/15 px-2.5 py-1.5 text-xs font-semibold text-iron transition-colors hover:bg-canvas"
                >
                  Choose another customer
                </button>
              </div>
            ) : (
              <p className="mt-2 text-sm leading-6 text-iron">
                Select a PSG customer to show its local competitor set.
              </p>
            )}
          </div>

          <div className="max-h-[500px] overflow-y-auto">
            {selectedPoint?.layer === 'psg_customer' ? (
              <div>
                <div className="border-b border-iron/10 bg-canvas/70 px-4 py-3">
                  <div className="flex items-center justify-between gap-3">
                    <p className="text-xs font-semibold uppercase tracking-wide text-iron">
                      Competitors within 25 miles
                    </p>
                    <span className="rounded-md bg-white px-2 py-1 text-xs font-semibold text-navy ring-1 ring-iron/10">
                      {isCompetitorLoading ? 'Loading' : competitors.length}
                    </span>
                  </div>
                  {competitorAnchor?.address && (
                    <p className="mt-2 text-xs leading-5 text-iron">
                      Anchored at {competitorAnchor.address}
                    </p>
                  )}
                  {competitorError && (
                    <p className="mt-2 text-xs leading-5 text-phoenix-red">{competitorError}</p>
                  )}
                </div>
                {competitors.length ? competitors.map((competitor) => (
                  <div
                    key={competitor.place_id || `${competitor.shop_name}-${competitor.distance_miles}`}
                    className="border-b border-iron/10 p-4 last:border-b-0"
                  >
                    <div className="flex items-start justify-between gap-3">
                      <div>
                        <p className="font-heading text-sm font-bold text-navy">
                          {competitor.shop_name}
                        </p>
                        {competitor.address && (
                          <p className="mt-1 text-xs leading-5 text-iron">{competitor.address}</p>
                        )}
                      </div>
                      <span className="whitespace-nowrap rounded-md bg-horizon px-2 py-1 text-xs font-semibold text-navy">
                        {formatDistance(competitor.distance_miles)}
                      </span>
                    </div>
                    <div className="mt-2 flex flex-wrap gap-x-3 gap-y-1 text-xs text-iron">
                      {competitor.rating !== null && <span>{competitor.rating.toFixed(1)} rating</span>}
                      {competitor.phone && <span>{competitor.phone}</span>}
                      {competitor.website && (
                        <a
                          href={competitor.website}
                          target="_blank"
                          rel="noreferrer"
                          className="text-clarity hover:underline"
                        >
                          Website
                        </a>
                      )}
                    </div>
                  </div>
                )) : (
                  <div className="p-4 text-sm leading-6 text-iron">
                    {isCompetitorLoading
                      ? 'Loading competitor set...'
                      : 'No competitors from the directory are mapped within 25 miles.'}
                  </div>
                )}
              </div>
            ) : (
              <div>
                {viewportIntel?.top_zips.length ? (
                  <div>
                    <div className="border-b border-iron/10 bg-canvas/70 px-4 py-3">
                      <p className="text-xs font-semibold uppercase tracking-wide text-iron">
                        Priority ZIPs in View
                      </p>
                    </div>
                    {viewportIntel.top_zips.map((zip) => (
                      <div key={`${zip.year}-${zip.zip}`} className="border-b border-iron/10 p-4">
                        <div className="flex items-start justify-between gap-3">
                          <div>
                            <p className="font-heading text-sm font-bold text-navy">{zip.zip}</p>
                            <p className="mt-1 text-xs text-iron">
                              {[zip.city, zip.state, zip.year].filter(Boolean).join(', ')}
                            </p>
                          </div>
                          <span className="rounded-md bg-horizon px-2 py-1 text-xs font-semibold text-navy">
                            {Math.round(zip.targeting_score).toLocaleString()}
                          </span>
                        </div>
                        <div className="mt-2 grid grid-cols-3 gap-2 text-xs text-iron">
                          <span>{compact(zip.total_crashes)} crashes</span>
                          <span>{compact(zip.injury_crashes)} injury</span>
                          <span>{compact(zip.storm_events)} storms</span>
                        </div>
                      </div>
                    ))}
                  </div>
                ) : null}
                <div className="border-b border-iron/10 bg-canvas/70 px-4 py-3">
                  <p className="text-xs font-semibold uppercase tracking-wide text-iron">
                    PSG Customers in View
                  </p>
                </div>
                {topCustomers.map((point) => (
                  <button
                    key={point.id}
                    type="button"
                    onClick={() => {
                      setSelectedPoint(point)
                      focusOnPoint(mapRef.current, point)
                    }}
                    className="block w-full border-b border-iron/10 p-4 text-left transition-colors hover:bg-horizon/40"
                  >
                    <div className="flex items-start justify-between gap-3">
                      <div>
                        <p className="font-heading text-sm font-bold text-navy">{point.shop_name}</p>
                        <p className="mt-1 text-xs text-iron">
                          {[point.city, point.state].filter(Boolean).join(', ') || point.address || 'Mapped customer'}
                        </p>
                      </div>
                      {point.psg_id && (
                        <span className="rounded-md bg-canvas px-2 py-1 text-xs font-semibold text-iron">
                          {point.psg_id}
                        </span>
                      )}
                    </div>
                    <div className="mt-2 flex gap-3 text-xs text-iron">
                      <span>{compact(point.survey_count || 0)} surveys</span>
                      {point.avg_emi_pct !== null && <span>{point.avg_emi_pct}% EMI</span>}
                    </div>
                  </button>
                ))}
                {!topCustomers.length && (
                  <div className="p-4 text-sm leading-6 text-iron">
                    No mapped PSG customers in this view.
                  </div>
                )}
              </div>
            )}
          </div>
        </aside>
      </section>
    </div>
  )
}

function Metric({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-lg border border-iron/20 bg-white p-4">
      <p className="text-xs font-medium uppercase tracking-wide text-iron">{label}</p>
      <p className="mt-2 font-heading text-2xl font-bold text-navy">{value}</p>
    </div>
  )
}

function SmallMetric({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-md border border-iron/10 bg-canvas/60 p-3">
      <p className="text-[11px] font-semibold uppercase tracking-wide text-iron">{label}</p>
      <p className="mt-1 font-heading text-lg font-bold text-navy">{value}</p>
    </div>
  )
}
