'use client'

import { useEffect, useMemo, useRef, useState } from 'react'
import maplibregl, {
  type GeoJSONSource,
  type LngLatBoundsLike,
  type Map as MapLibreMap,
  type StyleSpecification,
} from 'maplibre-gl'
import type {
  CustomerGeoZipPoint,
  CustomerGeoPinsResponse,
  CustomerGeoPreset,
  CustomerGeoShopOption,
  CustomerGeoZipIncomeResponse,
} from '@/types'

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
      attribution: '&copy; OpenStreetMap contributors &copy; CARTO',
    },
  },
  layers: [{ id: 'carto', type: 'raster', source: 'carto' }],
}

const USA_BOUNDS: LngLatBoundsLike = [[-124.8, 24.5], [-66.9, 49.5]]

type PointFeatureCollection = {
  type: 'FeatureCollection'
  features: Array<{
    type: 'Feature'
    properties: {
      shopName: string
      zip: string
      geocodeProvider: string
    }
    geometry: {
      type: 'Point'
      coordinates: [number, number]
    }
  }>
}

function todayIso() {
  return new Date().toISOString().slice(0, 10)
}

function formatMoney(value: number | null) {
  if (value === null) return '—'
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD',
    maximumFractionDigits: 0,
  }).format(value)
}

function compact(value: number) {
  return Intl.NumberFormat('en-US', {
    notation: value >= 10000 ? 'compact' : 'standard',
    maximumFractionDigits: 1,
  }).format(value)
}

function compactNullable(value: number | null) {
  if (value === null) return '—'
  return compact(value)
}

function pct(value: number) {
  return `${Math.max(0, Math.min(100, value)).toFixed(1)}%`
}

function pctNullable(value: number | null) {
  if (value === null) return '—'
  return `${value.toFixed(1)}%`
}

function toGeoJson(pins: CustomerGeoZipPoint[]): PointFeatureCollection {
  return {
    type: 'FeatureCollection',
    features: pins.map((pin) => ({
      type: 'Feature',
      properties: {
        shopName: pin.county_name || 'ZIP aggregate',
        zip: pin.zip || '',
        geocodeProvider: `${pin.repair_count} repairs`,
      },
      geometry: {
        type: 'Point',
        coordinates: [pin.longitude, pin.latitude],
      },
    })),
  }
}

function pinBounds(pins: CustomerGeoZipPoint[]) {
  if (!pins.length) return null
  const bounds = new maplibregl.LngLatBounds()
  for (const pin of pins) {
    bounds.extend([pin.longitude, pin.latitude])
  }
  return bounds
}

const PRESET_OPTIONS: Array<{ value: CustomerGeoPreset; label: string }> = [
  { value: 'nyc_nassau_suffolk', label: 'NYC + Nassau + Suffolk' },
  { value: 'nyc5', label: 'NYC 5 Boroughs' },
  { value: 'all', label: 'All Markets' },
]

