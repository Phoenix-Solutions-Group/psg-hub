import { createClient } from "@/lib/supabase/server";
import { createServiceClient } from "@/lib/supabase/service";
import { consumePendingSelection, StateError } from "@/lib/google-ads/oauth";
import { persistLinkedAccount } from "@/lib/google-ads/link";

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
    { status, headers: { "content-type": "text/html; charset=utf-8" } }
  );
}

function errorHtml(message: string, status = 400): Response {
  return page(
    `<h1>Link failed</h1><p>${esc(message)}</p><p>Close this tab and try again from the shop settings.</p>`,
    status
  );
}

function successHtml(customerId: string): Response {
  return page(
    `<h1>Google Ads linked</h1><p>Account ${esc(customerId)} is now linked. You can close this tab.</p><script>try{window.opener&&window.opener.postMessage({type:"google-ads-linked"},window.location.origin)}catch(e){}setTimeout(function(){try{window.close()}catch(e){}},1500);</script>`,
    200
  );
}

async function readParams(
  request: Request
): Promise<{ state: string | null; customerId: string | null }> {
  const ct = request.headers.get("content-type") ?? "";
  if (ct.includes("application/json")) {
    const body = (await request.json().catch(() => ({}))) as {
      state?: string;
      customer_id?: string;
    };
    return { state: body.state ?? null, customerId: body.customer_id ?? null };
  }
  const form = await request.formData();
  const state = form.get("state");
  const customerId = form.get("customer_id");
  return {
    state: typeof state === "string" ? state : null,
    customerId: typeof customerId === "string" ? customerId : null,
  };
}

export async function POST(request: Request) {
  const { state, customerId } = await readParams(request);
  if (!state || !customerId) return errorHtml("Missing selection.", 400);

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return errorHtml("Not signed in.", 401);

  let consumed;
  try {
    consumed = await consumePendingSelection(state);
  } catch (err) {
    if (err instanceof StateError) {
      return errorHtml(`Selection state invalid: ${err.code}`, 400);
    }
    return errorHtml("Selection state validation failed.", 400);
  }

  // Re-bind: the user finishing must be the one who started.
  if (user.id !== consumed.userId) {
    return errorHtml("User mismatch. Sign in as the user who started the link.", 403);
  }

  // The chosen customer must be one we offered (anti-tamper).
  const offered = new Set(consumed.pending.customers.map((c) => c.id));
  if (!offered.has(customerId)) {
    return errorHtml("Selected account was not offered for this link.", 400);
  }

  const { error: upErr } = await persistLinkedAccount({
    shopId: consumed.shopId,
    customerId,
    loginCustomerId: consumed.pending.loginCustomerId,
    encryptedTokenHex: consumed.pending.encryptedTokenHex,
    keyVersion: consumed.pending.keyVersion,
    scope: consumed.pending.scope,
    linkedBy: consumed.userId,
  });
  if (upErr) return errorHtml(`Failed to persist account: ${upErr.slice(0, 120)}`, 500);

  try {
    const service = createServiceClient();
    await service.from("ads_api_call_log").insert({
      user_id: consumed.userId,
      shop_id: consumed.shopId,
      endpoint: "ads.google.select",
      method: "SEARCH",
      result: "success",
    });
  } catch {
    // non-blocking
  }

  return successHtml(customerId);
}
