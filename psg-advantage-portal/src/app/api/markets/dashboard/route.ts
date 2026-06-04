import { NextRequest, NextResponse } from 'next/server'
import { getAuthenticatedProfile, isAdmin } from '@/lib/auth'
import { getCached, setCached } from '@/lib/cache'
import { getMarketDashboardData, type MarketDashboardData } from '@/lib/supabase/data'
import { marketDashboardFallbackData } from '@/lib/marketDashboardFallback'
import { getMarketDashboardDataFromPostgres } from '@/lib/postgres/marketDashboard'
import { normalizeMarketFilters } from '@/lib/requestValidation'

export async function GET(request: NextRequest) {
  const result = await getAuthenticatedProfile(request)
  if (result instanceof NextResponse) return result
  if (!isAdmin(result)) {
    return NextResponse.json(
      { error: { code: 'FORBIDDEN', message: 'Admin access required' } },
      { status: 403 }
    )
  }

  const { searchParams } = request.nextUrl
  const filters = normalizeMarketFilters(searchParams.get('city'), searchParams.get('state'))
  if (!filters.ok) {
    return NextResponse.json(
      { error: { code: 'BAD_REQUEST', message: filters.message } },
      { status: 400 }
    )
  }

  const { city, state } = filters.value
  const cacheKey = `market-dashboard:${city.toLowerCase() || '*'}:${state || '*'}`
  const cached = await getCached<MarketDashboardData>(cacheKey)
  if (cached) return NextResponse.json(cached)

  let data = marketDashboardFallbackData
  try {
    data = await getMarketDashboardDataFromPostgres(city || null, state || null)
      || await getMarketDashboardData(city || null, state || null)
  } catch (err) {
    console.error('[Market Dashboard API] Falling back to static dashboard data', err)
  }
  await setCached(cacheKey, data, 3600)

  return NextResponse.json(data)
}
