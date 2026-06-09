import { createClient } from "@/lib/supabase/server";
import { createServiceClient } from "@/lib/supabase/service";
import {
  peekState,
  verifyAndConsumeState,
  stashPendingSelection,
  exchangeCodeForTokens,
  StateError,
  type PendingAccount,
} from "@/lib/google-ads/oauth";
import { encryptRefreshToken } from "@/lib/google-ads/crypto";
import { listManagedAccounts } from "@/lib/google-ads/customers";
import { persistLinkedAccount } from "@/lib/google-ads/link";
import { AdsApiError } from "@/lib/google-ads/types";

function esc(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function page(body: string, status: number): Response {
  return new Response(
    `<!doctype html><html><head><title>Google Ads</title><meta name="viewport" content="width=device-width,initial-scale=1"></head><body style="font-family:system-ui;padding:2rem;max-width:32rem;margin:0 auto;">${body}</body></html>`,
    { status, headers: { "content-type": "text/html" } }
  );
}

function errorHtml(message: string): Response {
  return page(
    `<h1>Authorization failed</h1><p>${esc(message)}</p><p>Close this tab and try again from the shop settings.</p>`,
    400
  );
}

function successHtml(customerId: string): Response {
  return page(
    `<h1>Google Ads linked</h1><p>Account ${esc(customerId)} is now linked. You can close this tab.</p><script>try{window.opener&&window.opener.postMessage({type:"google-ads-linked"},window.location.origin)}catch(e){}setTimeout(function(){try{window.close()}catch(e){}},1500);</script>`,
    200
  );
}

function pickerHtml(stateToken: string, accounts: PendingAccount[]): Response {
  const options = accounts
    .map(
      (a, i) =>
        `<label style="display:block;padding:.6rem .75rem;border:1px solid #d4d4d4;border-radius:.5rem;margin-bottom:.5rem;cursor:pointer;"><input type="radio" name="customer_id" value="${esc(
          a.id
        )}"${i === 0 ? " checked" : ""} style="margin-right:.5rem;">${esc(
          a.name
        )} <span style="color:#707070;">(${esc(a.id)})</span></label>`
    )
    .join("");
  return page(
    `<h1>Choose a Google Ads account</h1>
     <p>Your Google login can access several accounts. Pick the one to link to this shop.</p>
     <form method="POST" action="/api/ads/google/select">
       <input type="hidden" name="state" value="${esc(stateToken)}">
       ${options}
       <button type="submit" style="margin-top:.5rem;padding:.6rem 1.1rem;border:0;border-radius:.5rem;background:#0b1f3a;color:#fff;font-weight:600;cursor:pointer;">Link selected account</button>
     </form>`,
    200
  );
}

// Fallback for non-MCC deployments (no GOOGLE_ADS_LOGIN_CUSTOMER_ID): list the
// directly-accessible customers via listAccessibleCustomers.
async function fetchAccessibleCustomers(
  accessToken: string,
  developerToken: string
): Promise<string[]> {
  const res = await fetch(
    "https://googleads.googleapis.com/v20/customers:listAccessibleCustomers",
    {
      headers: {
        Authorization: `Bearer ${accessToken}`,
        "developer-token": developerToken,
      },
    }
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

  if (googleError) return errorHtml(`Google returned: ${googleError}`);
  if (!code || !state) return errorHtml("Missing code or state parameter");

  // Verify state WITHOUT consuming — the picker path leaves it open for /select.
  let stateUser: string;
  let stateShop: string;
  try {
    const peeked = await peekState(state);
    stateUser = peeked.userId;
    stateShop = peeked.shopId;
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

  // Exchange code → tokens.
  let tokens;
  try {
    tokens = await exchangeCodeForTokens(code);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return errorHtml(`Token exchange failed: ${msg.slice(0, 120)}`);
  }

  const developerToken = process.env.GOOGLE_ADS_DEVELOPER_TOKEN;
  if (!developerToken) return errorHtml("Server missing GOOGLE_ADS_DEVELOPER_TOKEN");
  const mccId = process.env.GOOGLE_ADS_LOGIN_CUSTOMER_ID ?? null;

  // Enumerate linkable accounts. MCC → customer_client under the manager; else →
  // directly-accessible customers.
  let accounts: PendingAccount[];
  try {
    if (mccId) {
      accounts = await listManagedAccounts(tokens.refresh_token, mccId);
    } else {
      const ids = await fetchAccessibleCustomers(tokens.access_token, developerToken);
      accounts = ids.map((id) => ({ id, name: id }));
    }
  } catch (err) {
    const msg = err instanceof AdsApiError ? err.message : err instanceof Error ? err.message : String(err);
    return errorHtml(`Could not list accounts: ${msg.slice(0, 140)}`);
  }

  if (accounts.length === 0) {
    return errorHtml(
      "This Google login can't access a Google Ads client account under PSG's manager. Confirm the account has access, then try again."
    );
  }

  // Exactly one → link it directly (no picker).
  if (accounts.length === 1) {
    const { ciphertext, keyVersion } = encryptRefreshToken(tokens.refresh_token);
    let consumed: { userId: string; shopId: string };
    try {
      consumed = await verifyAndConsumeState(state);
    } catch {
      return errorHtml("Authorization state already used. Try again.");
    }
    const { error: upErr } = await persistLinkedAccount({
      shopId: consumed.shopId,
      customerId: accounts[0].id,
      loginCustomerId: mccId,
      encryptedTokenHex: `\\x${ciphertext.toString("hex")}`,
      keyVersion,
      scope: tokens.scope,
      linkedBy: consumed.userId,
    });
    if (upErr) return errorHtml(`Failed to persist account: ${upErr.slice(0, 120)}`);

    await logListCall(consumed.userId, consumed.shopId);
    return successHtml(accounts[0].id);
  }

  // Multiple → stash the encrypted token + the list, render the picker.
  const { ciphertext, keyVersion } = encryptRefreshToken(tokens.refresh_token);
  try {
    await stashPendingSelection(state, {
      encryptedTokenHex: `\\x${ciphertext.toString("hex")}`,
      keyVersion,
      scope: tokens.scope,
      loginCustomerId: mccId,
      customers: accounts,
    });
  } catch {
    return errorHtml("Authorization state already used. Try again.");
  }
  await logListCall(stateUser, stateShop);
  return pickerHtml(state, accounts);
}

async function logListCall(userId: string, shopId: string): Promise<void> {
  try {
    const service = createServiceClient();
    await service.from("ads_api_call_log").insert({
      user_id: userId,
      shop_id: shopId,
      endpoint: "customers.listManagedAccounts",
      method: "SEARCH",
      result: "success",
    });
  } catch {
    // non-blocking
  }
}
