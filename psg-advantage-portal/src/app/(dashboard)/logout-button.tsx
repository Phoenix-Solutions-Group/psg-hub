'use client'

import { useRouter } from 'next/navigation'
import { createClient } from '@/lib/supabase/client'

export default function LogoutButton() {
  const router = useRouter()

  async function handleLogout() {
    const supabase = createClient()
    await supabase.auth.signOut()
    document.cookie = 'psg_demo_auth=; Path=/; Max-Age=0; SameSite=Lax'
    router.push('/login')
    router.refresh()
  }

  return (
    <button
      onClick={handleLogout}
      className="border border-stone bg-white px-3 py-1.5 font-heading text-xs font-medium text-slate transition-colors duration-[220ms] ease-[cubic-bezier(0.22,0.61,0.36,1)] hover:border-phoenix-red hover:text-phoenix-red"
    >
      Sign out
    </button>
  )
}
