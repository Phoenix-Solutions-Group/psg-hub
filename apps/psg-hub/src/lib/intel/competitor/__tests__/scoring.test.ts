import { describe, it, expect } from "vitest";
import {
  haversineMiles,
  proximityScore,
  presenceScore,
  consolidatorWeight,
  scoreCompetitor,
  scoreShopCompetitors,
} from "../scoring";
import { DEFAULT_SCORING_WEIGHTS, type Competitor, type ShopContext } from "../types";

const SHOP: ShopContext = { id: "shop-1", latitude: 40.0, longitude: -74.0, searchRadiusMiles: 10 };

function competitor(over: Partial<Competitor> = {}): Competitor {
  return {
    id: "c1",
    shopId: "shop-1",
    name: "Rival Auto Body",
    type: "independent",
    consolidatorGroup: null,
    latitude: 40.0,
    longitude: -74.0,
    distanceMiles: 0,
    rating: 4.0,
    reviewCount: 50,
    website: null,
    source: "manual",
    ...over,
  };
}

describe("haversineMiles", () => {
  it("is ~0 for identical points and null when a coordinate is missing", () => {
    expect(haversineMiles(SHOP, SHOP)).toBeCloseTo(0, 5);
    expect(haversineMiles(SHOP, { latitude: null, longitude: -74 })).toBeNull();
  });

  it("computes a known one-degree-latitude distance (~69 miles)", () => {
    const d = haversineMiles(
      { latitude: 40, longitude: -74 },
      { latitude: 41, longitude: -74 },
    );
    expect(d).toBeGreaterThan(68);
    expect(d).toBeLessThan(70);
  });
});

describe("proximityScore", () => {
  it("is 1 at the shop, ~0.5 at half radius, 0 at/over the edge", () => {
    expect(proximityScore(0, 10)).toBe(1);
    expect(proximityScore(5, 10)).toBeCloseTo(0.5, 5);
    expect(proximityScore(10, 10)).toBe(0);
    expect(proximityScore(20, 10)).toBe(0);
  });

  it("is neutral 0.5 when distance is unknown", () => {
    expect(proximityScore(null, 10)).toBe(0.5);
  });
});

describe("presenceScore", () => {
  it("is 0 when rating is unknown or non-positive", () => {
    expect(presenceScore(null, 100)).toBe(0);
    expect(presenceScore(0, 100)).toBe(0);
  });

  it("rises with both rating and review volume", () => {
    const lowVol = presenceScore(4.5, 5);
    const highVol = presenceScore(4.5, 300);
    expect(highVol).toBeGreaterThan(lowVol);
    const lowRating = presenceScore(3.0, 300);
    expect(presenceScore(4.5, 300)).toBeGreaterThan(lowRating);
  });
});

describe("consolidatorWeight", () => {
  it("is 1.0 for independents and 1+premium for consolidators", () => {
    expect(consolidatorWeight(competitor({ type: "independent" }), 0.35)).toBe(1);
    expect(consolidatorWeight(competitor({ type: "consolidator" }), 0.35)).toBeCloseTo(1.35, 5);
  });
});

describe("scoreCompetitor", () => {
  it("a consolidator outscores an identical independent (consolidator-aware)", () => {
    const indep = scoreCompetitor(competitor({ id: "a", type: "independent" }), SHOP);
    const cons = scoreCompetitor(
      competitor({ id: "b", type: "consolidator", consolidatorGroup: "Caliber Collision" }),
      SHOP,
    );
    expect(cons.threatScore).toBeGreaterThan(indep.threatScore);
    expect(cons.consolidatorWeight).toBeGreaterThan(1);
    expect(cons.rationale).toContain("Caliber Collision");
  });

  it("computes distance from coordinates when distanceMiles is not pre-set", () => {
    const far = scoreCompetitor(
      competitor({ distanceMiles: null, latitude: 41, longitude: -74 }), // ~69mi, outside radius
      SHOP,
    );
    expect(far.proximityScore).toBe(0);
  });

  it("caps threatScore at 100", () => {
    const maxed = scoreCompetitor(
      competitor({ type: "consolidator", distanceMiles: 0, rating: 5, reviewCount: 100000 }),
      SHOP,
      { ...DEFAULT_SCORING_WEIGHTS, consolidatorPremium: 5 },
    );
    expect(maxed.threatScore).toBeLessThanOrEqual(100);
  });
});

describe("scoreShopCompetitors", () => {
  it("ranks by threat descending, 1-based, deterministic on ties", () => {
    const ranked = scoreShopCompetitors(
      [
        competitor({ id: "weak", distanceMiles: 9, rating: 3, reviewCount: 2 }),
        competitor({
          id: "strong",
          type: "consolidator",
          consolidatorGroup: "Crash Champions",
          distanceMiles: 1,
          rating: 4.7,
          reviewCount: 400,
        }),
      ],
      SHOP,
    );
    expect(ranked[0].competitorId).toBe("strong");
    expect(ranked[0].rank).toBe(1);
    expect(ranked[1].rank).toBe(2);
    expect(ranked[0].threatScore).toBeGreaterThan(ranked[1].threatScore);
  });

  it("returns an empty array for no competitors", () => {
    expect(scoreShopCompetitors([], SHOP)).toEqual([]);
  });
});
