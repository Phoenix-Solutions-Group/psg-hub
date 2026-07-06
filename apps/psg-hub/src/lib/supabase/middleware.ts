import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";

/**
 * Routes that require an authenticated user. Kept in sync with the redirect
 * rules below so the fail-open (missing-env) branch gates identically to the
 * normal branch.
 */
function isProtectedPath(pathname: string) {
  return pathname.startsWith("/dashboard");
}

/**
 * Redirect an unauthenticated request to /login (used by both the normal and
 * the missing-env branches so protected routes gate the same way).
 */
function redirectToLogin(request: NextRequest) {
  const url = request.nextUrl.clone();
  url.pathname = "/login";
  return NextResponse.redirect(url);
}

export async function updateSession(request: NextRequest) {
  let supabaseResponse = NextResponse.next({ request });

  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

  // Fail-open: Supabase env is configured Production-only in Vercel, so on
  // Preview (and any env missing these) the vars are absent. Rather than let
  // the non-null assertions throw and crash the middleware for EVERY route
  // (MIDDLEWARE_INVOCATION_FAILED -> whole deploy 500s), skip the session
  // refresh that needs Supabase and continue.
  //
  // This is NOT an auth bypass: with no Supabase we cannot mint or verify a
  // session, so we treat the request as unauthenticated and keep the SAME gate
  // — protected routes still redirect to /login. Public routes get a 200,
  // which is what makes preview QA possible.
  if (!supabaseUrl || !supabaseAnonKey) {
    const { pathname } = request.nextUrl;
    if (isProtectedPath(pathname)) {
      return redirectToLogin(request);
    }
    return supabaseResponse;
  }

  const supabase = createServerClient(supabaseUrl, supabaseAnonKey, {
    cookies: {
      getAll() {
        return request.cookies.getAll();
      },
      setAll(cookiesToSet) {
        cookiesToSet.forEach(({ name, value, options }) =>
          request.cookies.set(name, value)
        );
        supabaseResponse = NextResponse.next({ request });
        cookiesToSet.forEach(({ name, value, options }) =>
          supabaseResponse.cookies.set(name, value, options)
        );
      },
    },
  });

  const {
    data: { user },
  } = await supabase.auth.getUser();

  const { pathname } = request.nextUrl;

  // Redirect unauthenticated users away from dashboard
  if (!user && isProtectedPath(pathname)) {
    return redirectToLogin(request);
  }

  // Redirect authenticated users away from auth pages
  if (user && (pathname === "/login" || pathname === "/signup")) {
    const url = request.nextUrl.clone();
    url.pathname = "/dashboard";
    return NextResponse.redirect(url);
  }

  return supabaseResponse;
}
