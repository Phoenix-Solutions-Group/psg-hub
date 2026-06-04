import { NextRequest, NextResponse } from 'next/server'
import { getAuthenticatedProfile, isAdmin } from '@/lib/auth'
import { getCached, setCached } from '@/lib/cache'
import {
  getShopCompetitorOverlay,
  getShopCompetitorOverlayByPlaceId,
} from '@/lib/supabase/data'
import type { ShopCompetitorPoint } from '@/types'

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
  const placeId = (searchParams.get('placeId') || '').trim()
  const shopName = (searchParams.get('shopName') || '').trim()
  if (!placeId && !shopName) {
    return NextResponse.json(
      { error: { code: 'BAD_REQUEST', message: 'placeId or shopName is required' } },
      { status: 400 }
    )
  }

  const radiusMiles = Math.min(
    Math.max(Number(searchParams.get('radiusMiles') || 25) || 25, 1),
    100
  )
  const resultLimit = Math.min(
    Math.max(Number(searchParams.get('limit') || 25) || 25, 1),
    100
  )
  const identity = placeId ? `place:${placeId}` : `name:${shopName}`
  const cacheKey = `market-map:competitors:v1:${identity}:${radiusMiles}:${resultLimit}`
  const cached = await getCached<ShopCompetitorPoint[]>(cacheKey)
  if (cached) return NextResponse.json(cached)

  let rows: ShopCompetitorPoint[]
  try {
    rows = placeId
      ? await getShopCompetitorOverlayByPlaceId(placeId, radiusMiles, resultLimit)
      : await getShopCompetitorOverlay(shopName, radiusMiles, resultLimit)
  } catch (error) {
    console.error('[Market map competitors]', identity, error)
    return NextResponse.json([])
  }

  await setCached(cacheKey, rows, 86400)
  return NextResponse.json(rows)
}
