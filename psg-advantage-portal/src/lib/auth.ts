import { createClient } from '@/lib/supabase/server'
import { cookies } from 'next/headers'
import { NextResponse, type NextRequest } from 'next/server'
import type { AuthProfile } from '@/types'

export type { AuthProfile }

/**
 * Get the authenticated user profile from Supabase session + portal_users.
 * Returns AuthProfile on success, or a NextResponse (401/403) on failure.
 * Use in API routes: const result = await getAuthenticatedProfile()
 */
function getDemoProfile(): AuthProfile {
  return {
    userId: 'demo-user',
    email: 'demo@psg.local',
    shopId: '',
    role: 'psg_admin',
  }
}

async function hasDemoAuth(request?: NextRequest) {
  if (process.env.NODE_ENV === 'production') {
    return false
  }

  if (request) {
    return request.cookies.get('psg_demo_auth')?.value === '1'
  }

  try {
    const cookieStore = await cookies()
    return cookieStore.get('psg_demo_auth')?.value === '1'
  } catch {
    return false
  }
}

export async function getAuthenticatedProfile(
  request?: NextRequest
): Promise<AuthProfile | NextResponse> {
  const demoAuth = await hasDemoAuth(request)

  if (demoAuth) {
    return getDemoProfile()
  }

  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()

  if (!user) {
    return NextResponse.json(
      { error: { code: 'UNAUTHORIZED', message: 'Not authenticated' } },
      { status: 401 }
    )
  }

  const { data: profile } = await supabase
    .from('portal_users')
    .select('shop_id, role, email')
    .eq('id', user.id)
    .single()

  if (!profile) {
    return NextResponse.json(
      { error: { code: 'FORBIDDEN', message: 'No profile found' } },
      { status: 403 }
    )
  }

  return {
    userId: user.id,
    email: profile.email,
    shopId: profile.shop_id,
    role: profile.role as AuthProfile['role'],
  }
}

/**
 * Check if the profile has admin privileges.
 */
export function isAdmin(profile: AuthProfile): boolean {
  return profile.role === 'psg_admin'
}

/**
 * Check if the profile can access a given shop.
 * Admins can access all shops; shop owners can only access their own.
 */
export function canAccessShop(profile: AuthProfile, shopName: string): boolean {
  return profile.role === 'psg_admin' || profile.shopId === shopName
}
