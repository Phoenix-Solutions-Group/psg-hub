'use client'

import { useState } from 'react'
import Link from 'next/link'
import { createClient } from '@/lib/supabase/client'

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
    <div className="min-h-screen bg-canvas flex items-center justify-center px-4">
      <div className="w-full max-w-sm">
        <div className="bg-navy rounded-t-lg px-6 py-8 text-center">
          <h1 className="font-heading text-2xl font-bold text-white">
            Reset Password
          </h1>
          <p className="text-white/70 text-sm mt-1 font-body">
            Enter your email to receive a reset link
          </p>
        </div>

        <div className="bg-white border border-gray-200 rounded-b-lg px-6 py-6">
          {success ? (
            <div className="text-center space-y-3">
              <p className="text-sm text-iron">
                Check your email for a password reset link.
              </p>
              <Link
                href="/login"
                className="inline-block text-sm text-clarity hover:underline"
              >
                Back to login
              </Link>
            </div>
          ) : (
            <>
              <form onSubmit={handleSubmit} className="space-y-4">
                <div>
                  <label htmlFor="email" className="block text-sm font-medium text-iron mb-1">
                    Email
                  </label>
                  <input
                    id="email"
                    type="email"
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    required
                    className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm text-iron focus:outline-none focus:ring-2 focus:ring-clarity focus:border-transparent"
                    placeholder="you@company.com"
                  />
                </div>

                {error && (
                  <p className="text-sm text-phoenix-red">{error}</p>
                )}

                <button
                  type="submit"
                  disabled={loading}
                  className="w-full bg-navy text-white rounded-lg px-4 py-2 text-sm font-medium hover:bg-navy/90 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
                >
                  {loading ? 'Sending...' : 'Send reset link'}
                </button>
              </form>

              <div className="mt-4 text-center">
                <Link
                  href="/login"
                  className="text-sm text-clarity hover:underline"
                >
                  Back to login
                </Link>
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  )
}
