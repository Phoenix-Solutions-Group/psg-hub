import Image from 'next/image'

type LocationBlock = {
  name: string
  address: string
  phone: string
  email: string
  hours: string
}

const locations: LocationBlock[] = [
  {
    name: 'Roslyn',
    address: '1180 Old Northern Blvd, Roslyn, NY 11576',
    phone: '516.627.3913',
    email: 'roslyninfo@flowerhillautobody.com',
    hours: 'Mon–Fri 8am–5pm · Sat by appointment',
  },
  {
    name: 'Huntington Station',
    address: '755 New York Ave, Huntington Station, NY 11746',
    phone: '631.270.0033',
    email: 'huntingtoninfo@flowerhillautobody.com',
    hours: 'Mon–Fri 8am–5pm · Sat by appointment',
  },
  {
    name: 'About Flower Hill',
    address: 'Est. 1950 · Four Generations · I-CAR Gold Class',
    phone: '516.627.3913',
    email: 'roslyninfo@flowerhillautobody.com',
    hours: '25+ OEM Certifications · 627 Five-Star Reviews',
  },
]

export function SiteFooter() {
  return (
    <footer
      style={{
        background: 'var(--surface)',
        borderTop: '1px solid var(--border)',
        padding: 'var(--space-4xl) var(--space-2xl) var(--space-3xl)',
      }}
    >
      <div style={{ maxWidth: '1200px', margin: '0 auto' }}>
        <div style={{ marginBottom: 'var(--space-3xl)' }}>
          <Image
            src="/fhab-logo.svg"
            alt="Flower Hill Auto Body"
            width={140}
            height={40}
            style={{ display: 'block' }}
          />
        </div>

        <div
          style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(3, 1fr)',
            gap: 'var(--space-3xl)',
          }}
          className="footer-grid"
        >
          {locations.map((loc) => (
            <div key={loc.name}>
              <h4
                style={{
                  fontFamily: 'var(--font-display)',
                  fontSize: 'var(--text-base)',
                  color: 'var(--text)',
                  marginBottom: 'var(--space-lg)',
                }}
              >
                {loc.name}
              </h4>
              <div
                style={{
                  fontFamily: 'var(--font-body)',
                  fontSize: 'var(--text-sm)',
                  color: 'var(--text-muted)',
                  lineHeight: 1.8,
                  display: 'flex',
                  flexDirection: 'column',
                  gap: 'var(--space-xs)',
                }}
              >
                <span>{loc.address}</span>
                <a
                  href={`tel:${loc.phone.replace(/\./g, '')}`}
                  style={{ color: 'var(--red)', textDecoration: 'none' }}
                >
                  {loc.phone}
                </a>
                <a
                  href={`mailto:${loc.email}`}
                  style={{ color: 'var(--text-muted)', textDecoration: 'none' }}
                >
                  {loc.email}
                </a>
                <span>{loc.hours}</span>
              </div>
            </div>
          ))}
        </div>

        <div
          style={{
            marginTop: 'var(--space-3xl)',
            paddingTop: 'var(--space-xl)',
            borderTop: '1px solid var(--border)',
            fontFamily: 'var(--font-body)',
            fontSize: 'var(--text-xs)',
            color: 'var(--text-muted)',
          }}
        >
          &copy; {new Date().getFullYear()} Flower Hill Auto Body. All rights reserved.
        </div>
      </div>

      <style>{`
        @media (max-width: 768px) {
          .footer-grid {
            grid-template-columns: 1fr !important;
          }
        }
      `}</style>
    </footer>
  )
}
