import type { ReactNode } from 'react'

interface EmptyStateProps {
  title: string
  description?: string
  action?: ReactNode
  icon?: ReactNode
  className?: string
}

/**
 * Empty state for tables, lists, and dashboards with no data.
 * Always include a description that tells the user what to do next.
 */
export function EmptyState({
  title,
  description,
  action,
  icon,
  className = '',
}: EmptyStateProps) {
  return (
    <div
      className={`flex flex-col items-center justify-center gap-3 border border-dashed border-stone bg-paper px-6 py-12 text-center ${className}`}
    >
      {icon && <div className="text-mist">{icon}</div>}
      <p className="font-heading text-base font-medium text-navy">{title}</p>
      {description && (
        <p className="max-w-md text-sm leading-relaxed text-slate">{description}</p>
      )}
      {action && <div className="mt-2">{action}</div>}
    </div>
  )
}