export default function CustomerGeographyDashboard() {
  const mapNodeRef = useRef<HTMLDivElement | null>(null)
  const mapRef = useRef<MapLibreMap | null>(null)

  const [startDate, setStartDate] = useState('2024-01-01')
  const [endDate, setEndDate] = useState(todayIso())
  const [preset, setPreset] = useState<CustomerGeoPreset>('nyc_nassau_suffolk')
  const [shops, setShops] = useState<CustomerGeoShopOption[]>([])
  const [selectedShopIds, setSelectedShopIds] = useState<string[]>([])
  const [shopQuery, setShopQuery] = useState('')
  const [shopSort, setShopSort] = useState<'volume' | 'alpha'>('volume')
  const [pinsResponse, setPinsResponse] = useState<CustomerGeoPinsResponse | null>(null)
  const [zipResponse, setZipResponse] = useState<CustomerGeoZipIncomeResponse | null>(null)
  const [isLoading, setIsLoading] = useState(false)
  const [shopError, setShopError] = useState('')
  const [dataError, setDataError] = useState('')

  const shopParam = useMemo(() => selectedShopIds.join(','), [selectedShopIds])
  const filteredShops = useMemo(() => {
    const query = shopQuery.trim().toLowerCase()
    let next = shops
    if (query) {
      next = next.filter((shop) =>
        `${shop.shop_name} ${shop.shop_id}`.toLowerCase().includes(query)
      )
    }
    if (shopSort === 'alpha') {
      return [...next].sort((a, b) => a.shop_name.localeCompare(b.shop_name))
    }
    return [...next].sort((a, b) => b.repair_count - a.repair_count || a.shop_name.localeCompare(b.shop_name))
  }, [shops, shopQuery, shopSort])

  const zipRows = zipResponse?.rows || []
  const rowsWithIncome = zipRows.filter((row) => row.mean_household_income !== null).length
  const incomeCoveragePct = zipRows.length > 0 ? (rowsWithIncome / zipRows.length) * 100 : 0

  useEffect(() => {
    const controller = new AbortController()
    async function loadShops() {
      setShopError('')
      try {
        const params = new URLSearchParams({
          startDate,
          endDate,
          preset,
        })
        const response = await fetch(`/api/customer-geography/shops?${params.toString()}`, {
          signal: controller.signal,
          cache: 'no-store',
        })
        if (!response.ok) throw new Error(`Shops request failed (${response.status})`)
        const payload = (await response.json()) as CustomerGeoShopOption[]
        setShops(payload)
        setSelectedShopIds((current) => {
          if (!current.length) return current
          const validShopIds = new Set(payload.map((shop) => shop.shop_id))
          return current.filter((shopId) => validShopIds.has(shopId))
        })
      } catch (err) {
        if ((err as Error).name === 'AbortError') return
        setShopError((err as Error).message || 'Unable to load shop options')
      }
    }
    loadShops()
    return () => controller.abort()
  }, [startDate, endDate, preset])

  useEffect(() => {
    const controller = new AbortController()
    async function load() {
      setIsLoading(true)
      setDataError('')
      try {
        const params = new URLSearchParams({
          startDate,
          endDate,
          preset,
          limit: '2000',
        })
        if (shopParam) params.set('shopIds', shopParam)

        const [pinsRes, zipRes] = await Promise.all([
          fetch(`/api/customer-geography/pins?${params.toString()}`, {
            signal: controller.signal,
            cache: 'no-store',
          }),
          fetch(`/api/customer-geography/zip-income?${params.toString()}`, {
            signal: controller.signal,
            cache: 'no-store',
          }),
        ])
        if (!pinsRes.ok) throw new Error(`Pins request failed (${pinsRes.status})`)
        if (!zipRes.ok) throw new Error(`ZIP request failed (${zipRes.status})`)
        setPinsResponse((await pinsRes.json()) as CustomerGeoPinsResponse)
        setZipResponse((await zipRes.json()) as CustomerGeoZipIncomeResponse)
      } catch (err) {
        if ((err as Error).name === 'AbortError') return
        setDataError((err as Error).message || 'Unable to load customer geography data')
      } finally {
        setIsLoading(false)
      }
    }
    load()
    return () => controller.abort()
  }, [startDate, endDate, preset, shopParam])

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
      map.addSource('customer-pins', {
        type: 'geojson',
        data: { type: 'FeatureCollection', features: [] },
        cluster: true,
        clusterMaxZoom: 10,
        clusterRadius: 44,
      })
      map.addLayer({
        id: 'customer-clusters',
        type: 'circle',
        source: 'customer-pins',
        filter: ['has', 'point_count'],
        paint: {
          'circle-color': '#B8483E',
          'circle-radius': ['step', ['get', 'point_count'], 16, 25, 20, 100, 24, 300, 28],
          'circle-opacity': 0.74,
        },
      })
      map.addLayer({
        id: 'customer-cluster-count',
        type: 'symbol',
        source: 'customer-pins',
        filter: ['has', 'point_count'],
        layout: {
          'text-field': ['get', 'point_count_abbreviated'],
          'text-size': 11,
          'text-font': ['Open Sans Regular', 'Arial Unicode MS Regular'],
        },
        paint: { 'text-color': '#ffffff' },
      })
      map.addLayer({
        id: 'customer-pin',
        type: 'circle',
        source: 'customer-pins',
        filter: ['!', ['has', 'point_count']],
        paint: {
          'circle-radius': 4.5,
          'circle-color': '#1E3A52',
          'circle-stroke-color': '#FAF8F5',
          'circle-stroke-width': 1.2,
          'circle-opacity': 0.9,
        },
      })
    })

    mapRef.current = map
    return () => {
      map.remove()
      mapRef.current = null
    }
  }, [])

  useEffect(() => {
    const map = mapRef.current
    if (!map || !map.isStyleLoaded()) return
    const source = map.getSource('customer-pins') as GeoJSONSource | undefined
    if (!source) return
    const pins = pinsResponse?.pins || []
    source.setData(toGeoJson(pins))
    const bounds = pinBounds(pins)
    if (bounds && !bounds.isEmpty()) {
      map.fitBounds(bounds, {
        padding: { top: 48, right: 48, bottom: 48, left: 48 },
        maxZoom: 11.5,
        duration: 700,
      })
    }
  }, [pinsResponse])

  function toggleShop(shopId: string) {
    setSelectedShopIds((current) =>
      current.includes(shopId) ? current.filter((item) => item !== shopId) : [...current, shopId]
    )
  }

  const error = dataError || shopError

  return (
    <div className="space-y-6">
      <section className="border border-stone bg-white px-4 py-3">
        <p className="text-[10px] uppercase tracking-wide text-mist">What This Page Shows</p>
        <p className="mt-1 text-sm text-graphite">
          This view is ZIP-level demand intelligence. Map markers and table rows are ZIP aggregates, not
          individual households. Repair Orders are observed repair records. Market Share % estimates what
          share of collision-likely vehicles in each ZIP you are repairing, based on a 6% annual collision
          claim rate applied to registered vehicles.
        </p>
      </section>

      <section className="grid gap-3 md:grid-cols-4">
        <label className="text-xs text-slate">
          Start Date
          <input
            type="date"
            value={startDate}
            onChange={(event) => setStartDate(event.target.value)}
            className="mt-1 w-full border border-stone bg-white px-3 py-2 text-sm text-graphite"
          />
        </label>
        <label className="text-xs text-slate">
          End Date
          <input
            type="date"
            value={endDate}
            onChange={(event) => setEndDate(event.target.value)}
            className="mt-1 w-full border border-stone bg-white px-3 py-2 text-sm text-graphite"
          />
        </label>
        <label className="text-xs text-slate">
          Geography
          <select
            value={preset}
            onChange={(event) => setPreset(event.target.value as CustomerGeoPreset)}
            className="mt-1 w-full border border-stone bg-white px-3 py-2 text-sm text-graphite"
          >
            {PRESET_OPTIONS.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </select>
        </label>
        <div className="border border-stone bg-white px-3 py-2">
          <p className="text-[10px] uppercase tracking-wide text-mist">Status</p>
          <p className="mt-1 text-sm text-navy">{isLoading ? 'Loading…' : 'Ready'}</p>
          {error ? <p className="mt-1 text-xs text-phoenix-red">{error}</p> : null}
        </div>
      </section>

      <section className="grid gap-6 lg:grid-cols-[300px_minmax(0,1fr)]">
        <aside className="border border-stone bg-white p-3">
          <div className="mb-2 flex items-center justify-between">
            <h2 className="font-heading text-sm text-navy">Client Filter</h2>
            <button
              type="button"
              onClick={() => setSelectedShopIds([])}
              className="text-xs text-phoenix-red"
            >
              Clear
            </button>
          </div>
          <div className="mb-2 space-y-2">
            <input
              type="search"
              value={shopQuery}
              onChange={(event) => setShopQuery(event.target.value)}
              placeholder="Search client by name or ID"
              className="w-full border border-stone bg-white px-2 py-1.5 text-xs text-graphite"
            />
            <div className="flex items-center justify-between">
              <p className="text-[10px] uppercase tracking-wide text-mist">
                Showing {filteredShops.length} of {shops.length}
              </p>
              <label className="text-[10px] uppercase tracking-wide text-mist">
                Sort
                <select
                  value={shopSort}
                  onChange={(event) => setShopSort(event.target.value as 'volume' | 'alpha')}
                  className="ml-2 border border-stone bg-white px-1.5 py-1 text-[11px] text-graphite"
                >
                  <option value="volume">Volume</option>
                  <option value="alpha">A-Z</option>
                </select>
              </label>
            </div>
            <p className="text-[11px] text-slate">
              Clients listed here have geocoded ZIP activity in the selected date and geography scope.
            </p>
          </div>
          <div className="max-h-[440px] space-y-1 overflow-auto pr-1">
            {filteredShops.map((shop) => {
              const active = selectedShopIds.includes(shop.shop_id)
              return (
                <label
                  key={shop.shop_id || shop.shop_name}
                  className={`flex cursor-pointer items-start gap-2 border px-2 py-2 text-xs ${
                    active ? 'border-phoenix-red bg-bone' : 'border-stone bg-white'
                  }`}
                >
                  <input
                    type="checkbox"
                    checked={active}
                    onChange={() => toggleShop(shop.shop_id)}
                    className="mt-0.5"
                  />
                  <span className="min-w-0">
                    <span className="block truncate text-graphite">{shop.shop_name}</span>
                    <span className="block text-mist">{compact(shop.repair_count)} repairs</span>
                  </span>
                </label>
              )
            })}
            {!filteredShops.length ? (
              <p className="px-2 py-3 text-xs text-slate">
                No clients matched this search in the current date/geography scope.
              </p>
            ) : null}
          </div>
        </aside>

        <div className="space-y-4">
          <section className="grid gap-3 md:grid-cols-2 xl:grid-cols-6">
            <article className="border border-stone bg-white px-4 py-3">
              <p className="text-[10px] uppercase tracking-wide text-mist">ZIP Markers</p>
              <p className="mt-1 font-heading text-xl text-navy">
                {compact(pinsResponse?.summary.pin_count || 0)}
              </p>
            </article>
            <article className="border border-stone bg-white px-4 py-3">
              <p className="text-[10px] uppercase tracking-wide text-mist">Repair Orders</p>
              <p className="mt-1 font-heading text-xl text-navy">
                {compact(zipResponse?.summary.total_repairs || 0)}
              </p>
            </article>
            <article className="border border-stone bg-white px-4 py-3">
              <p className="text-[10px] uppercase tracking-wide text-mist">Registered Vehicles</p>
              <p className="mt-1 font-heading text-xl text-navy">
                {compactNullable(zipResponse?.summary.total_registered_vehicles ?? null)}
              </p>
            </article>
            <article className="border border-stone bg-white px-4 py-3">
              <p className="text-[10px] uppercase tracking-wide text-mist">Vehicle Pen% (RO)</p>
              <p className="mt-1 font-heading text-xl text-navy">
                {pctNullable(zipResponse?.summary.vehicle_repair_penetration_pct ?? null)}
              </p>
            </article>
            <article className="border border-stone bg-white px-4 py-3">
              <p className="text-[10px] uppercase tracking-wide text-mist">Market Share</p>
              <p className="mt-1 font-heading text-xl text-navy">
                {pctNullable(zipResponse?.summary.market_share_pct ?? null)}
              </p>
            </article>
            <article className="border border-stone bg-white px-4 py-3">
              <p className="text-[10px] uppercase tracking-wide text-mist">Weighted Mean Income</p>
              <p className="mt-1 font-heading text-xl text-navy">
                {formatMoney(zipResponse?.summary.weighted_mean_household_income ?? null)}
              </p>
            </article>
            <article className="border border-stone bg-white px-4 py-3">
              <p className="text-[10px] uppercase tracking-wide text-mist">Avg Opportunity</p>
              <p className="mt-1 font-heading text-xl text-navy">
                {zipResponse?.summary.avg_opportunity_score !== null && zipResponse?.summary.avg_opportunity_score !== undefined
                  ? zipResponse.summary.avg_opportunity_score.toFixed(1)
                  : '—'}
              </p>
            </article>
          </section>

          <section className="grid gap-3 md:grid-cols-3">
            <article className="border border-stone bg-white px-4 py-3">
              <p className="text-[10px] uppercase tracking-wide text-mist">Income Coverage</p>
              <p className="mt-1 font-heading text-xl text-navy">{pct(incomeCoveragePct)}</p>
              <p className="mt-1 text-xs text-slate">
                {rowsWithIncome.toLocaleString()} of {zipRows.length.toLocaleString()} ZIP rows have income.
              </p>
            </article>
            <article className="border border-stone bg-white px-4 py-3">
              <p className="text-[10px] uppercase tracking-wide text-mist">ZIPs</p>
              <p className="mt-1 font-heading text-xl text-navy">
                {compact(zipResponse?.summary.zip_count || 0)}
              </p>
              <p className="mt-1 text-xs text-slate">
                ZIP rows shown in the current geography and client scope.
              </p>
            </article>
            <article className="border border-stone bg-white px-4 py-3">
              <p className="text-[10px] uppercase tracking-wide text-mist">Selected Clients</p>
              <p className="mt-1 font-heading text-xl text-navy">{compact(selectedShopIds.length)}</p>
              <p className="mt-1 text-xs text-slate">
                Empty selection means all clients in this date and geography scope.
              </p>
            </article>
          </section>

          <section className="border border-stone bg-white">
            <div ref={mapNodeRef} className="h-[520px] w-full" />
            {!isLoading && !error && (pinsResponse?.summary.pin_count || 0) === 0 ? (
              <p className="border-t border-stone px-4 py-3 text-xs text-slate">
                No ZIP aggregates matched the current date, geography, and client filters.
              </p>
            ) : null}
          </section>

          <section className="border border-stone bg-white">
            <div className="overflow-auto">
              <table className="min-w-full border-collapse text-xs">
                <thead className="bg-bone">
                  <tr className="text-left text-[10px] uppercase tracking-wide text-slate">
                    <th className="px-3 py-2">ZIP</th>
                    <th className="px-3 py-2">County</th>
                    <th className="px-3 py-2">Repair Orders</th>
                    <th className="px-3 py-2">Registered Vehicles</th>
                    <th className="px-3 py-2">Vehicle Pen% (RO)</th>
                    <th className="px-3 py-2">Market Share %</th>
                    <th className="px-3 py-2">Competitor Shops</th>
                    <th className="px-3 py-2">Opportunity</th>
                    <th className="px-3 py-2">Mean Income</th>
                    <th className="px-3 py-2">Median Income</th>
                  </tr>
                </thead>
                <tbody>
                  {(zipResponse?.rows || []).slice(0, 200).map((row) => (
                    <tr
                      key={`${row.zip || 'zip'}:${row.state || 'state'}`}
                      className="border-t border-stone/70 text-graphite"
                    >
                      <td className="px-3 py-2 font-heading text-navy">{row.zip}</td>
                      <td className="px-3 py-2">{row.county_name || '—'}</td>
                      <td className="px-3 py-2">{row.repair_count.toLocaleString()}</td>
                      <td className="px-3 py-2">
                        {row.registered_vehicles === null ? 'DMV unavailable' : row.registered_vehicles.toLocaleString()}
                      </td>
                      <td className="px-3 py-2">{pctNullable(row.vehicle_repair_penetration_pct)}</td>
                      <td className="px-3 py-2">{pctNullable(row.market_share_pct)}</td>
                      <td className="px-3 py-2">
                        {row.competitor_shop_count === null ? '—' : row.competitor_shop_count.toLocaleString()}
                      </td>
                      <td className="px-3 py-2 font-heading">
                        {row.opportunity_score === null
                          ? '—'
                          : <span className={
                              row.opportunity_score >= 70 ? 'text-green-700' :
                              row.opportunity_score >= 40 ? 'text-amber-600' :
                              'text-red-600'
                            }>{row.opportunity_score.toFixed(1)}</span>
                        }
                      </td>
                      <td className="px-3 py-2">
                        {row.mean_household_income === null
                          ? 'Income unavailable'
                          : formatMoney(row.mean_household_income)}
                      </td>
                      <td className="px-3 py-2">
                        {row.median_household_income === null
                          ? 'Income unavailable'
                          : formatMoney(row.median_household_income)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>
        </div>
      </section>
    </div>
  )
}
