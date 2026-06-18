// v1.6 / 16-02 — Competitor engine types.
// A competitor is a rival body shop near one of our shops. The engine scores how much of
// a threat each competitor is, "consolidator-aware": a location owned by a national MSO
// consolidator (Caliber, Gerber, Crash Champions, …) is a structurally bigger threat than
// an independent at the same distance/rating (deeper capital, DRP relationships, brand
// pull), so its score carries a multiplier. See consolidators.ts + scoring.ts.

export type CompetitorType = "independent" | "consolidator";

/** How a competitor record entered the system. Live web_grounded/yext are G5-gated. */
export type CompetitorSource = "manual" | "gbp" | "web_grounded" | "yext";

export type Competitor = {
  id: string;
  shopId: string;
  name: string;
  type: CompetitorType;
  /** Consolidator brand group when type==="consolidator" (e.g. "Caliber Collision"). */
  consolidatorGroup: string | null;
  latitude: number | null;
  longitude: number | null;
  /** Straight-line miles from the owning shop, when both coordinates are known. */
  distanceMiles: number | null;
  /** Public rating 0–5 (e.g. Google), when known. */
  rating: number | null;
  reviewCount: number | null;
  website: string | null;
  source: CompetitorSource;
};

/** Minimal owning-shop context the scorer needs (subset of public.shops). */
export type ShopContext = {
  id: string;
  latitude: number | null;
  longitude: number | null;
  /** Service-area radius in miles; competitors beyond it score low on proximity. */
  searchRadiusMiles: number | null;
};

export type CompetitorScore = {
  competitorId: string;
  shopId: string;
  /** 0–100 composite threat. Higher = more competitive pressure on the shop. */
  threatScore: number;
  /** Sub-scores (0–1) that compose the threat, kept for the report's rationale. */
  proximityScore: number;
  presenceScore: number;
  /** Multiplier applied for consolidator status (1.0 for independents). */
  consolidatorWeight: number;
  /** 1-based rank within the shop's competitor set (1 = top threat). */
  rank: number;
  /** Short human-readable explanation of the score (for the agentic report). */
  rationale: string;
};

/** Tunable scoring weights. Base weights are blended, then consolidator-multiplied. */
export type ScoringWeights = {
  /** Weight on proximity in the base blend. Default 0.5. */
  proximity: number;
  /** Weight on market presence in the base blend. Default 0.5. */
  presence: number;
  /** Extra multiplier added for consolidator-owned locations. Default 0.35 (→ ×1.35). */
  consolidatorPremium: number;
  /** Review count at which presence volume saturates. Default 300. */
  reviewSaturation: number;
};

export const DEFAULT_SCORING_WEIGHTS: ScoringWeights = {
  proximity: 0.5,
  presence: 0.5,
  consolidatorPremium: 0.35,
  reviewSaturation: 300,
};
