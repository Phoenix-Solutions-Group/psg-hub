import type { ButtonHTMLAttributes, ReactNode } from 'react'

type ButtonVariant = 'primary' | 'secondary' | 'ghost' | 'danger'
type ButtonSize = 'sm' | 'md' | 'lg'

interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant
  size?: ButtonSize
  children: ReactNode
}

const VARIANT: Record<ButtonVariant, string> = {
  primary:
    'border border-navy bg-navy text-white hover:bg-navy-deep focus-visible:ring-phoenix-red',
  secondary:
    'border border-stone bg-white text-navy hover:bg-bone focus-visible:ring-phoenix-red',
  ghost:
    'border border-transparent bg-transparent text-slate hover:text-navy focus-visible:ring-phoenix-red',
  danger:
    'border border-danger bg-danger text-white hover:bg-danger-deep focus-visible:ring-danger',
}

const SIZE: Record<ButtonSize, string> = {
  sm: 'px-2.5 py-1 text-xs',
  md: 'px-4 py-2 text-sm',
  lg: 'px-5 py-3 text-base',
}

/**
 * Canonical button. Sharp corners. Focus ring uses brand accent.
 * Active state uses tactile translate-y.
 */
export function Button({
  variant = 'secondary',
  size = 'md',
  className = '',
  children,
  ...props
}: ButtonProps) {
  return (
    <button
      {...props}
      className={`inline-flex items-center justify-center gap-2 font-heading font-medium transition-all duration-[220ms] ease-[cubic-bezier(0.22,0.61,0.36,1)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-offset-2 focus-visible:ring-offset-white active:translate-y-px disabled:cursor-not-allowed disabled:opacity-40 ${VARIANT[variant]} ${SIZE[size]} ${className}`}
    >
      {children}
    </button>
  )
}
