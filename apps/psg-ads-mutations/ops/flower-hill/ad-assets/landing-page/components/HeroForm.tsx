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

type HeroFormProps = {
  concept: string
  phone: string
  ctaLabel: string
}

export function HeroForm({ concept, phone, ctaLabel }: HeroFormProps) {
  const [form, setForm] = useState<FormState>({ name: '', phone: '', email: '', vehicle: '', damage: '' })
  const [errors, setErrors] = useState<FieldErrors>({})
  const [expanded, setExpanded] = useState(false)
  const [submitting, setSubmitting] = useState(false)
  const [success, setSuccess] = useState(false)
  const [serverError, setServerError] = useState('')

  function expand() {
    if (!expanded) setExpanded(true)
  }

  function validate(field: 'name' | 'phone' | 'vehicle', value: string): string {
    if (field === 'name' && !value.trim()) return 'Name is required.'
    if (field === 'phone') {
      if (!value.trim()) return 'Phone number is required.'
      if (!/[\d\s\-().+]{7,}/.test(value)) return 'Enter a valid phone number.'
    }
    if (field === 'vehicle' && !value.trim()) return 'Vehicle year, make, and model is required.'
    return ''
  }

  function handleBlur(field: 'name' | 'phone' | 'vehicle') {
    setErrors((prev) => ({ ...prev, [field]: validate(field, form[field]) }))
  }

  function handleChange(field: keyof FormState, value: string) {
    setForm((prev) => ({ ...prev, [field]: value }))
    if (field !== 'email' && field !== 'damage') {
      setErrors((prev) => ({ ...prev, [field]: '' }))
    }
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    expand()

    const newErrors: FieldErrors = {}
    ;(['name', 'phone', 'vehicle'] as const).forEach((f) => {
      const err = validate(f, form[f])
      if (err) newErrors[f] = err
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
    padding: '12px 14px',
    boxSizing: 'border-box',
    outline: 'none',
    transition: 'border-color 0.15s ease',
  }

  const labelStyle: React.CSSProperties = {
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'baseline',
    fontFamily: 'var(--font-body)',
    fontSize: '11px',
    color: 'var(--text-muted)',
    textTransform: 'uppercase',
    letterSpacing: '0.08em',
    marginBottom: '5px',
  }

  const errorStyle: React.CSSProperties = {
    color: '#cc4444',
    fontSize: 'var(--text-xs)',
    marginTop: '4px',
    fontFamily: 'var(--font-body)',
  }

  const optionalTag: React.CSSProperties = {
    fontSize: '10px',
    textTransform: 'none',
    letterSpacing: 0,
    fontStyle: 'italic',
  }

  if (success) {
    return (
      <div style={{ padding: '24px', background: 'var(--bg)', border: '1px solid var(--border)' }}>
        <div
          style={{ height: '2px', background: 'var(--red)', width: '28px', marginBottom: '16px' }}
          aria-hidden="true"
        />
        <h3
          style={{
            fontFamily: 'var(--font-display)',
            fontSize: 'var(--text-2xl)',
            color: 'var(--text)',
            marginBottom: '10px',
          }}
        >
          Request confirmed.
        </h3>
        <p
          style={{
            fontFamily: 'var(--font-body)',
            fontSize: 'var(--text-sm)',
            color: 'var(--text-muted)',
            lineHeight: 1.7,
            marginBottom: '12px',
          }}
        >
          A certified advisor will call you within 2 hours — not a call center. For immediate help, call{' '}
          <a href={`tel:${phone.replace(/\./g, '')}`} style={{ color: 'var(--red)', textDecoration: 'none' }}>
            {phone}
          </a>
          .
        </p>
        <p style={{ fontFamily: 'var(--font-body)', fontSize: 'var(--text-sm)', color: 'var(--text-muted)', lineHeight: 1.7 }}>
          Next: We&apos;ll confirm your location and schedule your in-person damage assessment.
        </p>
      </div>
    )
  }

  return (
    <form onSubmit={handleSubmit} noValidate>
      <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>

        {/* ── Always visible: Name ── */}
        <div>
          <label htmlFor="hf-name" style={labelStyle}><span>Name</span></label>
          <input
            id="hf-name"
            type="text"
            value={form.name}
            onChange={(e) => handleChange('name', e.target.value)}
            onFocus={expand}
            onBlur={() => handleBlur('name')}
            placeholder="Your full name"
            aria-invalid={!!errors.name}
            style={{ ...inputStyle, borderColor: errors.name ? '#cc4444' : 'var(--border)' }}
            autoComplete="name"
          />
          {errors.name && <p role="alert" style={errorStyle}>{errors.name}</p>}
        </div>

        {/* ── Always visible: Phone ── */}
        <div>
          <label htmlFor="hf-phone" style={labelStyle}><span>Phone</span></label>
          <input
            id="hf-phone"
            type="tel"
            value={form.phone}
            onChange={(e) => handleChange('phone', e.target.value)}
            onFocus={expand}
            onBlur={() => handleBlur('phone')}
            placeholder="Best number to reach you"
            aria-invalid={!!errors.phone}
            style={{ ...inputStyle, borderColor: errors.phone ? '#cc4444' : 'var(--border)' }}
            autoComplete="tel"
          />
          {errors.phone && <p role="alert" style={errorStyle}>{errors.phone}</p>}
        </div>

        {/* ── Expandable: Vehicle + Email + Damage ── */}
        <div
          style={{
            display: 'grid',
            gridTemplateRows: expanded ? '1fr' : '0fr',
            transition: 'grid-template-rows 0.35s cubic-bezier(0.16, 1, 0.3, 1)',
            overflow: 'hidden',
          }}
          aria-hidden={!expanded}
        >
          <div style={{ overflow: 'hidden' }}>
            <div style={{ display: 'flex', flexDirection: 'column', gap: '12px', paddingTop: '0' }}>

              <div>
                <label htmlFor="hf-vehicle" style={labelStyle}><span>Vehicle</span></label>
                <input
                  id="hf-vehicle"
                  type="text"
                  value={form.vehicle}
                  onChange={(e) => handleChange('vehicle', e.target.value)}
                  onBlur={() => handleBlur('vehicle')}
                  placeholder="Year, make, and model"
                  aria-invalid={!!errors.vehicle}
                  style={{ ...inputStyle, borderColor: errors.vehicle ? '#cc4444' : 'var(--border)' }}
                  tabIndex={expanded ? 0 : -1}
                  autoComplete="off"
                />
                {errors.vehicle && <p role="alert" style={errorStyle}>{errors.vehicle}</p>}
              </div>

              <div>
                <label htmlFor="hf-email" style={labelStyle}>
                  <span>Email</span>
                  <span style={optionalTag}>Optional</span>
                </label>
                <input
                  id="hf-email"
                  type="email"
                  value={form.email}
                  onChange={(e) => handleChange('email', e.target.value)}
                  placeholder="name@example.com"
                  style={inputStyle}
                  tabIndex={expanded ? 0 : -1}
                  autoComplete="email"
                />
              </div>

              <div>
                <label htmlFor="hf-damage" style={labelStyle}>
                  <span>Damage Description</span>
                  <span style={optionalTag}>Optional</span>
                </label>
                <textarea
                  id="hf-damage"
                  value={form.damage}
                  onChange={(e) => handleChange('damage', e.target.value)}
                  placeholder="Briefly describe the damage"
                  rows={2}
                  style={{ ...inputStyle, resize: 'vertical', minHeight: '70px' }}
                  tabIndex={expanded ? 0 : -1}
                />
              </div>

            </div>
          </div>
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
            padding: '14px 20px',
            fontFamily: 'var(--font-body)',
            fontSize: 'var(--text-sm)',
            letterSpacing: '0.05em',
            textTransform: 'uppercase',
            cursor: submitting ? 'not-allowed' : 'pointer',
            width: '100%',
            transition: 'background 0.2s',
          }}
        >
          {submitting ? 'Sending...' : expanded ? ctaLabel : 'Get My Estimate →'}
        </button>

        <p
          style={{
            fontFamily: 'var(--font-body)',
            fontSize: 'var(--text-xs)',
            color: 'var(--text-muted)',
            textAlign: 'center',
            lineHeight: 1.5,
          }}
        >
          We call within 2 hours. We never share your information.
        </p>

      </div>
    </form>
  )
}
