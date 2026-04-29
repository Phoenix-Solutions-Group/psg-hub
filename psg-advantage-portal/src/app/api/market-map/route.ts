import { NextRequest, NextResponse } from 'next/server'
import { getAuthenticatedProfile, isAdmin } from '@/lib/auth'
import { getCached, setCached } from '@/lib/cache'
import { getMarketMapData } from '@/lib/supabase/data'
import { normalizeMarketFilters } from '@/lib/requestValidation'
import type { MarketMapData } from '@/types'

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
  const filters = normalizeMarketFilters(null, searchParams.get('state'))
  if (!filters.ok) {
    return NextResponse.json(
      { error: { code: 'BAD_REQUEST', message: filters.message } },
      { status: 400 }
    )
  }

  const directoryLimit = Math.min(
    Math.max(Number(searchParams.get('limit') || 5000) || 5000, 100),
    50000
  )
  const state = filters.value.state || null
  const cacheKey = `market-map:v3:${state || '*'}:${directoryLimit}`
  const cached = await getCached<MarketMapData>(cacheKey)
  if (cached) return NextResponse.json(cached)

  const data = await getMarketMapData(state, directoryLimit)
  await setCached(cacheKey, data, 3600)

  return NextResponse.json(data)
}
