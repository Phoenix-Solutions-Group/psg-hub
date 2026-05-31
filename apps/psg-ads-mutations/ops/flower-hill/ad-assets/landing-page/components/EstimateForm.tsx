'use client'

import { useState } from 'react'

type FormState = {
  name: string
  phone: string
  email: string
  vehicle: string
  damage: string
}

type FieldErrors = Partial<Record<'name' | 'phone' | 'vehicle', string>>

type EstimateFormProps = {
  concept: string
  phone: string
  ctaLabel: string
}

export function EstimateForm({ concept, phone, ctaLabel }: EstimateFormProps) {
  const [form, setForm] = useState<FormState>({ name: '', phone: '', email: '', vehicle: '', damage: '' })
  const [errors, setErrors] = useState<FieldErrors>({})
  const [submitting, setSubmitting] = useState(false)
  const [success, setSuccess] = useState(false)
  const [serverError, setServerError] = useState('')

  function validateField(field: 'name' | 'phone' | 'vehicle', value: string): string {
    if (field === 'name' && !value.trim()) return 'Name is required.'
    if (field === 'phone') {
      if (!value.trim()) return 'Phone number is required.'
      if (!/[\d\s\-().+]{7,}/.test(value)) return 'Enter a valid phone number, e.g. (516) 555-1234.'
    }
    if (field === 'vehicle' && !value.trim()) return 'Vehicle year, make, and model is required.'
    return ''
  }

  function handleBlur(field: 'name' | 'phone' | 'vehicle') {
    const error = validateField(field, form[field])
    setErrors((prev) => ({ ...prev, [field]: error }))
  }

  function handleChange(field: keyof FormState, value: string) {
    setForm((prev) => ({ ...prev, [field]: value }))
    if (field !== 'email' && field !== 'damage' && errors[field as 'name' | 'phone' | 'vehicle']) {
      setErrors((prev) => ({ ...prev, [field]: '' }))
    }
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()

    const newErrors: FieldErrors = {}
    ;(['name', 'phone', 'vehicle'] as const).forEach((field) => {
      const error = validateField(field, form[field])
      if (error) newErrors[field] = error
    })

    if (Object.keys(newErrors).length > 0) {
      setErrors(newErrors)
      return
    }

    setSubmitting(true)
    setServerError('')

    try {
      const res = await fetch('/api/estimate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ...form, concept }),
      })

      if (!res.ok) {
        const data = await res.json()
        setServerError(data.error || 'Something went wrong. Please try again.')
        return
      }

      setSuccess(true)
    } catch {
      setServerError('Network error. Please try again or call us directly.')
    } finally {
      setSubmitting(false)
    }
  }

  const inputStyle: React.CSSProperties = {
    width: '100%',
    background: 'var(--bg)',
    border: '1px solid var(--border)',
    color: 'var(--text)',
    fontFamily: 'var(--font-body)',
    fontSize: 'var(--text-base)',
    padding: 'var(--space-lg)',
    boxSizing: 'border-box',
    outline: 'none',
  }

  const labelStyle: React.CSSProperties = {
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'baseline',
    fontFamily: 'var(--font-body)',
    fontSize: 'var(--text-sm)',
    color: 'var(--text-muted)',
    marginBottom: 'var(--space-sm)',
    textTransform: 'uppercase',
    letterSpacing: '0.07em',
  }

  const optionalStyle: React.CSSProperties = {
    fontSize: 'var(--text-xs)',
    color: 'var(--text-muted)',
    textTransform: 'none',
    letterSpacing: 0,
    fontStyle: 'italic',
  }

  const errorStyle: React.CSSProperties = {
    color: '#cc4444',
    fontSize: 'var(--text-xs)',
    marginTop: 'var(--space-xs)',
    fontFamily: 'var(--font-body)',
  }

  if (success) {
    return (
      <div
        style={{
          padding: 'var(--space-3xl)',
          background: 'var(--bg)',
          border: '1px solid var(--border)',
        }}
      >
        <div
          style={{
            height: '2px',
            background: 'var(--red)',
            width: '32px',
            marginBottom: 'var(--space-xl)',
          }}
          aria-hidden="true"
        />
        <h3
          style={{
            fontFamily: 'var(--font-display)',
            fontSize: 'var(--text-h3)',
            color: 'var(--text)',
            marginBottom: 'var(--space-lg)',
          }}
        >
          Your request is confirmed.
        </h3>
        <p
          style={{
            fontFamily: 'var(--font-body)',
            color: 'var(--text-muted)',
            fontSize: 'var(--text-base)',
            lineHeight: 1.7,
            marginBottom: 'var(--space-xl)',
          }}
        >
          A certified advisor will call you within 2 hours — not a call center, not an automated system. For immediate assistance, call{' '}
          <a href={`tel:${phone.replace(/\./g, '')}`} style={{ color: 'var(--red)', textDecoration: 'none' }}>
            {phone}
          </a>
          .
        </p>
        <div
          style={{
            fontFamily: 'var(--font-body)',
            fontSize: 'var(--text-sm)',
            color: 'var(--text-muted)',
            lineHeight: 2,
          }}
        >
          <div>Next: We confirm your nearest location and schedule your in-person damage assessment.</div>
          <div>Then: We coordinate directly with your insurance adjuster. You don&apos;t manage the paperwork.</div>
        </div>
      </div>
    )
  }

  return (
    <form onSubmit={handleSubmit} noValidate>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-xl)' }}>
        {/* Name */}
        <div>
          <label htmlFor="est-name" style={labelStyle}>
            <span>Name</span>
          </label>
          <input
            id="est-name"
            type="text"
            value={form.name}
            onChange={(e) => handleChange('name', e.target.value)}
            onBlur={() => handleBlur('name')}
            placeholder="Your full name"
            aria-invalid={!!errors.name}
            aria-describedby={errors.name ? 'est-name-err' : undefined}
            style={{
              ...inputStyle,
              borderColor: errors.name ? '#cc4444' : 'var(--border)',
            }}
            autoComplete="name"
          />
          {errors.name && <p id="est-name-err" role="alert" style={errorStyle}>{errors.name}</p>}
        </div>

        {/* Phone */}
        <div>
          <label htmlFor="est-phone" style={labelStyle}>
            <span>Phone</span>
          </label>
          <input
            id="est-phone"
            type="tel"
            value={form.phone}
            onChange={(e) => handleChange('phone', e.target.value)}
            onBlur={() => handleBlur('phone')}
            placeholder="Best number to reach you"
            aria-invalid={!!errors.phone}
            aria-describedby={errors.phone ? 'est-phone-err' : undefined}
            style={{
              ...inputStyle,
              borderColor: errors.phone ? '#cc4444' : 'var(--border)',
            }}
            autoComplete="tel"
          />
          {errors.phone && <p id="est-phone-err" role="alert" style={errorStyle}>{errors.phone}</p>}
        </div>

        {/* Email — optional */}
        <div>
          <label htmlFor="est-email" style={labelStyle}>
            <span>Email</span>
            <span style={optionalStyle}>Optional</span>
          </label>
          <input
            id="est-email"
            type="email"
            value={form.email}
            onChange={(e) => handleChange('email', e.target.value)}
            placeholder="name@example.com"
            style={inputStyle}
            autoComplete="email"
          />
        </div>

        {/* Vehicle */}
        <div>
          <label htmlFor="est-vehicle" style={labelStyle}>
            <span>Vehicle</span>
          </label>
          <input
            id="est-vehicle"
            type="text"
            value={form.vehicle}
            onChange={(e) => handleChange('vehicle', e.target.value)}
            onBlur={() => handleBlur('vehicle')}
            placeholder="Year, make, and model"
            aria-invalid={!!errors.vehicle}
            aria-describedby={errors.vehicle ? 'est-vehicle-err' : undefined}
            style={{
              ...inputStyle,
              borderColor: errors.vehicle ? '#cc4444' : 'var(--border)',
            }}
            autoComplete="off"
          />
          {errors.vehicle && <p id="est-vehicle-err" role="alert" style={errorStyle}>{errors.vehicle}</p>}
        </div>

        {/* Damage — optional */}
        <div>
          <label htmlFor="est-damage" style={labelStyle}>
            <span>Damage Description</span>
            <span style={optionalStyle}>Optional</span>
          </label>
          <textarea
            id="est-damage"
            value={form.damage}
            onChange={(e) => handleChange('damage', e.target.value)}
            placeholder="Briefly describe the damage (e.g. rear-end collision, driver door dented)"
            rows={3}
            style={{
              ...inputStyle,
              resize: 'vertical',
              minHeight: '90px',
            }}
          />
        </div>

        {serverError && (
          <p role="alert" style={{ ...errorStyle, marginTop: 0 }}>{serverError}</p>
        )}

        <button
          type="submit"
          disabled={submitting}
          style={{
            background: submitting ? 'var(--gold-dim)' : 'var(--red)',
            color: '#ffffff',
            border: 'none',
            padding: '1rem 2rem',
            fontFamily: 'var(--font-body)',
            fontSize: 'var(--text-sm)',
            letterSpacing: '0.05em',
            textTransform: 'uppercase',
            cursor: submitting ? 'not-allowed' : 'pointer',
            width: '100%',
            transition: 'background 0.2s',
          }}
        >
          {submitting ? 'Sending your request...' : ctaLabel}
        </button>

        <p
          style={{
            fontFamily: 'var(--font-body)',
            fontSize: 'var(--text-xs)',
            color: 'var(--text-muted)',
            lineHeight: 1.6,
            textAlign: 'center',
          }}
        >
          We call within 2 hours. We never share your information. No spam.
        </p>
      </div>
    </form>
  )
}
