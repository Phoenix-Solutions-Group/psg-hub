import { NextRequest, NextResponse } from 'next/server'
import { getAuthenticatedProfile, isAdmin } from '@/lib/auth'
import { getCached, setCached } from '@/lib/cache'
import { getNetworkTrend } from '@/lib/supabase/data'
import type { TrendPoint } from '@/types'

export async function GET(request: NextRequest) {
  const result = await getAuthenticatedProfile()
  if (result instanceof NextResponse) return result
  if (!isAdmin(result)) {
    return NextResponse.json(
      { error: { code: 'FORBIDDEN', message: 'Admin access required' } },
      { status: 403 }
    )
  }

  const { searchParams } = request.nextUrl
  const months = Number(searchParams.get('months')) || 24

  const cacheKey = `network:trend:${months}`
  const cached = await getCached<TrendPoint[]>(cacheKey)
  if (cached) return NextResponse.json(cached)

  const data = await getNetworkTrend(months)

  await setCached(cacheKey, data, 86400)
  return NextResponse.json(data)
}
