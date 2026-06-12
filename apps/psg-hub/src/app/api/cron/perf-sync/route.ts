import { timingSafeEqual } from "node:crypto";
import { NextResponse } from "next/server";
import { createServiceClient } from "@/lib/supabase/service";
import { syncPerformance, type PerformanceSyncOptions } from "@/lib/perf/perf-sync";
import { psiConfigured } from "@/lib/perf/psi";
import { priorMonth } from "@/lib/analytics/rollup";

// 12-05c: website-performance MONTHLY ingest trigger (PSI lab + CrUX field + optional
// GTMetrix). Vercel Cron fires GET (`Authorization: Bearer ${CRON_SECRET}`) on the 1st
// BEFORE the monthly-report cron; POST supports manual triggers under the same gate.
// The gate runs BEFORE any client construction — an unauthorized call spends zero PSI
// quota.
//
// The injected month is the JUST-COMPLETED prior month, so the one monthly
// 'performance' row lands at date={prior-month}-01 — exactly what the report reads.
//
// GTMetrix is pilot-scoped via GTMETRIX_SHOP_IDS (comma-separated shop ids): its
// in-loop poll is ~80s/shop on top of PSI, so an unscoped fleet run would blow the 300s
// Fluid invocation ceiling AND the per-day credit cap. When the env is unset we fall
// back to a conservative limit of 1 so a misconfigured prod run can never fan out.
// PSI still runs for every url-bearing shop (the ~4 url-shops today fit the ceiling;
// fleet-scale 842-shop batching is a deferred follow-on).
//
// runtime=nodejs is REQUIRED (service client + node:crypto).
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

/** GTMetrix scope from env: explicit shop ids win; else a safe limit of 1. */
function gtmetrixScope(): Pick<
  PerformanceSyncOptions,
  "gtmetrixShopIds" | "gtmetrixShopLimit"
> {
  const ids = (process.env.GTMETRIX_SHOP_IDS ?? "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
  if (ids.length > 0) return { gtmetrixShopIds: ids };
  return { gtmetrixShopLimit: 1 };
}

async function handle(request: Request): Promise<NextResponse> {
  if (!authorized(request)) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  // PSI is the required floor — keyless PageSpeed quota is 0, so without the key the
  // whole perf section is inert. Designed not-configured 503 (set at the gate batch).
  if (!psiConfigured()) {
    return NextResponse.json({ error: "perf_not_configured" }, { status: 503 });
  }

  const service = createServiceClient();
  const month = priorMonth(new Date().toISOString().slice(0, 7));
  const result = await syncPerformance(service, { month, ...gtmetrixScope() });
  return NextResponse.json({ month, ...result });
}

export async function GET(request: Request): Promise<NextResponse> {
  return handle(request);
}

export async function POST(request: Request): Promise<NextResponse> {
  return handle(request);
}
