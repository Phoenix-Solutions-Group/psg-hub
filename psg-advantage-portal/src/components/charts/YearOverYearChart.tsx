'use client'

import {
  LineChart,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
} from 'recharts'
import { PSG_COLORS } from '@/lib/psgTheme'
import type { ShopTrendPoint } from '@/types'

interface YearOverYearChartProps {
  data: ShopTrendPoint[]
}

export default function YearOverYearChart({ data }: YearOverYearChartProps) {
  return (
    <div className="rounded-lg border border-iron/20 bg-white p-4">
      <h3 className="mb-3 text-sm font-semibold text-navy">EMI Trend</h3>
      <ResponsiveContainer width="100%" height={280}>
        <LineChart data={data} margin={{ left: 8, right: 16, top: 8, bottom: 0 }}>
          <CartesianGrid strokeDasharray="3 3" />
          <XAxis
            dataKey="month"
            tick={{ fontSize: 11, fill: PSG_COLORS.iron }}
            interval="preserveStartEnd"
          />
          <YAxis
            domain={[70, 100]}
            tick={{ fontSize: 11, fill: PSG_COLORS.iron }}
            tickFormatter={(v: number) => `${v}%`}
          />
          <Tooltip
            formatter={(val: unknown) => [`${val}%`, 'EMI']}
            labelFormatter={(label: unknown) => String(label)}
          />
          <Line
            type="monotone"
            dataKey="avg_emi_pct"
            stroke={PSG_COLORS.foundationNavy}
            strokeWidth={2}
            dot={{ r: 3, fill: PSG_COLORS.foundationNavy }}
            activeDot={{ r: 5 }}
          />
        </LineChart>
      </ResponsiveContainer>
    </div>
  )
}
