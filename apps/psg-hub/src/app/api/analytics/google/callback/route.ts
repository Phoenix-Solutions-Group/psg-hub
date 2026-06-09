import { createClient } from "@/lib/supabase/server";
import {
  peekState,
  stashPendingSelection,
  exchangeCodeForTokens,
  StateError,
  type PendingAccount,
} from "@/lib/google-oauth/state";
import { encryptRefreshToken } from "@/lib/google-oauth/crypto";
import { listGa4Properties } from "@/lib/google-oauth/ga4-enumerate";
import { listGscSites } from "@/lib/google-oauth/gsc-enumerate";

// Node runtime: constructs the gax (GA4 Admin) + googleapis (GSC) clients during
// enumeration; serverExternalPackages keeps the native deps unbundled.
export const runtime = "nodejs";

function esc(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

// utf-8 charset (10-04 fix: mojibake on curly-apostrophe display names).
function page(body: string, status: number): Response {
  return new Response(
    `<!doctype html><html><head><title>Google Analytics &amp; Search Console</title><meta name="viewport" content="width=device-width,initial-scale=1"></head><body style="font-family:system-ui;padding:2rem;max-width:34rem;margin:0 auto;line-height:1.5;">${body}</body></html>`,
    { status, headers: { "content-type": "text/html; charset=utf-8" } }
  );
}

function errorHtml(message: string, status = 400): Response {
  return page(
    `<h1>Authorization failed</h1><p>${esc(message)}</p><p>Close this tab and try again from the analytics page.</p>`,
    status
  );
}

/** A radio group for one source. Empty list -> an informational note + an empty
 *  hidden default so the source is simply skipped. */
function group(
  field: string,
  title: string,
  emptyNote: string,
  accounts: PendingAccount[],
  errorNote: string | null
): string {
  if (accounts.length === 0) {
    const note = errorNote ? `${emptyNote} (${errorNote})` : emptyNote;
    return `<fieldset style="border:1px solid #d4d4d4;border-radius:.5rem;padding:.75rem 1rem;margin-bottom:1rem;"><legend style="font-weight:600;padding:0 .35rem;">${esc(
      title
    )}</legend><p style="color:#707070;margin:.25rem 0;">${esc(note)}</p></fieldset>`;
  }
  const options = accounts
    .map(
      (a, i) =>
        `<label style="display:block;padding:.5rem .6rem;border:1px solid #e4e4e4;border-radius:.4rem;margin-bottom:.4rem;cursor:pointer;"><input type="radio" name="${field}" value="${esc(
          a.id
        )}"${i === 0 ? " checked" : ""} style="margin-right:.5rem;">${esc(
          a.name
        )} <span style="color:#707070;">${esc(a.id)}</span></label>`
    )
    .join("");
  const skip = `<label style="display:block;padding:.5rem .6rem;color:#707070;cursor:pointer;"><input type="radio" name="${field}" value="" style="margin-right:.5rem;">Don&rsquo;t link a ${esc(
    title.toLowerCase()
  )}</label>`;
  return `<fieldset style="border:1px solid #d4d4d4;border-radius:.5rem;padding:.75rem 1rem;margin-bottom:1rem;"><legend style="font-weight:600;padding:0 .35rem;">${esc(
    title
  )}</legend>${options}${skip}</fieldset>`;
}

function pickerHtml(
  stateToken: string,
  ga4: PendingAccount[],
  gsc: PendingAccount[],
  ga4Error: string | null,
  gscError: string | null
): Response {
  return page(
    `<h1>Choose what to connect</h1>
     <p>Your Google account is authorized. Pick a Google Analytics property and a Search Console site to link to this shop. You can connect either or both.</p>
     <form method="POST" action="/api/analytics/google/select">
       <input type="hidden" name="state" value="${esc(stateToken)}">
       ${group("ga4_id", "Google Analytics property", "No Google Analytics properties found for this Google account.", ga4, ga4Error)}
       ${group("gsc_id", "Search Console site", "No Search Console sites found for this Google account.", gsc, gscError)}
       <button type="submit" style="margin-top:.25rem;padding:.6rem 1.1rem;border:0;border-radius:.5rem;background:#0b1f3a;color:#fff;font-weight:600;cursor:pointer;">Connect selected</button>
     </form>`,
    200
  );
}

export async function GET(request: Request) {
  const url = new URL(request.url);
  const code = url.searchParams.get("code");
  const state = url.searchParams.get("state");
  const googleError = url.searchParams.get("error");

  if (googleError) return errorHtml(`Google returned: ${googleError}`);
  if (!code || !state) return errorHtml("Missing code or state parameter");

  // Verify state WITHOUT consuming — the picker leaves it open for /select.
  let stateUser: string;
  try {
    const peeked = await peekState(state);
    stateUser = peeked.userId;
  } catch (err) {
    if (err instanceof StateError) {
      return errorHtml(`Invalid authorization state: ${err.code}`);
    }
    return errorHtml("Authorization state validation failed");
  }

  // Bind to the authenticated session.
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return errorHtml("Not signed in");
  if (user.id !== stateUser) {
    return page(
      `<h1>Authorization rejected</h1><p>User mismatch. Sign in as the user who initiated the authorization and try again.</p>`,
      403
    );
  }

  const redirectUri = process.env.GOOGLE_ANALYTICS_OAUTH_REDIRECT_URI;
  if (!redirectUri) {
    return errorHtml("Server missing GOOGLE_ANALYTICS_OAUTH_REDIRECT_URI", 500);
  }

  // Exchange code -> tokens. redirectUri MUST match the authorize-time value.
  let tokens;
  try {
    tokens = await exchangeCodeForTokens(code, redirectUri);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return errorHtml(`Token exchange failed: ${msg.slice(0, 120)}`);
  }

  // Enumerate BOTH sources independently — one source failing (e.g. the GA4
  // Admin API not enabled) should not block linking the other.
  let ga4: PendingAccount[] = [];
  let gsc: PendingAccount[] = [];
  let ga4Error: string | null = null;
  let gscError: string | null = null;
  try {
    ga4 = (await listGa4Properties(tokens.refresh_token)).map((p) => ({
      id: p.id,
      name: p.account ? `${p.name} — ${p.account}` : p.name,
    }));
  } catch (err) {
    ga4Error = err instanceof Error ? err.message.slice(0, 100) : "lookup failed";
  }
  try {
    gsc = (await listGscSites(tokens.refresh_token)).map((s) => ({
      id: s.id,
      name: s.name,
    }));
  } catch (err) {
    gscError = err instanceof Error ? err.message.slice(0, 100) : "lookup failed";
  }

  if (ga4.length === 0 && gsc.length === 0) {
    const reasons = [ga4Error && `GA4: ${ga4Error}`, gscError && `GSC: ${gscError}`]
      .filter(Boolean)
      .join("; ");
    return errorHtml(
      `This Google account has no Google Analytics properties or Search Console sites available.${
        reasons ? ` (${reasons})` : ""
      }`
    );
  }

  // Encrypt the refresh token ONCE and stash it + both offered lists on the
  // unconsumed state row for /select. bytea is stored `\x<hex>` (10-01 trap).
  const { ciphertext, keyVersion } = encryptRefreshToken(tokens.refresh_token);
  try {
    await stashPendingSelection(state, {
      encryptedTokenHex: `\\x${ciphertext.toString("hex")}`,
      keyVersion,
      scope: tokens.scope,
      accounts: { ga4, gsc },
    });
  } catch {
    return errorHtml("Authorization state already used. Try again.");
  }

  return pickerHtml(state, ga4, gsc, ga4Error, gscError);
}
