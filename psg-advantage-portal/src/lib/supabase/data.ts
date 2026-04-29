import { createClient as createBrowserlessClient } from '@supabase/supabase-js'
import { createClient as createServerClient } from '@/lib/supabase/server'
import { getSupabaseUrl } from '@/lib/supabase/config'
import type {
  AlertShop,
  MarketMapData,
  MarketMapPoint,
  MarketViewportIntelligence,
  MarketViewportTopCustomer,
  MarketViewportTopZip,
  NetworkSummary,
  PaginatedComments,
  ShopComment,
  ShopCompetitorPoint,
  ShopDetail,
  ShopListItem,
  ShopTrendPoint,
  TrendPoint,
} from '@/types'
import { buildRepairDemandScore, buildWeatherDemandScore, score } from '@/lib/marketingScoring'

export interface MarketingMetadataRow {
  row_count: number
  weather_related_count: number
  severe_accident_rate: number
  weather_related_rate: number
  average_distance_miles: number
  storm_event_count: number
  hail_event_count: number
  wind_event_count: number
  tornado_event_count: number
  storm_demand_score: number
  max_hail_size: number
  max_wind_speed: number
}

export interface MarketingZipRow {
  zip: string
  accidents: number
  storm_event_count: number
  hail_event_count: number
  wind_event_count: number
  tornado_event_count: number
  storm_demand_score: number
}

export interface MarketingDaypartRow {
  time: string
  claims: number
}

export interface MarketStateRollupRow {
  state: string
  total_accidents: number
  high_severity_count: number
  weather_related_count: number
  zip_count: number
  severe_rate: number
  weather_rate: number
  opportunity_score: number
}

export interface MarketDashboardZipRow extends MarketingZipRow {
  repair_demand: number
  paid_search_priority: number
  coverage_gap: number
}

export interface MarketDashboardDaypartRow extends MarketingDaypartRow {
  search_intent: number
}

export interface CollisionTargetingExampleRow {
  zip: string
  state: string
  city: string
  year: number
  total_crashes: number
  injury_crashes: number
  weather_related_crashes: number
  storm_event_count: number
  hail_event_count: number
  wind_event_count: number
  psg_customer_count: number
  directory_shop_count: number
  collision_targeting_score: number
  example_detail: string
}

export interface MarketDashboardData {
  filter: {
    city: string
    state: string
    label: string
  }
  summary: {
    accident_rows: number
    weather_related_count: number
    severe_accident_rate: number
    weather_related_rate: number
    average_distance_miles: number
    storm_event_count: number
    hail_event_count: number
    storm_demand_score: number
    storm_layer_available: boolean
  }
  opportunity: {
    targetable_accidents: number
    coverage_gap: number
    best_next_channel: string
    weather_score: number
    severity_score: number
  }
  top_zips: MarketDashboardZipRow[]
  dayparts: MarketDashboardDaypartRow[]
  states: MarketStateRollupRow[]
  channel_mix: Array<{ channel: string; score: number }>
  signal_fit: Array<{ signal: string; current: number; target: number }>
  actions: Array<{ title: string; value: string; detail: string }>
}

type RpcArgs = Record<string, unknown>

function toNumber(value: unknown, fallback = 0): number {
  if (value === null || value === undefined || value === '') return fallback
  const numeric = Number(value)
  return Number.isFinite(numeric) ? numeric : fallback
}

function toNullableNumber(value: unknown): number | null {
  if (value === null || value === undefined || value === '') return null
  const numeric = Number(value)
  return Number.isFinite(numeric) ? numeric : null
}

function buildMarketLabel(city: string | null, state: string | null) {
  const cleanCity = city?.trim() || ''
  const cleanState = state?.trim().toUpperCase() || ''
  if (cleanCity && cleanState) return `${cleanCity}, ${cleanState}`
  if (cleanCity) return cleanCity
  if (cleanState) return cleanState
  return 'All markets'
}

async function callRpc<T>(fn: string, args: RpcArgs = {}): Promise<T[]> {
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY
  const supabase = serviceRoleKey && process.env.NODE_ENV !== 'production'
    ? createBrowserlessClient(getSupabaseUrl(), serviceRoleKey, {
        auth: {
          autoRefreshToken: false,
          persistSession: false,
        },
      })
    : await createServerClient()
  const { data, error } = await supabase.rpc(fn, args)

  if (error) {
    throw new Error(`${fn}: ${error.message}`)
  }

  return (data || []) as T[]
}

