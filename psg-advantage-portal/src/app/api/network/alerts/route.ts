import { NextRequest, NextResponse } from 'next/server'
import { getAuthenticatedProfile, isAdmin } from '@/lib/auth'
import { getCached, setCached } from '@/lib/cache'
import { getNetworkAlerts } from '@/lib/supabase/data'
import type { AlertShop } from '@/types'

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
  const threshold = Number(searchParams.get('threshold')) || 88
  const months = Number(searchParams.get('months')) || 3

  const cacheKey = `network:alerts:${threshold}:${months}`
  const cached = await getCached<AlertShop[]>(cacheKey)
  if (cached) return NextResponse.json(cached)

  const data = await getNetworkAlerts(threshold, months)

  await setCached(cacheKey, data, 86400)
  return NextResponse.json(data)
}
