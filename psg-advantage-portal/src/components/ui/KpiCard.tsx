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
    <div className="border border-stone bg-white p-5 shadow-[0_1px_2px_rgba(22,21,20,0.04)]">
      <p className="font-heading text-xs font-medium uppercase text-slate">{label}</p>
      <p className="mt-2 font-heading text-3xl font-light text-navy">{displayValue}</p>
      {delta !== undefined && (
        <p
          className={`mt-2 text-xs font-medium ${
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
