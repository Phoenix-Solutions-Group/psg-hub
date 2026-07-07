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
 * CONFIRMED by Reese (CRO, owns the live weights per PSG-433/PSG-435) on 2026-07-07,
 * keyed to the FETCHED stage NAMES (PSG-631). This CORRECTS the reversed strawman from
 * PSG-627/PSG-624: an earlier guess assumed stage_id order == pipeline order, but the names
 * showed it runs the other way — `56 "New Lead"` is the START and `61 "Won"` is the END:
 *
 *   stage_id | name                    | → Sn | conf | note
 *   ---------+-------------------------+------+------+---------------------------------------
 *   56       | New Lead                |  S0  | 10%  | top of funnel
 *   57       | Contacted / Discovery   |  S2  | 40%  | active discovery
 *   58       | Qualified               |  S3  | 60%  | fit confirmed
 *   59       | Proposal Sent           |  S4  | 70%  | proposal out
 *   60       | Verbal / Negotiation    |  S5  | 85%  | negotiating terms
 *   61       | Won (open, UNCLOSED)     |  S5  | 85%  | interim cap — see below
 *
 * STAGE 61 ("Won") — Reese's explicit call (PSG-631): the 9 deals in this stage are still
 * `status = open` (NOT among the 228 formally closed-won deals the accounting mirror tracks).
 * Booking them as committed would put ~$25K on the board that contradicts the CFO's booked
 * figure, so they are weighted at S5 (85%, high-confidence) but deliberately kept OUT of the
 * committed (≥ S6) bucket. "Committed" must reflect formally-closed-won status, NOT stage
 * position — so NO live stage maps to ≥ S6, and the committed line stays $0.00 until a deal is
 * closed-won (→ booked/reconciled) or verified signed-contract-open (→ promoted to 61→S6).
 * That reclassification of the 9 is tracked in PSG-632 (hygiene sweep, Reese).
 *
 * Against the 2026-07-07 08:57 UTC sync this yields: raw open pipeline $65,562.25 (unchanged)
 * · weighted ≈ $49,115.01 · committed $0.00. Confidence %s per the ratified S0–S8 scale
 * (S0 10 / S2 40 / S3 60 / S4 70 / S5 85 / S6 95). Drives every `buildDealsExport` consumer
 * (the /ops/sales-pipeline page + export route).
 */
export const PIPELINE_8_STAGE_CODES: Record<number, LifecycleStage["code"]> = {
  56: "S0", // New Lead               10%
  57: "S2", // Contacted / Discovery  40%
  58: "S3", // Qualified              60%
  59: "S4", // Proposal Sent          70%
  60: "S5", // Verbal / Negotiation   85%
  61: "S5", // Won (open, unclosed)   85%  interim — NOT committed (PSG-631/PSG-632)
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
