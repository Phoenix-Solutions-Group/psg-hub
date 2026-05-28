import { Pool } from 'pg'
import fs from 'node:fs'
import path from 'node:path'
import type {
  FlowerHillCustomerRow,
  FlowerHillMakeRow,
  FlowerHillMarketZipRow,
  FlowerHillMetrics,
  FlowerHillReportData,
  FlowerHillZipRow,
} from '@/types'

export const TARGET_ZIPS = [
  '11001', '11003', '11005', '11010', '11020', '11021', '11023', '11024',
  '11030', '11040', '11050', '11096', '11501', '11507', '11509', '11510',
  '11514', '11516', '11518', '11520', '11530', '11542', '11545', '11547',
  '11548', '11550', '11551', '11552', '11553', '11554', '11557', '11558',
  '11559', '11560', '11561', '11563', '11565', '11566', '11568', '11569',
  '11570', '11572', '11575', '11576', '11577', '11579', '11580', '11581',
  '11582', '11590', '11596', '11598', '11709', '11710', '11714', '11724',
  '11732', '11735', '11753', '11756', '11758', '11762', '11765', '11771',
  '11791', '11793', '11797', '11801', '11802', '11804',
] as const

export const TARGET_MAKES = [
  'ACURA', 'ALFA ROMEO', 'ASTON MARTIN', 'AUDI', 'BENTLEY', 'BMW',
  'CADILLAC', 'DODGE', 'GENESIS', 'GMC', 'INFINITI', 'JAGUAR', 'KIA',
  'LAND ROVER', 'LEXUS', 'LUCID', 'MASERATI', 'MAYBACH', 'MCLAREN',
  'MERCEDES-BENZ', 'POLESTAR', 'PORSCHE', 'RANGE ROVER', 'RIVIAN',
  'ROLLS ROYCE', 'SUBARU', 'TESLA', 'VOLVO',
] as const

export const TARGET_YEAR_MIN = 2020
export const TARGET_YEAR_MAX = 2025
export const TARGET_DATE_MIN = '2025-07-01'

export const HYPER_TARGET_ZIPS = new Set([
  '11010', '11020', '11021', '11023', '11024', '11030', '11040', '11050',
  '11501', '11507', '11514', '11530', '11542', '11545', '11547', '11548',
  '11560', '11568', '11576', '11577', '11579', '11596', '11709', '11724',
  '11732', '11753', '11765', '11771', '11791',
])

export const FLOWER_HILL_SHOPS = [
  'Flower Hill Auto Body - Roslyn',
  'Flower Hill Auto Body - Glen Cove',
  'Flower Hill Auto Body - Huntington',
] as const

export const CONSUMER_DB_BY_ZIP: Record<string, { city: string; count: number }> = {
  '11010': { city: 'Franklin Square', count: 154 },
  '11020': { city: 'Great Neck', count: 60 },
  '11021': { city: 'Great Neck', count: 131 },
  '11023': { city: 'Great Neck', count: 97 },
  '11024': { city: 'Great Neck', count: 84 },
  '11030': { city: 'Manhasset', count: 321 },
  '11040': { city: 'New Hyde Park', count: 442 },
  '11050': { city: 'Port Washington', count: 393 },
  '11501': { city: 'Mineola', count: 146 },
  '11507': { city: 'Albertson', count: 108 },
  '11514': { city: 'Carle Place', count: 33 },
  '11530': { city: 'Garden City', count: 317 },
  '11542': { city: 'Glen Cove', count: 187 },
  '11545': { city: 'Glen Head', count: 214 },
  '11547': { city: 'Glenwood Landing', count: 0 },
  '11548': { city: 'Greenvale', count: 13 },
  '11560': { city: 'Locust Valley', count: 73 },
  '11568': { city: 'Old Westbury', count: 74 },
  '11576': { city: 'Roslyn', count: 341 },
  '11577': { city: 'Roslyn Heights', count: 274 },
  '11579': { city: 'Sea Cliff', count: 49 },
  '11596': { city: 'Williston Park', count: 111 },
  '11709': { city: 'Bayville', count: 78 },
  '11724': { city: 'Cold Spring Harbor', count: 48 },
  '11732': { city: 'East Norwich', count: 46 },
  '11753': { city: 'Jericho', count: 304 },
  '11765': { city: 'Mill Neck', count: 3 },
  '11771': { city: 'Oyster Bay', count: 109 },
  '11791': { city: 'Syosset', count: 421 },
}

