import { NextRequest, NextResponse } from 'next/server'
import { getAuthenticatedProfile, isAdmin } from '@/lib/auth'
import { getCached, setCached } from '@/lib/cache'
import { getCustomerGeoShops } from '@/lib/customerGeographyData'
import type { CustomerGeoShopOption } from '@/types'
import { normalizeDateRange } from '@/lib/requestValidation'
import { normalizePreset } from '@/app/api/customer-geography/_shared'

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
  const dateRange = normalizeDateRange(
    searchParams.get('startDate'),
    searchParams.get('endDate'),
    { startDate: '2024-01-01', endDate: new Date().toISOString().slice(0, 10) }
  )
  if (!dateRange.ok) {
    return NextResponse.json(
      { error: { code: 'BAD_REQUEST', message: dateRange.message } },
      { status: 400 }
    )
  }

  const preset = normalizePreset(searchParams.get('preset'))
  if (!preset.ok) {
    return NextResponse.json(
      { error: { code: 'BAD_REQUEST', message: preset.message } },
      { status: 400 }
    )
  }

  const cacheKey = `customer-geo:shops:v1:${dateRange.value.startDate}:${dateRange.value.endDate}:${preset.value}`
  const cached = await getCached<CustomerGeoShopOption[]>(cacheKey)
  if (cached) return NextResponse.json(cached)

  let shops: CustomerGeoShopOption[]
  try {
    shops = await getCustomerGeoShops(
      dateRange.value.startDate,
      dateRange.value.endDate,
      preset.value
    )
  } catch (error) {
    console.error('[customer-geo:shops]', error)
    return NextResponse.json(
      { error: { code: 'INTERNAL_ERROR', message: 'Unable to load customer geography shops' } },
      { status: 500 }
    )
  }
  await setCached(cacheKey, shops, 3600)

  return NextResponse.json(shops)
}
