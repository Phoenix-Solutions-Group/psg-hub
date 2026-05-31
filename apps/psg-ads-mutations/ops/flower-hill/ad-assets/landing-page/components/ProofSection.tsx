import type { ProofItem } from '@/lib/concepts'

type ProofSectionProps = {
  proofItems: ProofItem[]
}

export function ProofSection({ proofItems }: ProofSectionProps) {
  return (
    <section
      aria-labelledby="proof-section-heading"
      style={{
        background: 'var(--bg)',
        padding: 'var(--space-5xl) var(--space-2xl)',
      }}
    >
      <div style={{ maxWidth: '1200px', margin: '0 auto' }}>
        <p
          id="proof-section-heading"
          style={{
            fontFamily: 'var(--font-body)',
            fontSize: 'var(--text-xs)',
            color: 'var(--text-muted)',
            textTransform: 'uppercase',
            letterSpacing: '0.12em',
            marginBottom: 'var(--space-4xl)',
          }}
        >
          Why Flower Hill
        </p>

        <div
          className="proof-grid"
          style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(3, 1fr)',
            gap: 'var(--space-4xl)',
          }}
        >
          {proofItems.map((item) => (
            <div key={item.label}>
              <div
                style={{
                  height: '1px',
                  background: 'var(--gold)',
                  width: '48px',
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
                  lineHeight: 1.3,
                }}
              >
                {item.label}
              </h3>
              <p
                style={{
                  fontFamily: 'var(--font-body)',
                  fontSize: 'var(--text-base)',
                  color: 'var(--text-muted)',
                  lineHeight: 1.7,
                }}
              >
                {item.detail}
              </p>
            </div>
          ))}
        </div>
      </div>

      <style>{`
        @media (max-width: 768px) {
          .proof-grid {
            grid-template-columns: 1fr !important;
            gap: var(--space-3xl) !important;
          }
        }
      `}</style>
    </section>
  )
}
