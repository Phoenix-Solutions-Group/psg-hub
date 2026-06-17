import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { buildAuthorizeUrl } from "@/lib/google-oauth/state";

// Node runtime: shares a module graph with the googleapis GBP clients (callback)
// and uses node:crypto for state signing — never Edge.
export const runtime = "nodejs";

// Phase 13 / 13-01 — SEPARATE GBP consent (Option B). One authorization yields one
// refresh token carrying `business.manage` (the single scope spanning Account
// Management, Business Information, Performance, and v4 Reviews). It is a NEW grant,
// not a reuse: the Phase-11 GA4/GSC token has only analytics.readonly +
// webmasters.readonly, so it 403s on every GBP call. business.manage requires OAuth
// consent-screen verification (the Phase-13 Gate B, handled at the 13-04 gate batch).
const GBP_SCOPE = "https://www.googleapis.com/auth/business.manage";

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

  // Owner-only, NO tier gate — matches the ungated analytics surface + the GA4/GSC
  // link posture (recorded decision, 13-01-PLAN AC-5).
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
      { error: "Only shop owners can link Google Business Profile" },
      { status: 403 }
    );
  }

  // Separate redirect URI for the GBP callback (registered on the SAME OAuth client
  // as GA4/GSC — Gate B attaches to the client, not the flow).
  const redirectUri = process.env.GOOGLE_GBP_OAUTH_REDIRECT_URI;
  if (!redirectUri) {
    return NextResponse.json(
      { error: "Server missing GOOGLE_GBP_OAUTH_REDIRECT_URI" },
      { status: 500 }
    );
  }
  // GBP runs on its OWN OAuth client (n8n-workspace-apis), separate from the
  // psg-google-ads client GA4/GSC/Ads share. Falls back to the shared client when the
  // GBP-specific var is unset. The client_id MUST match the one whose redirect URI is
  // registered, or Google returns redirect_uri_mismatch. 14-04 gate-batch deviation.
  const clientId =
    process.env.GOOGLE_GBP_OAUTH_CLIENT_ID ?? process.env.GOOGLE_OAUTH_CLIENT_ID;
  if (!clientId) {
    return NextResponse.json(
      { error: "Server missing GBP OAuth client id" },
      { status: 500 }
    );
  }

  try {
    const { url } = await buildAuthorizeUrl({
      scope: GBP_SCOPE,
      redirectUri,
      clientId,
      userId: user.id,
      shopId,
    });
    return NextResponse.json({ url });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
