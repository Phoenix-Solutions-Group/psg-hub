'use client'

type StickyPhoneCtaProps = {
  phone: string
}

export function StickyPhoneCta({ phone }: StickyPhoneCtaProps) {
  const tel = phone.replace(/\./g, '')

  return (
    <>
      <div
        style={{
          position: 'fixed',
          bottom: 0,
          left: 0,
          right: 0,
          zIndex: 100,
          background: 'var(--red)',
          display: 'none',
        }}
        className="sticky-phone-cta"
      >
        <a
          href={`tel:${tel}`}
          style={{
            display: 'block',
            width: '100%',
            padding: 'var(--space-xl)',
            textAlign: 'center',
            color: '#ffffff',
            textDecoration: 'none',
            fontFamily: 'var(--font-body)',
            fontSize: 'var(--text-lg)',
            fontWeight: 600,
            letterSpacing: '0.03em',
          }}
        >
          Call Now: {phone}
        </a>
      </div>

      <style>{`
        @media (max-width: 767px) {
          .sticky-phone-cta {
            display: block !important;
          }
        }
        .sticky-phone-cta a:focus-visible {
          outline: 2px solid var(--focus-ring);
          outline-offset: -4px;
        }
        .sticky-phone-cta a:hover {
          opacity: 0.9;
        }
      `}</style>
    </>
  )
}
