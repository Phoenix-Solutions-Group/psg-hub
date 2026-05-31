import type { TestimonialItem } from '@/lib/concepts'

type TestimonialsProps = {
  testimonials: [TestimonialItem, TestimonialItem]
}

export function Testimonials({ testimonials }: TestimonialsProps) {
  return (
    <section
      aria-label="Customer testimonials"
      style={{
        background: 'var(--surface)',
        borderTop: '1px solid var(--border)',
        borderBottom: '1px solid var(--border)',
        padding: 'var(--space-5xl) var(--space-2xl)',
      }}
    >
      <div
        style={{
          maxWidth: '1200px',
          margin: '0 auto',
        }}
      >
        <p
          style={{
            fontFamily: 'var(--font-body)',
            fontSize: 'var(--text-xs)',
            color: 'var(--text-muted)',
            textTransform: 'uppercase',
            letterSpacing: '0.1em',
            marginBottom: 'var(--space-4xl)',
            textAlign: 'center',
          }}
        >
          Verified Customer Reviews
        </p>

        <div
          className="testimonials-grid"
          style={{
            display: 'grid',
            gridTemplateColumns: '1fr 1fr',
            gap: 'var(--space-3xl)',
          }}
        >
          {testimonials.map((t, i) => (
            <blockquote
              key={i}
              style={{
                margin: 0,
                padding: 'var(--space-3xl)',
                background: 'var(--bg)',
                border: '1px solid var(--border)',
                boxShadow: 'var(--shadow-1)',
              }}
            >
              <div
                style={{
                  height: '1px',
                  background: 'var(--gold)',
                  width: '32px',
                  marginBottom: 'var(--space-xl)',
                }}
                aria-hidden="true"
              />
              <p
                style={{
                  fontFamily: 'var(--font-display)',
                  fontSize: 'var(--text-xl)',
                  color: 'var(--text)',
                  lineHeight: 1.6,
                  marginBottom: 'var(--space-xl)',
                  fontStyle: 'italic',
                }}
              >
                &ldquo;{t.quote}&rdquo;
              </p>
              <footer>
                <cite
                  style={{
                    fontFamily: 'var(--font-body)',
                    fontSize: 'var(--text-sm)',
                    color: 'var(--text-muted)',
                    fontStyle: 'normal',
                    lineHeight: 1.6,
                  }}
                >
                  <strong style={{ color: 'var(--text)', display: 'block' }}>
                    {t.author}
                  </strong>
                  {t.vehicle}
                </cite>
              </footer>
            </blockquote>
          ))}
        </div>
      </div>

      <style>{`
        @media (max-width: 768px) {
          .testimonials-grid {
            grid-template-columns: 1fr !important;
          }
        }
      `}</style>
    </section>
  )
}
