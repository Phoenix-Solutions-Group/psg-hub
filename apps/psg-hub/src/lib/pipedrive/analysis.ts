// PSG-446 — Pipeline diagnostics layer (PSG-435 TODO 5 + 6).
// Pure functions over the mirrored deal set that surface two things the raw forecast
// totals would otherwise hide:
//   1. STALE pipeline — open deals with no logged activity in 14 days, so stale $ is
//      visible and discountable rather than silently summed into the forecast.
//   2. OPEN-but-WON-stage deals — any deal sitting in an S7/S8 (won) stage that still
//      reports `status=open` would inflate the committed line; we raise a warning so
//      Reese can reconcile the live stage→Sn map instead of trusting a bad total.
// Deterministic: callers pass `asOf` (no ambient clock) so results are reproducible.

import type { PipedriveDeal } from "./types";

/** No-movement window after which an open deal is flagged stale. */
export const STALE_DEAL_DAYS = 14;

const MS_PER_DAY = 24 * 60 * 60 * 1000;

/** Whole days between an ISO date/timestamp and `asOf` (negative if in the future). */
export function daysSince(isoDate: string | null, asOf: Date): number | null {
  if (!isoDate) return null;
  const then = new Date(isoDate);
  if (Number.isNaN(then.getTime())) return null;
  return Math.floor((asOf.getTime() - then.getTime()) / MS_PER_DAY);
}

/**
 * Is this open deal stale (no logged activity in `staleDays`)? A deal with no
 * `lastActivityDate` at all is treated as stale (it has never moved). Closed deals
 * are never stale (they are out of the open pipeline).
 */
export function isStaleDeal(
  deal: PipedriveDeal,
  asOf: Date,
  staleDays: number = STALE_DEAL_DAYS,
): boolean {
  if (deal.status !== "open") return false;
  const days = daysSince(deal.lastActivityDate, asOf);
  if (days == null) return true; // never had activity → stale
  return days >= staleDays;
}

export interface DealWarning {
  kind: "open_in_won_stage";
  dealId: number;
  stageId: number | null;
  stageName: string | null;
  value: number;
  message: string;
}

export interface DealDiagnostics {
  /** Open deals flagged stale (no movement ≥ `staleDays`). */
  staleDealIds: number[];
  /** Σ value of the stale open deals (the discountable slice of the pipeline). */
  staleValue: number;
  /** Count of open deals overall (for context against the stale share). */
  openDealCount: number;
  /** Data-quality warnings to flag to Reese before trusting the committed line. */
  warnings: DealWarning[];
}

export interface DiagnosticsOptions {
  asOf: Date;
  staleDays?: number;
  /**
   * Pipedrive stage_ids that are "won" stages (S8 Won; S7 Commercial once signed).
   * Any deal in one of these stages that still reports `status=open` is a warning.
   * Supply once the live stage→Sn map is known (PSG-433); empty until then.
   */
  wonStageIds?: ReadonlySet<number>;
}

/** Surface stale pipeline + open-in-won-stage anomalies over the deal set. */
export function diagnoseDeals(
  deals: readonly PipedriveDeal[],
  opts: DiagnosticsOptions,
): DealDiagnostics {
  const staleDays = opts.staleDays ?? STALE_DEAL_DAYS;
  const wonStages = opts.wonStageIds ?? new Set<number>();

  const staleDealIds: number[] = [];
  let staleValue = 0;
  let openDealCount = 0;
  const warnings: DealWarning[] = [];

  for (const deal of deals) {
    if (deal.status !== "open") continue;
    openDealCount += 1;

    if (isStaleDeal(deal, opts.asOf, staleDays)) {
      staleDealIds.push(deal.dealId);
      staleValue += Number.isFinite(deal.value) ? deal.value : 0;
    }

    if (deal.stageId != null && wonStages.has(deal.stageId)) {
      warnings.push({
        kind: "open_in_won_stage",
        dealId: deal.dealId,
        stageId: deal.stageId,
        stageName: deal.stageName,
        value: Number.isFinite(deal.value) ? deal.value : 0,
        message: `Deal ${deal.dealId} is in won-stage ${
          deal.stageName ?? deal.stageId
        } but still status=open — would inflate the committed line; reconcile stage→Sn.`,
      });
    }
  }

  return {
    staleDealIds,
    staleValue: round2(staleValue),
    openDealCount,
    warnings,
  };
}

function round2(n: number): number {
  return Math.round((n + Number.EPSILON) * 100) / 100;
}
