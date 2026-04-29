'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import Image from 'next/image'
import { createClient } from '@/lib/supabase/client'

export default function LoginPage() {
  const isLocalDemo = process.env.NODE_ENV !== 'production'
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)
  const router = useRouter()

  function handleDemoLogin() {
    if (!isLocalDemo) return

    document.cookie = [
      'psg_demo_auth=1',
      'Path=/',
      'Max-Age=86400',
      'SameSite=Lax',
    ].join('; ')
    router.push('/')
    router.refresh()
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setError(null)
    setLoading(true)

    const supabase = createClient()

    const { error: signInError } = await supabase.auth.signInWithPassword({
      email,
      password,
    })

    if (signInError) {
      setError(signInError.message)
      setLoading(false)
      return
    }

    // Log the login event to portal_sessions_log
    const { data: { user } } = await supabase.auth.getUser()
    if (user) {
      const { data: profile } = await supabase
        .from('portal_users')
        .select('shop_id')
        .eq('id', user.id)
        .single()

      if (profile) {
        await supabase.from('portal_sessions_log').insert({
          user_id: user.id,
          shop_id: profile.shop_id,
          action: 'login',
        })
      }
    }

    router.push('/')
    router.refresh()
  }

  return (
    <div className="min-h-screen bg-canvas flex items-center justify-center px-4">
      <div className="w-full max-w-sm">
        <div className="bg-navy rounded-t-lg px-6 py-8 text-center">
          <Image
            src="/psg-logo-dark-bg.svg"
            alt="Phoenix Solutions Group"
            width={180}
            height={48}
            priority
            className="mx-auto mb-4"
          />
          <h1 className="font-heading text-2xl font-bold text-white">
            PSG Advantage
          </h1>
          <p className="text-white/70 text-sm mt-1 font-body">
            Portal Login
          </p>
        </div>

        <div className="bg-white border border-gray-200 rounded-b-lg px-6 py-6">
          {isLocalDemo ? (
            <div className="space-y-4">
              <button
                type="button"
                onClick={handleDemoLogin}
                className="w-full bg-navy text-white rounded-lg px-4 py-2 text-sm font-medium hover:bg-navy/90 transition-colors"
              >
                Continue to dashboard
              </button>

              <p className="text-center text-xs text-iron">
                Local demo access is enabled for this development server.
              </p>
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

                <div>
                  <label htmlFor="password" className="block text-sm font-medium text-iron mb-1">
                    Password
                  </label>
                  <input
                    id="password"
                    type="password"
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    required
                    className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm text-iron focus:outline-none focus:ring-2 focus:ring-clarity focus:border-transparent"
                    placeholder="Enter your password"
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
                  {loading ? 'Signing in...' : 'Sign in'}
                </button>
              </form>

              <div className="mt-4 text-center">
                <Link
                  href="/reset-password"
                  className="text-sm text-clarity hover:underline"
                >
                  Forgot password?
                </Link>
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  )
}
