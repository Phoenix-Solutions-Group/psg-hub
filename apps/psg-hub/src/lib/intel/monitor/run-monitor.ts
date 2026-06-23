// v1.6 / Wave 1B (PSG-226) — Continuous per-shop competitor monitor.
//
// The scheduled cadence that brings Providence's competitor-monitoring loop to BSM WITHOUT
// forking the scoring/report engine. One pass walks every shop and, per shop:
//   1. refreshes that shop's threat scores (reuses `scoreShopById` — pure scoring, zero spend), then
//   2. generates a fresh report via the existing `runCompetitorReport` (reuses the metered, G5-gated
//      research + narrative seams), then
//   3. records a `competitor_monitor_runs` row (the durable "monitored at X" signal).
//
// TENANT ISOLATION (the gating risk for this issue): every step is clamped to a single shopId.
// `scoreShopById` and `runCompetitorReport` only ever read/write rows `.eq("shop_id", shopId)`,
// and the run-log insert carries that same shopId. The service-role client bypasses RLS, so the
// per-shop scoping in this code IS the isolation boundary on the write path; the table RLS
// policies clamp the customer read path. A single shop's failure is contained — the rest of the
// fleet still gets monitored.
//
// BUDGET: each shop's report runs under `spendCapUsd`, enforced by the existing router/budget-reader
// against the shared month-to-date intel ledger. Because the cap is re-read per shop, cumulative
// spend across the whole pass is naturally capped — once the ceiling is crossed, later shops degrade
// to the deterministic (pending-activation) report and spend nothing. Until G5 activates, NO shop
// spends anything (the metered providers are gated off and the report degrades), exactly like the
// nightly scoring cron — so this is safe to schedule now.

import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { scoreShopById } from "../competitor/sync";
import { runCompetitorReport } from "../report/run";
import type { CompetitorReport } from "../report/types";

/**
 * Default per-shop spend ceiling for a monitor pass, in USD. Lower than the on-demand report's
 * $200 so a continuous cron can never burn the whole monthly intel budget. Overridable via
 * `INTEL_MONITOR_SPEND_CAP_USD`. Enforced against the SHARED month-to-date ledger, so this also
 * bounds the cumulative spend of the whole pass, not just one shop.
 */
export const DEFAULT_MONITOR_SPEND_CAP_USD = 50;

export type ShopMonitorStatus = "succeeded" | "degraded" | "skipped" | "failed";

export type ShopMonitorOutcome = {
  shopId: string;
  status: ShopMonitorStatus;
  competitorsTracked: number;
  topThreatScore: number | null;
  narrativeStatus: "grounded" | "pending_activation" | null;
  error?: string;
};

export type CompetitorMonitorResult = {
  shopsProcessed: number;
  /** Shops that produced a report (grounded OR degraded). */
  reportsGenerated: number;
  degraded: number;
  skipped: number;
  failed: number;
  outcomes: ShopMonitorOutcome[];
};

/** Injectable seams so the orchestrator is unit-testable without a live DB / router. */
export type MonitorDeps = {
  scoreShop?: typeof scoreShopById;
  runReport?: typeof runCompetitorReport;
};

export type MonitorOptions = {
  /** Injected "now" (ISO) for deterministic stamping. */
  now?: string;
  /** Per-shop spend ceiling; defaults to env `INTEL_MONITOR_SPEND_CAP_USD` or $50. */
  spendCapUsd?: number;
};

type ShopIdRow = { id: string };

type MonitorRunRow = {
  shop_id: string;
  ran_at: string;
  status: ShopMonitorStatus;
  competitors_tracked: number;
  top_threat_score: number | null;
  narrative_status: "grounded" | "pending_activation" | null;
  error: string | null;
};

function resolveSpendCapUsd(opts: MonitorOptions): number {
  if (typeof opts.spendCapUsd === "number") return opts.spendCapUsd;
  const env = process.env.INTEL_MONITOR_SPEND_CAP_USD;
  const parsed = env == null ? NaN : Number(env);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : DEFAULT_MONITOR_SPEND_CAP_USD;
}

