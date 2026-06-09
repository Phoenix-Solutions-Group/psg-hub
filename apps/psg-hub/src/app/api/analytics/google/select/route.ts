import { createClient } from "@/lib/supabase/server";
import {
  consumePendingSelection,
  StateError,
  type PendingAccount,
} from "@/lib/google-oauth/state";
import {
  persistLinkedAccount,
  type GoogleOAuthSource,
} from "@/lib/google-oauth/accounts";

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
    `<!doctype html><html><head><title>Google Analytics &amp; Search Console</title><meta name="viewport" content="width=device-width,initial-scale=1"></head><body style="font-family:system-ui;padding:2rem;max-width:34rem;margin:0 auto;line-height:1.5;">${body}</body></html>`,
    { status, headers: { "content-type": "text/html; charset=utf-8" } }
  );
}

function errorHtml(message: string, status = 400): Response {
  return page(
    `<h1>Link failed</h1><p>${esc(message)}</p><p>Close this tab and try again from the analytics page.</p>`,
    status
  );
}

function successHtml(linked: string[]): Response {
  return page(
    `<h1>Connected</h1><p>${esc(linked.join(" and "))} now linked to this shop. You can close this tab.</p><script>try{window.opener&&window.opener.postMessage({type:"google-analytics-linked"},window.location.origin)}catch(e){}setTimeout(function(){try{window.close()}catch(e){}},1500);</script>`,
    200
  );
}

function norm(v: unknown): string | null {
  return typeof v === "string" && v.trim() ? v.trim() : null;
}

async function readParams(request: Request): Promise<{
  state: string | null;
  ga4Id: string | null;
  gscId: string | null;
}> {
  const ct = request.headers.get("content-type") ?? "";
  if (ct.includes("application/json")) {
    const body = (await request.json().catch(() => ({}))) as {
      state?: string;
      ga4_id?: string;
      gsc_id?: string;
    };
    return {
      state: norm(body.state),
      ga4Id: norm(body.ga4_id),
      gscId: norm(body.gsc_id),
    };
  }
  const form = await request.formData();
  return {
    state: norm(form.get("state")),
    ga4Id: norm(form.get("ga4_id")),
    gscId: norm(form.get("gsc_id")),
  };
}

export async function POST(request: Request) {
  const { state, ga4Id, gscId } = await readParams(request);
  if (!state) return errorHtml("Missing selection state.", 400);
  // At least one source must be picked.
  if (!ga4Id && !gscId) {
    return errorHtml("Pick at least one property or site to connect.", 400);
  }

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

  // Build the validated pick set. Each picked id must be in its source's offered
  // set (anti-tamper); each source is independent (link one, the other, or both).
  const offeredGa4 = new Map(
    consumed.pending.accounts.ga4.map((a: PendingAccount) => [a.id, a.name])
  );
  const offeredGsc = new Map(
    consumed.pending.accounts.gsc.map((a: PendingAccount) => [a.id, a.name])
  );

  const picks: Array<{
    source: GoogleOAuthSource;
    id: string;
    name: string | null;
  }> = [];
  if (ga4Id) {
    if (!offeredGa4.has(ga4Id)) {
      return errorHtml("Selected Analytics property was not offered.", 400);
    }
    picks.push({ source: "ga4", id: ga4Id, name: offeredGa4.get(ga4Id) ?? null });
  }
  if (gscId) {
    if (!offeredGsc.has(gscId)) {
      return errorHtml("Selected Search Console site was not offered.", 400);
    }
    picks.push({ source: "gsc", id: gscId, name: offeredGsc.get(gscId) ?? null });
  }
  if (picks.length === 0) {
    return errorHtml("Pick at least one property or site to connect.", 400);
  }

  // Persist each pick as its own row, sharing the one encrypted refresh token.
  const linked: string[] = [];
  for (const pick of picks) {
    const { error } = await persistLinkedAccount({
      shopId: consumed.shopId,
      source: pick.source,
      externalAccountId: pick.id,
      displayName: pick.name,
      encryptedTokenHex: consumed.pending.encryptedTokenHex,
      keyVersion: consumed.pending.keyVersion,
      scope: consumed.pending.scope,
      linkedBy: consumed.userId,
    });
    if (error) {
      return errorHtml(`Failed to save ${pick.source}: ${error.slice(0, 120)}`, 500);
    }
    linked.push(pick.source === "ga4" ? "Google Analytics" : "Search Console");
  }

  return successHtml(linked);
}
