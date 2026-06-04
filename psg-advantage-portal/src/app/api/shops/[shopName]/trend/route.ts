import { NextRequest, NextResponse } from 'next/server'
import { getAuthenticatedProfile, canAccessShop } from '@/lib/auth'
import { getCached, setCached } from '@/lib/cache'
import { getShopTrend } from '@/lib/supabase/data'
import type { ShopTrendPoint } from '@/types'

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

  const cacheKey = `shop:trend:${decodedShopName}`
  const cached = await getCached<ShopTrendPoint[]>(cacheKey)
  if (cached) {
    return NextResponse.json(cached)
  }

  const rows = await getShopTrend(decodedShopName)

  await setCached(cacheKey, rows)
  return NextResponse.json(rows)
}
