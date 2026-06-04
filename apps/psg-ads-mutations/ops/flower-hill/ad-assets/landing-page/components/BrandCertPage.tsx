import Image from 'next/image'
import { GoldRule } from './GoldRule'
import { BrandCertCta } from './BrandCertCta'
import { SiteFooter } from './SiteFooter'
import { StickyPhoneCta } from './StickyPhoneCta'

const PHONE = '516.627.3913'
const TEL = '5166273913'

export function BrandCertPage() {
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
        <a href="https://www.flowerhillautobody.com" aria-label="Flower Hill Auto Body home">
          <Image
            src="/fhab-logo.svg"
            alt="Flower Hill Auto Body"
            width={140}
            height={40}
            style={{ display: 'block' }}
            priority
          />
        </a>
        <a
          href={`tel:${TEL}`}
          aria-label={`Call Flower Hill Auto Body at ${PHONE}`}
          style={{
            fontFamily: 'var(--font-body)',
            fontSize: 'var(--text-base)',
            color: 'var(--red)',
            textDecoration: 'none',
            fontWeight: 500,
          }}
        >
          {PHONE}
        </a>
      </header>

      <main id="main-content">
        {/* Full-width video hero */}
        <section
          style={{
            position: 'relative',
            width: '100%',
            background: '#050505',
            overflow: 'hidden',
          }}
          className="cert-hero"
        >
          <video
            autoPlay
            playsInline
            muted
            loop
            preload="auto"
            style={{
              width: '100%',
              height: '100%',
              objectFit: 'cover',
              display: 'block',
            }}
          >
            <source
              src="https://www.flowerhillautobody.com/wp-content/uploads/2022/07/aston_clipped.mp4"
              type="video/mp4"
            />
          </video>

          {/* Bottom fade to black */}
          <div
            aria-hidden="true"
            style={{
              position: 'absolute',
              bottom: 0,
              left: 0,
              right: 0,
              height: '200px',
              background: 'linear-gradient(to bottom, transparent, var(--bg))',
            }}
          />
        </section>

        {/* Content */}
        <section
          style={{
            background: 'var(--bg)',
            padding: 'var(--space-5xl) var(--space-2xl)',
          }}
        >
          <div style={{ maxWidth: '900px', margin: '0 auto' }}>
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
              Brand Certification · Aston Martin
            </p>

            <div style={{ marginBottom: 'var(--space-xl)' }}>
              <GoldRule />
            </div>

            <h1
              style={{
                fontFamily: 'var(--font-display)',
                fontSize: 'var(--text-hero)',
                color: 'var(--text)',
                lineHeight: 1.15,
                marginBottom: 'var(--space-3xl)',
              }}
            >
              Aston Martin Factory Authorized Body Shop
            </h1>

            <div
              style={{
                fontFamily: 'var(--font-body)',
                fontSize: 'var(--text-lg)',
                color: 'var(--text-muted)',
                lineHeight: 1.8,
                display: 'flex',
                flexDirection: 'column',
                gap: 'var(--space-2xl)',
                maxWidth: '72ch',
              }}
            >
              <p>
                Flower Hill Auto Body is a member of the Aston Martin Factory Authorized Collision
                Repair Program. This signifies that technicians have completed the required training
                and have acquired the equipment essential to support Aston Martins of North America.
                This program was put in place to offer customers only the best auto collision
                facilities around the country and provide each member with the training they need.
                This specialized training helps support all repairs and care for the complete line
                of Aston Martin vehicle platforms, including steel-manufactured platforms, aluminum
                bodies, and chassis platforms. Recent changes also feature new multi-technology
                platforms of carbon fiber, aluminum, magnesium, and high-strength blended steels.
              </p>

              <p>
                When dealing with vehicles and state-of-the-art technology, it is very important to
                have specialized and trained facilities to handle any repair. Each Aston Martin is
                built with very strict and precise tolerances whether it is the engine or the way
                individual features are designed. In order to sustain the high level of quality that
                the vehicle has, it is imperative to have a qualified and authorized repair facility
                handle any collisions. Flower Hill Auto Body&apos;s Aston Martin authorized collision
                repair status ensures that an Aston Martin-sanctioned repair specialist will perform
                high-quality repairs so that you can maintain the factory warranties on your vehicle.
              </p>

              <p>
                Only specialized repair shops can make the cut for your Aston Martin. All shops
                applying to be recognized as official repair facilities go through a rigorous vetting
                process. Everything has to be flawless from the word go. When Aston Martin
                approached Flower Hill Auto Body for their program, a team of experts was immediately
                fascinated by their strong focus on quality body repair work and their impressive
                customer satisfaction rate. First Class Collision and Body Repair work is an absolute
                necessity for Aston Martin&apos;s body repair program. Aston Martin vehicles are
                different from other cars in so many respects. Therefore, not any regular body repair
                shop can be trusted to carry out these body repairs. Flower Hill Auto Body has the
                skilled mechanics and genuine parts to give your Aston Martin vehicle the best
                service.
              </p>

              <p>
                To learn more, please visit{' '}
                <a
                  href="https://www.astonmartinlongisland.com/index.htm"
                  target="_blank"
                  rel="noopener noreferrer"
                  style={{ color: 'var(--red)', textDecoration: 'none' }}
                >
                  Aston Martin Collision Repair
                </a>
                .
              </p>
            </div>

            {/* Embedded video */}
            <div
              style={{
                marginTop: 'var(--space-4xl)',
                position: 'relative',
                paddingBottom: '56.25%',
                height: 0,
              }}
            >
              <video
                controls
                style={{
                  position: 'absolute',
                  top: 0,
                  left: 0,
                  width: '100%',
                  height: '100%',
                  background: '#050505',
                }}
              >
                <source
                  src="https://www.flowerhillautobody.com/wp-content/uploads/2022/08/Aston-Martin-8_9-edit-v2.mp4"
                  type="video/mp4"
                />
              </video>
            </div>
          </div>
        </section>

        <BrandCertCta />
      </main>

      <SiteFooter />
      <StickyPhoneCta phone={PHONE} />

      <style>{`
        .cert-hero {
          height: clamp(400px, 75vh, 800px);
        }
        .cert-hero video {
          position: absolute;
          inset: 0;
          width: 100%;
          height: 100%;
          object-fit: cover;
        }
        @media (max-width: 768px) {
          .cert-hero {
            height: 55vh !important;
          }
        }
      `}</style>
    </>
  )
}
