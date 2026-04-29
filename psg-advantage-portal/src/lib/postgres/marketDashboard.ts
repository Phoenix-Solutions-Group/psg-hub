import { Pool } from 'pg'
import { buildRepairDemandScore, buildWeatherDemandScore, score } from '@/lib/marketingScoring'
import type { MarketDashboardData, MarketStateRollupRow } from '@/lib/supabase/data'

let pool: Pool | null = null

function getPool() {
  if (process.env.NODE_ENV === 'production') return null

  const connectionString = process.env.SUPABASE_DB_URL || process.env.DATABASE_URL
  if (!connectionString) return null

  pool ||= new Pool({
    connectionString,
    max: 6,
    idleTimeoutMillis: 30000,
    connectionTimeoutMillis: 30000,
  })

  return pool
}

function toNumber(value: unknown, fallback = 0) {
  if (value === null || value === undefined || value === '') return fallback
  const numeric = Number(value)
  return Number.isFinite(numeric) ? numeric : fallback
}

function buildMarketLabel(city: string | null, state: string | null) {
  const cleanCity = city?.trim() || ''
  const cleanState = state?.trim().toUpperCase() || ''
  if (cleanCity && cleanState) return `${cleanCity}, ${cleanState}`
  if (cleanCity) return cleanCity
  if (cleanState) return cleanState
  return 'All markets'
}

export async function getMarketDashboardDataFromPostgres(
  city: string | null,
  state: string | null
): Promise<MarketDashboardData | null> {
  const database = getPool()
  if (!database) return null

  const cleanCity = city?.trim() || ''
  const cleanState = state?.trim().toUpperCase() || ''
  const [metadataResult, zipResult, daypartResult, stateResult] = await Promise.all([
    database.query('SELECT * FROM marketing_metadata($1, $2)', [
      cleanCity || null,
      cleanState || null,
    ]),
    database.query('SELECT * FROM marketing_top_zips($1, $2)', [
      cleanCity || null,
      cleanState || null,
    ]),
    database.query('SELECT * FROM marketing_daypart($1, $2)', [
      cleanCity || null,
      cleanState || null,
    ]),
    database.query('SELECT * FROM market_state_rollup() LIMIT 12').catch(() => ({ rows: [] })),
  ])

  const metadata = metadataResult.rows[0] || {}
  const zipRows = zipResult.rows.map((row) => ({
    zip: String(row.zip || ''),
    accidents: toNumber(row.accidents),
    storm_event_count: toNumber(row.storm_event_count),
    hail_event_count: toNumber(row.hail_event_count),
    wind_event_count: toNumber(row.wind_event_count),
    tornado_event_count: toNumber(row.tornado_event_count),
    storm_demand_score: toNumber(row.storm_demand_score),
  }))
  const daypartRows = daypartResult.rows.map((row) => ({
    time: String(row.time || ''),
    claims: toNumber(row.claims),
  }))
  const stateRows: MarketStateRollupRow[] = stateResult.rows.map((row) => ({
    state: String(row.state || ''),
    total_accidents: toNumber(row.total_accidents),
    high_severity_count: toNumber(row.high_severity_count),
    weather_related_count: toNumber(row.weather_related_count),
    zip_count: toNumber(row.zip_count),
    severe_rate: toNumber(row.severe_rate),
    weather_rate: toNumber(row.weather_rate),
    opportunity_score: toNumber(row.opportunity_score),
  }))

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

  const accidentRows = toNumber(metadata.row_count)
  const weatherRate = toNumber(metadata.weather_related_rate)
  const severeRate = toNumber(metadata.severe_accident_rate)
  const stormDemandScore = toNumber(metadata.storm_demand_score)
  const stormEventCount = toNumber(metadata.storm_event_count)
  const hailEventCount = toNumber(metadata.hail_event_count)
  const targetableAccidents = topZips.reduce((total, row) => total + row.accidents, 0)
  const coverageGap = topZips.length
    ? Math.round(topZips.reduce((total, row) => total + row.coverage_gap, 0) / topZips.length)
    : 0
  const weatherScore = buildWeatherDemandScore(weatherRate, stormDemandScore)
  const severityScore = Math.min(100, Math.round(45 + severeRate * 1.7))
  const demandScore = accidentRows > 1_000_000 ? 94 : accidentRows > 250_000 ? 82 : accidentRows > 75_000 ? 68 : 48
  const stormLayerAvailable = stormEventCount > 0 || topZips.some((row) => row.storm_event_count > 0)
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
      accident_rows: accidentRows,
      weather_related_count: toNumber(metadata.weather_related_count),
      severe_accident_rate: severeRate,
      weather_related_rate: weatherRate,
      average_distance_miles: toNumber(metadata.average_distance_miles),
      storm_event_count: stormEventCount,
      hail_event_count: hailEventCount,
      storm_demand_score: stormDemandScore,
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
    states: stateRows,
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
          ? `${stormEventCount.toLocaleString()} events`
          : `${toNumber(metadata.weather_related_count).toLocaleString()} accidents`,
        detail: stormLayerAvailable
          ? `${hailEventCount.toLocaleString()} hail events are included in the market signal.`
          : 'Storm tables are not live yet, so current weather scoring uses accident weather fields.',
      },
    ],
  }
}
