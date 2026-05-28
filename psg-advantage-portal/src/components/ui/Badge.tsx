import type { ReactNode } from 'react'

type BadgeTone = 'neutral' | 'navy' | 'success' | 'grove' | 'warning' | 'danger' | 'accent'
type BadgeVariant = 'solid' | 'soft' | 'outline'

interface BadgeProps {
  children: ReactNode
  tone?: BadgeTone
  variant?: BadgeVariant
  className?: string
}

const TONE: Record<BadgeTone, Record<BadgeVariant, string>> = {
  neutral: {
    solid: 'bg-stone text-graphite',
    soft: 'bg-bone text-slate',
    outline: 'border border-stone bg-white text-slate',
  },
  navy: {
    solid: 'bg-navy text-white',
    soft: 'bg-bone text-navy',
    outline: 'border border-navy/30 bg-white text-navy',
  },
  success: {
    solid: 'bg-success text-white',
    soft: 'bg-success-bg text-success-deep',
    outline: 'border border-success/30 bg-white text-success-deep',
  },
  grove: {
    solid: 'bg-grove text-white',
    soft: 'bg-grove-bg text-grove',
    outline: 'border border-grove/25 bg-white text-grove',
  },
  warning: {
    solid: 'bg-warning text-white',
    soft: 'bg-warning-bg text-warning-deep',
    outline: 'border border-warning/30 bg-white text-warning-deep',
  },
  danger: {
    solid: 'bg-danger text-white',
    soft: 'bg-danger-bg text-danger-deep',
    outline: 'border border-danger/25 bg-white text-danger-deep',
  },
  accent: {
    solid: 'bg-phoenix-red text-white',
    soft: 'bg-danger-bg text-phoenix-red',
    outline: 'border border-phoenix-red/30 bg-white text-phoenix-red',
  },
}

/**
 * Compact label/status badge. Sharp corners. Three variants: solid, soft, outline.
 */
export function Badge({ children, tone = 'neutral', variant = 'soft', className = '' }: BadgeProps) {
  return (
    <span
      className={`inline-flex items-center gap-1 px-2 py-0.5 font-heading text-xs font-medium ${TONE[tone][variant]} ${className}`}
    >
      {children}
    </span>
  )
}
