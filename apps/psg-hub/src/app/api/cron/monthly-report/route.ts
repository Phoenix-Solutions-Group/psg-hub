import { timingSafeEqual } from "node:crypto";
import { NextResponse } from "next/server";
import { createServiceClient } from "@/lib/supabase/service";
import { reportPipelineConfigured, runMonthlyReportPipeline } from "@/lib/report/run-cron";

// 12-04: monthly report cron. Vercel Cron fires GET on the 1st (Authorization:
// Bearer ${CRON_SECRET}); POST supports manual triggers with the same gate. The gate
// runs BEFORE any client/LLM construction — an unauthorized call spends zero Gateway
// units. A 503 not-configured guard returns until the 12-04 gate batch sets the
// RENDER / email / Gateway secrets. runtime=nodejs (service client + node:crypto).
//
// PSG-645: the generator wiring now lives in src/lib/report/run-cron.ts so the
// superadmin "Sync now" route (/api/ops/admin/analytics/sync) runs the identical
// pipeline with identical claim/dedup semantics. This route keeps its CRON_SECRET gate.
export const runtime = "nodejs";

function authorized(request: Request): boolean {
  const secret = process.env.CRON_SECRET;
  if (!secret) return false; // unconfigured = locked
  const header = request.headers.get("authorization") ?? "";
  const expected = `Bearer ${secret}`;
  const a = Buffer.from(header);
  const b = Buffer.from(expected);
  return a.length === b.length && timingSafeEqual(a, b);
}

// allowForce gates the manual re-send: the scheduled GET passes false (a cron run never
// re-sends a delivered report); the manual POST passes true and honors ?force=1.
async function handle(request: Request, allowForce: boolean): Promise<NextResponse> {
  if (!authorized(request)) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  if (!reportPipelineConfigured()) {
    // Designed not-configured state — REPORT_RENDER_URL / RENDER_TOKEN /
    // REPORT_EMAIL_TEMPLATE_ID / AI_GATEWAY_API_KEY land at the gate batch.
    return NextResponse.json({ error: "report_not_configured" }, { status: 503 });
  }

  const service = createServiceClient();
  const force = allowForce && new URL(request.url).searchParams.get("force") === "1";
  const { period, counts } = await runMonthlyReportPipeline(service, { force });

  return NextResponse.json({ period, force, counts });
}

export async function GET(request: Request): Promise<NextResponse> {
  return handle(request, false); // scheduled cron: never force
}

export async function POST(request: Request): Promise<NextResponse> {
  return handle(request, true); // manual trigger: ?force=1 re-sends a delivered report
}
