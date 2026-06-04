import { createClient } from '@/lib/supabase/server'
import { redirect } from 'next/navigation'
import { cookies } from 'next/headers'
import { hasDemoAuthCookie } from '@/lib/demoAuth'
import { getCached, setCached } from '@/lib/cache'
import { getShopList } from '@/lib/supabase/data'
import { getShopListFromPostgres } from '@/lib/postgres/shops'
import { ShopTable } from '@/components/ui/ShopTable'
import { DateRangePicker } from '@/components/ui/DateRangePicker'
import type { ShopListItem } from '@/types'
import { format, subDays } from 'date-fns'
import { normalizeDateRange } from '@/lib/requestValidation'

export default async function ShopsPage({
  searchParams,
}: {
  searchParams: Promise<{ startDate?: string; endDate?: string }>
}) {
  const cookieStore = await cookies()
  const demoAuth = hasDemoAuthCookie(cookieStore.get('psg_demo_auth')?.value)

  if (!demoAuth) {
    const supabase = await createClient()
    const { data: { user } } = await supabase.auth.getUser()

    if (!user) {
      redirect('/login')
    }

    const { data: profile } = await supabase
      .from('portal_users')
      .select('role')
      .eq('id', user.id)
      .single()

    // Admin-only page: non-admins redirect to dashboard root
    if (profile?.role !== 'psg_admin') {
      redirect('/')
    }
  }

  const params = await searchParams
  const defaultEndDate = format(new Date(), 'yyyy-MM-dd')
  const defaultStartDate = format(subDays(new Date(), 90), 'yyyy-MM-dd')
  const dateRange = normalizeDateRange(params.startDate, params.endDate, {
    startDate: defaultStartDate,
    endDate: defaultEndDate,
  })
  const { startDate, endDate } = dateRange.ok
    ? dateRange.value
    : { startDate: defaultStartDate, endDate: defaultEndDate }

  const cacheKey = `shops:geo:list:v5:${startDate}:${endDate}`
  let shops = await getCached<ShopListItem[]>(cacheKey)

  if (!shops) {
    shops = await getShopListFromPostgres(startDate, endDate)
      || await getShopList(startDate, endDate)
    await setCached(cacheKey, shops, 86400)
  }

  return (
    <div>
      <div className="mb-8 flex flex-col gap-5 border-b border-stone pb-6 lg:flex-row lg:items-end lg:justify-between">
        <div>
          <p className="font-heading text-xs font-medium uppercase text-phoenix-red">
            Customer network
          </p>
          <h2 className="mt-3 font-heading text-3xl font-light text-navy">
            Shop Performance
          </h2>
          <p className="mt-2 max-w-3xl text-sm leading-6 text-slate">
            Showing top {shops.length.toLocaleString()} shops from Supabase,
            prioritized by matched survey activity.
          </p>
        </div>
        <DateRangePicker />
      </div>
      <ShopTable shops={shops} />
    </div>
  )
}
