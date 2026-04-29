'use client'

import { useState } from 'react'
import Link from 'next/link'
import { createClient } from '@/lib/supabase/client'
import PsgAuthFrame from '@/components/auth/PsgAuthFrame'

export default function ResetPasswordPage() {
  const [email, setEmail] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [success, setSuccess] = useState(false)
  const [loading, setLoading] = useState(false)

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setError(null)
    setLoading(true)

    const supabase = createClient()

    const { error: resetError } = await supabase.auth.resetPasswordForEmail(
      email,
      {
        redirectTo: `${window.location.origin}/auth/callback?next=/update-password`,
      }
    )

    if (resetError) {
      setError(resetError.message)
      setLoading(false)
      return
    }

    setSuccess(true)
    setLoading(false)
  }

  return (
    <PsgAuthFrame
      eyebrow="Account access"
      title="Reset your portal password."
      description="Enter the email connected to your PSG Advantage account. We will send a secure reset link so you can return to the dashboard."
      asideTitle="Strategic insight. Operational execution."
      asideBody="Password resets are handled through Supabase Auth and return you directly to the PSG portal."
    >
      {success ? (
        <div>
          <p className="font-heading text-[11px] font-medium uppercase text-phoenix-red">
            Link sent
          </p>
          <h2 className="mt-4 font-heading text-2xl font-light text-navy">
            Check your inbox.
          </h2>
          <p className="mt-4 text-sm leading-[1.65] text-iron/75">
            If the email matches a portal account, a password reset link is on the way.
          </p>
          <Link
            href="/login"
            className="mt-8 inline-flex w-full items-center justify-center border border-navy bg-navy px-4 py-3 font-heading text-sm font-medium text-white transition-all duration-[220ms] ease-[cubic-bezier(0.22,0.61,0.36,1)] hover:bg-[#142838] focus:outline-none focus:ring-2 focus:ring-phoenix-red focus:ring-offset-2 focus:ring-offset-white active:translate-y-px"
          >
            Return to login
          </Link>
        </div>
      ) : (
        <>
          <div>
            <p className="font-heading text-[11px] font-medium uppercase text-phoenix-red">
              Secure reset
            </p>
            <h2 className="mt-4 font-heading text-2xl font-light text-navy">
              Send a reset link.
            </h2>
          </div>

          <form onSubmit={handleSubmit} className="mt-8 space-y-5">
            <div>
              <label htmlFor="email" className="block font-heading text-xs font-medium uppercase text-slate">
                Email address
              </label>
              <input
                id="email"
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                required
                className="mt-2 w-full border border-stone bg-paper px-3.5 py-3 text-base text-iron shadow-[inset_0_1px_2px_rgba(22,21,20,0.05)] transition-all duration-[220ms] ease-[cubic-bezier(0.22,0.61,0.36,1)] placeholder:text-mist focus:border-phoenix-red focus:bg-white focus:outline-none focus:ring-2 focus:ring-phoenix-red focus:ring-offset-2 focus:ring-offset-white"
                placeholder="you@company.com"
              />
            </div>

            {error && (
              <p className="border-l-2 border-phoenix-red bg-[#FAEEEC] px-3 py-2 text-sm leading-[1.55] text-[#8C362D]">
                {error}
              </p>
            )}

            <button
              type="submit"
              disabled={loading}
              className="w-full border border-navy bg-navy px-4 py-3 font-heading text-sm font-medium text-white transition-all duration-[220ms] ease-[cubic-bezier(0.22,0.61,0.36,1)] hover:bg-[#142838] focus:outline-none focus:ring-2 focus:ring-phoenix-red focus:ring-offset-2 focus:ring-offset-white active:translate-y-px disabled:cursor-not-allowed disabled:opacity-40"
            >
              {loading ? 'Sending reset link.' : 'Send reset link'}
            </button>
          </form>

          <div className="mt-6 border-t border-stone pt-5 text-center">
            <Link
              href="/login"
              className="font-heading text-sm font-medium text-slate underline decoration-stone underline-offset-4 transition-colors duration-[220ms] ease-[cubic-bezier(0.22,0.61,0.36,1)] hover:text-phoenix-red hover:decoration-phoenix-red"
            >
              Return to login
            </Link>
          </div>
        </>
      )}
    </PsgAuthFrame>
  )
}
