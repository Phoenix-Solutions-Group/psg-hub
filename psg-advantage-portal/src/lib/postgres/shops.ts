import { Pool } from 'pg'
import type { ShopListItem } from '@/types'

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

function toNullableNumber(value: unknown) {
  if (value === null || value === undefined || value === '') return null
  const numeric = Number(value)
  return Number.isFinite(numeric) ? numeric : null
}

export async function getShopListFromPostgres(
  startDate: string,
  endDate: string
): Promise<ShopListItem[] | null> {
  const database = getPool()
  if (!database) return null

  const result = await database.query(
    'SELECT * FROM shop_list($1::date, $2::date)',
    [startDate, endDate]
  )

  return result.rows.map((row) => ({
    shop_name: String(row.shop_name || ''),
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
