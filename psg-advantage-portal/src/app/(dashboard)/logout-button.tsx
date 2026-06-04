'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { createClient } from '@/lib/supabase/client'
import { Button } from '@/components/ui'

export default function LogoutButton() {
  const router = useRouter()
  const [confirming, setConfirming] = useState(false)
  const [loading, setLoading] = useState(false)

  async function handleLogout() {
    setLoading(true)
    const supabase = createClient()
    await supabase.auth.signOut()
    document.cookie = 'psg_demo_auth=; Path=/; Max-Age=0; SameSite=Lax'
    router.push('/login')
    router.refresh()
  }

  if (confirming) {
    return (
      <div className="flex items-center gap-2">
        <span className="font-heading text-xs text-slate">Sign out?</span>
        <Button
          type="button"
          variant="primary"
          size="sm"
          onClick={handleLogout}
          disabled={loading}
        >
          {loading ? 'Signing out…' : 'Yes'}
        </Button>
        <Button
          type="button"
          variant="secondary"
          size="sm"
          onClick={() => setConfirming(false)}
          disabled={loading}
        >
          Cancel
        </Button>
      </div>
    )
  }

  return (
    <Button
      type="button"
      variant="secondary"
      size="sm"
      onClick={() => setConfirming(true)}
    >
      Sign out
    </Button>
  )
}
