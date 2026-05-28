'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import { createClient } from '@/lib/supabase/client'
import PsgAuthFrame from '@/components/auth/PsgAuthFrame'
import { Button, Input } from '@/components/ui'

export default function LoginPageClient({
  isLocalDemo,
}: {
  isLocalDemo: boolean
}) {
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
    <PsgAuthFrame
      eyebrow="PSG Advantage"
      title="Market intelligence for collision repair."
      description="Sign in to view customer geography, storm and crash demand signals, shop-level performance, and market opportunity data."
      asideTitle="Built for operators who need signal, not noise."
      asideBody="The portal connects PSG customer insight with repair-demand data so your team can act with precision."
    >
      {isLocalDemo ? (
        <div>
          <p className="font-heading text-[11px] font-medium uppercase text-phoenix-red">
            Local demo
          </p>
          <h2 className="mt-4 font-heading text-2xl font-light text-navy">
            Continue to the dashboard.
          </h2>
          <p className="mt-4 text-sm leading-[1.65] text-iron/75">
            Local demo access is enabled for this server.
          </p>
          <Button
            type="button"
            variant="primary"
            size="lg"
            onClick={handleDemoLogin}
            className="mt-8 w-full"
          >
            Continue to dashboard
          </Button>
        </div>
      ) : (
        <>
          <div>
            <p className="font-heading text-[11px] font-medium uppercase text-phoenix-red">
              Portal login
            </p>
            <h2 className="mt-4 font-heading text-2xl font-light text-navy">
              Access your dashboard.
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

            <Input
              id="password"
              name="password"
              type="password"
              label="Password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              required
              placeholder="Enter your password"
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
              {loading ? 'Signing in…' : 'Sign in'}
            </Button>
          </form>

          <div className="mt-6 border-t border-stone pt-5 text-center">
            <Link
              href="/reset-password"
              className="font-heading text-sm font-medium text-slate underline decoration-stone underline-offset-4 transition-colors duration-[220ms] ease-[cubic-bezier(0.22,0.61,0.36,1)] hover:text-phoenix-red hover:decoration-phoenix-red"
            >
              Forgot password?
            </Link>
          </div>
        </>
      )}
    </PsgAuthFrame>
  )
}
