import { createClient } from '@/lib/supabase/server'
import { redirect } from 'next/navigation'
import { cookies } from 'next/headers'
import Image from 'next/image'
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
    <div className="min-h-screen bg-paper font-body text-graphite">
      <header className="sticky top-0 z-20 border-b border-stone bg-paper/95 backdrop-blur-sm">
        <div className="mx-auto max-w-[1320px] px-4 sm:px-6 lg:px-8">
          <div className="flex min-h-16 flex-col gap-4 py-4 lg:flex-row lg:items-center lg:justify-between">
            <div className="flex items-center gap-4">
              <Image
                src="/brand/assets/psg-logo-primary.svg"
                alt="Phoenix Solutions Group"
                width={202}
                height={52}
                priority
                className="h-auto w-44"
              />
              <div className="hidden h-8 w-px bg-stone md:block" />
              <div className="hidden md:block">
                <p className="font-heading text-sm font-medium text-navy">
                  Advantage Portal
                </p>
                <p className="mt-0.5 text-xs text-mist">
                  Strategic insight. Operational execution.
                </p>
              </div>
            </div>
            <div className="flex items-center justify-between gap-4 lg:justify-end">
              <span className="max-w-[220px] truncate border border-stone bg-white px-3 py-1.5 text-xs text-slate">
                {userEmail}
              </span>
              <LogoutButton />
            </div>
          </div>
          <DashboardNav role={role} shopId={shopId} />
        </div>
      </header>
      <main className="mx-auto max-w-[1320px] px-4 py-8 sm:px-6 lg:px-8 lg:py-10">
        {children}
      </main>
    </div>
  )
}
