interface KpiCardProps {
  label: string
  value: string | number
  delta?: number
  format?: 'number' | 'percent'
}

export function KpiCard({ label, value, delta, format = 'number' }: KpiCardProps) {
  const displayValue =
    format === 'percent'
      ? `${value}%`
      : typeof value === 'number'
        ? value.toLocaleString()
        : value

  return (
    <div className="rounded-lg border border-iron/20 bg-white p-4">
      <p className="text-xs font-medium text-iron uppercase tracking-wide">{label}</p>
      <p className="mt-1 text-2xl font-bold font-heading text-navy">{displayValue}</p>
      {delta !== undefined && (
        <p
          className={`mt-1 text-xs font-medium ${
            delta > 0
              ? 'text-clarity'
              : delta < 0
                ? 'text-phoenix-red'
                : 'text-iron'
          }`}
        >
          {delta > 0 ? '+' : ''}
          {delta.toFixed(1)}%
        </p>
      )}
    </div>
  )
}
