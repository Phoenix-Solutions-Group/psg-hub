import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createServiceClient } from "@/lib/supabase/service";
import { fetchMarketResearchBrief } from "@/lib/bsm/content-briefs";

// PSG-160 — Market Researcher → ContentBrief read API (part of PSG-153
// cross-module invocation; QA defect PSG-145 item 6). Returns the latest content
// brief for a shop.
//
// Auth mirrors the invoices route's membership gate: session → explicit
// shop_users tenancy check (distinct 403, NOT a silent RLS-empty). The read
// itself uses the service client because `research_artifacts` is default-deny RLS
// (service-role only) and has no shop_id column — `fetchMarketResearchBrief`
// scopes by the `data->>shop_id` payload, clamped behind the explicit gate above.
// runtime=nodejs for parity with the auth'd routes + the server-only service client.
export const runtime = "nodejs";

const UUID_RE = /^[0-9a-fA-F-]{36}$/;

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ shopId: string }> }
): Promise<Response> {
  const { shopId } = await params;
  if (!UUID_RE.test(shopId)) {
    return NextResponse.json({ error: "Bad request" }, { status: 400 });
  }

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  // Explicit tenancy check — do not rely on RLS returning empty to signal 403.
  const { data: membership } = await supabase
    .from("shop_users")
    .select("role")
    .eq("user_id", user.id)
    .eq("shop_id", shopId)
    .maybeSingle();
  if (!membership) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  // research_artifacts is default-deny (service-role only); the session user can
  // never read it directly. The membership gate above is the auth boundary.
  try {
    const service = createServiceClient();
    const brief = await fetchMarketResearchBrief(service, shopId);
    return NextResponse.json(
      { brief },
      { headers: { "Cache-Control": "private, no-store" } }
    );
  } catch {
    return NextResponse.json({ error: "Query failed" }, { status: 500 });
  }
}
