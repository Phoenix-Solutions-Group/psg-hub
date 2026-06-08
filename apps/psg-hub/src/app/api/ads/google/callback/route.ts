import { createClient } from "@/lib/supabase/server";
import { createServiceClient } from "@/lib/supabase/service";
import {
  verifyAndConsumeState,
  exchangeCodeForTokens,
  StateError,
} from "@/lib/google-ads/oauth";
import { encryptRefreshToken } from "@/lib/google-ads/crypto";

function errorHtml(message: string): Response {
  const safe = message.replace(/</g, "&lt;").replace(/>/g, "&gt;");
  return new Response(
    `<!doctype html><html><head><title>Google Ads authorization</title></head><body style="font-family:system-ui;padding:2rem;"><h1>Authorization failed</h1><p>${safe}</p><p>Close this tab and try again from the shop settings.</p></body></html>`,
    { status: 400, headers: { "content-type": "text/html" } }
  );
}

async function fetchAccessibleCustomers(
  accessToken: string,
  developerToken: string,
  loginCustomerId: string | null
): Promise<string[]> {
  const headers: Record<string, string> = {
    Authorization: `Bearer ${accessToken}`,
    "developer-token": developerToken,
  };
  if (loginCustomerId) headers["login-customer-id"] = loginCustomerId;

  const res = await fetch(
    "https://googleads.googleapis.com/v20/customers:listAccessibleCustomers",
    { headers }
  );

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`listAccessibleCustomers ${res.status}: ${text.slice(0, 200)}`);
  }

  const data = (await res.json()) as { resourceNames?: string[] };
  return (data.resourceNames ?? []).map((rn) => rn.replace(/^customers\//, ""));
}

export async function GET(request: Request) {
  const url = new URL(request.url);
  const code = url.searchParams.get("code");
  const state = url.searchParams.get("state");
  const googleError = url.searchParams.get("error");

  if (googleError) {
    return errorHtml(`Google returned: ${googleError}`);
  }
  if (!code || !state) {
    return errorHtml("Missing code or state parameter");
  }

  // Verify + consume state (blocks replay, bad HMAC, expired)
  let stateUser: string;
  let stateShop: string;
  try {
    const consumed = await verifyAndConsumeState(state);
    stateUser = consumed.userId;
    stateShop = consumed.shopId;
  } catch (err) {
    if (err instanceof StateError) {
      return errorHtml(`Invalid authorization state: ${err.code}`);
    }
    return errorHtml("Authorization state validation failed");
  }

  // Bind to authenticated session — user completing callback must match state.userId
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return errorHtml("Not signed in");
  }
  if (user.id !== stateUser) {
    return new Response(
      `<!doctype html><html><body style="font-family:system-ui;padding:2rem;"><h1>Authorization rejected</h1><p>User mismatch. Sign in as the user who initiated the authorization and try again.</p></body></html>`,
      { status: 403, headers: { "content-type": "text/html" } }
    );
  }

  // Exchange code → tokens
  let tokens;
  try {
    tokens = await exchangeCodeForTokens(code);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return errorHtml(`Token exchange failed: ${msg.slice(0, 120)}`);
  }

  const developerToken = process.env.GOOGLE_ADS_DEVELOPER_TOKEN;
  if (!developerToken) {
    return errorHtml("Server missing GOOGLE_ADS_DEVELOPER_TOKEN");
  }
  const loginCustomerId =
    process.env.GOOGLE_ADS_LOGIN_CUSTOMER_ID ?? null;

  // List accessible customers
  let customers: string[];
  try {
    customers = await fetchAccessibleCustomers(
      tokens.access_token,
      developerToken,
      loginCustomerId
    );
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return errorHtml(`Could not fetch customers: ${msg.slice(0, 120)}`);
  }

  if (customers.length === 0) {
    return errorHtml(
      "This Google account has no accessible Google Ads customer. Create one first."
    );
  }
  if (customers.length > 1) {
    return errorHtml(
      "This Google account has access to multiple Google Ads customers. PSG supports a single-customer link only in this release."
    );
  }
  const customerId = customers[0];

  // Encrypt + upsert (UPSERT allows reconnect after revoke)
  const { ciphertext, keyVersion } = encryptRefreshToken(tokens.refresh_token);
  const service = createServiceClient();

  const { error: upErr } = await service.from("google_ads_accounts").upsert(
    {
      shop_id: stateShop,
      customer_id: customerId,
      login_customer_id: loginCustomerId,
      // bytea over PostgREST: a raw Node Buffer JSON-serializes to
      // {"type":"Buffer","data":[...]} and is stored as that literal string, NOT
      // the bytes (10-01 finding — the blind-built code never ran against a real
      // DB). Send the Postgres `\x<hex>` bytea text form; client.ts decodes it.
      encrypted_refresh_token: `\\x${ciphertext.toString("hex")}`,
      key_version: keyVersion,
      scope: tokens.scope,
      status: "linked",
      linked_by: stateUser,
      linked_at: new Date().toISOString(),
      revoked_at: null,
      last_error: null,
    },
    { onConflict: "shop_id,customer_id" }
  );

  if (upErr) {
    return errorHtml(`Failed to persist account: ${upErr.message.slice(0, 120)}`);
  }

  // Log the listAccessibleCustomers call (no resource_name; this is a platform-level GET)
  await service.from("ads_api_call_log").insert({
    user_id: stateUser,
    shop_id: stateShop,
    endpoint: "customers.listAccessibleCustomers",
    method: "GET",
    result: "success",
  });

  return new Response(
    `<!doctype html><html><head><title>Google Ads linked</title></head><body style="font-family:system-ui;padding:2rem;"><h1>Google Ads linked</h1><p>Account ${customerId} is now linked. You can close this tab.</p><script>setTimeout(() => { try { window.close(); } catch (e) {} }, 1500);</script></body></html>`,
    { status: 200, headers: { "content-type": "text/html" } }
  );
}