export const CONSUMER_DB_BY_MAKE: Record<string, number> = {
  'BMW': 1495,
  'LEXUS': 1010,
  'ACURA': 838,
  'SUBARU': 644,
  'KIA': 234,
  'AUDI': 224,
  'MERCEDES-BENZ': 70,
  'LAND ROVER': 32,
  'GMC': 26,
  'DODGE': 15,
  'INFINITI': 10,
  'CADILLAC': 8,
  'TESLA': 8,
  'GENESIS': 5,
  'VOLVO': 4,
  'BENTLEY': 3,
  'JAGUAR': 2,
  'ALFA ROMEO': 1,
  'LUCID': 1,
  'PORSCHE': 1,
}

export const CONSUMER_DB_TOTAL = 4631

let pool: Pool | null = null

function resolveConnectionString() {
  const envValue = process.env.SUPABASE_DB_URL || process.env.DATABASE_URL
  if (envValue) return envValue

  if (process.env.NODE_ENV !== 'production') {
    const candidates = [
      path.resolve(process.cwd(), '.env.local'),
      path.resolve(process.cwd(), '../psg-data-lake/.env.local'),
    ]
    for (const candidate of candidates) {
      if (!fs.existsSync(candidate)) continue
      const content = fs.readFileSync(candidate, 'utf8')
      const line = content.split(/\r?\n/).find((l: string) => l.trim().startsWith('SUPABASE_DB_URL='))
      if (!line) continue
      const raw = line.slice(line.indexOf('=') + 1).trim().replace(/^['"]|['"]$/g, '')
      if (raw) return raw
    }
  }

  return null
}

function shouldEnableSsl(connectionString: string) {
  if (/sslmode=disable/i.test(connectionString)) return false
  return /\.supabase\.co(?::\d+)?\//i.test(connectionString)
}

function getPool() {
  const connectionString = resolveConnectionString()
  if (!connectionString) {
    throw new Error('SUPABASE_DB_URL (or DATABASE_URL) is required for Flower Hill report')
  }

  pool ||= new Pool({
    connectionString,
    max: 4,
    idleTimeoutMillis: 30000,
    connectionTimeoutMillis: 30000,
    ssl: shouldEnableSsl(connectionString) ? { rejectUnauthorized: false } : undefined,
  })

  return pool
}

function isTargetVehicle(make: string | null, year: number | null, repairDate: string | null, zip: string | null): boolean {
  if (!make || !year || !repairDate || !zip) return false
  if (!HYPER_TARGET_ZIPS.has(zip)) return false
  if (repairDate < TARGET_DATE_MIN) return false
  return TARGET_MAKES.includes(make.toUpperCase() as typeof TARGET_MAKES[number])
    && year >= TARGET_YEAR_MIN
    && year <= TARGET_YEAR_MAX
}

export async function getFlowerHillReport(radiusMiles = 25): Promise<FlowerHillReportData> {
  const db = getPool()
  const zipArray = [...TARGET_ZIPS]
  const makeArray = [...TARGET_MAKES]

  const [customersResult, zipResult, makeResult, marketZipResult] = await Promise.all([
    db.query(
      `SELECT
        rc.customer_first_name,
        rc.customer_last_name,
        rc.vehicle_year,
        rc.vehicle_make,
        rc.vehicle_model,
        rc.repair_total,
        rc.pay_type,
        rc.insurance_company,
        rc.date_in::text,
        rc.date_out::text,
        rc.shop_name,
        rcl.customer_zip,
        rcl.customer_city,
        rcl.customer_state,
        rcl.latitude,
        rcl.longitude,
        rcl.formatted_address
      FROM sensitive.repair_customers rc
      LEFT JOIN sensitive.repair_customer_locations rcl
        ON rcl.repair_customer_id = rc.id
      WHERE rc.shop_name ILIKE 'Flower Hill%'
      ORDER BY COALESCE(rc.date_out, rc.date_in, rc.creation_date) DESC NULLS LAST
      LIMIT 10000`,
      []
    ),

    db.query(
      `SELECT
        rcl.customer_zip AS zip,
        MAX(rcl.customer_city) AS city,
        COUNT(*)::int AS psg_customer_count,
        COUNT(*) FILTER (
          WHERE UPPER(rc.vehicle_make) = ANY($1::text[])
            AND rc.vehicle_year BETWEEN $2 AND $3
            AND rc.date_in >= '2025-07-01'::date
            AND rcl.customer_zip = ANY($4::text[])
        )::int AS target_vehicle_matches
      FROM sensitive.repair_customers rc
      JOIN sensitive.repair_customer_locations rcl
        ON rcl.repair_customer_id = rc.id
      WHERE rc.shop_name ILIKE 'Flower Hill%'
        AND rcl.customer_zip IS NOT NULL
      GROUP BY rcl.customer_zip
      ORDER BY psg_customer_count DESC`,
      [makeArray, TARGET_YEAR_MIN, TARGET_YEAR_MAX, [...HYPER_TARGET_ZIPS]]
    ),

    db.query(
      `SELECT
        UPPER(rc.vehicle_make) AS make,
        COUNT(*)::int AS psg_customer_count
      FROM sensitive.repair_customers rc
      LEFT JOIN sensitive.repair_customer_locations rcl
        ON rcl.repair_customer_id = rc.id
      WHERE rc.shop_name ILIKE 'Flower Hill%'
        AND UPPER(rc.vehicle_make) = ANY($1::text[])
        AND rc.vehicle_year BETWEEN $2 AND $3
        AND rc.date_in >= '2025-07-01'::date
        AND rcl.customer_zip = ANY($4::text[])
      GROUP BY UPPER(rc.vehicle_make)
      ORDER BY psg_customer_count DESC`,
      [makeArray, TARGET_YEAR_MIN, TARGET_YEAR_MAX, [...HYPER_TARGET_ZIPS]]
    ),

    db.query(
      `WITH shop_center AS (
        SELECT
          AVG(rcl.latitude)::float8 AS lat,
          AVG(rcl.longitude)::float8 AS lng
        FROM sensitive.repair_customer_locations rcl
        JOIN sensitive.repair_customers rc ON rc.id = rcl.repair_customer_id
        WHERE rc.shop_name ILIKE 'Flower Hill%'
          AND rcl.latitude IS NOT NULL
          AND rcl.longitude IS NOT NULL
      ),
      zip_centers AS (
        SELECT
          rcl.customer_zip AS zip,
          AVG(rcl.latitude)::float8 AS lat,
          AVG(rcl.longitude)::float8 AS lng
        FROM sensitive.repair_customer_locations rcl
        JOIN sensitive.repair_customers rc ON rc.id = rcl.repair_customer_id
        WHERE rc.shop_name ILIKE 'Flower Hill%'
          AND rcl.customer_zip IS NOT NULL
          AND rcl.latitude IS NOT NULL
        GROUP BY rcl.customer_zip
      ),
      zips_in_radius AS (
        SELECT zc.zip
        FROM zip_centers zc
        CROSS JOIN shop_center sc
        WHERE ST_DWithin(
          ST_MakePoint(zc.lng, zc.lat)::geography,
          ST_MakePoint(sc.lng, sc.lat)::geography,
          $1::float8 * 1609.34
        )
      )
      SELECT
        c.zip,
        MAX(zm.city_name) AS city,
        SUM(c.repair_count)::int AS repair_orders,
        SUM(c.unique_household_count)::int AS unique_households,
        MAX(c.registered_vehicles)::int AS registered_vehicles,
        MAX(c.competitor_shop_count)::int AS competitor_shops,
        MAX(c.crash_demand_score)::float8 AS crash_demand_score,
        MAX(c.storm_demand_score)::float8 AS storm_demand_score,
        MAX(c.market_opportunity_score)::float8 AS opportunity_score,
        MAX(c.mean_household_income)::float8 AS mean_income,
        MAX(c.median_household_income)::float8 AS median_income,
        MAX(ev.ev_vehicle_count)::int AS ev_vehicles
      FROM public.customer_zip_report_monthly c
      JOIN zips_in_radius zir ON zir.zip = c.zip
      LEFT JOIN LATERAL (
        SELECT zm2.city_name
        FROM public.zcta_zip_mapping zm2
        WHERE zm2.zip_code = c.zip
        LIMIT 1
      ) zm ON TRUE
      LEFT JOIN LATERAL (
        SELECT SUM(vehicle_count)::int AS ev_vehicle_count
        FROM public.ev_registrations er
        WHERE er.zip = c.zip
      ) ev ON TRUE
      WHERE c.shop_name ILIKE 'Flower Hill%'
        AND c.zip <> '__UNMATCHED__'
      GROUP BY c.zip
      ORDER BY repair_orders DESC, c.zip ASC
      LIMIT 500`,
      [radiusMiles]
    ),
  ])

  const customers: FlowerHillCustomerRow[] = customersResult.rows.map((row) => ({
    customer_first_name: row.customer_first_name || null,
    customer_last_name: row.customer_last_name || null,
    vehicle_year: row.vehicle_year != null ? Number(row.vehicle_year) : null,
    vehicle_make: row.vehicle_make || null,
    vehicle_model: row.vehicle_model || null,
    repair_total: row.repair_total != null ? Number(row.repair_total) : null,
    pay_type: row.pay_type || null,
    insurance_company: row.insurance_company || null,
    date_in: row.date_in || null,
    date_out: row.date_out || null,
    shop_name: String(row.shop_name || ''),
    customer_zip: row.customer_zip || null,
    customer_city: row.customer_city || null,
    customer_state: row.customer_state || null,
    latitude: row.latitude != null ? Number(row.latitude) : null,
    longitude: row.longitude != null ? Number(row.longitude) : null,
    formatted_address: row.formatted_address || null,
    is_target_vehicle: isTargetVehicle(row.vehicle_make, row.vehicle_year != null ? Number(row.vehicle_year) : null, row.date_in || null, row.customer_zip || null),
  }))

  const zipMap = new Map<string, { city: string | null; count: number; target: number }>()
  for (const row of zipResult.rows) {
    zipMap.set(String(row.zip), {
      city: row.city || null,
      count: Number(row.psg_customer_count),
      target: Number(row.target_vehicle_matches),
    })
  }

  const zip_breakdown: FlowerHillZipRow[] = TARGET_ZIPS.map((zip) => {
    const psg = zipMap.get(zip)
    const consumerEntry = CONSUMER_DB_BY_ZIP[zip]
    const psgCount = psg?.count || 0
    const targetMatches = psg?.target || 0
    const consumerCount = consumerEntry?.count || 0
    return {
      zip,
      city: psg?.city || consumerEntry?.city || null,
      psg_customer_count: psgCount,
      target_vehicle_matches: targetMatches,
      consumer_db_count: consumerCount,
      penetration_pct: consumerCount > 0
        ? Number(((targetMatches / consumerCount) * 100).toFixed(1))
        : null,
    }
  })

  const makeMap = new Map<string, number>()
  for (const row of makeResult.rows) {
    makeMap.set(String(row.make), Number(row.psg_customer_count))
  }

  const make_breakdown: FlowerHillMakeRow[] = TARGET_MAKES
    .map((make) => {
      const psgCount = makeMap.get(make) || 0
      const consumerCount = CONSUMER_DB_BY_MAKE[make] || 0
      return {
        make,
        psg_customer_count: psgCount,
        consumer_db_count: consumerCount,
        penetration_pct: consumerCount > 0
          ? Number(((psgCount / consumerCount) * 100).toFixed(1))
          : null,
      }
    })
    .sort((a, b) => b.consumer_db_count - a.consumer_db_count)

  const targetMatches = customers.filter((c) => c.is_target_vehicle).length
  const totalRevenue = customers.reduce((sum, c) => sum + (c.repair_total || 0), 0)
  const shopNames = [...new Set(customers.map((c) => c.shop_name).filter(Boolean))]

  const insuranceCounts = new Map<string, number>()
  const payTypeCounts = new Map<string, number>()
  const nameSet = new Set<string>()

  for (const c of customers) {
    if (c.insurance_company) {
      insuranceCounts.set(c.insurance_company, (insuranceCounts.get(c.insurance_company) || 0) + 1)
    }
    const pt = c.pay_type || 'Unknown'
    payTypeCounts.set(pt, (payTypeCounts.get(pt) || 0) + 1)
    const name = `${(c.customer_first_name || '').toLowerCase()}|${(c.customer_last_name || '').toLowerCase()}`
    if (name !== '|') nameSet.add(name)
  }

  // Build market_zips first since metrics use it
  const market_zips: FlowerHillMarketZipRow[] = marketZipResult.rows.map((row) => {
    const repairOrders = Number(row.repair_orders || 0)
    const registeredVehicles = row.registered_vehicles != null ? Number(row.registered_vehicles) : null
    return {
      zip: String(row.zip || ''),
      city: row.city ? String(row.city) : null,
      repair_orders: repairOrders,
      unique_households: Number(row.unique_households || 0),
      registered_vehicles: registeredVehicles,
      vehicle_pen_pct: registeredVehicles && registeredVehicles > 0
        ? Number(((repairOrders / registeredVehicles) * 100).toFixed(2))
        : null,
      market_share_pct: registeredVehicles && registeredVehicles > 0
        ? Number(((repairOrders / (registeredVehicles * 0.06)) * 100).toFixed(2))
        : null,
      competitor_shops: row.competitor_shops != null ? Number(row.competitor_shops) : null,
      ev_vehicles: row.ev_vehicles != null ? Number(row.ev_vehicles) : null,
      opportunity_score: row.opportunity_score != null ? Number(row.opportunity_score) : null,
      mean_income: row.mean_income != null ? Number(row.mean_income) : null,
      median_income: row.median_income != null ? Number(row.median_income) : null,
    }
  })

  // Date range
  const allDates = customers
    .flatMap((c) => [c.date_in, c.date_out])
    .filter((d): d is string => Boolean(d))
    .sort()
  const firstDate = allDates[0] || null
  const lastDate = allDates[allDates.length - 1] || null

  // Household penetration: unique customers vs registered vehicles in radius
  const totalRegisteredVehiclesInRadius = market_zips.reduce(
    (sum, z) => sum + (z.registered_vehicles || 0),
    0
  )
  const householdPenetrationPct = totalRegisteredVehiclesInRadius > 0
    ? Number(((nameSet.size / totalRegisteredVehiclesInRadius) * 100).toFixed(2))
    : null

  // Market penetration mirroring the map radius: target matches in market_zips footprint
  // Since target matches are shop-wide (not zip-filtered), show as % of total consumer DB
  // OR as % of radius-filtered registered vehicles for consistency
  const marketPenetrationInRadius = totalRegisteredVehiclesInRadius > 0
    ? Number(((targetMatches / totalRegisteredVehiclesInRadius) * 100).toFixed(2))
    : null

  const metrics: FlowerHillMetrics = {
    total_repairs: customers.length,
    unique_customers: nameSet.size,
    total_revenue: Math.round(totalRevenue),
    avg_repair_value: customers.length > 0 ? Math.round(totalRevenue / customers.length) : 0,
    target_vehicle_matches: targetMatches,
    target_vehicle_match_rate: customers.length > 0
      ? Number(((targetMatches / customers.length) * 100).toFixed(1))
      : 0,
    consumer_db_total: CONSUMER_DB_TOTAL,
    overall_penetration_pct: Number(((targetMatches / CONSUMER_DB_TOTAL) * 100).toFixed(2)),
    shop_names: shopNames,
    first_date: firstDate,
    last_date: lastDate,
    household_penetration_pct: householdPenetrationPct,
    market_penetration_radius_pct: marketPenetrationInRadius,
    registered_vehicles_in_radius: totalRegisteredVehiclesInRadius,
    top_insurance: [...insuranceCounts.entries()]
      .sort((a, b) => b[1] - a[1])
      .slice(0, 10)
      .map(([name, count]) => ({ name, count })),
    pay_type_distribution: [...payTypeCounts.entries()]
      .sort((a, b) => b[1] - a[1])
      .map(([name, count]) => ({ name, count })),
  }

  return { metrics, customers, zip_breakdown, make_breakdown, market_zips }
}
