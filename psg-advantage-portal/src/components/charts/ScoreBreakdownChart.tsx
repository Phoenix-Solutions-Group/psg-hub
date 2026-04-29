'use client'

import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  ReferenceLine,
} from 'recharts'
import { PSG_COLORS } from '@/lib/psgTheme'

interface ScoreItem {
  label: string
  value: number | null
  networkAvg?: number | null
}

interface ScoreBreakdownChartProps {
  scores: ScoreItem[]
}

export default function ScoreBreakdownChart({ scores }: ScoreBreakdownChartProps) {
  const data = scores.map((s) => ({
    name: s.label,
    score: s.value,
    networkAvg: s.networkAvg ?? undefined,
  }))

  return (
    <div className="border border-stone bg-white p-5 shadow-[0_1px_2px_rgba(22,21,20,0.04)]">
      <h3 className="mb-3 font-heading text-base font-medium text-navy">Score Breakdown</h3>
      <ResponsiveContainer width="100%" height={220}>
        <BarChart data={data} layout="vertical" margin={{ left: 80, right: 16, top: 0, bottom: 0 }}>
          <CartesianGrid strokeDasharray="3 3" horizontal={false} stroke="#E4DED5" />
          <XAxis type="number" domain={[0, 100]} tick={{ fontSize: 11 }} />
          <YAxis
            type="category"
            dataKey="name"
            tick={{ fontSize: 12, fill: PSG_COLORS.iron }}
            width={75}
          />
          <Tooltip
            formatter={(val: unknown) => (val !== null && val !== undefined ? `${val}%` : 'N/A')}
          />
          <Bar
            dataKey="score"
            fill={PSG_COLORS.foundationNavy}
            radius={[0, 4, 4, 0]}
            barSize={18}
          />
          {data.some((d) => d.networkAvg !== undefined) && (
            <ReferenceLine
              x={data.find((d) => d.networkAvg !== undefined)?.networkAvg}
              stroke={PSG_COLORS.phoenixRed}
              strokeDasharray="4 4"
              label={{ value: 'Net Avg', fill: PSG_COLORS.phoenixRed, fontSize: 10 }}
            />
          )}
        </BarChart>
      </ResponsiveContainer>
    </div>
  )
}
