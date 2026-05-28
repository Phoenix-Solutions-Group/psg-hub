import type { ReactNode } from 'react'

interface PanelProps {
  title?: string
  kicker?: string
  action?: ReactNode
  padding?: 'none' | 'sm' | 'md' | 'lg'
  className?: string
  children: ReactNode
}

const PADDING: Record<NonNullable<PanelProps['padding']>, string> = {
  none: '',
  sm: 'p-3',
  md: 'p-4',
  lg: 'p-5',
}

/**
 * Canonical container panel. Sharp corners, single border, subtle shadow.
 * Replaces all <section className="border border-stone bg-white"> ad-hoc panels.
 */
export function Panel({
  title,
  kicker,
  action,
  padding = 'lg',
  className = '',
  children,
}: PanelProps) {
  return (
    <section
      className={`border border-stone bg-white shadow-[0_1px_2px_rgba(22,21,20,0.04)] ${PADDING[padding]} ${className}`}
    >
      {(title || kicker || action) && (
        <header className="mb-4 flex items-start justify-between gap-4">
          <div>
            {kicker && (
              <p className="font-heading text-xs font-medium uppercase text-phoenix-red">
                {kicker}
              </p>
            )}
            {title && (
              <h3 className="mt-1 font-heading text-base font-medium text-navy">
                {title}
              </h3>
            )}
          </div>
          {action && <div className="shrink-0">{action}</div>}
        </header>
      )}
      {children}
    </section>
  )
}
