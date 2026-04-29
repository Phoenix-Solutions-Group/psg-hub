import { NextRequest, NextResponse } from 'next/server'
import { getAuthenticatedProfile, canAccessShop } from '@/lib/auth'
import { getCached, setCached } from '@/lib/cache'
import { getShopDetail } from '@/lib/supabase/data'
import { getTrend } from '@/lib/formatters'
import type { ShopDetail } from '@/types'

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
  const endDate = searchParams.get('endDate') || new Date().toISOString().split('T')[0]
  const startDate =
    searchParams.get('startDate') ||
    new Date(Date.now() - 90 * 24 * 60 * 60 * 1000).toISOString().split('T')[0]

  const cacheKey = `shop:detail:${decodedShopName}:${startDate}:${endDate}`
  const cached = await getCached<ShopDetail>(cacheKey)
  if (cached) {
    return NextResponse.json(cached)
  }

  const row = await getShopDetail(decodedShopName, startDate, endDate)

  if (!row) {
    return NextResponse.json(
      { error: { code: 'NOT_FOUND', message: 'Shop not found' } },
      { status: 404 }
    )
  }

  const detail: ShopDetail = {
    ...row,
    trend: getTrend(0),
    emi_delta: 0,
  }

  await setCached(cacheKey, detail)
  return NextResponse.json(detail)
}
