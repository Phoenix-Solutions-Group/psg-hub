import { createServerClient } from '@supabase/ssr'
import { NextResponse, type NextRequest } from 'next/server'

const PUBLIC_ROUTES = ['/login', '/reset-password', '/update-password', '/auth/callback']

// Only query portal_users for role-based redirect on these paths
// to avoid adding latency to every request
const ROLE_CHECK_PATHS = new Set(['/', '/shops'])
const DEMO_AUTH_COOKIE = 'psg_demo_auth'

function isDemoAuthEnabled(request: NextRequest) {
  const demoCookie = request.cookies.get?.(DEMO_AUTH_COOKIE)
    || request.cookies.getAll?.().find(({ name }) => name === DEMO_AUTH_COOKIE)

  return (
    process.env.NODE_ENV !== 'production' &&
    demoCookie?.value === '1'
  )
}

export async function middleware(request: NextRequest) {
  let supabaseResponse = NextResponse.next({
    request,
  })

  const demoAuth = isDemoAuthEnabled(request)
  if (demoAuth && request.nextUrl.pathname === '/login') {
    const url = request.nextUrl.clone()
    url.pathname = '/'
    return NextResponse.redirect(url)
  }

  if (demoAuth) {
    return supabaseResponse
  }

  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return request.cookies.getAll()
        },
        setAll(cookiesToSet) {
          cookiesToSet.forEach(({ name, value }) =>
            request.cookies.set(name, value)
          )
          supabaseResponse = NextResponse.next({
            request,
          })
          cookiesToSet.forEach(({ name, value, options }) =>
            supabaseResponse.cookies.set(name, value, options)
          )
        },
      },
    }
  )

  // Refresh the auth token on every request
  const {
    data: { user },
  } = await supabase.auth.getUser()

  const isPublicRoute = PUBLIC_ROUTES.some((route) =>
    request.nextUrl.pathname.startsWith(route)
  )

  // Redirect unauthenticated users to login
  if (!user && !isPublicRoute) {
    const url = request.nextUrl.clone()
    url.pathname = '/login'
    return NextResponse.redirect(url)
  }

  // Redirect authenticated users away from login
  if (user && request.nextUrl.pathname === '/login') {
    const url = request.nextUrl.clone()
    url.pathname = '/'
    return NextResponse.redirect(url)
  }

  // Role-based redirect: shop owners land on their own shop page
  // Only runs on specific paths to avoid latency on every request
  if (user && ROLE_CHECK_PATHS.has(request.nextUrl.pathname)) {
    const { data: profile } = await supabase
      .from('portal_users')
      .select('role, shop_id')
      .eq('id', user.id)
      .single()

    if (profile?.role === 'shop_owner' && profile.shop_id) {
      const url = request.nextUrl.clone()
      url.pathname = `/shops/${encodeURIComponent(profile.shop_id)}`
      return NextResponse.redirect(url)
    }
  }

  return supabaseResponse
}

export const config = {
  matcher: [
    '/((?!_next/static|_next/image|favicon\\.ico|api/health).*)',
  ],
}
