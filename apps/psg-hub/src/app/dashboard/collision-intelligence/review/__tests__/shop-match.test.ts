import { describe, expect, it } from "vitest";
import {
  approvedPoliciesWithoutCustomerAudience,
  forecastCandidateEvidence,
  matchesVerifiedShopLocation,
  normalizeShopMatchText,
  preferredForecastPilot,
  rankShopMatches,
  shopMemberCount,
  summarizeForecastCandidateEvidence,
  type ShopDirectoryEntry,
} from "../shop-match";

const shops: ShopDirectoryEntry[] = [
  {
    id: "collision-center",
    name: "Tracy's Collision Center",
    slug: "tracys-collision-center",
    address_street: null,
    address_locality: null,
    address_region: null,
    address_postal_code: null,
    client: { name: "Tracy's Collision Center" },
  },
  {
    id: "body-shop",
    name: "South Lincoln",
    slug: null,
    address_street: "1500 Center Park Road",
    address_locality: "Lincoln",
    address_region: "NE",
    address_postal_code: "68512",
    client: { name: "Tracy's Body Shop" },
  },
  {
    id: "wallace",
    name: "Wallace Collision Center",
    slug: "wallace-collision-center",
    address_street: "1010 N Main St",
    address_locality: "Ottawa",
    address_region: "KS",
    address_postal_code: "66067",
    client: { name: "Wallace Collision Center" },
  },
];

describe("shop identity matching", () => {
  it("normalizes punctuation and smart apostrophes", () => {
    expect(normalizeShopMatchText(" Tracy’s  Collision—Center ")).toBe(
      "tracys collision center",
    );
  });

  it("ranks the closest name but flags a missing source location", () => {
    const matches = rankShopMatches("Tracy’s Collision Center South", shops);

    expect(matches[0].shop.id).toBe("collision-center");
    expect(matches[0].locationWarning).toBe(true);
    expect(matches[0].score).toBeLessThan(80);
    expect(matches.map((match) => match.shop.id)).toContain("body-shop");
  });

  it("searches the directory by location without auto-approving a name match", () => {
    const matches = rankShopMatches(
      "Tracy’s Collision Center South",
      shops,
      "Lincoln NE",
    );

    expect(matches[0].shop.id).toBe("body-shop");
    expect(matches[0].searchScore).toBe(100);
  });

  it("marks an exact shop name as strong", () => {
    const [match] = rankShopMatches("Wallace Collision Center", shops);

    expect(match.shop.id).toBe("wallace");
    expect(match.score).toBe(100);
  });

  it("does not suggest a shop based only on generic industry words", () => {
    expect(rankShopMatches("IFM Collision Center", shops)).toEqual([]);
    expect(rankShopMatches("Andover Auto Body", shops)).toEqual([]);
  });

  it("keeps a close spelling match on the distinctive name", () => {
    const [match] = rankShopMatches("Walace Collision Center", shops);

    expect(match.shop.id).toBe("wallace");
    expect(match.score).toBeGreaterThanOrEqual(80);
  });

  it("requires the verified Tracy's street and ZIP", () => {
    expect(matchesVerifiedShopLocation("PS229", shops[0])).toBe(false);
    expect(matchesVerifiedShopLocation("PS229", shops[1])).toBe(true);
    expect(
      rankShopMatches("Tracy’s Collision Center South", shops)
        .filter((match) => matchesVerifiedShopLocation("PS229", match.shop))
        .map((match) => match.shop.id),
    ).toEqual(["body-shop"]);
  });

  it("keeps preview evidence separate from release readiness", () => {
    expect(forecastCandidateEvidence.PS229).toMatchObject({
      source: "preview",
      holdoutRepairs: 844,
      maeImprovementPct: [20.1, 24.1],
      intervalCoveragePct: [80.4, 85.1],
    });
    expect(preferredForecastPilot(forecastCandidateEvidence)).toBe("PS229");
  });

  it("summarizes a governed four-horizon snapshot", () => {
    const evidence = summarizeForecastCandidateEvidence({
      source_shop_key: "PS229",
      latest_week_cutoff: "2026-08-03",
      evaluated_at: "2026-08-20T12:00:00Z",
      horizons: [1, 2, 3, 4].map((forecast_horizon_weeks) => ({
        forecast_horizon_weeks,
        model_key: "seasonal_recent_blend_v1",
        model_wape_pct: 16 + forecast_horizon_weeks,
        mae_improvement_pct: 25 - forecast_horizon_weeks,
        holdout_repairs: 844,
        excluded_internal_gap_weeks: 0,
        interval_validation_coverage_pct: 80 + forecast_horizon_weeks,
      })),
    });

    expect(evidence).toMatchObject({
      source: "governed",
      modelLabel: "Seasonal + recent blend",
      holdoutRepairs: 844,
      maeImprovementPct: [21, 24],
      wapePct: [17, 20],
      intervalCoveragePct: [81, 84],
    });
  });

  it("rejects malformed governed evidence", () => {
    expect(
      summarizeForecastCandidateEvidence({
        source_shop_key: "PS229",
        latest_week_cutoff: "2026-08-03",
        evaluated_at: "2026-08-20T12:00:00Z",
        horizons: [{ forecast_horizon_weeks: 1 }],
      }),
    ).toBeNull();
  });

  it("rejects name-only mappings without governed address evidence", () => {
    expect(matchesVerifiedShopLocation("PS1023", shops[2])).toBe(false);
  });

  it("treats a missing membership aggregate as an empty customer audience", () => {
    const customerProfileIds = new Set(["customer-1", "customer-2"]);

    expect(shopMemberCount(shops[0], customerProfileIds)).toBe(0);
    expect(
      shopMemberCount(
        {
          members: [{ user_id: "customer-1" }, { user_id: "staff-1" }],
        },
        customerProfileIds,
      ),
    ).toBe(1);
  });

  it("surfaces only approved policies without a customer-role member", () => {
    const customerProfileIds = new Set(["customer-1"]);
    const audienceShops = [
      { ...shops[0], members: [{ user_id: "staff-1" }] },
      { ...shops[1], members: [{ user_id: "customer-1" }] },
    ];

    expect(
      approvedPoliciesWithoutCustomerAudience(
        [
          { shop_id: "collision-center", promotion_status: "approved" },
          { shop_id: "body-shop", promotion_status: "approved" },
          { shop_id: "wallace", promotion_status: "review" },
        ],
        audienceShops,
        customerProfileIds,
      ).map((policy) => policy.shop_id),
    ).toEqual(["collision-center"]);
  });
});
