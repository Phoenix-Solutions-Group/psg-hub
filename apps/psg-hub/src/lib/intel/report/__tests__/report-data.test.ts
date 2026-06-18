// v1.6 / 16-03 — Competitor report assembler tests. Pure: no DB, no network, no LLM.
import { describe, it, expect, vi } from "vitest";
import { assembleCompetitorReport, threatTier } from "../report-data";
import type { NarrativeInput } from "../report-data";
import type { Competitor, CompetitorScore } from "../../competitor/types";
import type { GroundedNarrative } from "../types";

const GEN_AT = "2026-06-18T00:00:00.000Z";

function competitor(p: Partial<Competitor> & { id: string }): Competitor {
  return {
    id: p.id,
    shopId: p.shopId ?? "shop-1",
    name: p.name ?? `Comp ${p.id}`,
    type: p.type ?? "independent",
    consolidatorGroup: p.consolidatorGroup ?? null,
    latitude: p.latitude ?? null,
    longitude: p.longitude ?? null,
    distanceMiles: p.distanceMiles ?? null,
    rating: p.rating ?? null,
    reviewCount: p.reviewCount ?? null,
    website: p.website ?? null,
    source: p.source ?? "manual",
  };
}

function score(p: Partial<CompetitorScore> & { competitorId: string; rank: number }): CompetitorScore {
  return {
    competitorId: p.competitorId,
    shopId: p.shopId ?? "shop-1",
    threatScore: p.threatScore ?? 50,
    proximityScore: p.proximityScore ?? 0.5,
    presenceScore: p.presenceScore ?? 0.5,
    consolidatorWeight: p.consolidatorWeight ?? 1,
    rank: p.rank,
    rationale: p.rationale ?? "rationale",
  };
}

describe("threatTier", () => {
  it("maps scores to bands at the cutoffs", () => {
    expect(threatTier(100)).toBe("critical");
    expect(threatTier(75)).toBe("critical");
    expect(threatTier(74)).toBe("elevated");
    expect(threatTier(50)).toBe("elevated");
    expect(threatTier(49)).toBe("moderate");
    expect(threatTier(25)).toBe("moderate");
    expect(threatTier(24)).toBe("low");
    expect(threatTier(0)).toBe("low");
  });
});

describe("assembleCompetitorReport", () => {
  const competitors = [
    competitor({ id: "a", type: "consolidator", consolidatorGroup: "Caliber Collision", distanceMiles: 2, rating: 4.5, reviewCount: 200 }),
    competitor({ id: "b", type: "independent", distanceMiles: 4, rating: 4.0, reviewCount: 50 }),
    competitor({ id: "c", type: "independent", distanceMiles: 6, rating: 3.5, reviewCount: 10 }),
  ];
  const scores = [
    score({ competitorId: "a", rank: 1, threatScore: 88 }),
    score({ competitorId: "b", rank: 2, threatScore: 52 }),
    score({ competitorId: "c", rank: 3, threatScore: 20 }),
  ];

  it("builds a deterministic summary + ranked list with no narrate dep", async () => {
    const r = await assembleCompetitorReport(competitors, scores, { generatedAt: GEN_AT });

    expect(r.shopId).toBe("shop-1");
    expect(r.generatedAt).toBe(GEN_AT);
    expect(r.summary.totalCompetitors).toBe(3);
    expect(r.summary.consolidatorCount).toBe(1);
    expect(r.summary.independentCount).toBe(2);
    expect(r.summary.consolidatorShare).toBeCloseTo(1 / 3, 5);
    expect(r.summary.topThreatScore).toBe(88);
    expect(r.summary.averageTopThreat).toBe(Math.round((88 + 52 + 20) / 3)); // 53
    expect(r.summary.medianDistanceMiles).toBe(4); // median of [2,4,6]
    expect(r.summary.tierCounts).toEqual({ critical: 1, elevated: 1, moderate: 0, low: 1 });

    // rank-ascending, joined display fields + tier
    expect(r.rankedCompetitors.map((c) => c.competitorId)).toEqual(["a", "b", "c"]);
    expect(r.rankedCompetitors[0]).toMatchObject({ name: "Comp a", tier: "critical", consolidatorGroup: "Caliber Collision" });
    expect(r.narrative).toEqual({ status: "pending_activation", notice: expect.stringContaining("G5") });
  });

  it("honors topN for the ranked list but keeps summary over the whole set", async () => {
    const r = await assembleCompetitorReport(competitors, scores, { generatedAt: GEN_AT, topN: 2 });
    expect(r.rankedCompetitors).toHaveLength(2);
    expect(r.summary.totalCompetitors).toBe(3); // summary still spans all
    expect(r.summary.averageTopThreat).toBe(Math.round((88 + 52) / 2)); // 70, top-2 only
    expect(r.summary.medianDistanceMiles).toBe(3); // median of top-2 distances [2,4]
  });

  it("drops scores whose competitor record is missing", async () => {
    const r = await assembleCompetitorReport(
      [competitors[0]],
      scores, // b and c have no competitor record
      { generatedAt: GEN_AT },
    );
    expect(r.summary.totalCompetitors).toBe(1);
    expect(r.rankedCompetitors.map((c) => c.competitorId)).toEqual(["a"]);
  });

  it("re-sorts by rank even when scores arrive out of order", async () => {
    const shuffled = [scores[2], scores[0], scores[1]];
    const r = await assembleCompetitorReport(competitors, shuffled, { generatedAt: GEN_AT });
    expect(r.rankedCompetitors.map((c) => c.rank)).toEqual([1, 2, 3]);
  });

  it("yields zeroed summary + pending notice for an empty set", async () => {
    const r = await assembleCompetitorReport([], [], { generatedAt: GEN_AT });
    expect(r.summary).toMatchObject({
      totalCompetitors: 0,
      consolidatorShare: 0,
      topThreatScore: 0,
      averageTopThreat: 0,
      medianDistanceMiles: null,
    });
    expect(r.rankedCompetitors).toEqual([]);
    expect(r.narrative.status).toBe("pending_activation");
  });

  it("embeds a grounded narrative when narrate resolves", async () => {
    const grounded: GroundedNarrative = {
      summary: "Caliber dominates.",
      keyMoves: ["Defend reviews", "Geo-target ads"],
      provider: "perplexity",
      model: "sonar",
    };
    let captured: NarrativeInput | undefined;
    const narrate = vi.fn(async (input: NarrativeInput) => {
      captured = input;
      return grounded;
    });
    const r = await assembleCompetitorReport(competitors, scores, { generatedAt: GEN_AT, narrate });

    expect(narrate).toHaveBeenCalledTimes(1);
    const input = captured!;
    expect(input.shopId).toBe("shop-1");
    expect(input.topCompetitors.map((c) => c.competitorId)).toEqual(["a", "b", "c"]);
    expect(r.narrative).toEqual({ status: "grounded", ...grounded });
  });

  it("degrades to pending when narrate returns null (provider still gated)", async () => {
    const r = await assembleCompetitorReport(competitors, scores, {
      generatedAt: GEN_AT,
      narrate: async () => null,
    });
    expect(r.narrative.status).toBe("pending_activation");
  });

  it("degrades to pending (never throws) when narrate rejects", async () => {
    const r = await assembleCompetitorReport(competitors, scores, {
      generatedAt: GEN_AT,
      narrate: async () => {
        throw new Error("gateway 503");
      },
    });
    expect(r.narrative.status).toBe("pending_activation");
  });
});
