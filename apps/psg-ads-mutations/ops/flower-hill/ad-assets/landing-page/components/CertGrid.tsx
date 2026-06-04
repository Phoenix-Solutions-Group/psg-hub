type CertGridProps = {
  certs: string[]
}

export function CertGrid({ certs }: CertGridProps) {
  return (
    <section
      aria-labelledby="cert-grid-heading"
      style={{
        background: 'var(--surface)',
        borderBottom: '1px solid var(--border)',
        padding: 'var(--space-3xl) var(--space-2xl)',
      }}
    >
      <div style={{ maxWidth: '1200px', margin: '0 auto' }}>
        <p
          id="cert-grid-heading"
          style={{
            fontFamily: 'var(--font-body)',
            fontSize: 'var(--text-xs)',
            color: 'var(--text-muted)',
            textTransform: 'uppercase',
            letterSpacing: '0.12em',
            textAlign: 'center',
            marginBottom: 'var(--space-xl)',
          }}
        >
          OEM Certifications &amp; Industry Recognition — Each awarded by the manufacturer, not self-declared.
        </p>

        <div
          style={{
            display: 'flex',
            flexWrap: 'wrap',
            gap: 'var(--space-sm)',
            alignItems: 'center',
            justifyContent: 'center',
          }}
        >
          {certs.map((cert) => (
            <span
              key={cert}
              style={{
                display: 'inline-block',
                fontFamily: 'var(--font-body)',
                fontSize: 'var(--text-xs)',
                fontWeight: 500,
                color: 'var(--text-muted)',
                textTransform: 'uppercase',
                letterSpacing: '0.08em',
                border: '1px solid var(--border)',
                padding: '4px 12px',
                whiteSpace: 'nowrap',
              }}
            >
              {cert}
            </span>
          ))}
        </div>
      </div>
    </section>
  )
}
