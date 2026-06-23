// PSG-247 / Wave 2 (G-b) — disconnect (revoke) a shop's Google Business Profile
// link. POST { shop_id }. Owner-only. Best-effort revokes the refresh token at
// Google, then flips the google_oauth_accounts row (source='gbp') to `revoked` so
// the link surface shows "reconnect". Mirrors the Ads disconnect route, adapted to
// the shared google_oauth_accounts table + the access_audit trail (no logAdsCall
// equivalent for the GBP family). Revocation is the acceptance's teardown half.
export const runtime = "nodejs";

import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createServiceClient } from "@/lib/supabase/service";
import { decryptRefreshToken } from "@/lib/google-ads/crypto";
import { revokeAtGoogle } from "@/lib/google-ads/oauth";
import { recordAuditEvent } from "@/lib/audit/access-audit";

type Body = { shop_id?: string };

export async function POST(request: Request) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  let body: Body;
  try {
    body = (await request.json()) as Body;
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }
  const shopId = body.shop_id;
  if (!shopId) {
    return NextResponse.json({ error: "shop_id required" }, { status: 400 });
  }

  // Owner-only, matching the GBP connect (authorize) route's posture.
  const { data: membership } = await supabase
    .from("shop_users")
    .select("role")
    .eq("user_id", user.id)
    .eq("shop_id", shopId)
    .maybeSingle();
  if (!membership) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }
  if (membership.role !== "owner") {
    return NextResponse.json(
      { error: "Only shop owners can disconnect Google Business Profile" },
      { status: 403 }
    );
  }

  const service = createServiceClient();
  const { data: account, error: acctErr } = await service
    .from("google_oauth_accounts")
    .select("id, encrypted_refresh_token, key_version, status")
    .eq("shop_id", shopId)
    .eq("source", "gbp")
    .eq("status", "linked")
    .order("linked_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (acctErr) {
    return NextResponse.json({ error: acctErr.message }, { status: 500 });
  }
  if (!account) {
    return NextResponse.json(
      { error: "No linked Google Business Profile to disconnect" },
      { status: 404 }
    );
  }

  // Best-effort revoke at Google. bytea round-trips as a Postgres `\x<hex>` text
  // string over PostgREST (NOT a Buffer) — decode that form, keeping the Buffer/
  // ArrayBuffer fallbacks (mirrors getLinkedAccount). A decrypt/revoke failure
  // must NOT block the local teardown: we still mark the row revoked.
  let googleRevoked = false;
  try {
    const raw = account.encrypted_refresh_token as unknown;
    const ct =
      raw instanceof Buffer
        ? raw
        : typeof raw === "string" && raw.startsWith("\\x")
          ? Buffer.from(raw.slice(2), "hex")
          : Buffer.from(raw as ArrayBufferLike);
    const refreshToken = decryptRefreshToken(ct, account.key_version as number);
    googleRevoked = await revokeAtGoogle(refreshToken);
  } catch {
    googleRevoked = false;
  }

  const revokedAt = new Date().toISOString();
  const { error: updErr } = await service
    .from("google_oauth_accounts")
    .update({ status: "revoked", revoked_at: revokedAt })
    .eq("id", account.id);
  if (updErr) {
    return NextResponse.json({ error: updErr.message }, { status: 500 });
  }

  // Audit the teardown AFTER the row is flipped (trail reflects committed state).
  await recordAuditEvent({
    actorProfileId: user.id,
    targetShopId: shopId,
    action: "gbp.disconnect",
    payload: { accountId: account.id, googleRevoked },
  });

  return NextResponse.json({ revoked_at: revokedAt, google_revoked: googleRevoked });
}
