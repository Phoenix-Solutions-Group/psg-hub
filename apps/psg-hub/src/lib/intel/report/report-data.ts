// v1.6 / 16-03 — Competitor intelligence report assembler.
// PURE + node-testable, in the same injected-deps mould as lib/report/report-data.ts and the
// 16-01 router: the deterministic report (ranking, tiers, consolidator share) is built from the
// CompetitorScore set produced build-local by 16-02 with ZERO vendor spend. The single metered
// piece — the grounded LLM narrative — is injected as `deps.narrate`; when it is absent (the
// build-local / pre-G5 posture) or fails, the report still assembles with a pending-activation
// notice. This module never imports the server-only router wiring, so it runs under vitest's
// node env; the live narrate factory lives in ./server.ts.

import type { Competitor, CompetitorScore, ScoringWeights } from "../competitor/types";
import { DEFAULT_SCORING_WEIGHTS } from "../competitor/types";
import type {
  CompetitorReport,
  CompetitorReportSummary,
  GroundedNarrative,
  RankedCompetitor,
  ReportNarrative,
  ThreatTier,
} from "./types";
import { TIER_THRESHOLDS } from "./types";

const DEFAULT_TOP_N = 10;

const PENDING_NOTICE =
  "Grounded narrative pending G5 vendor-spend activation. The deterministic threat " +
  "ranking below is complete and current; the LLM executive summary activates once " +
  "metered providers are enabled.";

/** Map a 0–100 threat score to its band. */
export function threatTier(score: number): ThreatTier {
  for (const { tier, min } of TIER_THRESHOLDS) {
    if (score >= min) return tier;
  }
  return "low";
}

/** Median of a numeric list, or null when empty. Does not mutate the input. */
function median(values: number[]): number | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0 ? (sorted[mid - 1] + sorted[mid]) / 2 : sorted[mid];
}

/**
 * Input handed to a grounded-narrative generator. Deliberately small + already-aggregated:
 * the generator grounds its prose in THESE numbers, never in raw PII, keeping the metered
 * prompt tight and the grounding auditable.
 */
export type NarrativeInput = {
  shopId: string;
  summary: CompetitorReportSummary;
  /** The top-N competitors, rank-ascending — the same list shown in the report. */
  topCompetitors: RankedCompetitor[];
};

/**
 * Injected grounded-narrative generator. Production wiring (./server.ts) routes through the
 * 16-01 multi-LLM router and is only enabled once the board clears G5. Returns null to signal
 * "could not ground" (e.g. providers still gated) — the assembler then degrades to a
 * pending-activation notice rather than failing the whole report.
 */
export type NarrativeGenerator = (input: NarrativeInput) => Promise<GroundedNarrative | null>;

export type AssembleCompetitorReportDeps = {
  /** ISO timestamp stamped onto the report (injected for purity/determinism). */
  generatedAt: string;
  /** How many top-threat competitors to surface. Default 10. */
  topN?: number;
  /** Scoring weights echoed into the report footer (audit). Default DEFAULT_SCORING_WEIGHTS. */
  weights?: ScoringWeights;
  /** Optional grounded-narrative generator (G5-gated). Absent => pending-activation notice. */
  narrate?: NarrativeGenerator;
};

/**
 * Join one shop's scored competitor set into the report payload.
 * `scores` are the CompetitorScore rows from 16-02 (already ranked); `competitors` supplies the
 * display fields. Scores whose competitor record is missing are dropped (defensive). The
 * deterministic summary is computed over the WHOLE set; the ranked list is the top-N.
 */
export async function assembleCompetitorReport(
  competitors: Competitor[],
  scores: CompetitorScore[],
  deps: AssembleCompetitorReportDeps,
): Promise<CompetitorReport> {
  const topN = deps.topN ?? DEFAULT_TOP_N;
  const weights = deps.weights ?? DEFAULT_SCORING_WEIGHTS;
  const byId = new Map(competitors.map((c) => [c.id, c]));

  // Join + sort rank-ascending. A score with no matching competitor is dropped.
  const ranked: RankedCompetitor[] = scores
    .map((s): RankedCompetitor | null => {
      const c = byId.get(s.competitorId);
      if (!c) return null;
      return {
        rank: s.rank,
        competitorId: s.competitorId,
        name: c.name,
        type: c.type,
        consolidatorGroup: c.consolidatorGroup,
        distanceMiles: c.distanceMiles,
        rating: c.rating,
        reviewCount: c.reviewCount,
        threatScore: s.threatScore,
        tier: threatTier(s.threatScore),
        rationale: s.rationale,
      };
    })
    .filter((r): r is RankedCompetitor => r !== null)
    .sort((a, b) => a.rank - b.rank);

  const shopId = scores[0]?.shopId ?? competitors[0]?.shopId ?? "";

  const consolidatorCount = ranked.filter((r) => r.type === "consolidator").length;
  const tierCounts: Record<ThreatTier, number> = {
    critical: 0,
    elevated: 0,
    moderate: 0,
    low: 0,
  };
  for (const r of ranked) tierCounts[r.tier] += 1;

  const top = ranked.slice(0, topN);
  const topThreatScore = ranked.reduce((max, r) => Math.max(max, r.threatScore), 0);
  const averageTopThreat =
    top.length === 0
      ? 0
      : Math.round(top.reduce((sum, r) => sum + r.threatScore, 0) / top.length);
  const medianDistanceMiles = median(
    top
      .map((r) => r.distanceMiles)
      .filter((d): d is number => typeof d === "number"),
  );

  const summary: CompetitorReportSummary = {
    totalCompetitors: ranked.length,
    consolidatorCount,
    independentCount: ranked.length - consolidatorCount,
    consolidatorShare: ranked.length === 0 ? 0 : consolidatorCount / ranked.length,
    topThreatScore,
    averageTopThreat,
    medianDistanceMiles,
    tierCounts,
  };

  return {
    shopId,
    generatedAt: deps.generatedAt,
    weights,
    summary,
    rankedCompetitors: top,
    narrative: await buildNarrative({ shopId, summary, topCompetitors: top }, deps.narrate),
  };
}

/**
 * Resolve the narrative block. No generator wired (pre-G5) => pending notice. A wired generator
 * that returns null or throws (provider gated / transient failure) => pending notice too, so a
 * narrative outage never sinks the deterministic report.
 */
async function buildNarrative(
  input: NarrativeInput,
  narrate: NarrativeGenerator | undefined,
): Promise<ReportNarrative> {
  if (!narrate) return { status: "pending_activation", notice: PENDING_NOTICE };
  try {
    const grounded = await narrate(input);
    if (!grounded) return { status: "pending_activation", notice: PENDING_NOTICE };
    return { status: "grounded", ...grounded };
  } catch {
    return { status: "pending_activation", notice: PENDING_NOTICE };
  }
}
