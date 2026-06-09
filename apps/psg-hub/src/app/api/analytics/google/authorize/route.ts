import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { buildAuthorizeUrl } from "@/lib/google-oauth/state";

// Node runtime: the link flow shares a module graph with the gax/googleapis
// clients (callback) and uses node:crypto for state signing — never Edge.
export const runtime = "nodejs";

// Combined consent: ONE authorization yields ONE refresh token usable for BOTH
// GA4 (analytics.readonly) and GSC (webmasters.readonly). Both are SENSITIVE
// scopes; production use needs consent-screen verification (Phase-11 gate batch).
const GA4_GSC_SCOPE =
  "https://www.googleapis.com/auth/analytics.readonly https://www.googleapis.com/auth/webmasters.readonly";

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

  // Only owners can link a shop's Google account. NO tier gate — the analytics
  // surface is intentionally ungated (page.tsx:27-32), unlike the Ads link; the
  // GA4/GSC link follows that ungated posture (recorded decision, 11-01-PLAN AC-5).
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
      { error: "Only shop owners can link Google Analytics" },
      { status: 403 }
    );
  }

  const redirectUri = process.env.GOOGLE_ANALYTICS_OAUTH_REDIRECT_URI;
  if (!redirectUri) {
    return NextResponse.json(
      { error: "Server missing GOOGLE_ANALYTICS_OAUTH_REDIRECT_URI" },
      { status: 500 }
    );
  }

  try {
    const { url } = await buildAuthorizeUrl({
      scope: GA4_GSC_SCOPE,
      redirectUri,
      userId: user.id,
      shopId,
    });
    return NextResponse.json({ url });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