export async function healthCheck(): Promise<boolean> {
  const rows = await callRpc<{ test: number }>('health_check')
  return rows.length > 0 && rows[0]?.test === 1
}

export async function getNetworkSummary(
  startDate: string,
  endDate: string
): Promise<NetworkSummary> {
  const rows = await callRpc<Record<string, unknown>>('network_summary', {
    start_date: startDate,
    end_date: endDate,
  })
  const row = rows[0] || {}

  return {
    total_surveys: toNumber(row.total_surveys),
    avg_emi_pct: toNumber(row.avg_emi_pct),
    active_shops: toNumber(row.active_shops),
    alert_count: toNumber(row.alert_count),
  }
}

export async function getNetworkTrend(months: number): Promise<TrendPoint[]> {
  const rows = await callRpc<Record<string, unknown>>('network_trend', { months })

  return rows.map((row) => ({
    month: String(row.month || ''),
    surveys: toNumber(row.surveys),
    avg_emi_pct: toNumber(row.avg_emi_pct),
  }))
}

export async function getShopList(
  startDate: string,
  endDate: string
): Promise<ShopListItem[]> {
  const rows = await callRpc<Record<string, unknown>>('shop_list', {
    start_date: startDate,
    end_date: endDate,
  })

  return rows.map((row) => ({
    shop_name: String(row.shop_name || ''),
    canonical_shop_name: row.canonical_shop_name ? String(row.canonical_shop_name) : null,
    total_surveys: toNumber(row.total_surveys),
    avg_emi_pct: toNumber(row.avg_emi_pct),
    latest_survey_date: row.latest_survey_date ? String(row.latest_survey_date) : '',
    place_id: row.place_id ? String(row.place_id) : undefined,
    address: row.address ? String(row.address) : null,
    phone: row.phone ? String(row.phone) : null,
    website: row.website ? String(row.website) : null,
    rating: toNullableNumber(row.rating),
    category: row.category ? String(row.category) : null,
    latitude: toNullableNumber(row.latitude),
    longitude: toNullableNumber(row.longitude),
  }))
}

export async function getNetworkAlerts(
  threshold: number,
  months: number
): Promise<AlertShop[]> {
  const rows = await callRpc<Record<string, unknown>>('network_alerts', {
    threshold,
    months,
  })

  return rows.map((row) => ({
    shop_name: String(row.shop_name || ''),
    avg_emi_pct: toNumber(row.avg_emi_pct),
    total_surveys: toNumber(row.total_surveys),
    months_below: toNumber(row.months_below),
  }))
}

export async function getShopDetail(
  shopName: string,
  startDate: string,
  endDate: string
): Promise<Omit<ShopDetail, 'trend' | 'emi_delta'> | null> {
  const rows = await callRpc<Record<string, unknown>>('shop_detail', {
    p_shop_name: shopName,
    start_date: startDate,
    end_date: endDate,
  })
  const row = rows[0]
  if (!row) return null

  return {
    shop_name: String(row.shop_name || ''),
    invoiced_id: toNullableNumber(row.invoiced_id),
    psg_id: row.psg_id ? String(row.psg_id) : null,
    invoiced_city: row.invoiced_city ? String(row.invoiced_city) : null,
    invoiced_state: row.invoiced_state ? String(row.invoiced_state) : null,
    avg_emi_pct: toNumber(row.avg_emi_pct),
    total_surveys: toNumber(row.total_surveys),
    avg_quality: toNullableNumber(row.avg_quality),
    avg_cleanliness: toNullableNumber(row.avg_cleanliness),
    avg_communication: toNullableNumber(row.avg_communication),
    avg_courtesy: toNullableNumber(row.avg_courtesy),
    network_avg_communication: toNullableNumber(row.network_avg_communication),
  }
}

export async function getShopTrend(shopName: string): Promise<ShopTrendPoint[]> {
  const rows = await callRpc<Record<string, unknown>>('shop_trend', {
    shop_name: shopName,
  })

  return rows.map((row) => ({
    month: String(row.month || ''),
    avg_emi_pct: toNumber(row.avg_emi_pct),
    surveys: toNumber(row.surveys),
  }))
}

