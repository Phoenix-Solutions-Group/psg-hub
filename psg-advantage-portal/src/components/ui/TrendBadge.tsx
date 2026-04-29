type Trend = 'improving' | 'stable' | 'declining'

const TREND_CONFIG: Record<Trend, { label: string; color: string; arrow: string }> = {
  improving: { label: 'Improving', color: 'bg-clarity/10 text-clarity', arrow: '\u2191' },
  stable: { label: 'Stable', color: 'bg-iron/10 text-iron', arrow: '\u2192' },
  declining: { label: 'Declining', color: 'bg-phoenix-red/10 text-phoenix-red', arrow: '\u2193' },
}

export function TrendBadge({ trend, delta }: { trend?: Trend; delta?: number }) {
  const config = TREND_CONFIG[trend || 'stable']
  return (
    <span
      className={`inline-flex items-center gap-1 rounded px-2 py-0.5 text-xs font-medium ${config.color}`}
    >
      {config.arrow} {config.label}
      {delta !== undefined && ` (${delta > 0 ? '+' : ''}${delta.toFixed(1)})`}
    </span>
  )
}
