import { NextResponse, type NextRequest } from "next/server";
import { createClient } from "@/lib/supabase/server";

/**
 * OAuth / email-link callback (PSG-766). Both the sign-up confirmation link and
 * the password-recovery link land here with a one-time `code`. We exchange it
 * for a real session (sets the auth cookies) and then forward the owner to the
 * `next` destination — /dashboard after confirming sign-up, /reset-password
 * after a recovery link.
 *
 * If the exchange fails (expired or already-used link), we bounce to a friendly
 * screen with an `error` flag instead of dead-ending on a raw system page.
 */
export async function GET(request: NextRequest) {
  const { searchParams, origin } = request.nextUrl;
  const code = searchParams.get("code");
  const next = safeNext(searchParams.get("next"));

  if (!code) {
    // No code to exchange — likely a stale or hand-typed URL. Send them to
    // login rather than showing a blank page.
    return NextResponse.redirect(`${origin}/login?error=link`);
  }

  const supabase = await createClient();
  const { error } = await supabase.auth.exchangeCodeForSession(code);

  if (error) {
    // Recovery links fail back to "request a new one"; everything else to login.
    const target = next === "/reset-password" ? "/forgot-password" : "/login";
    return NextResponse.redirect(`${origin}${target}?error=link`);
  }

  return NextResponse.redirect(`${origin}${next}`);
}

/**
 * Only allow same-app relative redirect targets, to avoid an open-redirect via
 * the `next` param. Anything unexpected falls back to the dashboard.
 */
function safeNext(next: string | null): string {
  if (next && next.startsWith("/") && !next.startsWith("//")) {
    return next;
  }
  return "/dashboard";
}