/** Map a finished report to its monitor outcome (status + the columns the run-log persists). */
function outcomeFromReport(shopId: string, report: CompetitorReport): ShopMonitorOutcome {
  const competitorsTracked = report.summary.totalCompetitors;
  if (competitorsTracked === 0) {
    // The shop has no scored competitor set yet (discovery is the separate G5-gated step), so
    // there is nothing to report on. We still recorded that we monitored it.
    return {
      shopId,
      status: "skipped",
      competitorsTracked: 0,
      topThreatScore: null,
      narrativeStatus: null,
    };
  }
  const narrativeStatus = report.narrative.status;
  return {
    shopId,
    // A deterministic report shipped either way; "succeeded" only when the grounded narrative ran.
    status: narrativeStatus === "grounded" ? "succeeded" : "degraded",
    competitorsTracked,
    topThreatScore: report.summary.topThreatScore,
    narrativeStatus,
  };
}

function outcomeToRow(outcome: ShopMonitorOutcome, ranAt: string): MonitorRunRow {
  return {
    shop_id: outcome.shopId,
    ran_at: ranAt,
    status: outcome.status,
    competitors_tracked: outcome.competitorsTracked,
    top_threat_score: outcome.topThreatScore,
    narrative_status: outcome.narrativeStatus,
    error: outcome.error ?? null,
  };
}

/**
 * Run one continuous-monitor pass across every shop. Service-role client (RLS bypassed); gate
 * the CALLER (cron secret). Returns a per-run summary plus the per-shop outcomes. Never throws on
 * a single shop's failure — only on the initial shop-list load (fail-closed).
 */
export async function runCompetitorMonitor(
  service: SupabaseClient,
  opts: MonitorOptions = {},
  deps: MonitorDeps = {},
): Promise<CompetitorMonitorResult> {
  const ranAt = opts.now ?? new Date().toISOString();
  const spendCapUsd = resolveSpendCapUsd(opts);
  const scoreShop = deps.scoreShop ?? scoreShopById;
  const runReport = deps.runReport ?? runCompetitorReport;

  const { data: shops, error: shopsErr } = await service.from("shops").select("id");
  if (shopsErr) {
    throw new Error(`[competitor-monitor] shop load failed: ${shopsErr.message}`);
  }

  const result: CompetitorMonitorResult = {
    shopsProcessed: 0,
    reportsGenerated: 0,
    degraded: 0,
    skipped: 0,
    failed: 0,
    outcomes: [],
  };

  for (const { id: shopId } of (shops ?? []) as ShopIdRow[]) {
    let outcome: ShopMonitorOutcome;
    try {
      // Refresh this shop's scores, then assemble its report — both tenant-scoped to shopId.
      await scoreShop(service, shopId, { now: ranAt });
      const { report } = await runReport({ service, shopId, now: ranAt, spendCapUsd });
      outcome = outcomeFromReport(shopId, report);
    } catch (err) {
      outcome = {
        shopId,
        status: "failed",
        competitorsTracked: 0,
        topThreatScore: null,
        narrativeStatus: null,
        error: err instanceof Error ? err.message : String(err),
      };
    }

    // Persist the run row. A log-write failure must not lose the shop's tallied outcome, so we
    // contain it (the row is the durable signal, but the pass result is the source of truth here).
    const { error: logErr } = await service
      .from("competitor_monitor_runs")
      .insert(outcomeToRow(outcome, ranAt));
    if (logErr) {
      console.error(`[competitor-monitor] run-log insert failed for shop ${shopId}: ${logErr.message}`);
    }

    result.shopsProcessed += 1;
    result.outcomes.push(outcome);
    if (outcome.status === "succeeded") result.reportsGenerated += 1;
    else if (outcome.status === "degraded") {
      result.reportsGenerated += 1;
      result.degraded += 1;
    } else if (outcome.status === "skipped") result.skipped += 1;
    else if (outcome.status === "failed") result.failed += 1;
  }

  return result;
}
