import { NextRequest, NextResponse } from 'next/server'
import { getAuthenticatedProfile, isAdmin } from '@/lib/auth'
import { getCached, setCached } from '@/lib/cache'
import { getShopList } from '@/lib/supabase/data'
import { getShopListFromPostgres } from '@/lib/postgres/shops'
import type { ShopListItem } from '@/types'
import { format, subDays } from 'date-fns'
import { normalizeDateRange } from '@/lib/requestValidation'

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
  const defaultEndDate = format(new Date(), 'yyyy-MM-dd')
  const defaultStartDate = format(subDays(new Date(), 90), 'yyyy-MM-dd')
  const dateRange = normalizeDateRange(searchParams.get('startDate'), searchParams.get('endDate'), {
    startDate: defaultStartDate,
    endDate: defaultEndDate,
  })
  if (!dateRange.ok) {
    return NextResponse.json(
      { error: { code: 'BAD_REQUEST', message: dateRange.message } },
      { status: 400 }
    )
  }
  const { startDate, endDate } = dateRange.value

  const cacheKey = `shops:list:v4:${startDate}:${endDate}`
  const cached = await getCached<ShopListItem[]>(cacheKey)
  if (cached) return NextResponse.json(cached)

  const data = await getShopListFromPostgres(startDate, endDate)
    || await getShopList(startDate, endDate)

  await setCached(cacheKey, data, 86400)
  return NextResponse.json(data)
}
