// PSG-434 — Canonical PSG sales lifecycle (S0–S8) + default forecast confidences.
// Source of truth: apps/psg-ads-mutations/process-model-psg-sales-lifecycle.html.
// These are the *defaults* — Reese/CRO (PSG-433) owns the live weights; confirm
// before locking. Wire as the StageProbabilityMap once Pipedrive stage_id → Sn is
// known (the mapping needs the live stages from the token in PSG-445).

import type { StageProbabilityMap } from "./types";

export interface LifecycleStage {
  code: `S${number}`;
  name: string;
  /** Forecast win-confidence in [0,1]. */
  probability: number;
}

/** S0–S8 with default confidences (10/25/40/60/70/85/95/~100/100%). */
export const PSG_LIFECYCLE_STAGES: readonly LifecycleStage[] = [
  { code: "S0", name: "Prospect", probability: 0.1 },
  { code: "S1", name: "Outreach", probability: 0.25 },
  { code: "S2", name: "Discovery", probability: 0.4 },
  { code: "S3", name: "Solution", probability: 0.6 },
  { code: "S4", name: "Proposal", probability: 0.7 },
  { code: "S5", name: "Negotiate", probability: 0.85 },
  { code: "S6", name: "Contract", probability: 0.95 },
  { code: "S7", name: "Commercial", probability: 0.99 },
  { code: "S8", name: "Won", probability: 1.0 },
] as const;

/**
 * "Committed" pipeline = deals at or past this stage index (Reese's definition:
 * ≥ S6 / Contract). Best-case = all open deals.
 */
export const COMMITTED_FROM_STAGE_INDEX = 6;

/**
 * Probability gate for the committed line when the live Pipedrive stage_id → Sn map
 * is not yet wired (PSG-445/PSG-446): a deal counts as committed if its resolved
 * win-probability ≥ this threshold. Derived from S6 (Contract) so it tracks the
 * lifecycle, not a magic number. Once `committedStageIds` is supplied, that explicit
 * set takes precedence over this fallback.
 */
export const COMMITTED_PROBABILITY_THRESHOLD =
  PSG_LIFECYCLE_STAGES[COMMITTED_FROM_STAGE_INDEX].probability; // 0.95 (S6)

/**
 * Build a StageProbabilityMap (Pipedrive stage_id → probability) from a mapping of
 * Pipedrive stage_id → Sn code. Supply `stageIdToCode` once the live Pipedrive
 * stages are known (PSG-445/PSG-446); until then `forecast.ts` falls back to each
 * deal's own Pipedrive win_probability.
 */
export function buildStageProbabilityMap(
  stageIdToCode: Record<number, LifecycleStage["code"]>
): StageProbabilityMap {
  const byCode = new Map(PSG_LIFECYCLE_STAGES.map((s) => [s.code, s.probability]));
  const map: StageProbabilityMap = {};
  for (const [stageId, code] of Object.entries(stageIdToCode)) {
    const p = byCode.get(code);
    if (p != null) map[Number(stageId)] = p;
  }
  return map;
}

/** Index of a lifecycle code within PSG_LIFECYCLE_STAGES (S0 → 0 … S8 → 8), or -1. */
function stageIndex(code: LifecycleStage["code"]): number {
  return PSG_LIFECYCLE_STAGES.findIndex((s) => s.code === code);
}

/**
 * The set of Pipedrive stage_ids that count as "committed" (≥ S6 / Contract), derived
 * from a stage_id → Sn mapping. Supply the same `stageIdToCode` used for the probability
 * map; the committed line then keys off the explicit stage (via `ForecastOptions.
 * committedStageIds`) instead of the probability-threshold fallback.
 */
export function committedStageIds(
  stageIdToCode: Record<number, LifecycleStage["code"]>
): ReadonlySet<number> {
  const set = new Set<number>();
  for (const [stageId, code] of Object.entries(stageIdToCode)) {
    if (stageIndex(code) >= COMMITTED_FROM_STAGE_INDEX) set.add(Number(stageId));
  }
  return set;
}

/**
 * LIVE Pipedrive `stage_id → Sn` mapping for the active sales pipeline (pipeline 8).
 * This is the single knob that turns the probability-WEIGHTED forecast on (PSG-622).
 *
 * The first live sync (PSG-446, 2026-07-07) surfaced pipeline 8 with 6 stages, ids 56–61.
 * Pipedrive's per-deal "win probability %" is blank on 17 of 19 deals, so the weighted /
 * committed lines can only become meaningful via THIS stage-based weighting.
 *
 *   stage_id | open deals | value      | (stage_name populated by client.ts once synced)
 *   ---------+------------+------------+------------------------------------------------
 *   56       | 2          | $0.00      |
 *   57       | 2          | $2,762.00  |
 *   58       | 2          | $0.00      |
 *   59       | 1          | $35,800.00 |
 *   60       | 3          | $1,770.00  |
 *   61       | 9          | $25,230.25 |
 *
 * INTENTIONALLY EMPTY until Reese (CRO, owns the live weights per PSG-433/PSG-435)
 * confirms which live stage is which lifecycle step — the values are a revenue call, not
 * an engineering one. While empty, the forecast is UNCHANGED (it falls back to each deal's
 * own win_probability → weighted stays $0). The moment this is filled in, the weighted /
 * committed lines light up everywhere `buildDealsExport` is consumed (the /ops/sales-
 * pipeline page + export route) with no other code change.
 *
 * Proposed strawman for Reese to confirm/correct (stage_id order = pipeline order):
 *   { 61: "S0", 60: "S2", 57: "S3", 59: "S4", 58: "S5", 56: "S6" }
 */
export const PIPELINE_8_STAGE_CODES: Record<number, LifecycleStage["code"]> = {
  // Pending Reese confirmation (PSG-622). Fill from the confirmed mapping, e.g.:
  //   61: "S0", 60: "S2", 57: "S3", 59: "S4", 58: "S5", 56: "S6",
};

/**
 * The live stage_id → probability map for the weighted forecast, or `undefined` while
 * {@link PIPELINE_8_STAGE_CODES} is unconfirmed/empty. `undefined` (not `{}`) so callers
 * cleanly fall back to today's behavior — an empty map would still be "supplied" and could
 * mask the win_probability fallback for a stage that isn't listed.
 */
export function liveStageProbabilityMap(): StageProbabilityMap | undefined {
  const map = buildStageProbabilityMap(PIPELINE_8_STAGE_CODES);
  return Object.keys(map).length > 0 ? map : undefined;
}

/**
 * The live committed (≥ S6) stage_id set, or `undefined` while the mapping is empty — so
 * the committed line keeps its probability-threshold fallback until the stages are wired.
 */
export function liveCommittedStageIds(): ReadonlySet<number> | undefined {
  const set = committedStageIds(PIPELINE_8_STAGE_CODES);
  return set.size > 0 ? set : undefined;
}
