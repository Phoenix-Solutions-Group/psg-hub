const steps = [
  {
    num: '01',
    title: 'We call you within 2 hours',
    body: 'A certified advisor — not a call center — contacts you to discuss your vehicle and confirm your nearest location. Every question answered before you commit to anything.',
  },
  {
    num: '02',
    title: 'In-person damage assessment',
    body: 'We photograph and document every aspect of the damage before a single repair begins. Our written estimate is submitted directly to your insurance company on your behalf.',
  },
  {
    num: '03',
    title: 'We manage your insurance claim',
    body: 'Our insurance specialists communicate with your adjuster directly. Most customers never speak to an adjuster after the initial incident report. We handle negotiation, paperwork, and approvals.',
  },
]

export function ProcessSteps() {
  return (
    <section
      aria-labelledby="process-heading"
      style={{
        background: 'var(--bg)',
        padding: 'var(--space-5xl) var(--space-2xl)',
        borderTop: '1px solid var(--border)',
      }}
    >
      <div style={{ maxWidth: '1200px', margin: '0 auto' }}>
        <p
          id="process-heading"
          style={{
            fontFamily: 'var(--font-body)',
            fontSize: 'var(--text-xs)',
            color: 'var(--text-muted)',
            textTransform: 'uppercase',
            letterSpacing: '0.12em',
            marginBottom: 'var(--space-xl)',
          }}
        >
          What Happens After You Submit
        </p>

        <h2
          style={{
            fontFamily: 'var(--font-display)',
            fontSize: 'var(--text-h2)',
            color: 'var(--text)',
            lineHeight: 1.2,
            marginBottom: 'var(--space-4xl)',
            maxWidth: '520px',
          }}
        >
          Three steps. No runaround. No call centers.
        </h2>

        <div
          className="process-grid"
          style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(3, 1fr)',
            gap: 'var(--space-4xl)',
          }}
        >
          {steps.map((step) => (
            <div key={step.num}>
              <div
                style={{
                  fontFamily: 'var(--font-body)',
                  fontSize: '11px',
                  color: 'var(--red)',
                  fontWeight: 700,
                  letterSpacing: '0.1em',
                  textTransform: 'uppercase',
                  marginBottom: 'var(--space-lg)',
                }}
              >
                {step.num}
              </div>
              <div
                style={{
                  height: '1px',
                  background: 'var(--gold)',
                  width: '32px',
                  marginBottom: 'var(--space-xl)',
                }}
                aria-hidden="true"
              />
              <h3
                style={{
                  fontFamily: 'var(--font-display)',
                  fontSize: 'var(--text-2xl)',
                  color: 'var(--text)',
                  lineHeight: 1.3,
                  marginBottom: 'var(--space-lg)',
                }}
              >
                {step.title}
              </h3>
              <p
                style={{
                  fontFamily: 'var(--font-body)',
                  fontSize: 'var(--text-base)',
                  color: 'var(--text-muted)',
                  lineHeight: 1.7,
                }}
              >
                {step.body}
              </p>
            </div>
          ))}
        </div>
      </div>

      <style>{`
        @media (max-width: 768px) {
          .process-grid {
            grid-template-columns: 1fr !important;
            gap: var(--space-3xl) !important;
          }
        }
      `}</style>
    </section>
  )
}
