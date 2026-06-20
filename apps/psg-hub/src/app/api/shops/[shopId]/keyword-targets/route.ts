import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createServiceClient } from "@/lib/supabase/service";
import { fetchKeywordTargets } from "@/lib/bsm/keyword-targets";

// PSG-161 — SEO Auditor keyword targets for a shop (Content Writer input path).
// Auth model mirrors the shop-scoped invoices route: session → explicit
// shop_users tenancy gate (distinct 403, not a silent RLS-empty) → load. The
// load itself uses a service-role client because `research_artifacts` is
// default-deny under RLS (no scoped SELECT policy), and the loader re-scopes to
// the shop's own campaigns, so service-role cannot widen the tenant boundary.
export const runtime = "nodejs";

const UUID_RE = /^[0-9a-fA-F-]{36}$/;

export async function GET(
  request: Request,
  { params }: { params: Promise<{ shopId: string }> },
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

  const url = new URL(request.url);
  const topic = url.searchParams.get("topic")?.trim() || undefined;

  try {
    const targets = await fetchKeywordTargets(
      createServiceClient(),
      shopId,
      topic,
    );
    return NextResponse.json(targets, {
      headers: { "Cache-Control": "private, no-store" },
    });
  } catch (err) {
    console.error("[keyword-targets] load failed:", (err as Error).message);
    return NextResponse.json({ error: "Query failed" }, { status: 500 });
  }
}
