'use client'

import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import maplibregl, { type GeoJSONSource, type Map as MapLibreMap } from 'maplibre-gl'
import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  Legend,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts'
import { PSG_COLORS } from '@/lib/psgTheme'
import { Metric, Panel } from '@/components/ui'
import { PSG_TOKENS } from '@/lib/psgTokens'
import type {
  FlowerHillCustomerRow,
  FlowerHillMakeRow,
  FlowerHillMarketZipRow,
  FlowerHillReportData,
  FlowerHillZipRow,
} from '@/types'

function compactNumber(value: number) {
  return Intl.NumberFormat('en-US', {
    notation: value >= 10000 ? 'compact' : 'standard',
    maximumFractionDigits: 1,
  }).format(value)
}

function dollars(value: number) {
  return Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD',
    maximumFractionDigits: 0,
  }).format(value)
}

function dollarsCompact(value: number) {
  if (value >= 1_000_000) return `$${(value / 1_000_000).toFixed(1)}M`
  if (value >= 1_000) return `$${(value / 1_000).toFixed(0)}K`
  return `$${value.toLocaleString()}`
}

function shortDate(iso: string | null) {
  if (!iso) return ''
  const d = new Date(iso.slice(0, 10))
  return d.toLocaleDateString('en-US', { month: 'short', year: '2-digit' })
}


const FLOWER_HILL_LOCATIONS = [
  { name: 'Roslyn', address: '12 Middle Neck Rd, Roslyn, NY 11576', lat: 40.7991373, lng: -73.6640659 },
  { name: 'Glen Cove', address: '36 Morris Ave, Glen Cove, NY 11542', lat: 40.8587349, lng: -73.6388497 },
  { name: 'Huntington', address: 'Huntington, NY', lat: 40.8675, lng: -73.4262 },
] as const

function buildCircle(lng: number, lat: number, radiusMiles: number, points = 64): [number, number][] {
  const km = radiusMiles * 1.60934
  const earthRadiusKm = 6371
  const angularDistance = km / earthRadiusKm
  const latRad = (lat * Math.PI) / 180
  const lngRad = (lng * Math.PI) / 180
  const coords: [number, number][] = []
  for (let i = 0; i <= points; i++) {
    const bearing = (i * 2 * Math.PI) / points
    const sinLat2 = Math.sin(latRad) * Math.cos(angularDistance) + Math.cos(latRad) * Math.sin(angularDistance) * Math.cos(bearing)
    const lat2 = Math.asin(sinLat2)
    const y = Math.sin(bearing) * Math.sin(angularDistance) * Math.cos(latRad)
    const x = Math.cos(angularDistance) - Math.sin(latRad) * sinLat2
    const lng2 = lngRad + Math.atan2(y, x)
    coords.push([(lng2 * 180) / Math.PI, (lat2 * 180) / Math.PI])
  }
  return coords
}

type SortKey = 'name' | 'vehicle' | 'repair_total' | 'insurance' | 'pay_type' | 'date' | 'zip'
type SortDir = 'asc' | 'desc'

