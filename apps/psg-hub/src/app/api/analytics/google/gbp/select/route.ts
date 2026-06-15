import { createClient } from "@/lib/supabase/server";
import {
  consumePendingSelection,
  StateError,
  type PendingAccount,
} from "@/lib/google-oauth/state";
import { persistLinkedAccount } from "@/lib/google-oauth/accounts";

export const runtime = "nodejs";

function esc(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function page(body: string, status: number): Response {
  return new Response(
    `<!doctype html><html><head><title>Google Business Profile</title><meta name="viewport" content="width=device-width,initial-scale=1"></head><body style="font-family:system-ui;padding:2rem;max-width:34rem;margin:0 auto;line-height:1.5;">${body}</body></html>`,
    { status, headers: { "content-type": "text/html; charset=utf-8" } }
  );
}

function errorHtml(message: string, status = 400): Response {
  return page(
    `<h1>Link failed</h1><p>${esc(message)}</p><p>Close this tab and try again from the analytics page.</p>`,
    status
  );
}

function successHtml(name: string): Response {
  return page(
    `<h1>Connected</h1><p>${esc(name)} is now linked to this shop. You can close this tab.</p><script>try{window.opener&&window.opener.postMessage({type:"google-gbp-linked"},window.location.origin)}catch(e){}setTimeout(function(){try{window.close()}catch(e){}},1500);</script>`,
    200
  );
}

function norm(v: unknown): string | null {
  return typeof v === "string" && v.trim() ? v.trim() : null;
}

async function readParams(request: Request): Promise<{
  state: string | null;
  locationId: string | null;
}> {
  const ct = request.headers.get("content-type") ?? "";
  if (ct.includes("application/json")) {
    const body = (await request.json().catch(() => ({}))) as {
      state?: string;
      location_id?: string;
    };
    return { state: norm(body.state), locationId: norm(body.location_id) };
  }
  const form = await request.formData();
  return {
    state: norm(form.get("state")),
    locationId: norm(form.get("location_id")),
  };
}

export async function POST(request: Request) {
  const { state, locationId } = await readParams(request);
  if (!state) return errorHtml("Missing selection state.", 400);
  if (!locationId) return errorHtml("Pick a business location to connect.", 400);

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
    return errorHtml(
      "User mismatch. Sign in as the user who started the link.",
      403
    );
  }

  // Anti-tamper: the picked location must be in the offered set. The offered
  // PendingAccount carries the parent accounts/{id} → external_parent_id.
  const offered = new Map(
    (consumed.pending.accounts.gbp ?? []).map((a: PendingAccount) => [a.id, a])
  );
  const pick = offered.get(locationId);
  if (!pick) {
    return errorHtml("Selected business location was not offered.", 400);
  }

  const { error } = await persistLinkedAccount({
    shopId: consumed.shopId,
    source: "gbp",
    externalAccountId: pick.id, // bare 'locations/{id}'
    externalParentId: pick.parent ?? null, // 'accounts/{id}'
    displayName: pick.name,
    encryptedTokenHex: consumed.pending.encryptedTokenHex,
    keyVersion: consumed.pending.keyVersion,
    scope: consumed.pending.scope,
    linkedBy: consumed.userId,
  });
  if (error) {
    return errorHtml(`Failed to save the location: ${error.slice(0, 120)}`, 500);
  }

  return successHtml(pick.name);
}
