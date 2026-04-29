import { Pool } from 'pg'
import type { AlertShop, NetworkSummary, TrendPoint } from '@/types'

let pool: Pool | null = null

function getPool() {
  if (process.env.NODE_ENV === 'production') return null

  const connectionString = process.env.SUPABASE_DB_URL || process.env.DATABASE_URL
  if (!connectionString) return null

  pool ||= new Pool({
    connectionString,
    max: 4,
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

export async function getNetworkSummaryFromPostgres(
  startDate: string,
  endDate: string
): Promise<NetworkSummary | null> {
  const database = getPool()
  if (!database) return null

  const result = await database.query(
    'SELECT * FROM network_summary($1::date, $2::date)',
    [startDate, endDate]
  )
  const row = result.rows[0] || {}

  return {
    total_surveys: toNumber(row.total_surveys),
    avg_emi_pct: toNumber(row.avg_emi_pct),
    active_shops: toNumber(row.active_shops),
    alert_count: toNumber(row.alert_count),
  }
}

export async function getNetworkTrendFromPostgres(
  months: number
): Promise<TrendPoint[] | null> {
  const database = getPool()
  if (!database) return null

  const result = await database.query('SELECT * FROM network_trend($1::integer)', [
    months,
  ])

  return result.rows.map((row) => ({
    month: String(row.month || ''),
    surveys: toNumber(row.surveys),
    avg_emi_pct: toNumber(row.avg_emi_pct),
  }))
}

export async function getNetworkAlertsFromPostgres(
  threshold: number,
  months: number
): Promise<AlertShop[] | null> {
  const database = getPool()
  if (!database) return null

  const result = await database.query(
    'SELECT * FROM network_alerts($1::numeric, $2::integer)',
    [threshold, months]
  )

  return result.rows.map((row) => ({
    shop_name: String(row.shop_name || ''),
    avg_emi_pct: toNumber(row.avg_emi_pct),
    total_surveys: toNumber(row.total_surveys),
    months_below: toNumber(row.months_below),
  }))
}
