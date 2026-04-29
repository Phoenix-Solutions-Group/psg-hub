import { redirect } from 'next/navigation'
import { getAuthenticatedProfile, canAccessShop } from '@/lib/auth'
import { getCached, setCached } from '@/lib/cache'
import { getShopCompetitorOverlay, getShopDetail, getShopTrend } from '@/lib/supabase/data'
import { getTrend } from '@/lib/formatters'
import { KpiCard } from '@/components/ui/KpiCard'
import { TrendBadge } from '@/components/ui/TrendBadge'
import ScoreBar from '@/components/ui/ScoreBar'
import ScoreBreakdownChart from '@/components/charts/ScoreBreakdownChart'
import YearOverYearChart from '@/components/charts/YearOverYearChart'
import CommentsFeed from '@/components/ui/CommentsFeed'
import { CompetitorOverlay } from '@/components/ui/CompetitorOverlay'
import type { ShopCompetitorPoint, ShopDetail, ShopTrendPoint } from '@/types'
import { NextResponse } from 'next/server'

interface PageProps {
  params: Promise<{ shopName: string }>
}

export default async function ShopDetailPage({ params }: PageProps) {
  const profile = await getAuthenticatedProfile()
  if (profile instanceof NextResponse) {
    redirect('/login')
  }

  const { shopName } = await params
  const decodedShopName = decodeURIComponent(shopName)

  if (!canAccessShop(profile, decodedShopName)) {
    redirect('/')
  }

  const endDate = new Date().toISOString().split('T')[0]
  const startDate = new Date(Date.now() - 90 * 24 * 60 * 60 * 1000).toISOString().split('T')[0]

  // Fetch shop detail with cache
  const detailCacheKey = `shop:detail:v2:${decodedShopName}:${startDate}:${endDate}`
  let shopData = await getCached<ShopDetail>(detailCacheKey)

  if (!shopData) {
    const row = await getShopDetail(decodedShopName, startDate, endDate)
    if (!row) {
      redirect('/')
    }
    shopData = { ...row, trend: getTrend(0), emi_delta: 0 }
    await setCached(detailCacheKey, shopData)
  }

  // Fetch trend data with cache
  const trendCacheKey = `shop:trend:${decodedShopName}`
  let trend = await getCached<ShopTrendPoint[]>(trendCacheKey)

  if (!trend) {
    trend = await getShopTrend(decodedShopName)
    await setCached(trendCacheKey, trend)
  }

  const competitorCacheKey = `shop:competitors:v2:${decodedShopName}:25`
  let competitorOverlay = await getCached<ShopCompetitorPoint[]>(competitorCacheKey)

  if (!competitorOverlay) {
    competitorOverlay = await getShopCompetitorOverlay(decodedShopName, 25, 25)
    await setCached(competitorCacheKey, competitorOverlay, 86400)
  }

  const shop = shopData
  const commIsFlagged =
    shop.avg_communication !== null &&
    shop.network_avg_communication !== null &&
    shop.avg_communication < shop.network_avg_communication

  return (
    <div>
      <div className="mb-8 flex flex-col gap-3 border-b border-stone pb-6">
        <p className="font-heading text-xs font-medium uppercase text-phoenix-red">
          Shop detail
        </p>
        <div className="flex items-center gap-3">
          <h2 className="font-heading text-3xl font-light text-navy">{shop.shop_name}</h2>
          <TrendBadge trend={shop.trend} delta={shop.emi_delta} />
        </div>
        {(shop.psg_id || shop.invoiced_id) && (
          <div className="flex flex-wrap gap-2 font-heading text-xs font-medium text-slate">
            {shop.psg_id && (
              <span className="border border-stone bg-white px-2.5 py-1">
                PSG {shop.psg_id}
              </span>
            )}
            {shop.invoiced_id && (
              <span className="border border-stone bg-white px-2.5 py-1">
                Invoiced {shop.invoiced_id}
              </span>
            )}
            {(shop.invoiced_city || shop.invoiced_state) && (
              <span className="border border-stone bg-white px-2.5 py-1">
                {[shop.invoiced_city, shop.invoiced_state].filter(Boolean).join(', ')}
              </span>
            )}
          </div>
        )}
      </div>

      {/* KPI row */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4 mb-6">
        <KpiCard label="EMI Score" value={shop.avg_emi_pct} format="percent" />
        <KpiCard label="Total Surveys" value={shop.total_surveys} />
        <div className="border border-stone bg-white p-5 shadow-[0_1px_2px_rgba(22,21,20,0.04)]">
          <ScoreBar
            label="Communication"
            value={shop.avg_communication}
            isFlagged={commIsFlagged}
          />
          {commIsFlagged && shop.network_avg_communication !== null && (
            <p className="mt-1 text-[10px] text-phoenix-red">
              Below network avg ({shop.network_avg_communication.toFixed(1)}%)
            </p>
          )}
        </div>
        <div className="border border-stone bg-white p-5 shadow-[0_1px_2px_rgba(22,21,20,0.04)]">
          <ScoreBar label="Courtesy" value={shop.avg_courtesy} />
        </div>
      </div>

      {/* Score breakdown + trend charts */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 mb-6">
        <ScoreBreakdownChart
          scores={[
            { label: 'Quality', value: shop.avg_quality },
            { label: 'Cleanliness', value: shop.avg_cleanliness },
            {
              label: 'Communication',
              value: shop.avg_communication,
              networkAvg: shop.network_avg_communication,
            },
            { label: 'Courtesy', value: shop.avg_courtesy },
          ]}
        />
        <YearOverYearChart data={trend} />
      </div>

      <div className="mb-6">
        <CompetitorOverlay shopName={decodedShopName} points={competitorOverlay} />
      </div>

      {/* Comments */}
      <CommentsFeed shopName={decodedShopName} />
    </div>
  )
}
