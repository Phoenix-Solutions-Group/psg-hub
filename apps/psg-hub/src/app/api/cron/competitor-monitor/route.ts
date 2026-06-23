// v1.6 / Wave 1B (PSG-226) — continuous competitor-monitor cron.
// Vercel Cron fires GET (with `Authorization: Bearer ${CRON_SECRET}`); POST is supported for
// manual/operator triggers under the SAME gate, which runs BEFORE any work — an unauthorized
// call does zero DB reads and zero vendor spend. Each pass re-scores + generates a fresh report
// per shop and logs a `competitor_monitor_runs` row (see run-monitor.ts). The metered narrative
// stays G5-gated and budget-capped, so this is safe to run before G5 clears (it degrades to the
// deterministic report and spends nothing, exactly like the nightly scoring cron).
//
// runtime=nodejs: the monitor orchestrator + report renderer/router are all server-only.
export const runtime = "nodejs";

import { timingSafeEqual } from "node:crypto";
import { NextResponse } from "next/server";
import { createServiceClient } from "@/lib/supabase/service";
import { runCompetitorMonitor } from "@/lib/intel/monitor/run-monitor";

function authorized(request: Request): boolean {
  const secret = process.env.CRON_SECRET;
  if (!secret) return false; // unconfigured = locked
  const header = request.headers.get("authorization") ?? "";
  const expected = `Bearer ${secret}`;
  const a = Buffer.from(header);
  const b = Buffer.from(expected);
  return a.length === b.length && timingSafeEqual(a, b);
}

async function handle(request: Request): Promise<NextResponse> {
  if (!authorized(request)) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const service = createServiceClient();
  const result = await runCompetitorMonitor(service);
  return NextResponse.json(result);
}

export async function GET(request: Request): Promise<NextResponse> {
  return handle(request);
}

export async function POST(request: Request): Promise<NextResponse> {
  return handle(request);
}
