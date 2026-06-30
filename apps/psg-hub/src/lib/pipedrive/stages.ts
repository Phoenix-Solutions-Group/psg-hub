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
