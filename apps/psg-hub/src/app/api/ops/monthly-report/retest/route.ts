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
import { monthWindow } from "@/lib/analytics/rollup";
import { sanitizeLastError } from "@/lib/google-ads/sanitize";
import {
  runMonthlyReports,
  type MonthlyShop,
  type PerShopResult,
} from "@/lib/report/monthly";

// Agent-runnable production retest for the June 2026 monthly report incident chain.
// This deliberately uses a dedicated bearer secret, not CRON_SECRET, and checks that
// secret before reading any downstream report/worker/Gateway configuration.
export const runtime = "nodejs";
export const maxDuration = 60;

const PERIOD = "2026-06";
const MONTHLY = "monthly_reports";
const TARGET_SHOP_NAMES = [
  "Tracy's Body Shop",
  "Wallace Collision",
  "Riverside Collision",
  "Demo Body Shop",
] as const;

function productionOnly(): boolean {
  return process.env.VERCEL_ENV === "production";
}

function authorized(request: Request): boolean {
  const secret = process.env.MONTHLY_REPORT_RETEST_SECRET;
  if (!secret) return false;
  const expected = `Bearer ${secret}`;
  const a = Buffer.from(request.headers.get("authorization") ?? "");
  const b = Buffer.from(expected);
  return a.length === b.length && timingSafeEqual(a, b);
}

function configured(): boolean {
  return Boolean(
    process.env.REPORT_RENDER_URL &&
      process.env.RENDER_TOKEN &&
      process.env.REPORT_EMAIL_TEMPLATE_ID &&
      process.env.AI_GATEWAY_API_KEY
  );
}

function redact(raw: string | null | undefined): string {
  const redacted = sanitizeLastError(raw)
    .replace(/https?:\/\/\S+/gi, "[url]")
    .replace(/api_token=[^&\s"']*/gi, "api_token=[redacted]")
    .replace(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi, "[redacted-email]")
    .replace(/\b[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\b/gi, "[redacted-id]")
    .replace(/\b\d{7,}\b/g, "[redacted-id]");
  return redacted || "no reason reported";
}

function publicResult(result: PerShopResult) {
  return {
    shopName: result.shop.name,
    status: result.status,
    ...(result.source ? { source: result.source } : {}),
    ...(result.reason ? { reason: redact(result.reason) } : {}),
    ...(result.error ? { error: redact(result.error) } : {}),
  };
}

async function listRetestShops(service: SupabaseClient): Promise<MonthlyShop[]> {
  const { data: shops, error: shopErr } = await service
    .from("shops")
    .select("id, name")
    .in("name", [...TARGET_SHOP_NAMES]);
  if (shopErr) throw new Error(`listRetestShops shops: ${shopErr.message}`);

  const shopIds = (shops ?? []).map((shop) => shop.id as string);
  if (shopIds.length === 0) return [];

  const { data: owners, error: ownErr } = await service
    .from("shop_users")
    .select("shop_id, user_id")
    .eq("role", "owner")
    .in("shop_id", shopIds);
  if (ownErr) throw new Error(`listRetestShops owners: ${ownErr.message}`);

  const ownerByShop = new Map<string, string>();
  for (const owner of owners ?? []) {
    if (!ownerByShop.has(owner.shop_id as string)) {
      ownerByShop.set(owner.shop_id as string, owner.user_id as string);
    }
  }

  const shopsByName = new Map((shops ?? []).map((shop) => [shop.name as string, shop]));
  const result: MonthlyShop[] = [];
  for (const name of TARGET_SHOP_NAMES) {
    const shop = shopsByName.get(name);
    if (!shop) continue;
    const userId = ownerByShop.get(shop.id as string);
    if (!userId) continue;
    const { data: userRes } = await service.auth.admin.getUserById(userId);
    const email = userRes?.user?.email;
    if (!email) continue;
    result.push({ id: shop.id as string, name, ownerEmail: email });
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

async function claimReport(service: SupabaseClient, shopId: string, period: string): Promise<boolean> {
  const { data, error } = await service.rpc("claim_monthly_report", {
    p_shop_id: shopId,
    p_period_month: period,
    p_force: false,
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

export async function POST(request: Request): Promise<NextResponse> {
  if (!productionOnly()) {
    return NextResponse.json({ error: "production_only" }, { status: 404 });
  }
  if (!authorized(request)) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  if (!configured()) {
    return NextResponse.json({ error: "report_not_configured" }, { status: 503 });
  }

  const service = createServiceClient();
  const { start, end } = monthWindow(PERIOD);
  const appUrl = (process.env.NEXT_PUBLIC_APP_URL ?? "").replace(/\/$/, "");

  const result = await runMonthlyReports(PERIOD, {
    listShops: () => listRetestShops(service),
    assembleReportData: (shopId, p) => {
      const readSnapshots: SnapshotReader = (query) => getSnapshots(service, query);
      return assembleReportData(shopId, p, {
        readSnapshots,
        generatedAt: new Date().toISOString(),
      });
    },
    generateNarrative: (reportData) => generateNarrative(reportData, { generate: gatewayGenerate }),
    storeReportNarrative: (shopId, period, narrative) =>
      storeReportNarrative(shopId, period, narrative),
    renderReportPdf: (slug) => renderReportPdf(slug),
    storeReportPdf: (shopId, period, bytes) => storeReportPdf(shopId, period, bytes),
    recordReport: (shopId, period, path) => recordReport(service, shopId, period, path),
    alreadySent: (shopId, period) => alreadySent(service, shopId, period),
    force: false,
    claimForSend: (shopId, period) => claimReport(service, shopId, period),
    markEmailed: (shopId, period) => markEmailed(service, shopId, period),
    buildReportEmail: (shop, period, url) => buildReportEmail(shop, period, url),
    sendEmail: (message) => sendEmail(message),
    downloadUrl: (shopId, period) => `${appUrl}/api/reports/${shopId}/${period}/download`,
    pdfKey,
  });

  return NextResponse.json({
    period: PERIOD,
    window: { start, end },
    force: false,
    targetShops: [...TARGET_SHOP_NAMES],
    counts: result.counts,
    results: result.results.map(publicResult),
    actionRequired: result.results
      .filter((r) => r.status === "held" || r.status === "failed")
      .map(publicResult),
  });
}
