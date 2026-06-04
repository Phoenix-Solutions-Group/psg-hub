'use client'

import { useState } from 'react'

type CtaButton = {
  label: string
  locations: { name: string; href: string }[]
}

const buttons: CtaButton[] = [
  {
    label: 'Start Your Online Estimate',
    locations: [
      { name: 'Roslyn Office', href: '/start-estimate-roslyn' },
      { name: 'Glen Cove Office', href: '/start-estimate-glen-cove' },
      { name: 'Huntington Office', href: '/start-estimate-huntington' },
    ],
  },
  {
    label: 'Schedule In-Person Assessment',
    locations: [
      { name: 'Roslyn Office', href: '/schedule-roslyn' },
      { name: 'Glen Cove Office', href: '/schedule-glen-cove' },
      { name: 'Huntington Office', href: '/schedule-huntington' },
    ],
  },
  {
    label: 'Pay Over Time',
    locations: [
      {
        name: 'Roslyn Office',
        href: 'https://apply.sunbit.com/FLOWERHILLAUTOBODYOFROSLYN-h2pj7l4o?origin=ALLIANCE_PREQUAL_LINK',
      },
      {
        name: 'Glen Cove Office',
        href: 'https://apply.sunbit.com/FlowerHillAutoBodyofGlenCove-zuyfiva3?origin=ALLIANCE_PREQUAL_LINK',
      },
      {
        name: 'Huntington Office',
        href: 'https://apply.sunbit.com/FLOWERHILLAUTOBODYofHUNTINGTON-c8z1d4ak?origin=ALLIANCE_PREQUAL_LINK',
      },
    ],
  },
]

export function BrandCertCta() {
  const [open, setOpen] = useState<number | null>(null)

  const toggle = (i: number) => setOpen(open === i ? null : i)

  return (
    <section
      style={{
        background: 'var(--surface)',
        borderTop: '1px solid var(--border)',
        padding: 'var(--space-5xl) var(--space-2xl)',
      }}
    >
      <div style={{ maxWidth: '1200px', margin: '0 auto' }}>
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
          Roslyn · Glen Cove · Huntington
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
            marginBottom: 'var(--space-lg)',
          }}
        >
          Contact Us
        </h2>

        <p
          style={{
            fontFamily: 'var(--font-body)',
            fontSize: 'var(--text-base)',
            color: 'var(--text-muted)',
            lineHeight: 1.7,
            marginBottom: 'var(--space-3xl)',
            maxWidth: '540px',
          }}
        >
          Start your damage assessment online, schedule an in-person visit, or apply for financing.
        </p>

        <div
          style={{
            display: 'flex',
            flexWrap: 'wrap',
            gap: 'var(--space-xl)',
          }}
          className="cta-button-row"
        >
          {buttons.map((btn, i) => (
            <div
              key={btn.label}
              style={{ position: 'relative', flexShrink: 0 }}
              className="cta-button-wrap"
            >
              <button
                onClick={() => toggle(i)}
                aria-expanded={open === i}
                style={{
                  display: 'block',
                  background: 'var(--red)',
                  color: '#ffffff',
                  border: 'none',
                  padding: '1rem 1.75rem',
                  fontFamily: 'var(--font-body)',
                  fontSize: 'var(--text-sm)',
                  letterSpacing: '0.05em',
                  textTransform: 'uppercase',
                  cursor: 'pointer',
                  whiteSpace: 'nowrap',
                  transition: 'background 0.15s ease',
                }}
                className="cta-btn"
              >
                {btn.label}
                <span
                  aria-hidden="true"
                  style={{
                    display: 'inline-block',
                    marginLeft: '0.5rem',
                    transform: open === i ? 'rotate(180deg)' : 'none',
                    transition: 'transform 0.15s ease',
                    fontSize: '0.75em',
                  }}
                >
                  &#9660;
                </span>
              </button>

              {open === i && (
                <ul
                  style={{
                    position: 'absolute',
                    top: '100%',
                    left: 0,
                    margin: '2px 0 0',
                    padding: 0,
                    listStyle: 'none',
                    background: 'var(--bg)',
                    border: '1px solid var(--border)',
                    minWidth: '100%',
                    zIndex: 10,
                  }}
                >
                  {btn.locations.map((loc) => (
                    <li key={loc.name}>
                      <a
                        href={loc.href}
                        target="_blank"
                        rel="noopener noreferrer"
                        style={{
                          display: 'block',
                          padding: 'var(--space-lg) var(--space-2xl)',
                          fontFamily: 'var(--font-body)',
                          fontSize: 'var(--text-sm)',
                          color: 'var(--text)',
                          textDecoration: 'none',
                          borderBottom: '1px solid var(--border)',
                          transition: 'background 0.1s ease',
                        }}
                        className="cta-loc-link"
                      >
                        {loc.name}
                      </a>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          ))}
        </div>
      </div>

      <style>{`
        .cta-btn:hover {
          background: #a50e1c !important;
        }
        .cta-loc-link:hover {
          background: var(--surface) !important;
          color: var(--red) !important;
        }
        @media (max-width: 768px) {
          .cta-button-row {
            flex-direction: column !important;
          }
          .cta-button-wrap {
            width: 100% !important;
          }
          .cta-btn {
            width: 100% !important;
            text-align: left !important;
          }
        }
      `}</style>
    </section>
  )
}
