import { NextRequest, NextResponse } from 'next/server'
import { getAuthenticatedProfile, isAdmin } from '@/lib/auth'
import { getCached, setCached } from '@/lib/cache'
import { getMarketViewportIntelligence } from '@/lib/supabase/data'
import type { MarketViewportIntelligence } from '@/types'

function parseBound(searchParams: URLSearchParams, key: string, min: number, max: number) {
  const value = Number(searchParams.get(key))
  if (!Number.isFinite(value) || value < min || value > max) {
    return null
  }
  return value
}

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
  const west = parseBound(searchParams, 'west', -180, 180)
  const south = parseBound(searchParams, 'south', -90, 90)
  const east = parseBound(searchParams, 'east', -180, 180)
  const north = parseBound(searchParams, 'north', -90, 90)
  const zoom = parseBound(searchParams, 'zoom', 0, 22)

  if (west === null || south === null || east === null || north === null || zoom === null) {
    return NextResponse.json(
      { error: { code: 'BAD_REQUEST', message: 'Valid west, south, east, north, and zoom are required' } },
      { status: 400 }
    )
  }

  if (south >= north || west === east) {
    return NextResponse.json(
      { error: { code: 'BAD_REQUEST', message: 'Map bounds must describe a visible area' } },
      { status: 400 }
    )
  }

  const rounded = [west, south, east, north, zoom].map((value) => value.toFixed(3))
  const cacheKey = `market-map-intelligence:v1:${rounded.join(':')}`
  const cached = await getCached<MarketViewportIntelligence>(cacheKey)
  if (cached) return NextResponse.json(cached)

  const data = await getMarketViewportIntelligence({
    west,
    south,
    east,
    north,
    zoom,
    resultLimit: 8,
  })
  await setCached(cacheKey, data, 300)

  return NextResponse.json(data)
}
