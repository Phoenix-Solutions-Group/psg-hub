// Wave 1C / PSG-227 — Shop SEO audit deliverable: customer route.
//
//   POST /api/onboarding/audit              → run (or re-run) the audit for the
//                                             caller's active shop; persist + return summary.
//   GET  /api/onboarding/audit?format=json  → latest persisted audit summary (json, default).
//   GET  /api/onboarding/audit?format=html  → latest persisted audit as the branded report.
//
// Auth is the user session; the active shop is resolved from the caller's
// memberships (the cookie SELECTS among already-authorized shops, never authorizes),
// so a customer can only ever audit a shop they belong to. The run itself goes
// through the service client (shops read + history insert), but the shopId it
// operates on is always one the session owns. RLS is the authoritative backstop.
//
// runtime=nodejs: the orchestrator + service client + renderer are all server-only.
export const runtime = "nodejs";

import { type NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createServiceClient } from "@/lib/supabase/service";
import { getActiveShopContext } from "@/lib/shop/context";
import {
  runShopAudit,
  getLatestShopAudit,
  ShopAuditPersistError,
} from "@/lib/seo-audit/run";
import { renderShopAuditReportHtml } from "@/lib/seo-audit/render";
import { recordBsmPilotEvent } from "@/lib/bsm/pilot-events";

async function resolveCallerShop(): Promise<
  | { ok: true; userId: string; shopId: string }
  | { ok: false; response: NextResponse }
> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return { ok: false, response: NextResponse.json({ error: "Unauthorized" }, { status: 401 }) };
  }
  const { activeShopId } = await getActiveShopContext(user.id);
  if (!activeShopId) {
    return {
      ok: false,
      response: NextResponse.json(
        { error: "No shop found for this account. Complete onboarding first." },
        { status: 404 },
      ),
    };
  }
  return { ok: true, userId: user.id, shopId: activeShopId };
}

export async function POST() {
  const gate = await resolveCallerShop();
  if (!gate.ok) return gate.response;

  const service = createServiceClient();
  let auditResult: Awaited<ReturnType<typeof runShopAudit>>;
  try {
    auditResult = await runShopAudit({
      service,
      shopId: gate.shopId,
      userId: gate.userId,
    });
  } catch (err) {
    if (err instanceof ShopAuditPersistError) {
      await recordBsmPilotEvent(service, {
        eventName: "audit_save_failed",
        shopId: gate.shopId,
        userId: gate.userId,
      });
      return NextResponse.json(
        {
          error:
            "The online presence check ran, but BSM could not save it. Please retry before relying on the result.",
        },
        { status: 503 },
      );
    }
    throw err;
  }

  const { report, auditId } = auditResult;
  return NextResponse.json({
    auditId,
    shopId: report.shopId,
    mode: report.mode,
    healthScore: report.healthScore,
    grade: report.grade,
    summary: report.summary,
    generatedAt: report.generatedAt,
  });
}

export async function GET(request: NextRequest) {
  const gate = await resolveCallerShop();
  if (!gate.ok) return gate.response;

  const format = (request.nextUrl.searchParams.get("format") ?? "json").toLowerCase();
  if (format !== "json" && format !== "html") {
    return NextResponse.json({ error: 'format must be "json" or "html"' }, { status: 400 });
  }

  const service = createServiceClient();
  const latest = await getLatestShopAudit(service, gate.shopId);
  if (!latest) {
    return NextResponse.json(
      { error: "No audit has been run for this shop yet. POST to run one." },
      { status: 404 },
    );
  }

  if (format === "html") {
    return new NextResponse(renderShopAuditReportHtml(latest.report), {
      headers: { "content-type": "text/html; charset=utf-8" },
    });
  }
  return NextResponse.json({
    shopId: latest.report.shopId,
    mode: latest.report.mode,
    healthScore: latest.report.healthScore,
    grade: latest.report.grade,
    summary: latest.report.summary,
    generatedAt: latest.generatedAt,
  });
}
