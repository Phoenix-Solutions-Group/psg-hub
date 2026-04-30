import { createClient } from '@/lib/supabase/server'
import { redirect } from 'next/navigation'
import { cookies } from 'next/headers'
import { hasDemoAuthCookie } from '@/lib/demoAuth'
import {
  getCollisionTargetingExamples,
  getMarketingDaypart,
  getMarketingMetadata,
  getMarketingTopZips,
} from '@/lib/supabase/data'
import {
  MarketingIntelligenceDashboard,
  type MarketingIntelligenceData,
} from '@/components/charts/MarketingIntelligenceDashboard'
import { marketingIntelligenceData } from '@/lib/marketingIntelligenceData'
import { buildRepairDemandScore, buildWeatherDemandScore, score } from '@/lib/marketingScoring'

interface PageProps {
  searchParams: Promise<{ city?: string; state?: string }>
}

function buildFilterLabel(city?: string, state?: string) {
  if (city && state) return `${city}, ${state.toUpperCase()}`
  if (city) return city
  if (state) return state.toUpperCase()
  return 'Full market'
}

async function fetchMarketingIntelligenceData(
  city?: string,
  state?: string
): Promise<MarketingIntelligenceData> {
  const params = {
    city: city || null,
    state: state || null,
  }

  const latestCrashYear = 2025
  const [metadataRows, zipRows, daypartRows, crashTargetingRows] = await Promise.all([
    getMarketingMetadata(params.city, params.state),
    getMarketingTopZips(params.city, params.state),
    getMarketingDaypart(params.city, params.state),
    getCollisionTargetingExamples(params.state, latestCrashYear, 8).catch(() => []),
  ])

  const metadata = metadataRows
  const maxZip = Math.max(...zipRows.map((row) => row.accidents), 0)
  const maxStormDemand = Math.max(...zipRows.map((row) => row.storm_demand_score), 0)
  const maxDaypart = Math.max(...daypartRows.map((row) => row.claims), 0)

  const opportunityByZip = zipRows.map((row) => {
    const repairDemand = buildRepairDemandScore(
      row.accidents,
      maxZip,
      row.storm_demand_score,
      maxStormDemand
    )
    const accidentShare = maxZip > 0 ? row.accidents / maxZip : 0
    const shopCoverage = Math.max(22, 82 - Math.round(accidentShare * 42))

    return {
      zip: row.zip,
      accidents: row.accidents,
      repairDemand,
      shopCoverage,
      paidSearch: Math.min(100, Math.round(repairDemand * 0.72 + (100 - shopCoverage) * 0.28)),
      stormDemandScore: row.storm_demand_score,
    }
  })

  const daypartDemand = daypartRows.map((row) => {
    const claims = score(row.claims, maxDaypart, 20)
    return {
      time: row.time,
      claims,
      search: Math.max(10, Math.round(claims * 0.9)),
    }
  })

  const accidentDensity = metadata.row_count > 1_000_000 ? 92 : metadata.row_count > 100_000 ? 78 : 58
  const weatherScore = buildWeatherDemandScore(metadata.weather_related_rate, metadata.storm_demand_score)
  const severityScore = Math.round(50 + Math.min(metadata.severe_accident_rate * 1.6, 40))
  const proximityScore = opportunityByZip[0]?.shopCoverage || 60
  const gapScore = Math.round(100 - proximityScore)

  return {
    metadata: {
      source: 'supabase.public.accidents',
      split: city || state ? 'filtered Supabase rows' : 'all Supabase rows',
      rowCount: metadata.row_count,
      weatherRelatedCount: metadata.weather_related_count,
      severeAccidentRate: metadata.severe_accident_rate || 0,
      weatherRelatedRate: metadata.weather_related_rate || 0,
      averageDistanceMiles: metadata.average_distance_miles || 0,
      stormEventCount: metadata.storm_event_count || 0,
      hailEventCount: metadata.hail_event_count || 0,
      windEventCount: metadata.wind_event_count || 0,
      tornadoEventCount: metadata.tornado_event_count || 0,
      stormDemandScore: metadata.storm_demand_score || 0,
      maxHailSize: metadata.max_hail_size || 0,
      maxWindSpeed: metadata.max_wind_speed || 0,
    },
    metrics: {
      targetableAccidentDemand: opportunityByZip.reduce((total, row) => total + row.accidents, 0),
      coverageGap: opportunityByZip.length
        ? Math.round(opportunityByZip.reduce((total, row) => total + (100 - row.shopCoverage), 0) / opportunityByZip.length)
        : 0,
      bestNextChannel: 'Paid search',
    },
    opportunityByZip,
    daypartDemand,
    marketMix: [
      { channel: 'Paid search', score: opportunityByZip[0]?.paidSearch || 75 },
      { channel: 'Tow partner', score: Math.min(100, severityScore + 10) },
      { channel: 'Geofenced display', score: Math.min(100, Math.round(accidentDensity * 0.82)) },
      { channel: 'Local service ads', score: Math.min(100, Math.round((accidentDensity + gapScore) / 2)) },
      { channel: 'Weather trigger', score: weatherScore },
    ],
    customerSignals: [
      { signal: 'Accident density', current: accidentDensity, target: 90 },
      { signal: 'Shop coverage', current: proximityScore, target: 80 },
      { signal: 'Severity mix', current: severityScore, target: 75 },
      { signal: 'Weather risk', current: weatherScore, target: 72 },
      { signal: 'Coverage gap', current: gapScore, target: 68 },
    ],
    segments: [
      {
        name: 'High-intent collision searches',
        audience: `Drivers in the top accident ZIPs: ${opportunityByZip.slice(0, 3).map((row) => row.zip).join(', ') || 'none'}.`,
        action: 'Increase paid search coverage during the highest accident dayparts.',
        impact: `${opportunityByZip.slice(0, 3).reduce((total, row) => total + row.accidents, 0).toLocaleString()} priority accidents`,
      },
      {
        name: 'Tow and referral partner zones',
        audience: 'ZIPs with high accident volume and inferred shop coverage gaps.',
        action: 'Use the top ZIP list to prioritize tow, carrier, and DRP partner outreach.',
        impact: `${opportunityByZip.length ? Math.round(opportunityByZip.reduce((total, row) => total + (100 - row.shopCoverage), 0) / opportunityByZip.length) : 0}% coverage gap`,
      },
      {
        name: 'Weather-triggered outreach',
        audience: 'Markets where accident weather fields and NOAA storm events indicate external repair demand.',
        action: 'Launch same-day paid search and social bursts after severe weather alerts.',
        impact: metadata.storm_event_count
          ? `${metadata.storm_event_count.toLocaleString()} storm events; ${metadata.hail_event_count.toLocaleString()} hail`
          : `${metadata.weather_related_count.toLocaleString()} weather-linked accidents`,
      },
    ],
    crashTargetingExamples: crashTargetingRows,
  }
}

