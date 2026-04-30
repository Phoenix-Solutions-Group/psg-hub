import { Pool } from 'pg'
import fs from 'node:fs'
import path from 'node:path'

export type CustomerGeoPreset = 'all' | 'nyc5' | 'nyc_nassau_suffolk'

export interface CustomerGeoFilters {
  startDate: string
  endDate: string
  shopIds: string[]
  preset: CustomerGeoPreset
  limit?: number
}

export interface CustomerGeoShopOption {
  shop_id: string
  shop_name: string
  repair_count: number
}

export interface CustomerGeoZipPointRow {
  zip: string | null
  city: string | null
  state: string | null
  county_name: string | null
  latitude: number
  longitude: number
  repair_count: number
  unique_household_count: number
  shop_count: number
}

export interface CustomerGeoZipIncomeRow {
  zip: string
  state: string | null
  county_name: string | null
  repair_count: number
  unique_household_count: number
  market_households: number | null
  service_address_penetration_pct: number | null
  registered_vehicles: number | null
  vehicle_penetration_pct: number | null
  vehicle_repair_penetration_pct: number | null
  competitor_shop_count: number | null
  mean_household_income: number | null
  median_household_income: number | null
  avg_repair_total: number | null
  total_repair_value: number | null
}

let pool: Pool | null = null

function shouldEnableSsl(connectionString: string) {
  if (!connectionString) return false
  if (/sslmode=disable/i.test(connectionString)) return false
  return /\.supabase\.co(?::\d+)?\//i.test(connectionString)
}

function isMissingGeoDependency(error: unknown) {
  const pgError = error as { code?: string; message?: string } | null
  if (!pgError) return false
  if (pgError.code === '42P01' || pgError.code === '42703') return true
  const message = String(pgError.message || '').toLowerCase()
  return (
    message.includes('relation') && message.includes('does not exist')
  ) || (
    message.includes('column') && message.includes('does not exist')
  )
}

