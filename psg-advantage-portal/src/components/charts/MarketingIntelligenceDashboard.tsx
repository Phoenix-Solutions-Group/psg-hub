'use client'

import {
  Area,
  AreaChart,
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  ComposedChart,
  Legend,
  Line,
  PolarAngleAxis,
  PolarGrid,
  Radar,
  RadarChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts'
import { PSG_COLORS } from '@/lib/psgTheme'
import { marketingIntelligenceData } from '@/lib/marketingIntelligenceData'

export interface MarketingIntelligenceData {
  metadata: {
    source: string
    split: string
    rowCount: number
    weatherRelatedCount: number
    severeAccidentRate: number
    weatherRelatedRate: number
    averageDistanceMiles: number
    stormEventCount?: number
    hailEventCount?: number
    windEventCount?: number
    tornadoEventCount?: number
    stormDemandScore?: number
    maxHailSize?: number
    maxWindSpeed?: number
  }
  metrics: {
    targetableAccidentDemand: number
    coverageGap: number
    bestNextChannel: string
  }
  opportunityByZip: ReadonlyArray<{
    zip: string
    accidents: number
    repairDemand: number
    shopCoverage: number
    paidSearch: number
    stormDemandScore?: number
  }>
  daypartDemand: ReadonlyArray<{
    time: string
    claims: number
    search: number
  }>
  marketMix: ReadonlyArray<{
    channel: string
    score: number
  }>
  customerSignals: ReadonlyArray<{
    signal: string
    current: number
    target: number
  }>
  segments: ReadonlyArray<{
    name: string
    audience: string
    action: string
    impact: string
  }>
  crashTargetingExamples?: ReadonlyArray<{
    zip: string
    state: string
    city: string
    year: number
    total_crashes: number
    injury_crashes: number
    weather_related_crashes: number
    storm_event_count: number
    hail_event_count: number
    wind_event_count: number
    psg_customer_count: number
    directory_shop_count: number
    collision_targeting_score: number
    example_detail: string
  }>
}

const zipColors = [
  PSG_COLORS.phoenixRed,
  PSG_COLORS.hermes,
  PSG_COLORS.catalyst,
  PSG_COLORS.clarity,
  PSG_COLORS.foundationNavy,
]

export function MarketingIntelligenceDashboard({
  data = marketingIntelligenceData,
  filterLabel = 'Full market',
}: {
  data?: MarketingIntelligenceData
  filterLabel?: string
}) {
  const {
    metadata,
    metrics,
    opportunityByZip,
    daypartDemand,
    marketMix,
    customerSignals,
    segments,
    crashTargetingExamples = [],
  } = data

  return (
    <div className="space-y-6">
      <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
        <Metric
          label="Full accident rows loaded"
          value={metadata.rowCount.toLocaleString()}
          detail={`${metadata.source} ${metadata.split}`}
        />
        <Metric
          label="Top ZIP accident demand"
          value={metrics.targetableAccidentDemand.toLocaleString()}
          detail="Top 5 ZIPs from full split"
        />
        <Metric
          label="Coverage gap"
          value={`${metrics.coverageGap}%`}
          detail={`Best next channel: ${metrics.bestNextChannel}`}
        />
      </div>

      <div className="rounded-lg border border-clarity/20 bg-bone px-4 py-3 text-sm text-navy">
        This view is built from <span className="font-medium">{filterLabel}</span> using
        <span className="font-medium"> {metadata.source}</span>. Weather-linked
        records: <span className="font-medium">{metadata.weatherRelatedCount.toLocaleString()}</span>,
        severe accident rate: <span className="font-medium">{metadata.severeAccidentRate}%</span>,
        average distance: <span className="font-medium">{metadata.averageDistanceMiles} mi</span>.
      </div>

      <div className="grid grid-cols-1 gap-6 xl:grid-cols-5">
        <section className="rounded-lg border border-stone bg-white p-5 xl:col-span-3">
          <div className="mb-4 flex items-start justify-between gap-4">
            <div>
              <h3 className="font-heading text-base font-medium text-navy">
                ZIP Opportunity Map
              </h3>
              <p className="mt-1 text-sm text-slate">
                Rank ZIPs where accident frequency, repair demand, and shop coverage
                indicate where media dollars can work hardest.
              </p>
            </div>
            <span className="rounded-md bg-bone px-3 py-1 text-xs font-medium text-navy">
              Full HF split
            </span>
          </div>
          <ResponsiveContainer width="100%" height={330}>
            <ComposedChart data={opportunityByZip}>
              <CartesianGrid strokeDasharray="3 3" stroke="#E5E7EB" />
              <XAxis dataKey="zip" tick={{ fontSize: 12 }} />
              <YAxis yAxisId="left" tick={{ fontSize: 12 }} />
              <YAxis yAxisId="right" orientation="right" domain={[0, 100]} tick={{ fontSize: 12 }} />
              <Tooltip />
              <Legend />
              <Bar yAxisId="left" dataKey="accidents" name="Accidents" radius={[5, 5, 0, 0]}>
                {opportunityByZip.map((entry, index) => (
                  <Cell key={entry.zip} fill={zipColors[index]} />
                ))}
              </Bar>
              <Line
                yAxisId="right"
                type="monotone"
                dataKey="paidSearch"
                name="Paid search priority"
                stroke={PSG_COLORS.foundationNavy}
                strokeWidth={3}
                dot={{ r: 4 }}
              />
            </ComposedChart>
          </ResponsiveContainer>
        </section>

        <section className="rounded-lg border border-stone bg-white p-5 xl:col-span-2">
          <h3 className="font-heading text-base font-medium text-navy">
            Customer Signal Fit
          </h3>
          <p className="mt-1 text-sm text-slate">
            Balance demand, access, experience, and external triggers before
            increasing customer outreach.
          </p>
          <ResponsiveContainer width="100%" height={330}>
            <RadarChart data={customerSignals}>
              <PolarGrid stroke="#E5E7EB" />
              <PolarAngleAxis dataKey="signal" tick={{ fontSize: 11 }} />
              <Radar
                name="Current market"
                dataKey="current"
                stroke={PSG_COLORS.clarity}
                fill={PSG_COLORS.clarity}
                fillOpacity={0.26}
              />
              <Radar
                name="Target profile"
                dataKey="target"
                stroke={PSG_COLORS.foundationNavy}
                fill={PSG_COLORS.foundationNavy}
                fillOpacity={0.1}
              />
              <Tooltip />
              <Legend />
            </RadarChart>
          </ResponsiveContainer>
        </section>
      </div>

      <div className="grid grid-cols-1 gap-6 xl:grid-cols-2">
        <section className="rounded-lg border border-stone bg-white p-5">
          <h3 className="font-heading text-base font-medium text-navy">
            Timing Intelligence
          </h3>
          <p className="mt-1 text-sm text-slate">
            Match campaign flighting to accident and search-intent peaks instead
            of spreading budget evenly across the day.
          </p>
          <ResponsiveContainer width="100%" height={280}>
            <AreaChart data={daypartDemand}>
              <CartesianGrid strokeDasharray="3 3" stroke="#E5E7EB" />
              <XAxis dataKey="time" tick={{ fontSize: 12 }} />
              <YAxis tick={{ fontSize: 12 }} />
              <Tooltip />
              <Legend />
              <Area
                type="monotone"
                dataKey="claims"
                name="Accident demand"
                stroke={PSG_COLORS.phoenixRed}
                fill={PSG_COLORS.phoenixRed}
                fillOpacity={0.18}
              />
              <Area
                type="monotone"
                dataKey="search"
                name="Search intent"
                stroke={PSG_COLORS.clarity}
                fill={PSG_COLORS.clarity}
                fillOpacity={0.2}
              />
            </AreaChart>
          </ResponsiveContainer>
        </section>

        <section className="rounded-lg border border-stone bg-white p-5">
          <h3 className="font-heading text-base font-medium text-navy">
            Channel Allocation
          </h3>
          <p className="mt-1 text-sm text-slate">
            Use accident density and repair proximity to choose the channel,
            not just the market.
          </p>
          <ResponsiveContainer width="100%" height={280}>
            <BarChart data={marketMix} layout="vertical" margin={{ left: 32 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="#E5E7EB" />
              <XAxis type="number" domain={[0, 100]} tick={{ fontSize: 12 }} />
              <YAxis dataKey="channel" type="category" tick={{ fontSize: 12 }} width={110} />
              <Tooltip />
              <Bar dataKey="score" name="Priority score" fill={PSG_COLORS.clarity} radius={[0, 5, 5, 0]} />
            </BarChart>
          </ResponsiveContainer>
        </section>
      </div>

      <section className="rounded-lg border border-stone bg-white">
        <div className="border-b border-stone p-5">
          <h3 className="font-heading text-base font-medium text-navy">
            Intelligence Customers Can Act On
          </h3>
          <p className="mt-1 text-sm text-slate">
            Package the data as recommendations, audience logic, and expected
            commercial impact.
          </p>
        </div>
        <div className="divide-y divide-iron/10">
          {segments.map((segment) => (
            <div key={segment.name} className="grid gap-4 p-5 lg:grid-cols-[1.1fr_1.4fr_1.2fr_0.6fr]">
              <div>
                <p className="font-heading text-sm font-medium text-navy">{segment.name}</p>
                <p className="mt-1 text-xs uppercase text-slate">Segment</p>
              </div>
              <p className="text-sm leading-6 text-slate">{segment.audience}</p>
              <p className="text-sm leading-6 text-navy">{segment.action}</p>
              <p className="font-heading text-lg font-medium text-phoenix-red">{segment.impact}</p>
            </div>
          ))}
        </div>
      </section>

      {crashTargetingExamples.length > 0 && (
        <section className="rounded-lg border border-stone bg-white">
          <div className="flex flex-col gap-2 border-b border-stone p-5 md:flex-row md:items-start md:justify-between">
            <div>
              <h3 className="font-heading text-base font-medium text-navy">
                Official Crash Targeting Examples
              </h3>
              <p className="mt-1 text-sm text-slate">
                Public crash records, storm demand, and local shop coverage ranked
                as ZIP-level marketing priorities.
              </p>
            </div>
            <span className="rounded-md bg-bone px-3 py-1 text-xs font-medium text-navy">
              Crash + storm + shops
            </span>
          </div>
          <div className="overflow-x-auto">
            <table className="min-w-full divide-y divide-iron/10 text-sm">
              <thead className="bg-bone/60 text-left text-xs uppercase text-slate">
                <tr>
                  <th className="px-5 py-3 font-medium">ZIP</th>
                  <th className="px-5 py-3 font-medium">Crashes</th>
                  <th className="px-5 py-3 font-medium">Injury</th>
                  <th className="px-5 py-3 font-medium">Storm</th>
                  <th className="px-5 py-3 font-medium">PSG</th>
                  <th className="px-5 py-3 font-medium">Directory</th>
                  <th className="px-5 py-3 font-medium">Score</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-iron/10">
                {crashTargetingExamples.map((row) => (
                  <tr key={`${row.state}-${row.year}-${row.zip}`} className="text-navy">
                    <td className="px-5 py-4">
                      <p className="font-heading font-medium">{row.zip}</p>
                      <p className="mt-1 text-xs text-slate">
                        {[row.city, row.state, row.year].filter(Boolean).join(', ')}
                      </p>
                    </td>
                    <td className="px-5 py-4 font-medium">{row.total_crashes.toLocaleString()}</td>
                    <td className="px-5 py-4">{row.injury_crashes.toLocaleString()}</td>
                    <td className="px-5 py-4">
                      <p>{row.storm_event_count.toLocaleString()}</p>
                      <p className="mt-1 text-xs text-slate">
                        {row.hail_event_count.toLocaleString()} hail / {row.wind_event_count.toLocaleString()} wind
                      </p>
                    </td>
                    <td className="px-5 py-4">{row.psg_customer_count.toLocaleString()}</td>
                    <td className="px-5 py-4">{row.directory_shop_count.toLocaleString()}</td>
                    <td className="px-5 py-4 font-heading text-lg font-medium text-phoenix-red">
                      {Math.round(row.collision_targeting_score).toLocaleString()}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      )}
    </div>
  )
}

function Metric({
  label,
  value,
  detail,
}: {
  label: string
  value: string
  detail: string
}) {
  return (
    <div className="rounded-lg border border-stone bg-white p-4">
      <p className="text-xs font-medium uppercase text-slate">{label}</p>
      <p className="mt-2 font-heading text-3xl font-medium text-navy">{value}</p>
      <p className="mt-1 text-sm text-slate">{detail}</p>
    </div>
  )
}
