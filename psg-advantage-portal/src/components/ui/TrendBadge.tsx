type Trend = 'improving' | 'stable' | 'declining'

const TREND_CONFIG: Record<Trend, { label: string; color: string; arrow: string }> = {
  improving: { label: 'Improving', color: 'border-grove/25 bg-grove-bg text-grove', arrow: '\u2191' },
  stable: { label: 'Stable', color: 'border-stone bg-bone text-slate', arrow: '\u2192' },
  declining: { label: 'Declining', color: 'border-danger/25 bg-danger-bg text-danger-deep', arrow: '\u2193' },
}

export function TrendBadge({ trend, delta }: { trend?: Trend; delta?: number }) {
  const config = TREND_CONFIG[trend || 'stable']
  return (
    <span
      className={`inline-flex items-center gap-1 border px-2 py-0.5 font-heading text-xs font-medium ${config.color}`}
    >
      {config.arrow} {config.label}
      {delta !== undefined && ` (${delta > 0 ? '+' : ''}${delta.toFixed(1)})`}
    </span>
  )
}
