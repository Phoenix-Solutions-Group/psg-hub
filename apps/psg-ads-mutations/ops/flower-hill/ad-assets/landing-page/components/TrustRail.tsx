import type { StatItem } from '@/lib/concepts'

type TrustRailProps = {
  stats: [StatItem, StatItem, StatItem]
}

export function TrustRail({ stats }: TrustRailProps) {
  return (
    <section
      style={{
        background: 'var(--surface)',
        borderTop: '1px solid var(--border)',
        borderBottom: '1px solid var(--border)',
      }}
    >
      <div
        style={{
          maxWidth: '1200px',
          margin: '0 auto',
          padding: 'var(--space-3xl) var(--space-2xl)',
          display: 'grid',
          gridTemplateColumns: 'repeat(3, 1fr)',
        }}
        className="trust-rail-grid"
      >
        {stats.map((stat, i) => (
          <div
            key={stat.label}
            className="trust-rail-item"
            style={{
              textAlign: 'center',
              padding: 'var(--space-xl) var(--space-2xl)',
              borderLeft: i > 0 ? '1px solid var(--border)' : 'none',
            }}
          >
            <div
              style={{
                fontFamily: 'var(--font-display)',
                fontSize: 'clamp(2rem, 4vw, 3.5rem)',
                color: 'var(--red)',
                lineHeight: 1.1,
                marginBottom: 'var(--space-sm)',
              }}
            >
              {stat.value}
            </div>
            <div
              style={{
                fontFamily: 'var(--font-body)',
                fontSize: 'var(--text-sm)',
                color: 'var(--text-muted)',
                textTransform: 'uppercase',
                letterSpacing: '0.08em',
              }}
            >
              {stat.label}
            </div>
          </div>
        ))}
      </div>

      <style>{`
        @media (max-width: 600px) {
          .trust-rail-grid {
            grid-template-columns: 1fr !important;
          }
          .trust-rail-item {
            border-left: none !important;
            border-top: 1px solid var(--border);
          }
          .trust-rail-item:first-child {
            border-top: none;
          }
        }
      `}</style>
    </section>
  )
}
