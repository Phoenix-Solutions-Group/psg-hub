'use client'

import {
  ComposedChart,
  Line,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  Legend,
} from 'recharts'
import { PSG_COLORS } from '@/lib/psgTheme'
import type { TrendPoint } from '@/types'

export function EmiTrendChart({ data }: { data: TrendPoint[] }) {
  return (
    <div className="border border-stone bg-white p-5 shadow-[0_1px_2px_rgba(22,21,20,0.04)]">
      <h3 className="mb-4 font-heading text-base font-medium text-navy">EMI Trend</h3>
      <ResponsiveContainer width="100%" height={320}>
        <ComposedChart data={data}>
          <CartesianGrid strokeDasharray="3 3" stroke="#E4DED5" />
          <XAxis dataKey="month" tick={{ fontSize: 12 }} />
          <YAxis yAxisId="left" domain={[80, 100]} tick={{ fontSize: 12 }} />
          <YAxis yAxisId="right" orientation="right" tick={{ fontSize: 12 }} />
          <Tooltip />
          <Legend />
          <Bar
            yAxisId="right"
            dataKey="surveys"
            fill={PSG_COLORS.clarity}
            opacity={0.3}
            name="Surveys"
          />
          <Line
            yAxisId="left"
            type="monotone"
            dataKey="avg_emi_pct"
            stroke={PSG_COLORS.foundationNavy}
            strokeWidth={2}
            dot={false}
            name="Avg EMI %"
          />
        </ComposedChart>
      </ResponsiveContainer>
    </div>
  )
}
