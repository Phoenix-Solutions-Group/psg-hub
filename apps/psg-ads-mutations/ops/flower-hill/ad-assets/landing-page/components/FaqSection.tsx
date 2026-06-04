'use client'

import { useState } from 'react'
import type { FaqItem } from '@/lib/concepts'

type FaqSectionProps = {
  faqs: FaqItem[]
}

export function FaqSection({ faqs }: FaqSectionProps) {
  const [open, setOpen] = useState<number | null>(null)

  return (
    <section
      aria-label="Frequently asked questions"
      style={{
        background: 'var(--bg)',
        padding: 'var(--space-5xl) var(--space-2xl)',
      }}
    >
      <div style={{ maxWidth: '800px', margin: '0 auto' }}>
        <div
          style={{
            height: '1px',
            background: 'var(--gold)',
            width: '32px',
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
            marginBottom: 'var(--space-4xl)',
          }}
        >
          Common Questions
        </h2>

        <dl>
          {faqs.map((faq, i) => {
            const isOpen = open === i
            return (
              <div
                key={i}
                style={{
                  borderTop: '1px solid var(--border)',
                  paddingTop: 'var(--space-xl)',
                  paddingBottom: 'var(--space-xl)',
                }}
              >
                <dt>
                  <button
                    type="button"
                    onClick={() => setOpen(isOpen ? null : i)}
                    aria-expanded={isOpen}
                    style={{
                      all: 'unset',
                      display: 'flex',
                      justifyContent: 'space-between',
                      alignItems: 'flex-start',
                      width: '100%',
                      cursor: 'pointer',
                      gap: 'var(--space-xl)',
                    }}
                  >
                    <span
                      style={{
                        fontFamily: 'var(--font-display)',
                        fontSize: 'var(--text-2xl)',
                        color: 'var(--text)',
                        lineHeight: 1.3,
                        textAlign: 'left',
                      }}
                    >
                      {faq.q}
                    </span>
                    <span
                      aria-hidden="true"
                      style={{
                        color: 'var(--red)',
                        fontSize: 'var(--text-xl)',
                        flexShrink: 0,
                        lineHeight: 1.4,
                        transition: 'transform 0.15s ease',
                        transform: isOpen ? 'rotate(45deg)' : 'rotate(0deg)',
                        display: 'inline-block',
                      }}
                    >
                      +
                    </span>
                  </button>
                </dt>

                {isOpen && (
                  <dd
                    style={{
                      margin: 0,
                      paddingTop: 'var(--space-lg)',
                    }}
                  >
                    <p
                      style={{
                        fontFamily: 'var(--font-body)',
                        fontSize: 'var(--text-base)',
                        color: 'var(--text-muted)',
                        lineHeight: 1.75,
                        maxWidth: '680px',
                      }}
                    >
                      {faq.a}
                    </p>
                  </dd>
                )}
              </div>
            )
          })}
          <div style={{ borderTop: '1px solid var(--border)' }} aria-hidden="true" />
        </dl>
      </div>
    </section>
  )
}
