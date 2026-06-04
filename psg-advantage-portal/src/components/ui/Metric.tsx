import type { ReactNode } from 'react'

type MetricSize = 'sm' | 'md' | 'lg'
type MetricTone = 'default' | 'accent' | 'success' | 'warning' | 'danger'

interface MetricProps {
  label: string
  value: ReactNode
  detail?: ReactNode
  delta?: number
  deltaFormat?: 'percent' | 'number'
  size?: MetricSize
  tone?: MetricTone
  /**
   * Dense layout for tight grids (7+ columns or sidebars).
   * Uses tighter padding, smaller label, no card shadow.
   */
  compact?: boolean
  className?: string
}

const VALUE_SIZE: Record<MetricSize, string> = {
  sm: 'text-lg',
  md: 'text-2xl',
  lg: 'text-3xl',
}

const TONE_BORDER: Record<MetricTone, string> = {
  default: 'border-stone',
  accent: 'border-phoenix-red/30 bg-phoenix-red/[0.02]',
  success: 'border-success/30',
  warning: 'border-warning/30',
  danger: 'border-danger/30',
}

const TONE_LABEL: Record<MetricTone, string> = {
  default: 'text-slate',
  accent: 'text-phoenix-red',
  success: 'text-success-deep',
  warning: 'text-warning-deep',
  danger: 'text-danger-deep',
}

/**
 * Canonical metric card. Replaces all previous Metric/KpiCard variants.
 *
 * Use `size` to control value typography. Use `tone` for semantic accent.
 * Pass `delta` for trend percentage; auto-colors based on sign.
 * Pass `compact` for dense layouts (7+ column grids, sidebars).
 */
export function Metric({
  label,
  value,
  detail,
  delta,
  deltaFormat = 'percent',
  size = 'md',
  tone = 'default',
  compact = false,
  className = '',
}: MetricProps) {
  const deltaColor =
    delta === undefined || delta === 0
      ? 'text-iron'
      : delta > 0
        ? 'text-success-deep'
        : 'text-danger-deep'

  const padding = compact ? 'px-4 py-3' : 'p-5'
  const shadow = compact ? '' : 'shadow-[0_1px_2px_rgba(22,21,20,0.04)]'
  const labelClass = compact
    ? 'font-heading text-[11px] font-medium uppercase tracking-wide'
    : 'font-heading text-xs font-medium uppercase'
  const valueSize = compact ? 'text-lg' : VALUE_SIZE[size]
  const valueMargin = compact ? 'mt-1' : 'mt-2'

  return (
    <div
      className={`border bg-white ${padding} ${shadow} ${TONE_BORDER[tone]} ${className}`}
    >
      <p className={`${labelClass} ${TONE_LABEL[tone]}`}>{label}</p>
      <p
        className={`${valueMargin} font-heading ${valueSize} font-light text-navy tabular-nums leading-tight`}
      >
        {value}
      </p>
      {delta !== undefined && (
        <p className={`mt-2 text-xs font-medium ${deltaColor}`}>
          {delta > 0 ? '+' : ''}
          {delta.toFixed(1)}
          {deltaFormat === 'percent' ? '%' : ''}
        </p>
      )}
      {detail && (
        <p className={`${compact ? 'mt-1' : 'mt-2'} text-xs text-slate leading-snug`}>
          {detail}
        </p>
      )}
    </div>
  )
}
