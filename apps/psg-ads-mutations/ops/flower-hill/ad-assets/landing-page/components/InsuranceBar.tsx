const CARRIERS = [
  'Geico',
  'Allstate',
  'State Farm',
  'Progressive',
  'Liberty Mutual',
  'Travelers',
  'USAA',
  'Nationwide',
  'Farmers',
  'Hartford',
  'MetLife',
  'All others',
]

export function InsuranceBar() {
  return (
    <section
      aria-labelledby="insurance-heading"
      style={{
        background: 'var(--surface)',
        borderTop: '1px solid var(--border)',
        borderBottom: '1px solid var(--border)',
        padding: 'var(--space-4xl) var(--space-2xl)',
      }}
    >
      <div style={{ maxWidth: '1200px', margin: '0 auto' }}>
        <div
          className="insurance-layout"
          style={{
            display: 'grid',
            gridTemplateColumns: '1fr 2fr',
            gap: 'var(--space-3xl)',
            alignItems: 'start',
          }}
        >
          <div>
            <div
              style={{
                height: '1px',
                background: 'var(--gold)',
                width: '32px',
                marginBottom: 'var(--space-xl)',
              }}
              aria-hidden="true"
            />
            <h2
              id="insurance-heading"
              style={{
                fontFamily: 'var(--font-display)',
                fontSize: 'var(--text-h3)',
                color: 'var(--text)',
                lineHeight: 1.3,
                marginBottom: 'var(--space-lg)',
              }}
            >
              We work with every insurance company.
            </h2>
            <p
              style={{
                fontFamily: 'var(--font-body)',
                fontSize: 'var(--text-sm)',
                color: 'var(--text-muted)',
                lineHeight: 1.7,
              }}
            >
              In New York, you have the legal right to choose your body shop. Your insurance company cannot force you to use their preferred facility. We negotiate directly with your adjuster — you don&apos;t chase paperwork.
            </p>
          </div>

          <div>
            <p
              style={{
                fontFamily: 'var(--font-body)',
                fontSize: 'var(--text-xs)',
                color: 'var(--text-muted)',
                textTransform: 'uppercase',
                letterSpacing: '0.1em',
                marginBottom: 'var(--space-lg)',
              }}
            >
              Accepted Insurance Companies
            </p>
            <div
              style={{
                display: 'flex',
                flexWrap: 'wrap',
                gap: 'var(--space-sm)',
              }}
            >
              {CARRIERS.map((carrier) => (
                <span
                  key={carrier}
                  style={{
                    fontFamily: 'var(--font-body)',
                    fontSize: 'var(--text-sm)',
                    color: 'var(--text)',
                    border: '1px solid var(--border)',
                    padding: '4px 14px',
                    whiteSpace: 'nowrap',
                  }}
                >
                  {carrier}
                </span>
              ))}
            </div>
          </div>
        </div>
      </div>

      <style>{`
        @media (max-width: 768px) {
          .insurance-layout {
            grid-template-columns: 1fr !important;
          }
        }
      `}</style>
    </section>
  )
}
