import { NextRequest, NextResponse } from 'next/server'
import { getAuthenticatedProfile, isAdmin } from '@/lib/auth'
import { getCached, setCached } from '@/lib/cache'
import { searchMarketMapShops } from '@/lib/supabase/data'
import type { MarketMapSearchResult } from '@/types'

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
  const query = (searchParams.get('q') || '').trim()
  if (query.length < 2) {
    return NextResponse.json([])
  }

  const resultLimit = Math.min(
    Math.max(Number(searchParams.get('limit') || 20) || 20, 1),
    50
  )
  const cacheKey = `market-map:search:v1:${query.toLowerCase()}:${resultLimit}`
  const cached = await getCached<MarketMapSearchResult[]>(cacheKey)
  if (cached) return NextResponse.json(cached)

  const rows = await searchMarketMapShops(query, resultLimit)
  await setCached(cacheKey, rows, 300)

  return NextResponse.json(rows)
}
