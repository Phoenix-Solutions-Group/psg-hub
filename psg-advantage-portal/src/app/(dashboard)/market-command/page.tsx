import { cookies } from 'next/headers'
import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import MarketCommandDashboard from '@/components/charts/MarketCommandDashboard'
import { marketDashboardFallbackData } from '@/lib/marketDashboardFallback'

export default async function MarketCommandPage() {
  const cookieStore = await cookies()
  const demoAuth =
    process.env.NODE_ENV !== 'production' &&
    cookieStore.get('psg_demo_auth')?.value === '1'

  if (!demoAuth) {
    const supabase = await createClient()
    const { data: { user } } = await supabase.auth.getUser()

    if (!user) {
      redirect('/login')
    }

    const { data: profile } = await supabase
      .from('portal_users')
      .select('role')
      .eq('id', user.id)
      .single()

    if (profile?.role !== 'psg_admin') {
      redirect('/')
    }
  }

  return <MarketCommandDashboard initialData={marketDashboardFallbackData} />
}
