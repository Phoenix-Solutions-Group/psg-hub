import { timingSafeEqual } from "node:crypto";
import { NextResponse } from "next/server";
import type { SupabaseClient } from "@supabase/supabase-js";
import { createServiceClient } from "@/lib/supabase/service";
import { getSnapshots } from "@/lib/analytics/snapshots";
import { assembleReportData, type SnapshotReader } from "@/lib/report/report-data";
import { generateNarrative } from "@/lib/report/generate";
import { gatewayGenerate } from "@/lib/report/narrative";
import { renderReportPdf } from "@/lib/report/render-client";
import { storeReportPdf, storeReportNarrative, pdfKey } from "@/lib/report/storage";
import { buildReportEmail } from "@/lib/report/email";
import { sendEmail } from "@/lib/mail/sendgrid";
import { priorMonth, monthWindow } from "@/lib/analytics/rollup";
import { sanitizeLastError } from "@/lib/google-ads/sanitize";
import {
  runMonthlyReports,
  type MonthlyShop,
  type PerShopResult,
} from "@/lib/report/monthly";

// 12-04: monthly report cron. Vercel Cron fires GET on the 1st (Authorization:
// Bearer ${CRON_SECRET}); POST supports manual triggers with the same gate. The gate
// runs BEFORE any client/LLM construction — an unauthorized call spends zero Gateway
// units. A 503 not-configured guard returns until the 12-04 gate batch sets the
// RENDER / email / Gateway secrets. runtime=nodejs (service client + node:crypto).
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

// The report pipeline's outward dependencies (worker + email + Gateway) land at the
// 12-04 operator gate batch; until then the cron is a designed not-configured 503.
function configured(): boolean {
  return Boolean(
    process.env.REPORT_RENDER_URL &&
      process.env.RENDER_TOKEN &&
      process.env.REPORT_EMAIL_TEMPLATE_ID &&
      process.env.AI_GATEWAY_API_KEY
  );
}

const MONTHLY = "monthly_reports";

