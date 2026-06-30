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
  /** Deal owner (sales rep) — distinct from the contact (person/org). */
  ownerId: number | null;
  ownerName: string | null;
  /** Forecasted close date. */
  expectedCloseDate: string | null; // ISO date
  /** ACTUAL won/lost close date (set when status leaves "open"); anchors the
   *  won/booked reconciled line + YoY. Null while the deal is still open. */
  closeDate: string | null; // ISO date
  /** Last logged activity (call/email/meeting) — distinct from update_time. Drives
   *  the 14-day stale / no-movement flag. Null when Pipedrive omits it. */
  lastActivityDate: string | null; // ISO date
  /**
   * Revenue character of a WON deal (PSG-435 / John's §2.1 tie-out): `recurring`
   * deals become Invoiced subscriptions and are netted OUT against MRR; `one_time`
   * (project/setup fees) are additive net-new. Carrier for the export's required
   * `revenue_type` column. **Honest-null rule:** the sync derives this from a native
   * Pipedrive recurring flag, else a documented deal-type/product-category mapping,
   * else leaves it `null` (unknown/unmapped) — it is NEVER silently bucketed. The live
   * source is wired once PSG-434 exposes the field; until then won deals carry `null`
   * and the export surfaces them as `unknown` (never netted). Irrelevant for open deals. */
  revenueType?: RevenueType | null;
  /**
   * Normalized **monthly** MRR contribution of a WON `recurring` deal (PSG-468 /
   * John's §2.1 tightening B). `WonBookedRow.value` is face `$` with no period, but
   * Invoiced MRR is monthly — so a recurring deal's total-contract/annual face-$ must
   * be normalized to a monthly basis before it is netted against Invoiced MRR (often a
   * 12× error otherwise). Derived alongside `revenueType` from the same raw Pipedrive
   * recurring metadata (a native monthly `mrr`, else a recurring amount ÷ derivable
   * interval). **Honest-null rule:** when the interval/basis can't be derived it stays
   * `null` — never silently annualized or assumed monthly; such a recurring deal is
   * counted for manual reconcile, never mechanically netted. `null` for `one_time`,
   * `unknown`, and open deals. */
  monthlyValue?: number | null;
  /**
   * Raw Pipedrive custom-field values, keyed by field key/hash (the deal's bag of
   * org-specific fields). Pipedrive has no native recurring flag, so when a recurring/
   * one-time signal lives in a custom field, the export reads it via the caller's
   * `revenueTypeFieldKey` (PSG-463) and maps it deterministically. Optional/absent
   * until such a field is wired; irrelevant for open deals. */
  customFields?: Record<string, unknown> | null;
}

export type DealStatus = "open" | "won" | "lost" | "deleted";

/**
 * Revenue character of a won/booked deal for the §2.1 Invoiced reconciliation
 * (PSG-435 spec rev 4bd80aec). `null` (unknown) is the honest default when no source
 * maps the deal — it is never netted against MRR by default (CFO double-count guard).
 */
export type RevenueType = "recurring" | "one_time";

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
  /** value × probability — the probability-weighted (expected) contribution of this stage. */
  weightedValue: number;
}

/**
 * The pipeline-weighted forecast Reese hands to John (PSG-432 §2.1). Three named
 * lines per Reese's CRO sign-off (PSG-435), low → high confidence:
 *   committed  ≤  weighted/expected  ≤  best-case
 */
export interface PipelineForecast {
  /** Total count of open deals. */
  openDealCount: number;
  /**
   * COMMITTED (floor): Σ value of open deals at ≥ S6 (Contract) — the face-$ pipeline
   * we'd stake the quarter on. NOT probability-weighted. This is the "downside floor".
   */
  committedValue: number;
  /** Σ (value × probability) over the committed (≥ S6) deals only. */
  committedWeightedValue: number;
  /** Count of open deals meeting the committed (≥ S6) gate. */
  committedDealCount: number;
  /**
   * WEIGHTED / EXPECTED (base): Σ (value × probability) over ALL open deals — the
   * probability-weighted midpoint that feeds John's §2.1 forecast. (Formerly mislabeled
   * `committedValue`; renamed per PSG-435.)
   */
  weightedValue: number;
  /** BEST CASE (ceiling): Σ value over all open deals — un-weighted upside. */
  bestCaseValue: number;
  currency: string;
  /** Per-stage breakdown (S0–S8), ordered by stageId ascending. */
  perStage: StageBreakdown[];
}