export async function getShopCompetitorOverlay(
  shopName: string,
  radiusMiles = 25,
  resultLimit = 25
): Promise<ShopCompetitorPoint[]> {
  const rows = await callRpc<Record<string, unknown>>('shop_competitor_overlay', {
    p_shop_name: shopName,
    p_radius_miles: radiusMiles,
    p_limit: resultLimit,
  })

  return rows
    .map((row) => ({
      is_anchor: Boolean(row.is_anchor),
      shop_name: String(row.shop_name || ''),
      place_id: row.place_id ? String(row.place_id) : null,
      address: row.address ? String(row.address) : null,
      phone: row.phone ? String(row.phone) : null,
      website: row.website ? String(row.website) : null,
      rating: toNullableNumber(row.rating),
      category: row.category ? String(row.category) : null,
      latitude: toNumber(row.latitude),
      longitude: toNumber(row.longitude),
      distance_miles: toNumber(row.distance_miles),
    }))
    .filter((row) => row.latitude !== 0 && row.longitude !== 0)
}

export async function getMarketMapData(
  state: string | null = null,
  directoryLimit = 40000
): Promise<MarketMapData> {
  const payloadRows = await callRpc<{ payload: unknown }>('market_map_payload', {
    p_state: state,
    p_directory_limit: directoryLimit,
  })
  const payload = payloadRows[0]?.payload as { points?: unknown[] } | undefined
  const rows = Array.isArray(payload?.points)
    ? payload.points as Record<string, unknown>[]
    : await callRpc<Record<string, unknown>>('market_map_points', {
        p_state: state,
        p_directory_limit: directoryLimit,
      })

  const points: MarketMapPoint[] = rows
    .map((row) => {
      const layer = (row.layer === 'psg_customer' ? 'psg_customer' : 'directory_shop') as MarketMapPoint['layer']
      const isCustomer = layer === 'psg_customer'

      return {
        layer,
        id: String(row.id || row.place_id || row.shop_name || ''),
        shop_name: String(row.shop_name || ''),
        psg_id: row.psg_id ? String(row.psg_id) : null,
        invoiced_id: toNullableNumber(row.invoiced_id),
        place_id: row.place_id ? String(row.place_id) : null,
        address: isCustomer && row.address ? String(row.address) : null,
        phone: isCustomer && row.phone ? String(row.phone) : null,
        website: isCustomer && row.website ? String(row.website) : null,
        rating: toNullableNumber(row.rating),
        latitude: toNumber(row.latitude),
        longitude: toNumber(row.longitude),
        state: row.state ? String(row.state) : null,
        city: row.city ? String(row.city) : null,
        survey_count: toNullableNumber(row.survey_count),
        avg_emi_pct: toNullableNumber(row.avg_emi_pct),
        match_status: isCustomer ? String(row.match_status || '') : '',
      }
    })
    .filter((point) => point.id && point.latitude !== 0 && point.longitude !== 0)

  const states = Array.from(
    new Set(points.map((point) => point.state).filter((value): value is string => Boolean(value)))
  ).sort((a, b) => a.localeCompare(b))

  return {
    points,
    summary: {
      psg_customers: points.filter((point) => point.layer === 'psg_customer').length,
      directory_shops: points.filter((point) => point.layer === 'directory_shop').length,
      surveyed_psg_customers: points.filter(
        (point) => point.layer === 'psg_customer' && (point.survey_count || 0) > 0
      ).length,
      states,
    },
  }
}

function mapViewportZip(row: Record<string, unknown>): MarketViewportTopZip {
  return {
    zip: String(row.zip || ''),
    state: String(row.state || ''),
    city: row.city ? String(row.city) : null,
    year: toNullableNumber(row.year),
    total_crashes: toNumber(row.total_crashes),
    injury_crashes: toNumber(row.injury_crashes),
    weather_related_crashes: toNumber(row.weather_related_crashes),
    storm_events: toNumber(row.storm_events),
    hail_events: toNumber(row.hail_events),
    wind_events: toNumber(row.wind_events),
    storm_demand_score: toNumber(row.storm_demand_score),
    targeting_score: toNumber(row.targeting_score),
  }
}

