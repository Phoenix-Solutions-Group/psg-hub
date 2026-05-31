import Image from 'next/image'
import { ConceptBadge } from './ConceptBadge'
import { GoldRule } from './GoldRule'
import { HeroForm } from './HeroForm'

import type { ConceptData } from '@/lib/concepts'

type HeroSectionProps = {
  concept: ConceptData
}

export function HeroSection({ concept }: HeroSectionProps) {
  const tel = concept.phone.replace(/\./g, '')

  return (
    <>
      <section
        style={{
          position: 'relative',
          minHeight: 'clamp(540px, 85vh, 860px)',
          display: 'grid',
          gridTemplateColumns: '1fr 1fr',
          overflow: 'hidden',
        }}
        className="hero-section"
      >
        {/* Mobile background */}
        <div
          className="hero-bg-mobile"
          style={{
            position: 'absolute',
            inset: 0,
            display: 'none',
            zIndex: 0,
          }}
        >
          <Image
            src={concept.heroImage}
            alt=""
            fill
            style={{ objectFit: 'cover', opacity: 0.07 }}
            priority
            aria-hidden="true"
          />
        </div>

        {/* Left: copy + expandable form */}
        <div
          style={{
            position: 'relative',
            zIndex: 1,
            display: 'flex',
            flexDirection: 'column',
            justifyContent: 'center',
            padding: 'var(--space-5xl) var(--space-4xl)',
            background: 'var(--bg)',
            gap: 'var(--space-xl)',
          }}
          className="hero-content"
        >
          <div>
            <ConceptBadge text={concept.badge} />
            <div style={{ margin: 'var(--space-xl) 0' }}>
              <GoldRule />
            </div>
            <h1
              style={{
                fontFamily: 'var(--font-display)',
                fontSize: 'var(--text-hero)',
                color: 'var(--text)',
                lineHeight: 1.15,
                marginBottom: 'var(--space-lg)',
              }}
            >
              {concept.headline}
            </h1>
            <p
              style={{
                fontFamily: 'var(--font-body)',
                fontSize: 'var(--text-base)',
                color: 'var(--text-muted)',
                lineHeight: 1.65,
                maxWidth: '440px',
              }}
            >
              {concept.subhead}
            </p>
          </div>

          {/* Compact form — expands on first interaction */}
          <div
            style={{
              background: 'var(--surface)',
              border: '1px solid var(--border)',
              padding: 'var(--space-2xl)',
            }}
          >
            <HeroForm
              concept={concept.slug}
              phone={concept.phone}
              ctaLabel={concept.ctaLabel}
            />
          </div>

          <p
            style={{
              fontFamily: 'var(--font-body)',
              fontSize: 'var(--text-sm)',
              color: 'var(--text-muted)',
            }}
          >
            Prefer to call?{' '}
            <a
              href={`tel:${tel}`}
              style={{ color: 'var(--red)', textDecoration: 'none', fontWeight: 500 }}
            >
              {concept.phone}
            </a>
          </p>
        </div>

        {/* Right: video loop OR Ken Burns image — desktop only */}
        <div
          style={{ position: 'relative', overflow: 'hidden' }}
          className="hero-image-desktop"
          aria-hidden="true"
        >
          {concept.heroVideo ? (
            <video
              autoPlay
              muted
              loop
              playsInline
              preload="auto"
              style={{
                position: 'absolute',
                inset: 0,
                width: '100%',
                height: '100%',
                objectFit: 'cover',
              }}
            >
              <source src={concept.heroVideo} type="video/mp4" />
            </video>
          ) : (
            <div className="hero-ken-burns">
              <Image
                src={concept.heroImage}
                alt=""
                fill
                style={{ objectFit: 'cover' }}
                sizes="50vw"
                priority
              />
            </div>
          )}
        </div>
      </section>

      <style>{`
        /* Ken Burns — slow breathing zoom/pan for static images */
        @keyframes kenBurns {
          0%   { transform: scale(1.04) translate(1%, 0.4%); }
          100% { transform: scale(1.09) translate(-1%, -0.4%); }
        }
        .hero-ken-burns {
          position: absolute;
          inset: -5%;
          width: 110%;
          height: 110%;
          animation: kenBurns 18s ease-in-out infinite alternate;
        }

        @media (max-width: 768px) {
          .hero-section {
            grid-template-columns: 1fr !important;
            min-height: unset !important;
          }
          .hero-image-desktop {
            display: none !important;
          }
          .hero-bg-mobile {
            display: block !important;
          }
          .hero-content {
            padding: var(--space-3xl) var(--space-xl) !important;
            min-height: 100dvh;
          }
        }
      `}</style>
    </>
  )
}
