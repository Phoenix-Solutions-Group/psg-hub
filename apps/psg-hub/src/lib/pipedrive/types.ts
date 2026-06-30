// PSG-434 — Pipedrive deals: shared types for the durable mirror + forecast.
// Parent PSG-432 (§2.1 / Phase 3); interprets to Reese's pipeline-weighted forecast.

/** A single open/closed deal as mirrored from Pipedrive into `public.pipedrive_deals`. */
export interface PipedriveDeal {
  dealId: number;
  title: string | null;
  /** Monetary value in `currency`. Open-pipeline-$ = sum over status === "open". */
  value: number;
  currency: string;
  status: DealStatus;
  pipelineId: number | null;
  stageId: number | null;
  stageName: string | null;
  /** Pipedrive per-deal win probability, 0–100 (nullable when Pipedrive omits it). */
  winProbability: number | null;
  orgId: number | null;
  orgName: string | null;
  personId: number | null;
  expectedCloseDate: string | null; // ISO date
}

export type DealStatus = "open" | "won" | "lost" | "deleted";

/**
 * Stage win-probability map, keyed by Pipedrive stage_id, value in [0,1].
 * Source of truth for the S0–S8 weights is Reese/CRO (PSG-433). Optional: when a
 * stage is absent, the forecast falls back to the deal's own win_probability/100.
 */
export type StageProbabilityMap = Record<number, number>;

/** Per-stage rollup line for the breakdown the acceptance criteria require. */
export interface StageBreakdown {
  stageId: number | null;
  stageName: string | null;
  /** Number of open deals in this stage. */
  count: number;
  /** Σ value of open deals in this stage (un-weighted, "best case" for the stage). */
  value: number;
  /** Probability applied (the resolved weight, [0,1]). */
  probability: number;
  /** value × probability — the committed contribution of this stage. */
  weightedValue: number;
}

/** The pipeline-weighted forecast Reese hands to John (committed vs. best-case). */
export interface PipelineForecast {
  /** Total count of open deals. */
  openDealCount: number;
  /** Σ value over all open deals — the best-case (un-weighted) pipeline. */
  bestCaseValue: number;
  /** Σ (value × probability) over all open deals — the committed (weighted) pipeline. */
  committedValue: number;
  currency: string;
  /** Per-stage breakdown (S0–S8), ordered by stageId ascending. */
  perStage: StageBreakdown[];
}
