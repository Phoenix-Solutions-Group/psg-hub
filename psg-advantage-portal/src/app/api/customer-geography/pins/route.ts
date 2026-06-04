import { NextRequest, NextResponse } from 'next/server'
import { getAuthenticatedProfile, isAdmin } from '@/lib/auth'
import { getCached, setCached } from '@/lib/cache'
import { getCustomerGeoPins } from '@/lib/customerGeographyData'
import { normalizeCustomerGeoFilters } from '@/app/api/customer-geography/_shared'
import type { CustomerGeoPinsResponse } from '@/types'

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
  const normalized = normalizeCustomerGeoFilters(searchParams)
  if (!normalized.ok) {
    return NextResponse.json(
      { error: { code: 'BAD_REQUEST', message: normalized.message } },
      { status: 400 }
    )
  }

  const limit = Math.min(
    Math.max(Number(searchParams.get('limit') || 1200) || 1200, 100),
    10000
  )

  const { startDate, endDate, preset, shopIds } = normalized.value
  const cacheKey = `customer-geo:pins:v1:${startDate}:${endDate}:${preset}:${shopIds.join('|')}:${limit}`
  const cached = await getCached<CustomerGeoPinsResponse>(cacheKey)
  if (cached) return NextResponse.json(cached)

  let pins: CustomerGeoPinsResponse['pins']
  try {
    pins = await getCustomerGeoPins({
      startDate,
      endDate,
      preset,
      shopIds,
      limit,
    })
  } catch (error) {
    console.error('[customer-geo:pins]', error)
    return NextResponse.json(
      { error: { code: 'INTERNAL_ERROR', message: 'Unable to load customer geography pins' } },
      { status: 500 }
    )
  }

  const uniqueHouseholds = pins.reduce((sum, row) => sum + row.unique_household_count, 0)
  const totalRepairs = pins.reduce((sum, row) => sum + row.repair_count, 0)
  const uniqueZips = new Set(pins.map((row) => row.zip).filter(Boolean)).size

  const payload: CustomerGeoPinsResponse = {
    filters: {
      startDate,
      endDate,
      preset,
      shopIds,
    },
    summary: {
      pin_count: pins.length,
      unique_households: uniqueHouseholds,
      unique_zips: uniqueZips,
      total_repairs: totalRepairs,
    },
    pins,
  }

  await setCached(cacheKey, payload, 600)
  return NextResponse.json(payload)
}