function mapViewportCustomer(row: Record<string, unknown>): MarketViewportTopCustomer {
  return {
    shop_name: String(row.shop_name || ''),
    psg_id: row.psg_id ? String(row.psg_id) : null,
    city: row.city ? String(row.city) : null,
    state: row.state ? String(row.state) : null,
    survey_count: toNullableNumber(row.survey_count),
    avg_emi_pct: toNullableNumber(row.avg_emi_pct),
  }
}

export async function getMarketViewportIntelligence({
  west,
  south,
  east,
  north,
  zoom,
  resultLimit = 8,
}: {
  west: number
  south: number
  east: number
  north: number
  zoom: number
  resultLimit?: number
}): Promise<MarketViewportIntelligence> {
  const rows = await callRpc<Record<string, unknown>>('market_viewport_intelligence', {
    p_west: west,
    p_south: south,
    p_east: east,
    p_north: north,
    p_zoom: zoom,
    result_limit: resultLimit,
  })
  const row = rows[0] || {}
  const topZips = Array.isArray(row.top_zips)
    ? row.top_zips as Record<string, unknown>[]
    : []
  const topCustomers = Array.isArray(row.top_customers)
    ? row.top_customers as Record<string, unknown>[]
    : []

  return {
    viewport_label: String(row.viewport_label || 'Map view'),
    zoom: toNumber(row.zoom, zoom),
    psg_customer_count: toNumber(row.psg_customer_count),
    directory_shop_count: toNumber(row.directory_shop_count),
    surveyed_psg_customer_count: toNumber(row.surveyed_psg_customer_count),
    crash_count: toNumber(row.crash_count),
    injury_crash_count: toNumber(row.injury_crash_count),
    weather_related_crash_count: toNumber(row.weather_related_crash_count),
    storm_event_count: toNumber(row.storm_event_count),
    hail_event_count: toNumber(row.hail_event_count),
    wind_event_count: toNumber(row.wind_event_count),
    storm_demand_score: toNumber(row.storm_demand_score),
    top_zips: topZips.map(mapViewportZip),
    top_customers: topCustomers.map(mapViewportCustomer),
  }
}

export async function getShopComments(
  shopName: string,
  search: string | null,
  pageSize: number,
  offset: number
): Promise<ShopComment[]> {
  const rows = await callRpc<Record<string, unknown>>('shop_comments', {
    shop_name: shopName,
    search,
    result_limit: pageSize,
    result_offset: offset,
  })

  return rows.map((row) => ({
    survey_date: String(row.survey_date || ''),
    comment_text: String(row.comment_text || ''),
    scale_emi_pct: toNumber(row.scale_emi_pct),
  }))
}

export async function getShopCommentsCount(
  shopName: string,
  search: string | null
): Promise<number> {
  const rows = await callRpc<{ total: unknown }>('shop_comments_count', {
    shop_name: shopName,
    search,
  })

  return toNumber(rows[0]?.total)
}

export async function getPaginatedShopComments(
  shopName: string,
  search: string | null,
  page: number,
  pageSize: number
): Promise<PaginatedComments> {
  const offset = (page - 1) * pageSize
  const [comments, total] = await Promise.all([
    getShopComments(shopName, search, pageSize, offset),
    getShopCommentsCount(shopName, search),
  ])

  return {
    comments,
    total,
    page,
    pageSize,
    totalPages: Math.ceil(total / pageSize),
  }
}

export async function getMarketingMetadata(
  city: string | null,
  state: string | null
): Promise<MarketingMetadataRow> {
  const rows = await callRpc<Record<string, unknown>>('marketing_metadata', { city, state })
  const row = rows[0] || {}

  return {
    row_count: toNumber(row.row_count),
    weather_related_count: toNumber(row.weather_related_count),
    severe_accident_rate: toNumber(row.severe_accident_rate),
    weather_related_rate: toNumber(row.weather_related_rate),
    average_distance_miles: toNumber(row.average_distance_miles),
    storm_event_count: toNumber(row.storm_event_count),
    hail_event_count: toNumber(row.hail_event_count),
    wind_event_count: toNumber(row.wind_event_count),
    tornado_event_count: toNumber(row.tornado_event_count),
    storm_demand_score: toNumber(row.storm_demand_score),
    max_hail_size: toNumber(row.max_hail_size),
    max_wind_speed: toNumber(row.max_wind_speed),
  }
}