export default async function MarketingIntelligencePage({ searchParams }: PageProps) {
  const cookieStore = await cookies()
  const demoAuth = hasDemoAuthCookie(cookieStore.get('psg_demo_auth')?.value)

  if (!demoAuth) {
    const supabase = await createClient()
    const { data: { user } } = await supabase.auth.getUser()

    if (!user) {
      redirect('/login')
    }
  }

  const params = await searchParams
  const city = params.city?.trim() || ''
  const state = params.state?.trim() || ''
  let data: MarketingIntelligenceData = marketingIntelligenceData

  try {
    data = await fetchMarketingIntelligenceData(city, state)
  } catch (err) {
    console.error('[Marketing Intelligence] Falling back to static aggregates', err)
  }

  return (
    <div>
      <div className="mb-8 flex flex-col gap-5 border-b border-stone pb-6 lg:flex-row lg:items-end lg:justify-between">
        <div>
          <p className="font-heading text-xs font-medium uppercase text-phoenix-red">
            Customer targeting
          </p>
          <h2 className="mt-3 font-heading text-3xl font-light text-navy">
            Marketing Intelligence
          </h2>
          <p className="mt-2 max-w-3xl text-sm leading-6 text-slate">
            Turn accident volume, ZIP coverage, repair capacity, and customer
            experience into practical media and outreach decisions.
          </p>
        </div>
        <div className="border border-stone bg-white px-4 py-3 shadow-[0_1px_2px_rgba(22,21,20,0.04)]">
          <p className="font-heading text-xs font-medium uppercase text-slate">
            Recommended refresh
          </p>
          <p className="mt-1 font-heading text-lg font-light text-navy">
            Weekly by market
          </p>
        </div>
      </div>

      <form className="mb-6 grid grid-cols-1 gap-3 border border-stone bg-white p-4 shadow-[0_1px_2px_rgba(22,21,20,0.04)] md:grid-cols-[1fr_120px_auto]">
        <label className="block">
          <span className="font-heading text-xs font-medium uppercase text-slate">City</span>
          <input
            name="city"
            defaultValue={city}
            placeholder="e.g. Miami"
            className="mt-1 w-full border border-stone bg-paper px-3 py-2 text-sm text-navy placeholder:text-mist focus:border-phoenix-red focus:bg-white focus:outline-none focus:ring-2 focus:ring-phoenix-red focus:ring-offset-2"
          />
        </label>
        <label className="block">
          <span className="font-heading text-xs font-medium uppercase text-slate">State</span>
          <input
            name="state"
            defaultValue={state}
            placeholder="FL"
            maxLength={2}
            className="mt-1 w-full border border-stone bg-paper px-3 py-2 text-sm uppercase text-navy placeholder:text-mist focus:border-phoenix-red focus:bg-white focus:outline-none focus:ring-2 focus:ring-phoenix-red focus:ring-offset-2"
          />
        </label>
        <div className="flex items-end gap-2">
          <button
            type="submit"
            className="border border-navy bg-navy px-4 py-2 font-heading text-sm font-medium text-white transition-colors hover:bg-[#142838]"
          >
            Apply
          </button>
          <a
            href="/marketing-intelligence"
            className="border border-stone px-4 py-2 font-heading text-sm font-medium text-slate transition-colors hover:border-phoenix-red hover:text-phoenix-red"
          >
            Clear
          </a>
        </div>
      </form>

      <MarketingIntelligenceDashboard
        data={data}
        filterLabel={buildFilterLabel(city, state)}
      />
    </div>
  )
}
