import { NextRequest, NextResponse } from 'next/server'
import { getAuthenticatedProfile, canAccessShop } from '@/lib/auth'
import { getCached, setCached } from '@/lib/cache'
import { getShopCompetitorOverlay } from '@/lib/supabase/data'
import type { ShopCompetitorPoint } from '@/types'

interface RouteParams {
  params: Promise<{ shopName: string }>
}

export async function GET(request: NextRequest, { params }: RouteParams) {
  const result = await getAuthenticatedProfile(request)
  if (result instanceof NextResponse) return result

  const { shopName } = await params
  const decodedShopName = decodeURIComponent(shopName)

  if (!canAccessShop(result, decodedShopName)) {
    return NextResponse.json(
      { error: { code: 'FORBIDDEN', message: 'Access denied to this shop' } },
      { status: 403 }
    )
  }

  const { searchParams } = request.nextUrl
  const radiusMiles = Math.min(
    Math.max(Number(searchParams.get('radiusMiles') || 25) || 25, 1),
    100
  )
  const resultLimit = Math.min(
    Math.max(Number(searchParams.get('limit') || 25) || 25, 1),
    100
  )
  const cacheKey = `shop:competitors:v3:${decodedShopName}:${radiusMiles}:${resultLimit}`
  const cached = await getCached<ShopCompetitorPoint[]>(cacheKey)
  if (cached) return NextResponse.json(cached)

  let rows: ShopCompetitorPoint[]
  try {
    rows = await getShopCompetitorOverlay(decodedShopName, radiusMiles, resultLimit)
  } catch (error) {
    console.error('[Competitors]', decodedShopName, error)
    return NextResponse.json([])
  }
  await setCached(cacheKey, rows, 86400)

  return NextResponse.json(rows)
}
