import { Suspense } from 'react'
import { createClient } from '@/lib/supabase/server'
import { redirect } from 'next/navigation'
import { cookies } from 'next/headers'
import { getCached, setCached } from '@/lib/cache'
import {
  getNetworkAlerts,
  getNetworkSummary,
  getNetworkTrend,
  getShopList,
} from '@/lib/supabase/data'
import {
  getNetworkAlertsFromPostgres,
  getNetworkSummaryFromPostgres,
  getNetworkTrendFromPostgres,
} from '@/lib/postgres/network'
import { getShopListFromPostgres } from '@/lib/postgres/shops'
import type { NetworkSummary, TrendPoint, AlertShop, ShopListItem } from '@/types'
import { KpiCard } from '@/components/ui/KpiCard'
import { AlertPanel } from '@/components/ui/AlertPanel'
import { DateRangePicker } from '@/components/ui/DateRangePicker'
import { ShopTable } from '@/components/ui/ShopTable'
import { EmiTrendChart } from '@/components/charts/EmiTrendChart'
import { format, subDays } from 'date-fns'
import { normalizeDateRange } from '@/lib/requestValidation'

const DEMO_SUMMARY: NetworkSummary = {
  total_surveys: 12846,
  avg_emi_pct: 91.4,
  active_shops: 42,
  alert_count: 5,
  total_surveys_delta: 8.2,
  avg_emi_delta: 1.1,
}

const DEMO_TREND: TrendPoint[] = [
  { month: '2025-11', surveys: 920, avg_emi_pct: 88.7 },
  { month: '2025-12', surveys: 1055, avg_emi_pct: 89.5 },
  { month: '2026-01', surveys: 1188, avg_emi_pct: 90.2 },
  { month: '2026-02', surveys: 1240, avg_emi_pct: 90.8 },
  { month: '2026-03', surveys: 1325, avg_emi_pct: 91.1 },
  { month: '2026-04', surveys: 1410, avg_emi_pct: 91.4 },
]

const DEMO_ALERTS: AlertShop[] = [
  { shop_name: 'Dallas North Collision', avg_emi_pct: 84.6, total_surveys: 88, months_below: 3 },
  { shop_name: 'Plano Repair Center', avg_emi_pct: 86.1, total_surveys: 74, months_below: 3 },
  { shop_name: 'Irving Auto Body', avg_emi_pct: 87.3, total_surveys: 66, months_below: 3 },
]

const DEMO_SHOPS: ShopListItem[] = [
  { shop_name: 'Phoenix Central', total_surveys: 412, avg_emi_pct: 96.2, trend: 'improving', emi_delta: 2.4, latest_survey_date: '2026-04-21' },
  { shop_name: 'Frisco Collision', total_surveys: 377, avg_emi_pct: 94.8, trend: 'stable', emi_delta: 0.3, latest_survey_date: '2026-04-20' },
  { shop_name: 'Plano Repair Center', total_surveys: 288, avg_emi_pct: 86.1, trend: 'declining', emi_delta: -3.2, latest_survey_date: '2026-04-18' },
]

async function fetchWithCache<T>(
  cacheKey: string,
  load: () => Promise<T>
): Promise<T> {
  const cached = await getCached<T>(cacheKey)
  if (cached) return cached
  try {
    const data = await load()
    await setCached(cacheKey, data, 86400)
    return data
  } catch (err) {
    console.warn('[Dashboard data]', cacheKey, err)
    throw err
  }
}

export default async function NetworkDashboard({
  searchParams,
}: {
  searchParams: Promise<{ startDate?: string; endDate?: string }>
}) {
  const cookieStore = await cookies()
  const demoAuth =
    process.env.NODE_ENV !== 'production' &&
    cookieStore.get('psg_demo_auth')?.value === '1'

  let displayName = 'Demo User'

  if (!demoAuth) {
    const supabase = await createClient()
    const { data: { user } } = await supabase.auth.getUser()

    if (!user) {
      redirect('/login')
    }

    const { data: profile } = await supabase
      .from('portal_users')
      .select('full_name, role, shop_id')
      .eq('id', user.id)
      .single()

    // Shop owners go to their own shop detail page
    if (profile?.role === 'shop_owner' && profile.shop_id) {
      redirect(`/shops/${encodeURIComponent(profile.shop_id)}`)
    }

    displayName = profile?.full_name || user.email || displayName
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

  let isDemoData = false
  let summary: NetworkSummary
  let trend: TrendPoint[]
  let alerts: AlertShop[]
  let shops: ShopListItem[]

  try {
    ;[summary, trend, alerts, shops] = await Promise.all([
      fetchWithCache<NetworkSummary>(
        `network:summary:${startDate}:${endDate}`,
        async () =>
          await getNetworkSummaryFromPostgres(startDate, endDate)
          || await getNetworkSummary(startDate, endDate)
      ),
      fetchWithCache<TrendPoint[]>(
        'network:trend:24',
        async () =>
          await getNetworkTrendFromPostgres(24)
          || await getNetworkTrend(24)
      ),
      fetchWithCache<AlertShop[]>(
        'network:alerts:88:3',
        async () =>
          await getNetworkAlertsFromPostgres(88, 3)
          || await getNetworkAlerts(88, 3)
      ),
      fetchWithCache<ShopListItem[]>(
        `shops:list:v4:${startDate}:${endDate}`,
        async () =>
          await getShopListFromPostgres(startDate, endDate)
          || await getShopList(startDate, endDate)
      ),
    ])
  } catch (err) {
    console.warn('[Dashboard] Falling back to demo data', err)
    isDemoData = true
    summary = DEMO_SUMMARY
    trend = DEMO_TREND
    alerts = DEMO_ALERTS
    shops = DEMO_SHOPS
  }

  return (
    <div>
      <div className="mb-8 flex flex-col gap-5 border-b border-stone pb-6 lg:flex-row lg:items-end lg:justify-between">
        <div>
          <p className="font-heading text-xs font-medium uppercase text-phoenix-red">
            Network performance
          </p>
          <h2 className="mt-3 font-heading text-3xl font-light text-navy">
            Network Dashboard
          </h2>
          <p className="mt-2 text-sm text-slate">Welcome, {displayName}.</p>
        </div>
        <DateRangePicker />
      </div>

      {isDemoData && (
        <div className="mb-6 border border-catalyst/40 bg-white px-4 py-3 text-sm leading-6 text-slate">
          <span className="font-heading font-medium text-navy">Demo mode:</span>{' '}
          Supabase data is not available locally, so this dashboard is
          showing sample data. Marketing Intelligence is still available from
          the navigation.
        </div>
      )}

      {/* KPI Cards */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        <KpiCard
          label="Total Surveys"
          value={summary.total_surveys}
          delta={summary.total_surveys_delta}
        />
        <KpiCard
          label="Avg EMI"
          value={summary.avg_emi_pct}
          format="percent"
          delta={summary.avg_emi_delta}
        />
        <KpiCard
          label="Active Shops"
          value={summary.active_shops}
        />
        <KpiCard
          label="Alerts"
          value={summary.alert_count}
        />
      </div>

      {/* Chart + Alerts */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6 mt-6">
        <div className="lg:col-span-2">
          <Suspense
            fallback={
              <div className="h-[400px] animate-pulse border border-stone bg-white p-4" />
            }
          >
            <EmiTrendChart data={trend} />
          </Suspense>
        </div>
        <AlertPanel alerts={alerts} threshold={88} />
      </div>

      {/* Shop Table */}
      <div className="mt-6">
        <ShopTable shops={shops} />
      </div>
    </div>
  )
}
