import { cookies } from 'next/headers'
import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import { hasDemoAuthCookie } from '@/lib/demoAuth'
import CustomerGeographyDashboard from '@/components/charts/CustomerGeographyDashboard'

export default async function CustomerGeographyPage() {
  const cookieStore = await cookies()
  const demoAuth = hasDemoAuthCookie(cookieStore.get('psg_demo_auth')?.value)

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

  return <CustomerGeographyDashboard />
}
