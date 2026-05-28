'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { createClient } from '@/lib/supabase/client'
import PsgAuthFrame from '@/components/auth/PsgAuthFrame'
import { Button, Input } from '@/components/ui'

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
        <Input
          id="password"
          name="password"
          type="password"
          label="New password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          required
          minLength={8}
          placeholder="At least 8 characters"
        />

        <Input
          id="confirmPassword"
          name="confirmPassword"
          type="password"
          label="Confirm password"
          value={confirmPassword}
          onChange={(e) => setConfirmPassword(e.target.value)}
          required
          placeholder="Repeat your password"
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
          {loading ? 'Updating password…' : 'Update password'}
        </Button>
      </form>
    </PsgAuthFrame>
  )
}
