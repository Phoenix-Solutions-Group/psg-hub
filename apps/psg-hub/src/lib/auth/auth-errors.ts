/**
 * Translate raw Supabase auth errors into plain, recoverable sentences a
 * non-technical shop owner can act on (BSM launch blocker B1 / T5, PSG-766).
 *
 * Supabase surfaces auth failures as opaque strings ("Invalid login
 * credentials", "Email not confirmed", ...) and, on newer versions, a stable
 * `code`. Showing those raw is a dead end: the owner reads a system string and
 * gives up. We map every known failure to a sentence that says what happened
 * AND what to do next, and fall back to a friendly, non-scary default for
 * anything we haven't catalogued yet.
 */

/** Minimal shape we read off a Supabase `AuthError` (or a thrown network error). */
export interface AuthErrorLike {
  message?: string | null;
  /** Stable Supabase error code, when present (e.g. "invalid_credentials"). */
  code?: string | null;
  /** HTTP status, when present. */
  status?: number | null;
  /** Some transport errors carry `name` instead of a useful message. */
  name?: string | null;
}

/**
 * Map a Supabase auth error to a plain, recoverable sentence.
 *
 * Matching is done on the stable `code` first (future-proof), then on
 * lower-cased message substrings (what older Supabase versions give us), then
 * a safe generic fallback. Never returns a raw system string.
 */
export function friendlyAuthError(error: AuthErrorLike | null | undefined): string {
  if (!error) {
    return GENERIC;
  }

  const code = (error.code ?? "").toLowerCase();
  const message = (error.message ?? "").toLowerCase();
  const status = error.status ?? undefined;

  // Network / transport failures surface as a TypeError "Failed to fetch"
  // (or an AuthRetryableFetchError) with no useful code. Treat these first so
  // a flaky connection never looks like a credentials problem.
  if (
    message.includes("failed to fetch") ||
    message.includes("networkerror") ||
    message.includes("network request failed") ||
    (error.name ?? "").toLowerCase().includes("authretryablefetcherror") ||
    status === 0
  ) {
    return "We couldn't reach the server. Check your internet connection and try again.";
  }

  // Wrong email/password.
  if (
    code === "invalid_credentials" ||
    code === "invalid_grant" ||
    message.includes("invalid login credentials") ||
    message.includes("invalid credentials")
  ) {
    return "That email and password don't match. Double-check them and try again, or use “Forgot password?” below to reset it.";
  }

  // Account exists but the email hasn't been confirmed yet.
  if (code === "email_not_confirmed" || message.includes("email not confirmed")) {
    return "Please confirm your email first. Open the confirmation link we sent to your inbox, then sign in.";
  }

  // Signing up with an email that already has an account.
  if (
    code === "user_already_exists" ||
    code === "email_exists" ||
    message.includes("already registered") ||
    message.includes("already been registered") ||
    message.includes("user already exists")
  ) {
    return "An account with this email already exists. Try signing in instead, or reset your password if you've forgotten it.";
  }

  // Too many attempts / rate limited.
  if (
    code === "over_request_rate_limit" ||
    code === "over_email_send_rate_limit" ||
    status === 429 ||
    message.includes("rate limit") ||
    message.includes("too many requests")
  ) {
    return "Too many attempts in a short time. Please wait about a minute, then try again.";
  }

  // Password too weak / too short (server-side rule).
  if (
    code === "weak_password" ||
    message.includes("password should be") ||
    message.includes("password is too weak") ||
    message.includes("weak password")
  ) {
    return "That password is too weak. Please use at least 8 characters with a mix of letters and numbers.";
  }

  // Malformed / unaccepted email address.
  if (
    code === "email_address_invalid" ||
    code === "validation_failed" ||
    message.includes("unable to validate email") ||
    message.includes("invalid email") ||
    message.includes("email address") && message.includes("invalid")
  ) {
    return "That email address doesn't look right. Please check it and try again.";
  }

  // Expired or already-used confirmation / recovery link.
  if (
    code === "otp_expired" ||
    code === "flow_state_expired" ||
    message.includes("token has expired") ||
    message.includes("expired") ||
    message.includes("invalid flow state")
  ) {
    return "That link has expired or was already used. Please request a new one and try again.";
  }

  // Signups disabled at the project level.
  if (code === "signup_disabled" || message.includes("signups not allowed")) {
    return "New sign-ups are paused right now. Please contact your Phoenix Solutions Group rep for access.";
  }

  return GENERIC;
}

const GENERIC =
  "Something went wrong on our end. Please try again in a moment — if it keeps happening, contact your Phoenix Solutions Group rep.";
