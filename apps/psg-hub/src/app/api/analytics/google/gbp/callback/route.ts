import { createClient } from "@/lib/supabase/server";
import {
  peekState,
  stashPendingSelection,
  exchangeCodeForTokens,
  StateError,
} from "@/lib/google-oauth/state";
import { encryptRefreshToken } from "@/lib/google-oauth/crypto";
import {
  listGbpAccountsAndLocations,
  type GbpLocation,
} from "@/lib/google-oauth/gbp-enumerate";

// Node runtime: constructs the googleapis GBP clients during enumeration;
// serverExternalPackages keeps the native deps unbundled.
export const runtime = "nodejs";

function esc(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

// utf-8 charset (10-04 fix: mojibake on curly apostrophes / accented names).
function page(body: string, status: number): Response {
  return new Response(
    `<!doctype html><html><head><title>Google Business Profile</title><meta name="viewport" content="width=device-width,initial-scale=1"></head><body style="font-family:system-ui;padding:2rem;max-width:34rem;margin:0 auto;line-height:1.5;">${body}</body></html>`,
    { status, headers: { "content-type": "text/html; charset=utf-8" } }
  );
}

function errorHtml(message: string, status = 400): Response {
  return page(
    `<h1>Authorization failed</h1><p>${esc(message)}</p><p>Close this tab and try again from the analytics page.</p>`,
    status
  );
}

function pickerHtml(stateToken: string, locations: GbpLocation[]): Response {
  const options = locations
    .map((l, i) => {
      const addr = l.address ? ` <span style="color:#707070;">${esc(l.address)}</span>` : "";
      const badge = l.hasVoiceOfMerchant
        ? ""
        : ` <span style="color:#b8483e;font-size:.85em;">(needs verification)</span>`;
      return `<label style="display:block;padding:.5rem .6rem;border:1px solid #e4e4e4;border-radius:.4rem;margin-bottom:.4rem;cursor:pointer;"><input type="radio" name="location_id" value="${esc(
        l.id
      )}"${i === 0 ? " checked" : ""} style="margin-right:.5rem;">${esc(
        l.name
      )}${addr}${badge}</label>`;
    })
    .join("");
  return page(
    `<h1>Choose a business location</h1>
     <p>Your Google account is authorized. Pick the Google Business Profile location to link to this shop.</p>
     <form method="POST" action="/api/analytics/google/gbp/select">
       <input type="hidden" name="state" value="${esc(stateToken)}">
       <fieldset style="border:1px solid #d4d4d4;border-radius:.5rem;padding:.75rem 1rem;margin-bottom:1rem;"><legend style="font-weight:600;padding:0 .35rem;">Business locations</legend>${options}</fieldset>
       <button type="submit" style="margin-top:.25rem;padding:.6rem 1.1rem;border:0;border-radius:.5rem;background:#0b1f3a;color:#fff;font-weight:600;cursor:pointer;">Connect location</button>
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
    stateUser = (await peekState(state)).userId;
  } catch (err) {
    if (err instanceof StateError) {
      return errorHtml(`Invalid authorization state: ${err.code}`);
    }
    return errorHtml("Authorization state validation failed");
  }

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

  const redirectUri = process.env.GOOGLE_GBP_OAUTH_REDIRECT_URI;
  if (!redirectUri) {
    return errorHtml("Server missing GOOGLE_GBP_OAUTH_REDIRECT_URI", 500);
  }
  // GBP's OWN OAuth client (n8n-workspace-apis); falls back to the shared client when
  // unset. The id/secret MUST match the client used at authorize time. 14-04 deviation.
  const gbpClientId =
    process.env.GOOGLE_GBP_OAUTH_CLIENT_ID ?? process.env.GOOGLE_OAUTH_CLIENT_ID;
  const gbpClientSecret =
    process.env.GOOGLE_GBP_OAUTH_CLIENT_SECRET ??
    process.env.GOOGLE_OAUTH_CLIENT_SECRET;

  // Exchange code -> tokens. redirectUri MUST match the authorize-time value.
  let tokens;
  try {
    tokens = await exchangeCodeForTokens(
      code,
      redirectUri,
      gbpClientId,
      gbpClientSecret
    );
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return errorHtml(`Token exchange failed: ${msg.slice(0, 120)}`);
  }

  // Enumerate accounts -> locations under the fresh token.
  let locations: GbpLocation[];
  try {
    locations = await listGbpAccountsAndLocations(tokens.refresh_token);
  } catch (err) {
    const msg = err instanceof Error ? err.message.slice(0, 120) : "lookup failed";
    return errorHtml(
      `Could not read your Business Profile locations. Confirm the Google account manages a verified location and Business Profile API access is granted. (${msg})`
    );
  }

  if (locations.length === 0) {
    return errorHtml(
      "This Google account has no Business Profile locations available. Confirm it is an owner or manager on a verified location."
    );
  }

  // Encrypt the refresh token ONCE and stash it + the offered location list on the
  // unconsumed state row for /select. Each PendingAccount carries the parent
  // accounts/{id}; bytea is stored `\x<hex>` (10-01 trap). Only the GBP slot is set.
  const { ciphertext, keyVersion } = encryptRefreshToken(tokens.refresh_token);
  try {
    await stashPendingSelection(state, {
      encryptedTokenHex: `\\x${ciphertext.toString("hex")}`,
      keyVersion,
      scope: tokens.scope,
      accounts: {
        ga4: [],
        gsc: [],
        gbp: locations.map((l) => ({ id: l.id, name: l.name, parent: l.parent })),
      },
    });
  } catch {
    return errorHtml("Authorization state already used. Try again.");
  }

  return pickerHtml(state, locations);
}
