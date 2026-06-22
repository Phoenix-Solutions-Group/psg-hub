// v1.6 / 17-B (PSG-177b) — Production entry point: superadmin ops route for the competitor report.
// GET /api/ops/intel/competitor-report?shopId=<uuid>&format=html|json
// Superadmin-gated (the report is the metered, G5-gated intel surface — privilege-escalation-
// adjacent, so it sits at psg_superadmin, not a per-capability flag). RLS is the authoritative
// backstop; this is fail-closed defense-in-depth. The run is audited so any vendor spend is
// attributable to an actor + shop.
//
// runtime=nodejs: requireSuperadmin -> getOpsAccess + the report orchestrator both use the
// server-only service client; the report renderer/router are server-only too.
export const runtime = "nodejs";

import { type NextRequest, NextResponse } from "next/server";
import { requireSuperadmin } from "@/lib/auth/ops-access";
import { createServiceClient } from "@/lib/supabase/service";
import { recordAuditEvent } from "@/lib/audit/access-audit";
import { runCompetitorReport } from "@/lib/intel/report/run";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export async function GET(request: NextRequest) {
  const gate = await requireSuperadmin();
  if (!gate.ok) return gate.response;

  const search = request.nextUrl.searchParams;
  const shopId = search.get("shopId");
  if (!shopId || !UUID_RE.test(shopId)) {
    return NextResponse.json(
      { error: "shopId query parameter is required and must be a UUID" },
      { status: 400 },
    );
  }

  const format = (search.get("format") ?? "html").toLowerCase();
  if (format !== "html" && format !== "json") {
    return NextResponse.json(
      { error: 'format must be "html" or "json"' },
      { status: 400 },
    );
  }

  const service = createServiceClient();
  const { report, html } = await runCompetitorReport({
    service,
    shopId,
    userId: gate.userId,
  });

  // The shop has no scored competitor set — nothing to report on (and no metered call was made).
  if (report.summary.totalCompetitors === 0) {
    return NextResponse.json(
      { error: "No competitor scores found for this shop" },
      { status: 404 },
    );
  }

  const narrative = report.narrative;
  await recordAuditEvent({
    actorProfileId: gate.userId,
    action: "intel.competitor_report.run",
    targetShopId: shopId,
    payload: {
      shopId,
      format,
      provider: narrative.status === "grounded" ? narrative.provider : null,
      model: narrative.status === "grounded" ? narrative.model : null,
      competitorsTracked: report.summary.totalCompetitors,
    },
  });

  if (format === "json") {
    return NextResponse.json({ report });
  }
  return new NextResponse(html, {
    headers: { "content-type": "text/html; charset=utf-8" },
  });
}
