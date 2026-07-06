// PSG-434 — Pipeline-weighted forecast core.
// Pure function over mirrored deals → open-deal count, total open-pipeline-$, and a
// per-stage (S0–S8) breakdown weighted by stage win-probability. This is the domain
// heart Reese (CRO) interprets into the committed-vs-best-case forecast for John
// (PSG-432 §2.1 / Phase 3). Kept dependency-free and deterministic so it is trivially
// testable and reusable from a report runner, an API route, or an export.

import type {
  PipedriveDeal,
  PipelineForecast,
  StageBreakdown,
  StageProbabilityMap,
} from "./types";
import { COMMITTED_PROBABILITY_THRESHOLD } from "./stages";

export interface ForecastOptions {
  /** Stage_id → probability in [0,1]. Overrides the deal's own win_probability. */
  stageProbability?: StageProbabilityMap;
  /** Reported currency for the forecast totals. Default "USD". */
  currency?: string;
  /**
   * Pipedrive stage_ids that count as "committed" (≥ S6 / Contract). Supply this once
   * the live stage_id → Sn mapping is known (PSG-446). When omitted, a deal counts as
   * committed via the probability fallback below.
   */
  committedStageIds?: ReadonlySet<number>;
  /**
   * Probability gate for the committed line when `committedStageIds` is not supplied.
   * A deal is committed if its resolved win-probability ≥ this value.
   * Defaults to COMMITTED_PROBABILITY_THRESHOLD (S6 = 0.95).
   */
  committedProbabilityThreshold?: number;
}

/**
 * Is this open deal part of the committed (≥ S6) floor?
 * Precedence: explicit `committedStageIds` set → probability ≥ threshold.
 */
export function isCommitted(
  deal: PipedriveDeal,
  probability: number,
  opts: ForecastOptions = {}
): boolean {
  if (opts.committedStageIds && deal.stageId != null) {
    return opts.committedStageIds.has(deal.stageId);
  }
  const threshold = opts.committedProbabilityThreshold ?? COMMITTED_PROBABILITY_THRESHOLD;
  return probability >= threshold;
}

/**
 * Resolve the win-probability (fraction in [0,1]) to weight a deal by.
 * Precedence: explicit stage map → deal's Pipedrive win_probability/100 → 0.
 * Always clamped to [0,1] so a bad input can never inflate the committed number.
 */
export function resolveProbability(
  deal: PipedriveDeal,
  stageProbability?: StageProbabilityMap
): number {
  let p: number | undefined;
  if (
    stageProbability &&
    deal.stageId != null &&
    Object.prototype.hasOwnProperty.call(stageProbability, deal.stageId)
  ) {
    p = stageProbability[deal.stageId];
  } else if (deal.winProbability != null) {
    p = deal.winProbability / 100;
  }
  if (p == null || Number.isNaN(p)) return 0;
  return Math.min(1, Math.max(0, p));
}

/**
 * Build the pipeline-weighted forecast from the mirrored deal set.
 * Only `status === "open"` deals count toward the open pipeline; won/lost/deleted
 * are ignored here (they belong to realized-revenue analysis, not the forecast).
 */
export function buildForecast(
  deals: readonly PipedriveDeal[],
  opts: ForecastOptions = {}
): PipelineForecast {
  const currency = opts.currency ?? "USD";
  const open = deals.filter((d) => d.status === "open");

  // Group by stage, accumulating count / value / weighted value.
  const byStage = new Map<string, StageBreakdown>();
  let bestCaseValue = 0; // Σ value, all open (ceiling)
  let weightedValue = 0; // Σ value × prob, all open (expected midpoint)
  let committedValue = 0; // Σ value, ≥ S6 only (floor, face $)
  let committedWeightedValue = 0; // Σ value × prob, ≥ S6 only
  let committedDealCount = 0;

  for (const deal of open) {
    const value = Number.isFinite(deal.value) ? deal.value : 0;
    const probability = resolveProbability(deal, opts.stageProbability);
    const weighted = value * probability;

    bestCaseValue += value;
    weightedValue += weighted;
    if (isCommitted(deal, probability, opts)) {
      committedValue += value;
      committedWeightedValue += weighted;
      committedDealCount += 1;
    }

    const key = deal.stageId == null ? "null" : String(deal.stageId);
    const existing = byStage.get(key);
    if (existing) {
      existing.count += 1;
      existing.value += value;
      existing.weightedValue += weighted;
    } else {
      byStage.set(key, {
        stageId: deal.stageId,
        stageName: deal.stageName,
        count: 1,
        value,
        // Stage-level probability is only meaningful when uniform across the stage;
        // we report the resolved weight of the first deal and recompute an effective
        // weight below from the aggregates so mixed-probability stages stay honest.
        probability,
        weightedValue: weighted,
      });
    }
  }

  const perStage = [...byStage.values()]
    .map((s) => ({
      ...s,
      // Effective stage probability from aggregates (weighted / value), so the
      // reported probability reflects the whole stage, not just the first deal.
      probability: s.value > 0 ? round(s.weightedValue / s.value, 4) : s.probability,
      value: round(s.value, 2),
      weightedValue: round(s.weightedValue, 2),
    }))
    .sort(byStageIdAsc);

  return {
    openDealCount: open.length,
    committedValue: round(committedValue, 2),
    committedWeightedValue: round(committedWeightedValue, 2),
    committedDealCount,
    weightedValue: round(weightedValue, 2),
    bestCaseValue: round(bestCaseValue, 2),
    currency,
    perStage,
  };
}

function byStageIdAsc(a: StageBreakdown, b: StageBreakdown): number {
  if (a.stageId == null) return 1;
  if (b.stageId == null) return -1;
  return a.stageId - b.stageId;
}

function round(n: number, dp: number): number {
  const f = 10 ** dp;
  return Math.round((n + Number.EPSILON) * f) / f;
}