export async function getMarketingTopZips(
  city: string | null,
  state: string | null
): Promise<MarketingZipRow[]> {
  const rows = await callRpc<Record<string, unknown>>('marketing_top_zips', { city, state })

  return rows.map((row) => ({
    zip: String(row.zip || ''),
    accidents: toNumber(row.accidents),
    storm_event_count: toNumber(row.storm_event_count),
    hail_event_count: toNumber(row.hail_event_count),
    wind_event_count: toNumber(row.wind_event_count),
    tornado_event_count: toNumber(row.tornado_event_count),
    storm_demand_score: toNumber(row.storm_demand_score),
  }))
}

export async function getMarketingDaypart(
  city: string | null,
  state: string | null
): Promise<MarketingDaypartRow[]> {
  const rows = await callRpc<Record<string, unknown>>('marketing_daypart', { city, state })

  return rows.map((row) => ({
    time: String(row.time || ''),
    claims: toNumber(row.claims),
  }))
}

export async function getMarketStateRollup(): Promise<MarketStateRollupRow[]> {
  const rows = await callRpc<Record<string, unknown>>('market_state_rollup')

  return rows.map((row) => ({
    state: String(row.state || ''),
    total_accidents: toNumber(row.total_accidents),
    high_severity_count: toNumber(row.high_severity_count),
    weather_related_count: toNumber(row.weather_related_count),
    zip_count: toNumber(row.zip_count),
    severe_rate: toNumber(row.severe_rate),
    weather_rate: toNumber(row.weather_rate),
    opportunity_score: toNumber(row.opportunity_score),
  }))
}

export async function getCollisionTargetingExamples(
  state: string | null,
  year: number | null,
  resultLimit = 8
): Promise<CollisionTargetingExampleRow[]> {
  const rows = await callRpc<Record<string, unknown>>('collision_targeting_examples', {
    p_state: state,
    p_year: year,
    result_limit: resultLimit,
  })

  return rows.map((row) => ({
    zip: String(row.zip || ''),
    state: String(row.state || ''),
    city: String(row.city || ''),
    year: toNumber(row.year),
    total_crashes: toNumber(row.total_crashes),
    injury_crashes: toNumber(row.injury_crashes),
    weather_related_crashes: toNumber(row.weather_related_crashes),
    storm_event_count: toNumber(row.storm_event_count),
    hail_event_count: toNumber(row.hail_event_count),
    wind_event_count: toNumber(row.wind_event_count),
    psg_customer_count: toNumber(row.psg_customer_count),
    directory_shop_count: toNumber(row.directory_shop_count),
    collision_targeting_score: toNumber(row.collision_targeting_score),
    example_detail: String(row.example_detail || ''),
  }))
}

