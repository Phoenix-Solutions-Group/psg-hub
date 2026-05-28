import type { InputHTMLAttributes } from 'react'

interface InputProps extends InputHTMLAttributes<HTMLInputElement> {
  label?: string
  hint?: string
  error?: string
}

/**
 * Canonical form input. Sharp corners. Visible focus ring on phoenix-red.
 * Pair with a `<label>` wrap or pass `label` prop for built-in label.
 */
export function Input({ label, hint, error, className = '', id, ...props }: InputProps) {
  const inputId = id || props.name

  return (
    <div className="flex flex-col gap-1.5">
      {label && (
        <label
          htmlFor={inputId}
          className="font-heading text-xs font-medium uppercase text-slate"
        >
          {label}
        </label>
      )}
      <input
        id={inputId}
        {...props}
        aria-invalid={error ? true : undefined}
        aria-describedby={hint || error ? `${inputId}-desc` : undefined}
        className={`border bg-paper px-3 py-2.5 text-sm text-iron shadow-[inset_0_1px_2px_rgba(22,21,20,0.05)] transition-all duration-[220ms] ease-[cubic-bezier(0.22,0.61,0.36,1)] placeholder:text-mist focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-offset-white ${
          error
            ? 'border-danger focus:border-danger focus:ring-danger'
            : 'border-stone focus:border-phoenix-red focus:bg-white focus:ring-phoenix-red'
        } ${className}`}
      />
      {(hint || error) && (
        <p
          id={`${inputId}-desc`}
          className={`text-xs ${error ? 'text-danger-deep' : 'text-mist'}`}
        >
          {error || hint}
        </p>
      )}
    </div>
  )
}
