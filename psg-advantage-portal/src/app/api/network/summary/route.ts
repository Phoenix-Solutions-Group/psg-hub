import { NextRequest, NextResponse } from 'next/server'
import { getAuthenticatedProfile, isAdmin } from '@/lib/auth'
import { getCached, setCached } from '@/lib/cache'
import { getNetworkSummary } from '@/lib/supabase/data'
import type { NetworkSummary } from '@/types'
import { format, subDays } from 'date-fns'

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
  const endDate = searchParams.get('endDate') || format(new Date(), 'yyyy-MM-dd')
  const startDate = searchParams.get('startDate') || format(subDays(new Date(), 90), 'yyyy-MM-dd')

  const cacheKey = `network:summary:${startDate}:${endDate}`
  const cached = await getCached<NetworkSummary>(cacheKey)
  if (cached) return NextResponse.json(cached)

  const data = await getNetworkSummary(startDate, endDate)

  await setCached(cacheKey, data, 86400)
  return NextResponse.json(data)
}
