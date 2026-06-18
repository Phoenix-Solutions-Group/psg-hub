// v1.6 / 16-03 — Competitor intelligence report types.
// The thin-slice deliverable: one grounded agentic report over a shop's scored competitor
// set (16-02). The DETERMINISTIC half — ranking, threat tiers, consolidator share — is built
// build-local from the existing CompetitorScore data with zero vendor spend. The GROUNDED
// narrative half (an LLM summary + recommended moves) is the only metered piece and is wired
// through the 16-01 router; it stays G5-gated and is modelled here as an injected seam, so the
// report assembles and ships either way (narrative.status === "pending_activation" until G5).

import type { CompetitorType, ScoringWeights } from "../competitor/types";
import type { Provider } from "../types";

/** Threat band derived from a competitor's 0–100 composite threat score. */
export type ThreatTier = "critical" | "elevated" | "moderate" | "low";

/** Score → tier cutoffs (inclusive lower bound). critical ≥75, elevated ≥50, moderate ≥25. */
export const TIER_THRESHOLDS: ReadonlyArray<{ tier: ThreatTier; min: number }> = [
  { tier: "critical", min: 75 },
  { tier: "elevated", min: 50 },
  { tier: "moderate", min: 25 },
  { tier: "low", min: 0 },
];

/** One competitor as it appears in the report: the score joined to its display fields. */
export type RankedCompetitor = {
  rank: number;
  competitorId: string;
  name: string;
  type: CompetitorType;
  consolidatorGroup: string | null;
  distanceMiles: number | null;
  rating: number | null;
  reviewCount: number | null;
  threatScore: number;
  tier: ThreatTier;
  /** Deterministic per-competitor rationale carried from the scorer. */
  rationale: string;
};

/** Aggregate, deterministic view of the competitive set (drives the report header). */
export type CompetitorReportSummary = {
  /** All scored competitors for the shop (not just the top-N shown). */
  totalCompetitors: number;
  consolidatorCount: number;
  independentCount: number;
  /** Consolidator-owned share of the set, 0–1. 0 when the set is empty. */
  consolidatorShare: number;
  /** Highest threat score across the whole set. 0 when empty. */
  topThreatScore: number;
  /** Mean threat across the top-N shown in the report. 0 when empty. */
  averageTopThreat: number;
  /** Median straight-line distance of the top-N (non-null distances only). null when none. */
  medianDistanceMiles: number | null;
  /** How many of the whole set fall in each tier. */
  tierCounts: Record<ThreatTier, number>;
};

export type NarrativeStatus = "grounded" | "pending_activation";

/** The grounded-narrative half produced by the (G5-gated) LLM router. */
export type GroundedNarrative = {
  /** 2–4 sentence executive read of the competitive picture. */
  summary: string;
  /** Recommended marketing/operational moves, most important first. */
  keyMoves: string[];
  /** Which provider/model actually produced it (for the report footer + audit). */
  provider: Provider;
  model: string;
};

/** Narrative block on the report: either grounded (G5 active) or a pending-activation notice. */
export type ReportNarrative =
  | ({ status: "grounded" } & GroundedNarrative)
  | { status: "pending_activation"; notice: string };

/** The full report payload for one shop. Deterministic everywhere except `narrative`. */
export type CompetitorReport = {
  shopId: string;
  generatedAt: string;
  weights: ScoringWeights;
  summary: CompetitorReportSummary;
  /** Top-N competitors by threat, rank-ascending. */
  rankedCompetitors: RankedCompetitor[];
  narrative: ReportNarrative;
};
