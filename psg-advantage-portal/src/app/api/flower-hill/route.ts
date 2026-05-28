import { NextRequest, NextResponse } from 'next/server'
import { getAuthenticatedProfile, isAdmin } from '@/lib/auth'
import { getCached, setCached } from '@/lib/cache'
import { getFlowerHillReport } from '@/lib/flowerHillData'
import type { FlowerHillReportData } from '@/types'

export async function GET(request: NextRequest) {
  const result = await getAuthenticatedProfile(request)
  if (result instanceof NextResponse) return result
  if (!isAdmin(result)) {
    return NextResponse.json(
      { error: { code: 'FORBIDDEN', message: 'Admin access required' } },
      { status: 403 }
    )
  }

  const radiusRaw = request.nextUrl.searchParams.get('radius')
  const radiusMiles = Math.max(5, Math.min(100, Number(radiusRaw) || 25))

  const cacheKey = `flower-hill:report:v7:r${radiusMiles}`
  const cached = await getCached<FlowerHillReportData>(cacheKey)
  if (cached) return NextResponse.json(cached)

  try {
    const data = await getFlowerHillReport(radiusMiles)
    await setCached(cacheKey, data, 600)
    return NextResponse.json(data)
  } catch (error) {
    console.error('[flower-hill] Error:', error instanceof Error ? error.message : error, error instanceof Error ? error.stack : '')
    return NextResponse.json(
      { error: { code: 'INTERNAL_ERROR', message: 'Unable to load Flower Hill report' } },
      { status: 500 }
    )
  }
}