export default function FlowerHillDashboard() {
  const [data, setData] = useState<FlowerHillReportData | null>(null)
  const [isLoading, setIsLoading] = useState(true)
  const [error, setError] = useState('')
  const [search, setSearch] = useState('')
  const [targetOnly, setTargetOnly] = useState(false)
  const [sortKey, setSortKey] = useState<SortKey>('date')
  const [sortDir, setSortDir] = useState<SortDir>('desc')
  const [zipSort, setZipSort] = useState<{ key: keyof FlowerHillZipRow; dir: SortDir }>({ key: 'consumer_db_count', dir: 'desc' })
  const [mzSort, setMzSort] = useState<{ key: keyof FlowerHillMarketZipRow; dir: SortDir }>({ key: 'repair_orders', dir: 'desc' })
  const [radius, setRadius] = useState(25)
  const [pendingRadius, setPendingRadius] = useState(25)
  const [mapNode, setMapNode] = useState<HTMLDivElement | null>(null)
  const [mapReady, setMapReady] = useState(false)
  const dataRef = useRef<FlowerHillReportData | null>(null)
  const mapRef = useRef<MapLibreMap | null>(null)
  const mapReadyRef = useRef(false)
  const initialFitDoneRef = useRef(false)

  useEffect(() => {
    const controller = new AbortController()
    setIsLoading(true)
    setError('')

    fetch(`/api/flower-hill?radius=${radius}`, { signal: controller.signal })
      .then((res) => {
        if (!res.ok) throw new Error(`Request failed: ${res.status}`)
        return res.json() as Promise<FlowerHillReportData>
      })
      .then(setData)
      .catch((err) => {
        if (err.name !== 'AbortError') {
          setError(err instanceof Error ? err.message : 'Failed to load report')
        }
      })
      .finally(() => setIsLoading(false))

    return () => controller.abort()
  }, [radius])

  useEffect(() => {
    if (!mapNode || mapRef.current) return

    const map = new maplibregl.Map({
      container: mapNode,
      style: {
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
      },
      center: [-73.65, 40.82],
      zoom: 9.5,
      attributionControl: false,
    })

    map.addControl(new maplibregl.NavigationControl({ visualizePitch: false }), 'top-right')
    map.addControl(new maplibregl.AttributionControl({ compact: true }), 'bottom-right')

    // Build pin SVG → map image
    const makePinImage = (color: string, strokeColor: string = PSG_TOKENS.white): Promise<HTMLImageElement> => {
      const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="32" height="44" viewBox="0 0 32 44"><path d="M16 2 C8 2 2 8 2 16 C2 26 16 42 16 42 C16 42 30 26 30 16 C30 8 24 2 16 2 Z" fill="${color}" stroke="${strokeColor}" stroke-width="2"/><circle cx="16" cy="16" r="5" fill="${strokeColor}"/></svg>`
      const blob = new Blob([svg], { type: 'image/svg+xml' })
      const url = URL.createObjectURL(blob)
      return new Promise((resolve, reject) => {
        const img = new Image()
        img.onload = () => { URL.revokeObjectURL(url); resolve(img) }
        img.onerror = reject
        img.src = url
      })
    }

    map.on('load', async () => {
      // Load pin images
      const [targetPin, otherPin, shopPin] = await Promise.all([
        makePinImage(PSG_TOKENS.phoenixRed),
        makePinImage(PSG_TOKENS.slate),
        makePinImage(PSG_TOKENS.navy, PSG_TOKENS.warning),
      ])
      if (!map.hasImage('pin-target')) map.addImage('pin-target', targetPin)
      if (!map.hasImage('pin-other')) map.addImage('pin-other', otherPin)
      if (!map.hasImage('pin-shop')) map.addImage('pin-shop', shopPin)

      // Customer source
      map.addSource('fh-customers', {
        type: 'geojson',
        data: { type: 'FeatureCollection', features: [] },
      })

      // OTHER customer pins (smaller, muted)
      map.addLayer({
        id: 'fh-other-pin',
        type: 'symbol',
        source: 'fh-customers',
        filter: ['==', ['get', 'isTarget'], false],
        layout: {
          'icon-image': 'pin-other',
          'icon-size': ['interpolate', ['linear'], ['zoom'], 9, 0.25, 12, 0.4, 14, 0.55, 17, 0.8],
          'icon-anchor': 'bottom',
          'icon-allow-overlap': true,
        },
      })

      // HYPER-TARGETING customer pins (full size, red)
      map.addLayer({
        id: 'fh-target-pin',
        type: 'symbol',
        source: 'fh-customers',
        filter: ['==', ['get', 'isTarget'], true],
        layout: {
          'icon-image': 'pin-target',
          'icon-size': ['interpolate', ['linear'], ['zoom'], 9, 0.25, 12, 0.4, 14, 0.55, 17, 0.8],
          'icon-anchor': 'bottom',
          'icon-allow-overlap': true,
        },
      })

      // SHOPS - bigger pins on top
      map.addSource('fh-shops', {
        type: 'geojson',
        data: {
          type: 'FeatureCollection',
          features: FLOWER_HILL_LOCATIONS.map((shop) => ({
            type: 'Feature' as const,
            properties: { name: shop.name, address: shop.address },
            geometry: { type: 'Point' as const, coordinates: [shop.lng, shop.lat] },
          })),
        },
      })
      map.addLayer({
        id: 'fh-shop-pin',
        type: 'symbol',
        source: 'fh-shops',
        layout: {
          'icon-image': 'pin-shop',
          'icon-size': 0.7,
          'icon-anchor': 'bottom',
          'icon-allow-overlap': true,
          'text-field': ['get', 'name'],
          'text-size': 13,
          'text-font': ['Open Sans Semibold', 'Arial Unicode MS Bold'],
          'text-offset': [0, 0.6],
          'text-anchor': 'top',
          'text-allow-overlap': true,
        },
        paint: {
          'text-color': PSG_TOKENS.navy,
          'text-halo-color': PSG_TOKENS.white,
          'text-halo-width': 2.5,
        },
      })

      const customerPopup = (e: maplibregl.MapMouseEvent & { features?: maplibregl.MapGeoJSONFeature[] }) => {
        const f = e.features?.[0]
        if (!f || f.geometry.type !== 'Point') return
        new maplibregl.Popup({ offset: 8, maxWidth: '300px' })
          .setLngLat(f.geometry.coordinates as [number, number])
          .setHTML(`<div style="font-size:12px;line-height:1.6;font-family:Didact Gothic, system-ui"><div style="font-weight:600;color:${PSG_TOKENS.navy};margin-bottom:4px">${String(f.properties.name)}</div><div style="color:${PSG_TOKENS.slate}">${String(f.properties.vehicle)}</div>${f.properties.address ? `<div style="color:${PSG_TOKENS.slate};margin-top:2px">${String(f.properties.address)}</div>` : ''}<div style="color:${PSG_TOKENS.mist};margin-top:4px;font-size:11px">${String(f.properties.shop)}</div></div>`)
          .addTo(map)
      }
      map.on('click', 'fh-target-pin', customerPopup)
      map.on('click', 'fh-other-pin', customerPopup)

      map.on('click', 'fh-shop-pin', (e) => {
        const f = e.features?.[0]
        if (!f || f.geometry.type !== 'Point') return
        new maplibregl.Popup({ offset: 12, maxWidth: '280px' })
          .setLngLat(f.geometry.coordinates as [number, number])
          .setHTML(`<div style="font-size:13px;line-height:1.5;font-family:Didact Gothic, system-ui"><div style="font-weight:600;color:${PSG_TOKENS.phoenixRed};font-size:11px;text-transform:uppercase;letter-spacing:0.5px;margin-bottom:4px">Flower Hill</div><div style="font-weight:600;color:${PSG_TOKENS.navy};margin-bottom:2px">${String(f.properties.name)}</div><div style="color:${PSG_TOKENS.slate}">${String(f.properties.address)}</div></div>`)
          .addTo(map)
      })

      for (const layer of ['fh-target-pin', 'fh-other-pin', 'fh-shop-pin', 'fh-target-clusters', 'fh-other-clusters']) {
        map.on('mouseenter', layer, () => { map.getCanvas().style.cursor = 'pointer' })
        map.on('mouseleave', layer, () => { map.getCanvas().style.cursor = '' })
      }

      mapReadyRef.current = true
      setMapReady(true)
    })

    mapRef.current = map
    return () => {
      map.remove()
      mapRef.current = null
      mapReadyRef.current = false
      setMapReady(false)
    }
  }, [mapNode])

  useEffect(() => {
    dataRef.current = data
    if (!data || !mapReady || !mapRef.current) return
    const map = mapRef.current

    const source = map.getSource('fh-customers') as GeoJSONSource | undefined
    if (!source) {
      console.warn('[fh-map] source missing')
      return
    }

    const features = data.customers
      .filter((c) => c.latitude != null && c.longitude != null && !Number.isNaN(c.latitude) && !Number.isNaN(c.longitude))
      .map((c) => ({
        type: 'Feature' as const,
        properties: {
          name: [c.customer_first_name, c.customer_last_name].filter(Boolean).join(' '),
          vehicle: [c.vehicle_year, c.vehicle_make, c.vehicle_model].filter(Boolean).join(' '),
          shop: c.shop_name,
          address: c.formatted_address || '',
          zip: c.customer_zip || '',
          isTarget: c.is_target_vehicle,
        },
        geometry: { type: 'Point' as const, coordinates: [c.longitude as number, c.latitude as number] },
      }))

    source.setData({ type: 'FeatureCollection', features })
    console.log('[fh-map]', features.length, 'customers loaded')
  }, [data, mapReady])

  const applyRadius = useCallback(() => {
    if (pendingRadius !== radius) setRadius(pendingRadius)
  }, [pendingRadius, radius])

  const filteredCustomers = useMemo(() => {
    if (!data) return []
    let rows = data.customers
    if (targetOnly) rows = rows.filter((c) => c.is_target_vehicle)
    if (search.trim()) {
      const q = search.toLowerCase()
      rows = rows.filter((c) =>
        [c.customer_first_name, c.customer_last_name, c.vehicle_make, c.vehicle_model,
         c.insurance_company, c.pay_type, c.customer_zip, c.shop_name,
         c.vehicle_year?.toString(), c.repair_total?.toString()]
          .some((field) => field?.toLowerCase().includes(q))
      )
    }
    return [...rows].sort((a, b) => {
      const dir = sortDir === 'asc' ? 1 : -1
      switch (sortKey) {
        case 'name': return dir * ((a.customer_last_name || '').localeCompare(b.customer_last_name || ''))
        case 'vehicle': return dir * ((a.vehicle_make || '').localeCompare(b.vehicle_make || ''))
        case 'repair_total': return dir * ((a.repair_total || 0) - (b.repair_total || 0))
        case 'insurance': return dir * ((a.insurance_company || '').localeCompare(b.insurance_company || ''))
        case 'pay_type': return dir * ((a.pay_type || '').localeCompare(b.pay_type || ''))
        case 'date': return dir * ((a.date_in || '').localeCompare(b.date_in || ''))
        case 'zip': return dir * ((a.customer_zip || '').localeCompare(b.customer_zip || ''))
        default: return 0
      }
    })
  }, [data, search, targetOnly, sortKey, sortDir])

  const sortedZips = useMemo(() => {
    if (!data) return []
    return [...data.zip_breakdown].sort((a, b) => {
      const dir = zipSort.dir === 'asc' ? 1 : -1
      const av = a[zipSort.key]
      const bv = b[zipSort.key]
      if (av === null && bv === null) return 0
      if (av === null) return 1
      if (bv === null) return -1
      if (typeof av === 'string') return dir * av.localeCompare(bv as string)
      return dir * ((av as number) - (bv as number))
    })
  }, [data, zipSort])

  const sortedMarketZips = useMemo(() => {
    if (!data) return []
    return [...data.market_zips].sort((a, b) => {
      const dir = mzSort.dir === 'asc' ? 1 : -1
      const av = a[mzSort.key]
      const bv = b[mzSort.key]
      if (av === null && bv === null) return 0
      if (av === null) return 1
      if (bv === null) return -1
      if (typeof av === 'string') return dir * av.localeCompare(bv as string)
      return dir * ((av as number) - (bv as number))
    })
  }, [data, mzSort])

  function toggleMzSort(key: keyof FlowerHillMarketZipRow) {
    if (mzSort.key === key) setMzSort({ key, dir: mzSort.dir === 'asc' ? 'desc' : 'asc' })
    else setMzSort({ key, dir: 'desc' })
  }

  function toggleSort(key: SortKey) {
    if (sortKey === key) setSortDir(sortDir === 'asc' ? 'desc' : 'asc')
    else { setSortKey(key); setSortDir('desc') }
  }

  function toggleZipSort(key: keyof FlowerHillZipRow) {
    if (zipSort.key === key) setZipSort({ key, dir: zipSort.dir === 'asc' ? 'desc' : 'asc' })
    else setZipSort({ key, dir: 'desc' })
  }

  if (!data && isLoading) {
    return (
      <div className="flex min-h-[400px] items-center justify-center">
        <div className="text-center">
          <div className="mx-auto mb-4 h-8 w-8 animate-spin rounded-full border-2 border-stone border-t-phoenix-red" />
          <p className="text-sm text-slate">Loading Flower Hill report&hellip;</p>
        </div>
      </div>
    )
  }

  if (error && !data) {
    return (
      <div className="border border-phoenix-red/20 bg-phoenix-red/5 p-6 text-center">
        <p className="text-sm font-medium text-phoenix-red">{error}</p>
      </div>
    )
  }

  if (!data) return null

  const { metrics, make_breakdown } = data
  const dateRangeText = metrics.first_date && metrics.last_date
    ? `${shortDate(metrics.first_date)} — ${shortDate(metrics.last_date)}`
    : ''
  const makeChartData = make_breakdown.filter((m) => m.consumer_db_count > 0 || m.psg_customer_count > 0)
  const geocodedCount = data.customers.filter((c) => c.latitude && c.longitude).length

  return (
    <div className="space-y-6">
      {isLoading && (
        <div className="fixed inset-x-0 top-0 z-50 h-1 overflow-hidden bg-stone">
          <div className="h-full w-1/3 animate-pulse bg-phoenix-red" style={{ animation: 'pulse 1s ease-in-out infinite, slideRight 1.5s ease-in-out infinite' }} />
        </div>
      )}

      {/* Header */}
      <section className="border border-stone bg-white">
        <div className="p-5">
          <p className="text-xs font-medium uppercase text-phoenix-red">Market Report</p>
          <h2 className="mt-1 font-heading text-2xl font-medium text-navy">
            Flower Hill — Market Intelligence Report
          </h2>
          <div className="mt-3 flex flex-wrap gap-2 text-xs font-medium">
            <span className="bg-bone px-2.5 py-1 text-navy">28 Premium Makes</span>
            <span className="bg-bone px-2.5 py-1 text-navy">2020 — 2025</span>
            <span className="bg-paper px-2.5 py-1 text-slate">
              Consumer DB: {compactNumber(metrics.consumer_db_total)} households
            </span>
            {metrics.shop_names.map((name) => (
              <span key={name} className="bg-paper px-2.5 py-1 text-slate">{name}</span>
            ))}
          </div>
        </div>
      </section>

      {/* KPI Cards — Row 1: Volume */}
      <section className="grid grid-cols-2 gap-3 md:grid-cols-4">
        <Metric size="lg"
          label="Total Repairs"
          value={compactNumber(metrics.total_repairs)}
          detail={dateRangeText}
        />
        <Metric size="lg"
          label="Unique Customers"
          value={compactNumber(metrics.unique_customers)}
          detail={dateRangeText}
        />
        <Metric size="lg"
          label="Total Revenue"
          value={dollarsCompact(metrics.total_revenue)}
          detail="From submitted customers"
        />
        <Metric size="lg"
          label="Avg Repair Value"
          value={dollars(metrics.avg_repair_value)}
          detail="From submitted customers"
        />
      </section>

      {/* KPI Cards — Row 2: Targeting */}
      <section className="grid grid-cols-1 gap-3 md:grid-cols-3">
        <Metric
          size="lg"
          tone="accent"
          label="Hyper Targeting Customers"
          value={compactNumber(metrics.target_vehicle_matches)}
          detail={`${metrics.target_vehicle_match_rate}% of customers`}
        />
        <Metric size="lg"
          label={`Market Penetration · ${radius}mi`}
          value={metrics.market_penetration_radius_pct != null ? `${metrics.market_penetration_radius_pct}%` : '—'}
          detail={`${compactNumber(metrics.registered_vehicles_in_radius)} reg. vehicles in radius`}
        />
        <Metric size="lg"
          label="Household Penetration"
          value={metrics.household_penetration_pct != null ? `${metrics.household_penetration_pct}%` : '—'}
          detail={`${compactNumber(metrics.unique_customers)} households served`}
        />
      </section>

      {/* Customer Map */}
      <section className="border border-stone bg-white p-5">
        <div className="mb-4">
          <p className="text-xs font-medium uppercase text-phoenix-red">{geocodedCount} geocoded customers</p>
          <h3 className="mt-1 font-heading text-base font-medium text-navy">Customer Map</h3>
        </div>
        <div className="flex flex-wrap items-center gap-5 mb-3 text-xs">
          <span className="flex items-center gap-2">
            <svg width="14" height="20" viewBox="0 0 32 44"><path d="M16 2 C8 2 2 8 2 16 C2 26 16 42 16 42 C16 42 30 26 30 16 C30 8 24 2 16 2 Z" fill={PSG_TOKENS.navy} stroke={PSG_TOKENS.warning} strokeWidth="2"/><circle cx="16" cy="16" r="5" fill={PSG_TOKENS.warning}/></svg>
            <span className="font-medium text-navy">Flower Hill shop</span>
          </span>
          <span className="flex items-center gap-2">
            <svg width="12" height="17" viewBox="0 0 32 44"><path d="M16 2 C8 2 2 8 2 16 C2 26 16 42 16 42 C16 42 30 26 30 16 C30 8 24 2 16 2 Z" fill={PSG_TOKENS.phoenixRed} stroke={PSG_TOKENS.white} strokeWidth="2"/><circle cx="16" cy="16" r="5" fill={PSG_TOKENS.white}/></svg>
            <span className="font-medium text-navy">Hyper targeting customer</span>
          </span>
          <span className="flex items-center gap-2">
            <svg width="10" height="14" viewBox="0 0 32 44"><path d="M16 2 C8 2 2 8 2 16 C2 26 16 42 16 42 C16 42 30 26 30 16 C30 8 24 2 16 2 Z" fill={PSG_TOKENS.slate} stroke={PSG_TOKENS.white} strokeWidth="2"/><circle cx="16" cy="16" r="5" fill={PSG_TOKENS.white}/></svg>
            <span className="text-slate">Other customer</span>
          </span>
        </div>
        <div ref={setMapNode} className="h-[480px] w-full border border-stone" />
      </section>

      {/* Market ZIP Metrics */}
      <section className="border border-stone bg-white p-5">
        <div className="mb-4 flex flex-wrap items-end justify-between gap-4">
          <div>
            <p className="text-xs font-medium uppercase text-phoenix-red">Flower Hill shops by ZIP</p>
            <h3 className="mt-1 font-heading text-base font-medium text-navy">Household Market Metrics</h3>
          </div>
          <div className="flex items-center gap-3">
            <label className="text-xs font-medium uppercase text-slate">Radius</label>
            <input
              type="range"
              min={5}
              max={50}
              step={5}
              value={pendingRadius}
              onChange={(e) => setPendingRadius(Number(e.target.value))}
              onMouseUp={applyRadius}
              onTouchEnd={applyRadius}
              className="w-32 accent-phoenix-red"
            />
            <span className="min-w-[52px] border border-stone bg-bone px-2 py-1 text-center text-sm font-medium text-navy">{pendingRadius} mi</span>
            {pendingRadius !== radius && (
              <button onClick={applyRadius} className="bg-navy px-3 py-1 text-xs font-medium text-white">Apply</button>
            )}
          </div>
        </div>
        <div className="max-h-[520px] overflow-auto">
          <table className="w-full text-left text-sm">
            <thead className="sticky top-0 bg-white text-xs uppercase text-slate">
              <tr>
                <MzTh label="ZIP" sortKey="zip" current={mzSort} onSort={toggleMzSort} />
                <MzTh label="City" sortKey="city" current={mzSort} onSort={toggleMzSort} />
                <MzTh label="Repair Orders" sortKey="repair_orders" current={mzSort} onSort={toggleMzSort} className="text-right" />
                <MzTh label="Reg. Vehicles" sortKey="registered_vehicles" current={mzSort} onSort={toggleMzSort} className="text-right" />
                <MzTh label="Veh Pen%" sortKey="vehicle_pen_pct" current={mzSort} onSort={toggleMzSort} className="text-right" />
                <MzTh label="Mkt Share%" sortKey="market_share_pct" current={mzSort} onSort={toggleMzSort} className="text-right" />
                <MzTh label="Competitors" sortKey="competitor_shops" current={mzSort} onSort={toggleMzSort} className="text-right" />
                <MzTh label="EV Vehicles" sortKey="ev_vehicles" current={mzSort} onSort={toggleMzSort} className="text-right" />
                <MzTh label="Opportunity" sortKey="opportunity_score" current={mzSort} onSort={toggleMzSort} className="text-right" />
                <MzTh label="Mean Income" sortKey="mean_income" current={mzSort} onSort={toggleMzSort} className="text-right" />
                <MzTh label="Median Income" sortKey="median_income" current={mzSort} onSort={toggleMzSort} className="text-right" />
              </tr>
            </thead>
            <tbody className="divide-y divide-stone/50">
              {sortedMarketZips.map((row) => (
                <tr key={row.zip} className="hover:bg-bone/30">
                  <td className="py-2 pr-3 font-medium text-navy">{row.zip}</td>
                  <td className="py-2 pr-3 text-slate">{row.city || '—'}</td>
                  <td className="py-2 pr-3 text-right tabular-nums">{row.repair_orders}</td>
                  <td className="py-2 pr-3 text-right tabular-nums">{row.registered_vehicles?.toLocaleString() ?? '—'}</td>
                  <td className="py-2 pr-3 text-right tabular-nums">{row.vehicle_pen_pct != null ? `${row.vehicle_pen_pct}%` : '—'}</td>
                  <td className="py-2 pr-3 text-right tabular-nums">{row.market_share_pct != null ? `${row.market_share_pct}%` : '—'}</td>
                  <td className="py-2 pr-3 text-right tabular-nums">{row.competitor_shops ?? '—'}</td>
                  <td className="py-2 pr-3 text-right tabular-nums">{row.ev_vehicles?.toLocaleString() ?? '—'}</td>
                  <td className="py-2 pr-3 text-right">
                    {row.opportunity_score != null ? (
                      <span className={`inline-block min-w-[44px] rounded px-1.5 py-0.5 text-right text-xs font-medium ${
                        row.opportunity_score >= 70 ? 'bg-clarity/10 text-clarity'
                          : row.opportunity_score >= 40 ? 'bg-catalyst/10 text-catalyst'
                            : 'bg-phoenix-red/10 text-phoenix-red'
                      }`}>
                        {row.opportunity_score.toFixed(0)}
                      </span>
                    ) : '—'}
                  </td>
                  <td className="py-2 pr-3 text-right tabular-nums">{row.mean_income != null ? dollars(row.mean_income) : '—'}</td>
                  <td className="py-2 text-right tabular-nums">{row.median_income != null ? dollars(row.median_income) : '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
          {sortedMarketZips.length === 0 && (
            <p className="py-6 text-center text-sm text-mist">No market ZIP data available yet.</p>
          )}
        </div>
      </section>

      {/* ZIP Comparison + Make Chart */}
      <section className="grid grid-cols-1 gap-6 xl:grid-cols-5">
        <Panel title="ZIP Comparison" kicker="PSG vs Consumer Database" className="xl:col-span-3">
          <div className="max-h-[460px] overflow-auto">
            <table className="w-full text-left text-sm">
              <thead className="sticky top-0 bg-white text-xs uppercase text-slate">
                <tr>
                  <ZipTh label="ZIP" sortKey="zip" current={zipSort} onSort={toggleZipSort} />
                  <ZipTh label="City" sortKey="city" current={zipSort} onSort={toggleZipSort} />
                  <ZipTh label="PSG" sortKey="psg_customer_count" current={zipSort} onSort={toggleZipSort} className="text-right" />
                  <ZipTh label="Target" sortKey="target_vehicle_matches" current={zipSort} onSort={toggleZipSort} className="text-right" />
                  <ZipTh label="Consumer DB" sortKey="consumer_db_count" current={zipSort} onSort={toggleZipSort} className="text-right" />
                  <ZipTh label="Penetration" sortKey="penetration_pct" current={zipSort} onSort={toggleZipSort} className="text-right" />
                </tr>
              </thead>
              <tbody className="divide-y divide-stone/50">
                {sortedZips.map((row) => (
                  <tr key={row.zip} className="hover:bg-bone/30">
                    <td className="py-2 pr-3 font-medium text-navy">{row.zip}</td>
                    <td className="py-2 pr-3 text-slate">{row.city || '—'}</td>
                    <td className="py-2 pr-3 text-right tabular-nums">{row.psg_customer_count}</td>
                    <td className="py-2 pr-3 text-right tabular-nums">{row.target_vehicle_matches}</td>
                    <td className="py-2 pr-3 text-right tabular-nums">{row.consumer_db_count}</td>
                    <td className="py-2 text-right">
                      {row.penetration_pct !== null ? (
                        <span className={`inline-block min-w-[52px] rounded px-1.5 py-0.5 text-right text-xs font-medium ${
                          row.penetration_pct >= 10 ? 'bg-clarity/10 text-clarity'
                            : row.penetration_pct >= 3 ? 'bg-catalyst/10 text-catalyst'
                              : 'bg-phoenix-red/10 text-phoenix-red'
                        }`}>
                          {row.penetration_pct}%
                        </span>
                      ) : (
                        <span className="text-xs text-mist">{'—'}</span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Panel>

        <Panel title="Make Comparison" kicker="PSG vs Consumer DB" className="xl:col-span-2">
          <ResponsiveContainer width="100%" height={420}>
            <BarChart data={makeChartData} layout="vertical" margin={{ left: 10, right: 10 }}>
              <CartesianGrid strokeDasharray="3 3" stroke={PSG_COLORS.stone} />
              <XAxis type="number" tick={{ fontSize: 11 }} />
              <YAxis dataKey="make" type="category" width={105} tick={{ fontSize: 10 }} />
              <Tooltip />
              <Legend />
              <Bar dataKey="consumer_db_count" name="Consumer DB" fill={PSG_COLORS.foundationNavy} />
              <Bar dataKey="psg_customer_count" name="PSG Customers" fill={PSG_COLORS.phoenixRed} />
            </BarChart>
          </ResponsiveContainer>
        </Panel>
      </section>

      {/* Insurance + Pay Type */}
      <section className="grid grid-cols-1 gap-6 xl:grid-cols-2">
        <Panel title="Top Insurance Carriers" kicker="By repair count">
          <ResponsiveContainer width="100%" height={280}>
            <BarChart data={metrics.top_insurance} layout="vertical" margin={{ left: 20 }}>
              <CartesianGrid strokeDasharray="3 3" stroke={PSG_COLORS.stone} />
              <XAxis type="number" tick={{ fontSize: 12 }} />
              <YAxis dataKey="name" type="category" width={140} tick={{ fontSize: 11 }} />
              <Tooltip />
              <Bar dataKey="count" name="Repairs" fill={PSG_COLORS.clarity} />
            </BarChart>
          </ResponsiveContainer>
        </Panel>

        <Panel title="Pay Type Distribution" kicker="Payment method breakdown">
          <ResponsiveContainer width="100%" height={280}>
            <BarChart data={metrics.pay_type_distribution}>
              <CartesianGrid strokeDasharray="3 3" stroke={PSG_COLORS.stone} />
              <XAxis dataKey="name" tick={{ fontSize: 11 }} />
              <YAxis tick={{ fontSize: 12 }} />
              <Tooltip />
              <Bar dataKey="count" name="Repairs">
                {metrics.pay_type_distribution.map((_, index) => (
                  <Cell key={index} fill={[PSG_COLORS.phoenixRed, PSG_COLORS.clarity, PSG_COLORS.catalyst, PSG_COLORS.foundationNavy, PSG_COLORS.slate][index % 5]} />
                ))}
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        </Panel>
      </section>

      {/* Customer Table */}
      <Panel title="Customer List" kicker={`${filteredCustomers.length} of ${data.customers.length} records`}>
        <div className="mb-4 flex flex-wrap items-center gap-3">
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search customers..."
            className="w-full max-w-xs border border-stone px-3 py-2 text-sm text-navy focus:border-phoenix-red focus:outline-none focus:ring-2 focus:ring-phoenix-red focus:ring-offset-2"
          />
          <label className="flex cursor-pointer items-center gap-2 text-sm text-slate">
            <input
              type="checkbox"
              checked={targetOnly}
              onChange={(e) => setTargetOnly(e.target.checked)}
              className="accent-phoenix-red"
            />
            Hyper targeting customers only
          </label>
        </div>
        <div className="max-h-[520px] overflow-auto">
          <table className="w-full text-left text-sm">
            <thead className="sticky top-0 bg-white text-xs uppercase text-slate">
              <tr>
                <SortTh label="Name" sortKey="name" current={sortKey} dir={sortDir} onSort={toggleSort} />
                <SortTh label="Vehicle" sortKey="vehicle" current={sortKey} dir={sortDir} onSort={toggleSort} />
                <SortTh label="Repair Total" sortKey="repair_total" current={sortKey} dir={sortDir} onSort={toggleSort} className="text-right" />
                <SortTh label="Insurance" sortKey="insurance" current={sortKey} dir={sortDir} onSort={toggleSort} />
                <SortTh label="Pay Type" sortKey="pay_type" current={sortKey} dir={sortDir} onSort={toggleSort} />
                <SortTh label="Date In" sortKey="date" current={sortKey} dir={sortDir} onSort={toggleSort} />
                <SortTh label="ZIP" sortKey="zip" current={sortKey} dir={sortDir} onSort={toggleSort} />
              </tr>
            </thead>
            <tbody className="divide-y divide-stone/50">
              {filteredCustomers.slice(0, 500).map((c, i) => (
                <tr key={i} className={`hover:bg-bone/30 ${c.is_target_vehicle ? 'bg-clarity/[0.03]' : ''}`}>
                  <td className="whitespace-nowrap py-2 pr-3 font-medium text-navy">
                    {c.customer_first_name} {c.customer_last_name}
                  </td>
                  <td className="whitespace-nowrap py-2 pr-3">
                    {c.vehicle_year} {c.vehicle_make} {c.vehicle_model}
                    {c.is_target_vehicle && (
                      <span className="ml-1.5 inline-block rounded bg-phoenix-red/10 px-1.5 py-0.5 text-[10px] font-semibold uppercase text-phoenix-red">
                        Hyper Target
                      </span>
                    )}
                  </td>
                  <td className="whitespace-nowrap py-2 pr-3 text-right tabular-nums">
                    {c.repair_total != null ? dollars(c.repair_total) : '—'}
                  </td>
                  <td className="whitespace-nowrap py-2 pr-3 text-slate">{c.insurance_company || '—'}</td>
                  <td className="whitespace-nowrap py-2 pr-3 text-slate">{c.pay_type || '—'}</td>
                  <td className="whitespace-nowrap py-2 pr-3 tabular-nums text-slate">{c.date_in || '—'}</td>
                  <td className="whitespace-nowrap py-2 text-slate">{c.customer_zip || '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
          {filteredCustomers.length > 500 && (
            <p className="mt-2 text-center text-xs text-mist">
              Showing 500 of {filteredCustomers.length} rows
            </p>
          )}
        </div>
      </Panel>
    </div>
  )
}


function SortTh({ label, sortKey, current, dir, onSort, className = '' }: {
  label: string; sortKey: SortKey; current: SortKey; dir: SortDir; onSort: (k: SortKey) => void; className?: string
}) {
  const active = current === sortKey
  return (
    <th className={`cursor-pointer select-none whitespace-nowrap pb-2 pr-3 font-medium ${className}`} onClick={() => onSort(sortKey)}>
      {label} {active ? (dir === 'asc' ? '↑' : '↓') : ''}
    </th>
  )
}

function ZipTh({ label, sortKey, current, onSort, className = '' }: {
  label: string; sortKey: keyof FlowerHillZipRow; current: { key: keyof FlowerHillZipRow; dir: SortDir }; onSort: (k: keyof FlowerHillZipRow) => void; className?: string
}) {
  const active = current.key === sortKey
  return (
    <th className={`cursor-pointer select-none whitespace-nowrap pb-2 pr-3 font-medium ${className}`} onClick={() => onSort(sortKey)}>
      {label} {active ? (current.dir === 'asc' ? '↑' : '↓') : ''}
    </th>
  )
}

function MzTh({ label, sortKey, current, onSort, className = '' }: {
  label: string; sortKey: keyof FlowerHillMarketZipRow; current: { key: keyof FlowerHillMarketZipRow; dir: SortDir }; onSort: (k: keyof FlowerHillMarketZipRow) => void; className?: string
}) {
  const active = current.key === sortKey
  return (
    <th className={`cursor-pointer select-none whitespace-nowrap pb-2 pr-3 font-medium ${className}`} onClick={() => onSort(sortKey)}>
      {label} {active ? (current.dir === 'asc' ? '↑' : '↓') : ''}
    </th>
  )
}