function readEnvVarFromFile(filePath: string, key: string): string | null {
  if (!fs.existsSync(filePath)) return null
  const content = fs.readFileSync(filePath, 'utf8')
  const line = content
    .split(/\r?\n/)
    .find((item) => item.trim().startsWith(`${key}=`))
  if (!line) return null
  const raw = line.slice(line.indexOf('=') + 1).trim()
  if (!raw) return null
  return raw.replace(/^['"]|['"]$/g, '')
}

function resolveConnectionString() {
  const envValue = process.env.SUPABASE_DB_URL || process.env.DATABASE_URL
  if (envValue) return envValue

  // Local developer fallback for this PSG multi-repo setup.
  if (process.env.NODE_ENV !== 'production') {
    const candidates = [
      path.resolve(process.cwd(), '.env.local'),
      path.resolve(process.cwd(), '../psg-data-lake/.env.local'),
    ]
    for (const candidate of candidates) {
      const fromFile = readEnvVarFromFile(candidate, 'SUPABASE_DB_URL')
      if (fromFile) return fromFile
    }
  }

  return null
}

function getPool() {
  const connectionString = resolveConnectionString()
  if (!connectionString) {
    throw new Error(
      'SUPABASE_DB_URL (or DATABASE_URL) is required for customer geography APIs. For local standalone parity, start the portal with `npm run start` so the launcher can prepare assets and inject the database env before boot.'
    )
  }

  pool ||= new Pool({
    connectionString,
    max: 8,
    idleTimeoutMillis: 30000,
    connectionTimeoutMillis: 30000,
    ssl: shouldEnableSsl(connectionString) ? { rejectUnauthorized: false } : undefined,
  })

  return pool
}

const NYC_COUNTY_PREFIXES = ['Bronx', 'Kings', 'New York', 'Queens', 'Richmond']
const NYC_NASSAU_SUFFOLK_COUNTY_PREFIXES = [...NYC_COUNTY_PREFIXES, 'Nassau', 'Suffolk']

function countyPrefixesForPreset(preset: CustomerGeoPreset): string[] {
  if (preset === 'nyc5') return NYC_COUNTY_PREFIXES
  if (preset === 'nyc_nassau_suffolk') return NYC_NASSAU_SUFFOLK_COUNTY_PREFIXES
  return []
}

function addPresetCountyClause(
  preset: CustomerGeoPreset,
  countyColumnSql: string,
  params: unknown[],
  conditions: string[]
) {
  const countyPrefixes = countyPrefixesForPreset(preset)
  if (!countyPrefixes.length) return
  const countyPatterns = countyPrefixes.map((prefix) => `${prefix}%`)
  params.push(countyPatterns)
  conditions.push(
    `EXISTS (SELECT 1 FROM unnest($${params.length}::text[]) county_pattern WHERE ${countyColumnSql} ILIKE county_pattern)`
  )
}

function baseFiltersSql(
  filters: CustomerGeoFilters,
  params: unknown[],
  dateColumnSql: string
) {
  const conditions: string[] = []
  conditions.push(`${dateColumnSql} BETWEEN $1::date AND $2::date`)
  params.push(filters.startDate, filters.endDate)

  if (filters.shopIds.length) {
    params.push(filters.shopIds)
    conditions.push(`rc.shop_id = ANY($${params.length}::text[])`)
  }

  addPresetCountyClause(filters.preset, 'COALESCE(cr.county_name, \'\')', params, conditions)

  return conditions
}

export async function getCustomerGeoShops(
  startDate: string,
  endDate: string,
  preset: CustomerGeoPreset
): Promise<CustomerGeoShopOption[]> {
  const db = getPool()
  const params: unknown[] = [startDate, endDate]
  const conditions = [
    `COALESCE(rcl.repair_date, rc.date_out, rc.date_in, rc.creation_date) BETWEEN $1::date AND $2::date`,
    `rcl.geocode_status = 'matched'`,
    `rcl.latitude IS NOT NULL`,
    `rcl.longitude IS NOT NULL`,
  ]
  addPresetCountyClause(preset, 'COALESCE(cr.county_name, \'\')', params, conditions)

  let rows: Array<Record<string, unknown>> = []
  try {
    const result = await db.query(
      `
        SELECT
          rc.shop_id,
          MAX(COALESCE(NULLIF(rc.shop_name, ''), rc.shop_id)) AS shop_name,
          COUNT(*)::int AS repair_count
        FROM sensitive.repair_customers rc
        JOIN sensitive.repair_customer_locations rcl ON rcl.repair_customer_id = rc.id
        LEFT JOIN LATERAL (
          SELECT zr.county_fips
          FROM public.zip_references zr
          WHERE zr.zip_code = rcl.customer_zip
          LIMIT 1
        ) zr ON TRUE
        LEFT JOIN public.county_references cr ON cr.county_fips = zr.county_fips
        WHERE ${conditions.join('\n        AND ')}
        GROUP BY rc.shop_id
        ORDER BY repair_count DESC, shop_name ASC
        LIMIT 2000
      `,
      params
    )
    rows = result.rows
  } catch (error) {
    if (!isMissingGeoDependency(error)) throw error
    console.warn('[customer-geo] shop source not ready; returning empty set')
    return []
  }

  return rows.map((row) => ({
    shop_id: String(row.shop_id || ''),
    shop_name: String(row.shop_name || row.shop_id || ''),
    repair_count: Number(row.repair_count || 0),
  }))
}

export async function getCustomerGeoPins(
  filters: CustomerGeoFilters
): Promise<CustomerGeoZipPointRow[]> {
  const db = getPool()
  const params: unknown[] = []
  const conditions = baseFiltersSql(
    filters,
    params,
    `COALESCE(rcl.repair_date, rc.date_out, rc.date_in, rc.creation_date)`
  )

  conditions.push(`rcl.geocode_status = 'matched'`)
  conditions.push('rcl.latitude IS NOT NULL')
  conditions.push('rcl.longitude IS NOT NULL')

  params.push(Math.max(100, Math.min(filters.limit || 1000, 10000)))
  const limitParam = `$${params.length}`

  let rows: Array<Record<string, unknown>> = []
  try {
    const result = await db.query(
      `
        SELECT
          rcl.customer_zip AS zip,
          COALESCE(NULLIF(rcl.customer_city, ''), NULLIF(rc.raw_payload->>'customer_city', '')) AS city,
          COALESCE(NULLIF(rcl.customer_state, ''), NULLIF(rc.raw_payload->>'customer_state', '')) AS state,
          cr.county_name,
          AVG(rcl.latitude::float8)::float8 AS latitude,
          AVG(rcl.longitude::float8)::float8 AS longitude,
          COUNT(*)::int AS repair_count,
          COUNT(DISTINCT rcl.repair_customer_id)::int AS unique_household_count,
          COUNT(DISTINCT rc.shop_id)::int AS shop_count
        FROM sensitive.repair_customer_locations rcl
        JOIN sensitive.repair_customers rc ON rc.id = rcl.repair_customer_id
        LEFT JOIN LATERAL (
          SELECT zr.county_fips
          FROM public.zip_references zr
          WHERE zr.zip_code = rcl.customer_zip
          LIMIT 1
        ) zr ON TRUE
        LEFT JOIN public.county_references cr ON cr.county_fips = zr.county_fips
        WHERE ${conditions.join('\n        AND ')}
        GROUP BY
          rcl.customer_zip,
          COALESCE(NULLIF(rcl.customer_city, ''), NULLIF(rc.raw_payload->>'customer_city', '')),
          COALESCE(NULLIF(rcl.customer_state, ''), NULLIF(rc.raw_payload->>'customer_state', '')),
          cr.county_name
        ORDER BY repair_count DESC, rcl.customer_zip ASC
        LIMIT ${limitParam}
      `,
      params
    )
    rows = result.rows
  } catch (error) {
    if (!isMissingGeoDependency(error)) throw error
    console.warn('[customer-geo] pin source not ready; returning empty set')
    return []
  }

  return rows.map((row) => ({
    zip: row.zip ? String(row.zip) : null,
    city: row.city ? String(row.city) : null,
    state: row.state ? String(row.state) : null,
    county_name: row.county_name ? String(row.county_name) : null,
    latitude: Number(row.latitude),
    longitude: Number(row.longitude),
    repair_count: Number(row.repair_count || 0),
    unique_household_count: Number(row.unique_household_count || 0),
    shop_count: Number(row.shop_count || 0),
  }))
}

export async function getCustomerGeoZipIncome(
  filters: CustomerGeoFilters
): Promise<CustomerGeoZipIncomeRow[]> {
  const db = getPool()
  const params: unknown[] = [filters.startDate, filters.endDate]
  const conditions: string[] = [
    `c.month BETWEEN date_trunc('month', $1::date)::date AND date_trunc('month', $2::date)::date`,
    `c.zip <> '__UNMATCHED__'`,
  ]

  if (filters.shopIds.length) {
    params.push(filters.shopIds)
    conditions.push(`c.shop_id = ANY($${params.length}::text[])`)
  }

  addPresetCountyClause(filters.preset, 'COALESCE(c.county_name, \'\')', params, conditions)

  params.push(Math.max(25, Math.min(filters.limit || 500, 5000)))
  const limitParam = `$${params.length}`

  let rows: Array<Record<string, unknown>> = []
  try {
    const result = await db.query(
      `
        SELECT
          c.zip,
          MAX(c.state) AS state,
          MAX(c.county_name) AS county_name,
          SUM(c.repair_count)::int AS repair_count,
          SUM(c.unique_household_count)::int AS unique_household_count,
          MAX(zi.households)::bigint AS market_households,
          MAX(c.mean_household_income)::float8 AS mean_household_income,
          MAX(c.median_household_income)::float8 AS median_household_income,
          AVG(c.avg_repair_total)::float8 AS avg_repair_total,
          SUM(c.total_repair_value)::float8 AS total_repair_value,
          MAX(c.registered_vehicles)::int AS registered_vehicles,
          MAX(c.competitor_shop_count)::int AS competitor_shop_count
        FROM public.customer_zip_report_monthly c
        LEFT JOIN LATERAL (
          SELECT z.households
          FROM public.zcta_income_annual z
          WHERE z.zip = c.zip
            AND z.year <= EXTRACT(YEAR FROM $2::date)::int
          ORDER BY z.year DESC
          LIMIT 1
        ) zi ON TRUE
        WHERE ${conditions.join('\n        AND ')}
        GROUP BY c.zip
        ORDER BY repair_count DESC, c.zip ASC
        LIMIT ${limitParam}
      `,
      params
    )
    rows = result.rows
  } catch (error) {
    if (!isMissingGeoDependency(error)) throw error
    console.warn('[customer-geo] zip income source not ready; returning empty set')
    return []
  }

  return rows.map((row) => ({
    market_households:
      row.market_households === null || row.market_households === undefined
        ? null
        : Number(row.market_households),
    service_address_penetration_pct:
      row.market_households === null || row.market_households === undefined || Number(row.market_households) <= 0
        ? null
        : Number((((Number(row.unique_household_count || 0) / Number(row.market_households)) * 100)).toFixed(2)),
    zip: String(row.zip || ''),
    state: row.state ? String(row.state) : null,
    county_name: row.county_name ? String(row.county_name) : null,
    repair_count: Number(row.repair_count || 0),
    unique_household_count: Number(row.unique_household_count || 0),
    mean_household_income:
      row.mean_household_income === null || row.mean_household_income === undefined
        ? null
        : Number(row.mean_household_income),
    median_household_income:
      row.median_household_income === null || row.median_household_income === undefined
        ? null
        : Number(row.median_household_income),
    avg_repair_total:
      row.avg_repair_total === null || row.avg_repair_total === undefined
        ? null
        : Number(row.avg_repair_total),
    total_repair_value:
      row.total_repair_value === null || row.total_repair_value === undefined
        ? null
        : Number(row.total_repair_value),
    registered_vehicles:
      row.registered_vehicles === null || row.registered_vehicles === undefined
        ? null
        : Number(row.registered_vehicles),
    vehicle_penetration_pct:
      row.registered_vehicles === null || row.registered_vehicles === undefined || Number(row.registered_vehicles) <= 0
        ? null
        : Number(((Number(row.unique_household_count || 0) / Number(row.registered_vehicles)) * 100).toFixed(2)),
    vehicle_repair_penetration_pct:
      row.registered_vehicles === null || row.registered_vehicles === undefined || Number(row.registered_vehicles) <= 0
        ? null
        : Number(((Number(row.repair_count || 0) / Number(row.registered_vehicles)) * 100).toFixed(2)),
    competitor_shop_count:
      row.competitor_shop_count === null || row.competitor_shop_count === undefined
        ? null
        : Number(row.competitor_shop_count),
  }))
}