function publicReason(raw: string | null | undefined): string {
  const redacted = sanitizeLastError(raw)
    .replace(/https?:\/\/\S+/gi, "[url]")
    .replace(/api_token=[^&\s"']*/gi, "api_token=[redacted]");
  return redacted || "no reason reported";
}

function publicResult(result: PerShopResult) {
  return {
    shopId: result.shop.id,
    shopName: result.shop.name,
    status: result.status,
    ...(result.source ? { source: result.source } : {}),
    ...(result.reason ? { reason: publicReason(result.reason) } : {}),
    ...(result.error ? { error: publicReason(result.error) } : {}),
  };
}

/** Eligible shops = those with any analytics_snapshots in the period AND an owner with an email. */
async function listEligibleShops(
  service: SupabaseClient,
  start: string,
  end: string
): Promise<MonthlyShop[]> {
  const { data: snaps, error: snapErr } = await service
    .from("analytics_snapshots")
    .select("shop_id")
    .gte("date", start)
    .lte("date", end);
  if (snapErr) throw new Error(`listEligibleShops snapshots: ${snapErr.message}`);

  const shopIds = [...new Set((snaps ?? []).map((r) => r.shop_id as string))];
  if (shopIds.length === 0) return [];

  const { data: shops, error: shopErr } = await service
    .from("shops")
    .select("id, name")
    .in("id", shopIds);
  if (shopErr) throw new Error(`listEligibleShops shops: ${shopErr.message}`);

  const { data: owners, error: ownErr } = await service
    .from("shop_users")
    .select("shop_id, user_id")
    .eq("role", "owner")
    .in("shop_id", shopIds);
  if (ownErr) throw new Error(`listEligibleShops owners: ${ownErr.message}`);

  const ownerByShop = new Map<string, string>();
  for (const o of owners ?? []) {
    if (!ownerByShop.has(o.shop_id as string)) ownerByShop.set(o.shop_id as string, o.user_id as string);
  }

  const result: MonthlyShop[] = [];
  for (const shop of shops ?? []) {
    const userId = ownerByShop.get(shop.id as string);
    if (!userId) continue; // no owner -> cannot deliver
    const { data: userRes } = await service.auth.admin.getUserById(userId);
    const email = userRes?.user?.email;
    if (!email) continue; // no email -> cannot deliver
    result.push({ id: shop.id as string, name: (shop.name as string) ?? "your shop", ownerEmail: email });
  }
  return result;
}

async function alreadySent(service: SupabaseClient, shopId: string, period: string): Promise<boolean> {
  const { data } = await service
    .from(MONTHLY)
    .select("emailed_at")
    .eq("shop_id", shopId)
    .eq("period_month", period)
    .maybeSingle();
  return Boolean(data?.emailed_at);
}

async function recordReport(
  service: SupabaseClient,
  shopId: string,
  period: string,
  storagePath: string
): Promise<void> {
  const { error } = await service
    .from(MONTHLY)
    .upsert(
      { shop_id: shopId, period_month: period, storage_path: storagePath },
      { onConflict: "shop_id,period_month" }
    );
  if (error) throw new Error(`recordReport: ${error.message}`);
}

// Atomic exclusive claim of the send slot (see 20260613000000_monthly_reports_claim.sql).
// Returns true iff THIS call won the claim. Server-side conditional UPDATE: two
// overlapping runs serialize on the row lock and exactly one wins. force=false here —
// the cron never re-sends a delivered report; force is reserved for a manual re-run.
async function claimReport(
  service: SupabaseClient,
  shopId: string,
  period: string,
  force: boolean
): Promise<boolean> {
  const { data, error } = await service.rpc("claim_monthly_report", {
    p_shop_id: shopId,
    p_period_month: period,
    p_force: force,
  });
  if (error) throw new Error(`claimReport: ${error.message}`);
  return data === true;
}

async function markEmailed(service: SupabaseClient, shopId: string, period: string): Promise<void> {
  const { error } = await service
    .from(MONTHLY)
    .update({ emailed_at: new Date().toISOString() })
    .eq("shop_id", shopId)
    .eq("period_month", period);
  if (error) throw new Error(`markEmailed: ${error.message}`);
}

// allowForce gates the manual re-send: the scheduled GET passes false (a cron run never
// re-sends a delivered report); the manual POST passes true and honors ?force=1.
async function handle(request: Request, allowForce: boolean): Promise<NextResponse> {
  if (!authorized(request)) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  if (!configured()) {
    // Designed not-configured state — REPORT_RENDER_URL / RENDER_TOKEN /
    // REPORT_EMAIL_TEMPLATE_ID / AI_GATEWAY_API_KEY land at the gate batch.
    return NextResponse.json({ error: "report_not_configured" }, { status: 503 });
  }

  const service = createServiceClient();
  const period = priorMonth(new Date().toISOString().slice(0, 7)); // just-completed prior month
  const { start, end } = monthWindow(period);
  const appUrl = (process.env.NEXT_PUBLIC_APP_URL ?? "").replace(/\/$/, "");
  const force = allowForce && new URL(request.url).searchParams.get("force") === "1";

  const result = await runMonthlyReports(period, {
    listShops: () => listEligibleShops(service, start, end),
    assembleReportData: (shopId, p) => {
      const readSnapshots: SnapshotReader = (query) => getSnapshots(service, query);
      return assembleReportData(shopId, p, { readSnapshots, generatedAt: new Date().toISOString() });
    },
    generateNarrative: (reportData) => generateNarrative(reportData, { generate: gatewayGenerate }),
    storeReportNarrative: (s, p, n) => storeReportNarrative(s, p, n),
    renderReportPdf: (slug) => renderReportPdf(slug),
    storeReportPdf: (s, p, b) => storeReportPdf(s, p, b),
    recordReport: (s, p, path) => recordReport(service, s, p, path),
    alreadySent: (s, p) => alreadySent(service, s, p),
    // force MUST be threaded into BOTH `force` (preflight bypass) and this claim arg in
    // lockstep: a force that bypasses the preflight but claims with force=false would
    // skip at the claim (emailed_at set) and silently never re-send.
    force,
    claimForSend: (s, p) => claimReport(service, s, p, force),
    markEmailed: (s, p) => markEmailed(service, s, p),
    buildReportEmail: (shop, p, url) => buildReportEmail(shop, p, url),
    sendEmail: (m) => sendEmail(m),
    downloadUrl: (s, p) => `${appUrl}/api/reports/${s}/${p}/download`,
    pdfKey,
  });

  return NextResponse.json({
    period,
    force,
    counts: result.counts,
    results: result.results.map(publicResult),
    actionRequired: result.results
      .filter((r) => r.status === "held" || r.status === "failed")
      .map(publicResult),
  });
}

export async function GET(request: Request): Promise<NextResponse> {
  return handle(request, false); // scheduled cron: never force
}

export async function POST(request: Request): Promise<NextResponse> {
  return handle(request, true); // manual trigger: ?force=1 re-sends a delivered report
}