export async function getMarketDashboardData(
  city: string | null,
  state: string | null
): Promise<MarketDashboardData> {
  const cleanCity = city?.trim() || ''
  const cleanState = state?.trim().toUpperCase() || ''
  const [metadata, zipRows, daypartRows, stateRows] = await Promise.all([
    getMarketingMetadata(cleanCity || null, cleanState || null),
    getMarketingTopZips(cleanCity || null, cleanState || null),
    getMarketingDaypart(cleanCity || null, cleanState || null),
    getMarketStateRollup().catch(() => [] as MarketStateRollupRow[]),
  ])

  const maxZipAccidents = Math.max(...zipRows.map((row) => row.accidents), 0)
  const maxStormDemand = Math.max(...zipRows.map((row) => row.storm_demand_score), 0)
  const maxDaypartClaims = Math.max(...daypartRows.map((row) => row.claims), 0)

  const topZips = zipRows.map((row) => {
    const repairDemand = buildRepairDemandScore(
      row.accidents,
      maxZipAccidents,
      row.storm_demand_score,
      maxStormDemand
    )
    const demandShare = maxZipAccidents > 0 ? row.accidents / maxZipAccidents : 0
    const coverageGap = Math.max(12, Math.min(72, Math.round(18 + demandShare * 54)))

    return {
      ...row,
      repair_demand: repairDemand,
      paid_search_priority: Math.min(100, Math.round(repairDemand * 0.78 + coverageGap * 0.22)),
      coverage_gap: coverageGap,
    }
  })

  const dayparts = daypartRows.map((row) => {
    const accidentDemand = score(row.claims, maxDaypartClaims, 15)
    return {
      ...row,
      search_intent: Math.max(10, Math.round(accidentDemand * 0.88)),
    }
  })

  const targetableAccidents = topZips.reduce((total, row) => total + row.accidents, 0)
  const coverageGap = topZips.length
    ? Math.round(topZips.reduce((total, row) => total + row.coverage_gap, 0) / topZips.length)
    : 0
  const weatherScore = buildWeatherDemandScore(
    metadata.weather_related_rate,
    metadata.storm_demand_score
  )
  const severityScore = Math.min(100, Math.round(45 + metadata.severe_accident_rate * 1.7))
  const demandScore = metadata.row_count > 1_000_000 ? 94 : metadata.row_count > 250_000 ? 82 : metadata.row_count > 75_000 ? 68 : 48
  const stormLayerAvailable = metadata.storm_event_count > 0 || topZips.some((row) => row.storm_event_count > 0)
  const bestChannel = weatherScore >= 72
    ? 'Weather-triggered search'
    : coverageGap >= 42
      ? 'Tow and carrier partners'
      : 'Paid search'

  return {
    filter: {
      city: cleanCity,
      state: cleanState,
      label: buildMarketLabel(cleanCity, cleanState),
    },
    summary: {
      accident_rows: metadata.row_count,
      weather_related_count: metadata.weather_related_count,
      severe_accident_rate: metadata.severe_accident_rate,
      weather_related_rate: metadata.weather_related_rate,
      average_distance_miles: metadata.average_distance_miles,
      storm_event_count: metadata.storm_event_count,
      hail_event_count: metadata.hail_event_count,
      storm_demand_score: metadata.storm_demand_score,
      storm_layer_available: stormLayerAvailable,
    },
    opportunity: {
      targetable_accidents: targetableAccidents,
      coverage_gap: coverageGap,
      best_next_channel: bestChannel,
      weather_score: weatherScore,
      severity_score: severityScore,
    },
    top_zips: topZips,
    dayparts,
    states: stateRows.slice(0, 12),
    channel_mix: [
      { channel: 'Paid search', score: topZips[0]?.paid_search_priority || 70 },
      { channel: 'Tow partners', score: Math.min(100, Math.round((severityScore + coverageGap) / 2 + 10)) },
      { channel: 'Carrier/DRP', score: Math.min(100, Math.round((demandScore + severityScore) / 2)) },
      { channel: 'Geo display', score: Math.min(100, Math.round(demandScore * 0.82)) },
      { channel: 'Weather trigger', score: weatherScore },
    ],
    signal_fit: [
      { signal: 'Demand', current: demandScore, target: 90 },
      { signal: 'Severity', current: severityScore, target: 76 },
      { signal: 'Weather', current: weatherScore, target: 72 },
      { signal: 'Coverage gap', current: coverageGap, target: 62 },
      { signal: 'ZIP focus', current: topZips.length ? 78 : 30, target: 80 },
    ],
    actions: [
      {
        title: 'Concentrate spend',
        value: topZips.slice(0, 3).map((row) => row.zip).join(', ') || 'No ZIPs',
        detail: `${targetableAccidents.toLocaleString()} accidents in the current top ZIP set.`,
      },
      {
        title: 'Prime dayparts',
        value: dayparts
          .slice()
          .sort((a, b) => b.claims - a.claims)
          .slice(0, 2)
          .map((row) => row.time)
          .join(' + ') || 'No peak',
        detail: 'Use the highest accident windows for paid search and partner staffing.',
      },
      {
        title: stormLayerAvailable ? 'Storm demand' : 'Weather proxy',
        value: stormLayerAvailable
          ? `${metadata.storm_event_count.toLocaleString()} events`
          : `${metadata.weather_related_count.toLocaleString()} accidents`,
        detail: stormLayerAvailable
          ? `${metadata.hail_event_count.toLocaleString()} hail events are included in the market signal.`
          : 'Storm tables are not live yet, so current weather scoring uses accident weather fields.',
      },
    ],
  }
}
