'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { createClient } from '@/lib/supabase/client'
import PsgAuthFrame from '@/components/auth/PsgAuthFrame'

export default function UpdatePasswordPage() {
  const [password, setPassword] = useState('')
  const [confirmPassword, setConfirmPassword] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)
  const router = useRouter()

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setError(null)

    if (password !== confirmPassword) {
      setError('Passwords do not match.')
      return
    }

    if (password.length < 8) {
      setError('Password must be at least 8 characters.')
      return
    }

    setLoading(true)

    const supabase = createClient()
    const { error: updateError } = await supabase.auth.updateUser({
      password,
    })

    if (updateError) {
      setError(updateError.message)
      setLoading(false)
      return
    }

    router.push('/login?message=password_updated')
  }

  return (
    <PsgAuthFrame
      eyebrow="Password reset"
      title="Choose your new password."
      description="Create a new password for your PSG Advantage account. Once updated, you will return to the portal login."
      asideTitle="Protected access for market intelligence."
      asideBody="Use at least eight characters. A longer phrase with numbers or symbols is stronger."
    >
      <div>
        <p className="font-heading text-[11px] font-medium uppercase text-phoenix-red">
          New credentials
        </p>
        <h2 className="mt-4 font-heading text-2xl font-light text-navy">
          Set a secure password.
        </h2>
      </div>

      <form onSubmit={handleSubmit} className="mt-8 space-y-5">
        <div>
          <label htmlFor="password" className="block font-heading text-xs font-medium uppercase text-slate">
            New password
          </label>
          <input
            id="password"
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            required
            minLength={8}
            className="mt-2 w-full border border-stone bg-paper px-3.5 py-3 text-base text-iron shadow-[inset_0_1px_2px_rgba(22,21,20,0.05)] transition-all duration-[220ms] ease-[cubic-bezier(0.22,0.61,0.36,1)] placeholder:text-mist focus:border-phoenix-red focus:bg-white focus:outline-none focus:ring-2 focus:ring-phoenix-red focus:ring-offset-2 focus:ring-offset-white"
            placeholder="At least 8 characters"
          />
        </div>

        <div>
          <label htmlFor="confirmPassword" className="block font-heading text-xs font-medium uppercase text-slate">
            Confirm password
          </label>
          <input
            id="confirmPassword"
            type="password"
            value={confirmPassword}
            onChange={(e) => setConfirmPassword(e.target.value)}
            required
            className="mt-2 w-full border border-stone bg-paper px-3.5 py-3 text-base text-iron shadow-[inset_0_1px_2px_rgba(22,21,20,0.05)] transition-all duration-[220ms] ease-[cubic-bezier(0.22,0.61,0.36,1)] placeholder:text-mist focus:border-phoenix-red focus:bg-white focus:outline-none focus:ring-2 focus:ring-phoenix-red focus:ring-offset-2 focus:ring-offset-white"
            placeholder="Repeat your password"
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
          {loading ? 'Updating password.' : 'Update password'}
        </button>
      </form>
    </PsgAuthFrame>
  )
}
