import { type NextRequest, NextResponse } from "next/server";
import { requireOpsFn } from "@/lib/auth/ops-access";
import { listGtmContainerStatuses } from "@/lib/gtm/status";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// GET /api/ads-mutations/gtm/status?shop_id=<uuid>
//
// Read-only GTM readiness feed for Ads Mutation Studio/BSM reporting. It returns the
// latest stored per-shop container inventory; it never calls Google and never mutates.
export async function GET(request: NextRequest) {
  const gate = await requireOpsFn("ads_mutations");
  if (!gate.ok) return gate.response;

  const shopId = request.nextUrl.searchParams.get("shop_id")?.trim() ?? "";
  if (!UUID_RE.test(shopId)) {
    return NextResponse.json({ error: "shop_id must be a UUID" }, { status: 422 });
  }

  try {
    const containers = await listGtmContainerStatuses(shopId);
    return NextResponse.json({ shopId, containers }, { status: 200 });
  } catch (err) {
    console.error("[api/ads-mutations/gtm/status] failed:", err);
    return NextResponse.json({ error: "Failed to read GTM status" }, { status: 500 });
  }
}

