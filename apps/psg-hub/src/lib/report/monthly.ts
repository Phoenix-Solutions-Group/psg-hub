// Phase 12 / 12-04 — Monthly report orchestrator.
// PURE + deps-injected: wires the 12-01 data layer + 12-02 verified narrative +
// 12-03 render/store/download/email-builder into one per-shop pipeline. Every IO is
// injected so this is fully node-testable with NO real network / DB / LLM. The cron
// route (route.ts) binds the real implementations.
//
// Invariants:
//  - NEVER emails an unverified report: a "hold" outcome stores/sends nothing.
//  - Narrative is persisted BEFORE render (the print route loads the persisted JSON).
//  - EXACTLY-ONE delivery under overlap: an atomic claim (claimForSend) is taken
//    AFTER recordReport and BEFORE the non-idempotent sendEmail. Two overlapping
//    runs both reach the claim, but only one wins; the loser skips without emailing.
//    The preflight alreadySent read is a cheap early-skip optimization, NOT the gate.
//  - Per-shop failure is CONTAINED: one shop throwing never aborts the rest.

import type { ReportData } from "./types";
import type { ReportNarrative } from "./schema";
import type { GenerateOutcome } from "./generate";
import type { MailMessage } from "../mail/types";

/** A shop eligible for a monthly report (id + display name + owner email). */
export type MonthlyShop = { id: string; name: string; ownerEmail: string };

export type ShopReportStatus = "sent" | "skipped" | "held" | "failed";

export type PerShopResult = {
  shop: MonthlyShop;
  status: ShopReportStatus;
  /** narrative provenance for a sent report ("model" | "template"). */
  source?: GenerateOutcome["source"];
  /** Non-exception reason for held/skipped outcomes. */
  reason?: string;
  error?: string;
};

export type MonthlyCounts = Record<ShopReportStatus, number>;

export type MonthlyRunResult = {
  period: string;
  results: PerShopResult[];
  counts: MonthlyCounts;
};

export type MonthlyDeps = {
  listShops: () => Promise<MonthlyShop[]>;
  assembleReportData: (shopId: string, period: string) => Promise<ReportData>;
  generateNarrative: (reportData: ReportData) => Promise<GenerateOutcome>;
  storeReportNarrative: (shopId: string, period: string, narrative: ReportNarrative) => Promise<unknown>;
  renderReportPdf: (slug: string) => Promise<Uint8Array>;
  storeReportPdf: (shopId: string, period: string, bytes: Uint8Array) => Promise<unknown>;
  recordReport: (shopId: string, period: string, storagePath: string) => Promise<unknown>;
  /** True if this shop already has an emailed report for the period. CHEAP PREFLIGHT
   *  optimization only (skips expensive assemble/generate/render) — it is a non-atomic
   *  read and is NOT the delivery gate. The authoritative gate is claimForSend. */
  alreadySent: (shopId: string, period: string) => Promise<boolean>;
  /** Atomically claim the send slot AFTER recordReport, BEFORE sendEmail. Returns true
   *  if THIS run won the exclusive claim (proceed to send); false if another run already
   *  holds or completed it (skip without emailing). This is the real idempotency gate. */
  claimForSend: (shopId: string, period: string) => Promise<boolean>;
  markEmailed: (shopId: string, period: string) => Promise<unknown>;
  buildReportEmail: (shop: MonthlyShop, period: string, downloadUrl: string) => MailMessage;
  sendEmail: (message: MailMessage) => Promise<unknown>;
  downloadUrl: (shopId: string, period: string) => string;
  pdfKey: (shopId: string, period: string) => string;
  /** Re-render + re-email even if alreadySent (manual re-run). Default false. */
  force?: boolean;
};

function tally(results: PerShopResult[]): MonthlyCounts {
  const counts: MonthlyCounts = { sent: 0, skipped: 0, held: 0, failed: 0 };
  for (const r of results) counts[r.status] += 1;
  return counts;
}

/**
 * Run the monthly report pipeline for every eligible shop for `period` ('YYYY-MM').
 * Returns a per-shop result list + counts. Never throws for a single shop's failure.
 */
export async function runMonthlyReports(
  period: string,
  deps: MonthlyDeps
): Promise<MonthlyRunResult> {
  const shops = await deps.listShops();
  const results: PerShopResult[] = [];

  for (const shop of shops) {
    try {
      if (!deps.force && (await deps.alreadySent(shop.id, period))) {
        results.push({ shop, status: "skipped" });
        continue;
      }

      const reportData = await deps.assembleReportData(shop.id, period);
      if (reportData.linkedSources.length === 0) {
        results.push({ shop, status: "skipped", reason: "no linked sources to report" });
        continue;
      }

      const outcome = await deps.generateNarrative(reportData);

      // Never email an unverified report.
      if (outcome.verdict !== "pass" || !outcome.narrative) {
        const reason = outcome.violations.map((v) => `${v.code}: ${v.detail}`).join("; ");
        results.push({
          shop,
          status: "held",
          reason: reason || "narrative did not pass the report safety check",
        });
        continue;
      }

      // Persist the verified narrative BEFORE render (print route loads it).
      await deps.storeReportNarrative(shop.id, period, outcome.narrative);

      const slug = `${shop.id}__${period}`;
      const pdf = await deps.renderReportPdf(slug);
      await deps.storeReportPdf(shop.id, period, pdf);
      await deps.recordReport(shop.id, period, deps.pdfKey(shop.id, period));

      // Atomic claim BEFORE the non-idempotent send. Overlapping runs both reach here;
      // only the claim winner emails. A lost claim is a clean skip, never a failure.
      const claimed = await deps.claimForSend(shop.id, period);
      if (!claimed) {
        results.push({ shop, status: "skipped" });
        continue;
      }

      const message = deps.buildReportEmail(shop, period, deps.downloadUrl(shop.id, period));
      await deps.sendEmail(message);
      await deps.markEmailed(shop.id, period);

      results.push({ shop, status: "sent", source: outcome.source });
    } catch (err) {
      results.push({
        shop,
        status: "failed",
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }

  return { period, results, counts: tally(results) };
}
