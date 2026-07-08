import type { SupabaseClient } from "@supabase/supabase-js";
import { getSnapshots } from "@/lib/analytics/snapshots";
import { assembleReportData, type SnapshotReader } from "@/lib/report/report-data";
import { generateNarrative } from "@/lib/report/generate";
import { gatewayGenerate } from "@/lib/report/narrative";
import { renderReportPdf } from "@/lib/report/render-client";
import { storeReportPdf, storeReportNarrative, pdfKey } from "@/lib/report/storage";
import { buildReportEmail } from "@/lib/report/email";
import { sendEmail } from "@/lib/mail/sendgrid";
import { priorMonth, monthWindow } from "@/lib/analytics/rollup";
import {
  runMonthlyReports,
  type MonthlyShop,
  type MonthlyCounts,
  type PerShopResult,
} from "@/lib/report/monthly";

// PSG-645: the monthly-report pipeline wiring, extracted verbatim from
// src/app/api/cron/monthly-report/route.ts so BOTH the Vercel cron and the
// superadmin-gated manual "Sync now" route (/api/ops/admin/analytics/sync) run the
// exact same generator with the exact same claim/dedup semantics. The cron route
// keeps its own CRON_SECRET gate; the admin route keeps its requireSuperadmin gate.
// This module is auth-agnostic: it assumes the caller has already authorized the run.

const MONTHLY = "monthly_reports";

/**
 * The report pipeline's outward dependencies (headless render worker + SendGrid +
 * AI Gateway). Same predicate the cron used inline. When any is missing the pipeline
 * is a designed not-configured no-op — the caller returns a 503-style outcome rather
 * than half-generating.
 */
export function reportPipelineConfigured(): boolean {
  return Boolean(
    process.env.REPORT_RENDER_URL &&
      process.env.RENDER_TOKEN &&
      process.env.REPORT_EMAIL_TEMPLATE_ID &&
      process.env.AI_GATEWAY_API_KEY
  );
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
// overlapping runs serialize on the row lock and exactly one wins.
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

export type MonthlyReportRunOptions = {
  /** Re-send an already-delivered report (bypasses the emailed_at dedup). Manual only. */
  force?: boolean;
  /**
   * Target period as YYYY-MM. Defaults to the just-completed prior month (what the
   * scheduled cron always runs). The manual route can pass an explicit period to
   * backfill (e.g. the July pilot report — PSG-526 / PSG-418).
   */
  period?: string;
};

export type MonthlyReportRunResult = {
  period: string;
  force: boolean;
  counts: MonthlyCounts;
  results: PerShopResult[];
};

/**
 * Run the monthly-report generator for one period. Never throws for a single shop's
 * failure (runMonthlyReports tallies per-shop status). The caller MUST have gated the
 * request (CRON_SECRET or requireSuperadmin) and confirmed reportPipelineConfigured().
 */
export async function runMonthlyReportPipeline(
  service: SupabaseClient,
  opts: MonthlyReportRunOptions = {}
): Promise<MonthlyReportRunResult> {
  const period = opts.period ?? priorMonth(new Date().toISOString().slice(0, 7));
  const { start, end } = monthWindow(period);
  const appUrl = (process.env.NEXT_PUBLIC_APP_URL ?? "").replace(/\/$/, "");
  const force = opts.force === true;

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
    // force MUST be threaded into BOTH the preflight bypass and the claim in lockstep:
    // a force that bypasses the preflight but claims with force=false would skip at the
    // claim (emailed_at set) and silently never re-send.
    force,
    claimForSend: (s, p) => claimReport(service, s, p, force),
    markEmailed: (s, p) => markEmailed(service, s, p),
    buildReportEmail: (shop, p, url) => buildReportEmail(shop, p, url),
    sendEmail: (m) => sendEmail(m),
    downloadUrl: (s, p) => `${appUrl}/api/reports/${s}/${p}/download`,
    pdfKey,
  });

  return { period, force, counts: result.counts, results: result.results };
}
