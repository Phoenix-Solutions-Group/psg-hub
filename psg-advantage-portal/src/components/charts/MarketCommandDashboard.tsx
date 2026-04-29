'use client'

import { FormEvent, type ReactNode, useMemo, useState } from 'react'
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
import type { MarketDashboardData } from '@/lib/supabase/data'

const zipColors = [
  PSG_COLORS.phoenixRed,
  PSG_COLORS.hermes,
  PSG_COLORS.catalyst,
  PSG_COLORS.clarity,
  PSG_COLORS.foundationNavy,
]

function compactNumber(value: number) {
  return Intl.NumberFormat('en-US', {
    notation: value >= 10000 ? 'compact' : 'standard',
    maximumFractionDigits: 1,
  }).format(value)
}

function dollars(value: number) {
  return Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD',
    maximumFractionDigits: 0,
  }).format(value)
}

export default function MarketCommandDashboard({
  initialData,
}: {
  initialData: MarketDashboardData
}) {
  const [data, setData] = useState(initialData)
  const [city, setCity] = useState(initialData.filter.city)
  const [state, setState] = useState(initialData.filter.state)
  const [budget, setBudget] = useState(25000)
  const [isLoading, setIsLoading] = useState(false)
  const [error, setError] = useState('')

  const channelBudget = useMemo(() => {
    const totalScore = data.channel_mix.reduce((total, row) => total + row.score, 0) || 1
    return data.channel_mix.map((row) => ({
      ...row,
      budget: Math.round((row.score / totalScore) * budget),
    }))
  }, [budget, data.channel_mix])

  async function loadMarket(nextCity = city, nextState = state) {
    setIsLoading(true)
    setError('')
    try {
      const params = new URLSearchParams()
      if (nextCity.trim()) params.set('city', nextCity.trim())
      if (nextState.trim()) params.set('state', nextState.trim().toUpperCase())
      const response = await fetch(`/api/markets/dashboard?${params.toString()}`)
      if (!response.ok) {
        throw new Error(`Market request failed: ${response.status}`)
      }
      const nextData = (await response.json()) as MarketDashboardData
      setData(nextData)
      setCity(nextData.filter.city)
      setState(nextData.filter.state)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Market request failed')
    } finally {
      setIsLoading(false)
    }
  }

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    await loadMarket()
  }

  async function pickState(nextState: string) {
    setCity('')
    setState(nextState)
    await loadMarket('', nextState)
  }

  async function clearMarket() {
    setCity('')
    setState('')
    await loadMarket('', '')
  }

  return (
    <div className="space-y-6">
      <section className="rounded-lg border border-stone bg-white">
        <div className="grid gap-5 p-5 lg:grid-cols-[1fr_420px] lg:items-end">
          <div>
            <p className="text-xs font-medium uppercase text-phoenix-red">
              Market Command
            </p>
            <h2 className="mt-1 font-heading text-2xl font-medium text-navy">
              {data.filter.label}
            </h2>
            <div className="mt-3 flex flex-wrap gap-2 text-xs font-medium">
              <span className="rounded-md bg-bone px-2.5 py-1 text-navy">
                {compactNumber(data.summary.accident_rows)} accident rows
              </span>
              <span className="rounded-md bg-paper px-2.5 py-1 text-slate">
                {data.summary.severe_accident_rate}% severe
              </span>
              <span className="rounded-md bg-paper px-2.5 py-1 text-slate">
                {data.summary.weather_related_rate}% weather-linked
              </span>
              <span className={`rounded-md px-2.5 py-1 ${
                data.summary.storm_layer_available
                  ? 'bg-bone text-navy'
                  : 'bg-paper text-slate'
              }`}>
                Storm layer {data.summary.storm_layer_available ? 'live' : 'pending'}
              </span>
            </div>
          </div>

          <form onSubmit={onSubmit} className="grid grid-cols-1 gap-2 sm:grid-cols-[1fr_88px_auto_auto]">
            <label className="block">
              <span className="text-xs font-medium uppercase text-slate">City</span>
              <input
                value={city}
                onChange={(event) => setCity(event.target.value)}
                placeholder="Los Angeles"
                className="mt-1 w-full rounded-lg border border-stone px-3 py-2 text-sm text-navy focus:border-phoenix-red focus:outline-none"
              />
            </label>
            <label className="block">
              <span className="text-xs font-medium uppercase text-slate">State</span>
              <input
                value={state}
                onChange={(event) => setState(event.target.value.toUpperCase())}
                placeholder="CA"
                maxLength={2}
                className="mt-1 w-full rounded-lg border border-stone px-3 py-2 text-sm uppercase text-navy focus:border-phoenix-red focus:outline-none"
              />
            </label>
            <button
              type="submit"
              disabled={isLoading}
              className="mt-5 rounded-lg bg-navy px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-navy/90 disabled:opacity-60"
            >
              Run
            </button>
            <button
              type="button"
              onClick={clearMarket}
              disabled={isLoading}
              className="mt-5 rounded-lg border border-stone px-4 py-2 text-sm font-medium text-slate transition-colors hover:text-navy disabled:opacity-60"
            >
              Clear
            </button>
          </form>
        </div>
        {error && (
          <div className="border-t border-phoenix-red/20 bg-phoenix-red/5 px-5 py-3 text-sm text-phoenix-red">
            {error}
          </div>
        )}
      </section>

      <section className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-4">
        <Metric label="Targetable Top ZIPs" value={compactNumber(data.opportunity.targetable_accidents)} detail="Top ZIP accident demand" />
        <Metric label="Coverage Gap" value={`${data.opportunity.coverage_gap}%`} detail="Inferred repair access pressure" />
        <Metric label="Weather Score" value={`${data.opportunity.weather_score}`} detail={`${compactNumber(data.summary.weather_related_count)} weather-linked rows`} />
        <Metric label="Next Channel" value={data.opportunity.best_next_channel} detail={`${data.opportunity.severity_score} severity score`} />
      </section>

      <section className="grid grid-cols-1 gap-6 xl:grid-cols-5">
        <Panel title="ZIP Demand Stack" kicker="Prioritized local demand" className="xl:col-span-3">
          <ResponsiveContainer width="100%" height={330}>
            <ComposedChart data={data.top_zips}>
              <CartesianGrid strokeDasharray="3 3" stroke="#E5E7EB" />
              <XAxis dataKey="zip" tick={{ fontSize: 12 }} />
              <YAxis yAxisId="left" tick={{ fontSize: 12 }} />
              <YAxis yAxisId="right" orientation="right" domain={[0, 100]} tick={{ fontSize: 12 }} />
              <Tooltip />
              <Legend />
              <Bar yAxisId="left" dataKey="accidents" name="Accidents" radius={[5, 5, 0, 0]}>
                {data.top_zips.map((entry, index) => (
                  <Cell key={entry.zip} fill={zipColors[index % zipColors.length]} />
                ))}
              </Bar>
              <Line
                yAxisId="right"
                type="monotone"
                dataKey="paid_search_priority"
                name="Paid search priority"
                stroke={PSG_COLORS.foundationNavy}
                strokeWidth={3}
                dot={{ r: 4 }}
              />
            </ComposedChart>
          </ResponsiveContainer>
        </Panel>

        <Panel title="Signal Fit" kicker="Demand quality" className="xl:col-span-2">
          <ResponsiveContainer width="100%" height={330}>
            <RadarChart data={data.signal_fit}>
              <PolarGrid stroke="#E5E7EB" />
              <PolarAngleAxis dataKey="signal" tick={{ fontSize: 11 }} />
              <Radar
                name="Current"
                dataKey="current"
                stroke={PSG_COLORS.clarity}
                fill={PSG_COLORS.clarity}
                fillOpacity={0.26}
              />
              <Radar
                name="Target"
                dataKey="target"
                stroke={PSG_COLORS.foundationNavy}
                fill={PSG_COLORS.foundationNavy}
                fillOpacity={0.08}
              />
              <Tooltip />
              <Legend />
            </RadarChart>
          </ResponsiveContainer>
        </Panel>
      </section>

      <section className="grid grid-cols-1 gap-6 xl:grid-cols-2">
        <Panel title="Daypart Pressure" kicker="Accident timing">
          <ResponsiveContainer width="100%" height={280}>
            <AreaChart data={data.dayparts}>
              <CartesianGrid strokeDasharray="3 3" stroke="#E5E7EB" />
              <XAxis dataKey="time" tick={{ fontSize: 12 }} />
              <YAxis tick={{ fontSize: 12 }} />
              <Tooltip />
              <Legend />
              <Area
                type="monotone"
                dataKey="claims"
                name="Accidents"
                stroke={PSG_COLORS.phoenixRed}
                fill={PSG_COLORS.phoenixRed}
                fillOpacity={0.16}
              />
              <Area
                type="monotone"
                dataKey="search_intent"
                name="Search intent"
                stroke={PSG_COLORS.clarity}
                fill={PSG_COLORS.clarity}
                fillOpacity={0.2}
              />
            </AreaChart>
          </ResponsiveContainer>
        </Panel>

        <Panel title="Budget Scenario" kicker={dollars(budget)}>
          <div className="mb-4">
            <input
              type="range"
              min={5000}
              max={100000}
              step={5000}
              value={budget}
              onChange={(event) => setBudget(Number(event.target.value))}
              className="w-full accent-clarity"
            />
          </div>
          <ResponsiveContainer width="100%" height={246}>
            <BarChart data={channelBudget} layout="vertical" margin={{ left: 38 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="#E5E7EB" />
              <XAxis type="number" tick={{ fontSize: 12 }} />
              <YAxis dataKey="channel" type="category" width={118} tick={{ fontSize: 12 }} />
              <Tooltip formatter={(value, name) => name === 'budget' ? dollars(Number(value)) : value} />
              <Bar dataKey="budget" name="Budget" fill={PSG_COLORS.clarity} radius={[0, 5, 5, 0]} />
            </BarChart>
          </ResponsiveContainer>
        </Panel>
      </section>

      <section className="grid grid-cols-1 gap-6 xl:grid-cols-[1.1fr_1.4fr]">
        <Panel title="State Leaderboard" kicker="Opportunity rank">
          <div className="grid gap-2">
            {data.states.length ? data.states.slice(0, 8).map((row, index) => (
              <button
                key={row.state}
                type="button"
                onClick={() => pickState(row.state)}
                className="grid grid-cols-[32px_52px_1fr_70px] items-center gap-3 rounded-lg border border-stone px-3 py-2 text-left transition-colors hover:border-clarity/40 hover:bg-bone/50"
              >
                <span className="text-xs font-medium text-slate">{index + 1}</span>
                <span className="font-heading text-sm font-medium text-navy">{row.state}</span>
                <span className="h-2 overflow-hidden rounded-full bg-paper">
                  <span
                    className="block h-full rounded-full bg-clarity"
                    style={{ width: `${Math.min(100, row.opportunity_score)}%` }}
                  />
                </span>
                <span className="text-right text-xs font-medium text-slate">
                  {compactNumber(row.total_accidents)}
                </span>
              </button>
            )) : (
              <div className="rounded-lg border border-stone bg-paper p-4 text-sm text-slate">
                State rollup migration is pending.
              </div>
            )}
          </div>
        </Panel>

        <section className="rounded-lg border border-stone bg-white">
          <div className="border-b border-stone p-5">
            <p className="text-xs font-medium uppercase text-phoenix-red">
              Report Extract
            </p>
            <h3 className="mt-1 font-heading text-base font-medium text-navy">
              Market Moves
            </h3>
          </div>
          <div className="divide-y divide-iron/10">
            {data.actions.map((action) => (
              <div key={action.title} className="grid gap-3 p-5 md:grid-cols-[0.8fr_1fr_1.4fr]">
                <p className="font-heading text-sm font-medium text-navy">{action.title}</p>
                <p className="text-sm font-medium text-phoenix-red">{action.value}</p>
                <p className="text-sm leading-6 text-slate">{action.detail}</p>
              </div>
            ))}
          </div>
        </section>
      </section>
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
      <p className="mt-2 font-heading text-2xl font-medium text-navy">{value}</p>
      <p className="mt-1 text-sm text-slate">{detail}</p>
    </div>
  )
}

function Panel({
  title,
  kicker,
  className = '',
  children,
}: {
  title: string
  kicker: string
  className?: string
  children: ReactNode
}) {
  return (
    <section className={`rounded-lg border border-stone bg-white p-5 ${className}`}>
      <div className="mb-4 flex items-start justify-between gap-4">
        <div>
          <p className="text-xs font-medium uppercase text-phoenix-red">{kicker}</p>
          <h3 className="mt-1 font-heading text-base font-medium text-navy">{title}</h3>
        </div>
      </div>
      {children}
    </section>
  )
}
