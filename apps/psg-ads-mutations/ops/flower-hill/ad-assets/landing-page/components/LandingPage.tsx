import Image from 'next/image'
import { HeroSection } from './HeroSection'
import { TrustRail } from './TrustRail'
import { CertGrid } from './CertGrid'
import { ProofSection } from './ProofSection'
import { ProcessSteps } from './ProcessSteps'
import { Testimonials } from './Testimonials'
import { InsuranceBar } from './InsuranceBar'
import { FaqSection } from './FaqSection'
import { EstimateForm } from './EstimateForm'
import { SiteFooter } from './SiteFooter'
import { StickyPhoneCta } from './StickyPhoneCta'
import type { ConceptData } from '@/lib/concepts'

type LandingPageProps = {
  concept: ConceptData
}

const TRUST_BULLETS = [
  'Manufacturer-certified technicians',
  'We manage your insurance claim directly',
  'Written estimate before any work begins',
]

export function LandingPage({ concept }: LandingPageProps) {
  const tel = concept.phone.replace(/\./g, '')

  return (
    <>
      {/* Sticky Nav */}
      <header
        style={{
          position: 'sticky',
          top: 0,
          zIndex: 50,
          background: 'var(--bg)',
          borderBottom: '1px solid var(--border)',
          padding: '1rem 2rem',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
        }}
      >
        <Image
          src="/fhab-logo.svg"
          alt="Flower Hill Auto Body"
          width={140}
          height={40}
          style={{ display: 'block' }}
          priority
        />
        <a
          href={`tel:${tel}`}
          aria-label={`Call Flower Hill Auto Body at ${concept.phone}`}
          style={{
            fontFamily: 'var(--font-body)',
            fontSize: 'var(--text-base)',
            color: 'var(--red)',
            textDecoration: 'none',
            fontWeight: 500,
          }}
        >
          {concept.phone}
        </a>
      </header>

      <main id="main-content">
        <HeroSection concept={concept} />
        <TrustRail stats={concept.stats} />
        <CertGrid certs={concept.certBadges} />
        <ProofSection proofItems={concept.proofItems} />
        <ProcessSteps />
        <Testimonials testimonials={concept.testimonials} />
        <InsuranceBar />
        <FaqSection faqs={concept.faqs} />

        {/* Estimate Section */}
        <section
          id="estimate"
          style={{
            background: 'var(--surface)',
            borderTop: '1px solid var(--border)',
            padding: 'var(--space-5xl) var(--space-2xl)',
          }}
        >
          <div
            style={{
              maxWidth: '1200px',
              margin: '0 auto',
              display: 'grid',
              gridTemplateColumns: '1fr 1fr',
              gap: 'var(--space-4xl)',
              alignItems: 'start',
            }}
            className="estimate-grid"
          >
            {/* Left: copy + trust */}
            <div>
              <p
                style={{
                  fontFamily: 'var(--font-body)',
                  fontSize: 'var(--text-sm)',
                  color: 'var(--text-muted)',
                  textTransform: 'uppercase',
                  letterSpacing: '0.1em',
                  marginBottom: 'var(--space-xl)',
                }}
              >
                {concept.location} · {concept.badge}
              </p>
              <div
                style={{
                  height: '1px',
                  background: 'var(--gold)',
                  width: '48px',
                  marginBottom: 'var(--space-xl)',
                }}
                aria-hidden="true"
              />
              <h2
                style={{
                  fontFamily: 'var(--font-display)',
                  fontSize: 'var(--text-h2)',
                  color: 'var(--text)',
                  lineHeight: 1.2,
                  marginBottom: 'var(--space-xl)',
                }}
              >
                Request a Certified Estimate
              </h2>
              <p
                style={{
                  fontFamily: 'var(--font-body)',
                  fontSize: 'var(--text-base)',
                  color: 'var(--text-muted)',
                  lineHeight: 1.7,
                  marginBottom: 'var(--space-2xl)',
                }}
              >
                We call within 2 hours to discuss your vehicle and schedule your in-person assessment. As a manufacturer-certified shop, we negotiate your insurance claim directly — you don&apos;t chase adjusters or manage paperwork.
              </p>

              {/* Trust bullets */}
              <ul
                style={{
                  listStyle: 'none',
                  padding: 0,
                  margin: '0 0 var(--space-2xl)',
                  display: 'flex',
                  flexDirection: 'column',
                  gap: 'var(--space-sm)',
                }}
              >
                {TRUST_BULLETS.map((bullet) => (
                  <li
                    key={bullet}
                    style={{
                      display: 'flex',
                      alignItems: 'flex-start',
                      gap: '10px',
                      fontFamily: 'var(--font-body)',
                      fontSize: 'var(--text-sm)',
                      color: 'var(--text-muted)',
                      lineHeight: 1.5,
                    }}
                  >
                    <span
                      style={{
                        color: 'var(--red)',
                        fontWeight: 700,
                        flexShrink: 0,
                        marginTop: '1px',
                      }}
                      aria-hidden="true"
                    >
                      ✓
                    </span>
                    {bullet}
                  </li>
                ))}
              </ul>

              <div
                style={{
                  fontFamily: 'var(--font-body)',
                  fontSize: 'var(--text-sm)',
                  color: 'var(--text-muted)',
                  lineHeight: 2,
                }}
              >
                <div>
                  <a
                    href={`tel:${tel}`}
                    style={{ color: 'var(--red)', textDecoration: 'none' }}
                  >
                    {concept.phone}
                  </a>
                </div>
                <div>
                  <a
                    href={`mailto:${concept.email}`}
                    style={{ color: 'var(--text-muted)', textDecoration: 'none' }}
                  >
                    {concept.email}
                  </a>
                </div>
              </div>
            </div>

            {/* Right: form */}
            <div>
              <EstimateForm
                concept={concept.slug}
                phone={concept.phone}
                ctaLabel={concept.ctaLabel}
              />
            </div>
          </div>
        </section>
      </main>

      <SiteFooter />
      <StickyPhoneCta phone={concept.phone} />

      <style>{`
        @media (max-width: 768px) {
          .estimate-grid {
            grid-template-columns: 1fr !important;
          }
        }
      `}</style>
    </>
  )
}
