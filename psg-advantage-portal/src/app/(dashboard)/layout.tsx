import { createClient } from '@/lib/supabase/server'
import { redirect } from 'next/navigation'
import { cookies } from 'next/headers'
import LogoutButton from './logout-button'
import DashboardNav from './dashboard-nav'

export default async function DashboardLayout({
  children,
}: {
  children: React.ReactNode
}) {
  const cookieStore = await cookies()
  const demoAuth =
    process.env.NODE_ENV !== 'production' &&
    cookieStore.get('psg_demo_auth')?.value === '1'

  let userEmail = 'demo@psg.local'
  let role: 'psg_admin' | 'shop_owner' | 'read_only' = 'psg_admin'
  let shopId: string | null = null

  if (!demoAuth) {
    const supabase = await createClient()
    const { data: { user } } = await supabase.auth.getUser()

    if (!user) {
      redirect('/login')
    }

    userEmail = user.email || userEmail

    // Fetch profile for role-aware navigation
    const { data: profile } = await supabase
      .from('portal_users')
      .select('role, shop_id, full_name')
      .eq('id', user.id)
      .single()

    role = (profile?.role as 'psg_admin' | 'shop_owner' | 'read_only') || 'read_only'
    shopId = profile?.shop_id || null
  }

  return (
    <div className="min-h-screen bg-canvas">
      <header className="bg-navy border-b border-navy/20">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="flex items-center justify-between h-14">
            <h1 className="font-heading text-lg font-bold text-white">
              PSG Advantage Portal
            </h1>
            <div className="flex items-center gap-4">
              <span className="text-sm text-white/70 font-body">
                {userEmail}
              </span>
              <LogoutButton />
            </div>
          </div>
          <DashboardNav role={role} shopId={shopId} />
        </div>
      </header>
      <main className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-6">
        {children}
      </main>
    </div>
  )
}
