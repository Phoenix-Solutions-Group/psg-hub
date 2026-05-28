'use client'

import { useState } from 'react'
import Link from 'next/link'
import { createClient } from '@/lib/supabase/client'
import PsgAuthFrame from '@/components/auth/PsgAuthFrame'
import { Button, Input } from '@/components/ui'

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
          <Link href="/login" className="mt-8 block">
            <Button type="button" variant="primary" size="lg" className="w-full">
              Return to login
            </Button>
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
            <Input
              id="email"
              name="email"
              type="email"
              label="Email address"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              required
              placeholder="you@company.com"
            />

            {error && (
              <p className="border-l-2 border-danger bg-danger-bg px-3 py-2 text-sm leading-[1.55] text-danger-deep">
                {error}
              </p>
            )}

            <Button
              type="submit"
              variant="primary"
              size="lg"
              disabled={loading}
              className="w-full"
            >
              {loading ? 'Sending reset link…' : 'Send reset link'}
            </Button>
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
