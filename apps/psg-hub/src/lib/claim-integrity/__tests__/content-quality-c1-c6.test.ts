// BSM Content-Quality Standard v1 — C1 (honest claims) + C6 (reviews gatekeeper)
// hard-block tests (PSG-752). These verify the claim-integrity trust gate was
// extended so an unprovable superlative, an undocumentable number, or an
// unverified/weak/unlinkable/over-claimed rating is a HARD-FAIL.

import { describe, it, expect } from "vitest";
import {
  checkClaimIntegrity,
  scanSuperlatives,
  scanUnverifiableNumbers,
  scanRating,
  verifiedFactsSchema,
  type VerifiedFacts,
} from "../index";

const noRatingFacts: VerifiedFacts = verifiedFactsSchema.parse({ shopId: "shop-x" });
const goodRatingFacts: VerifiedFacts = verifiedFactsSchema.parse({
  shopId: "shop-x",
  rating: { value: 4.8, reviewCount: 250, profileUrl: "https://g.page/shop-x" },
});
const lowRatingFacts: VerifiedFacts = verifiedFactsSchema.parse({
  shopId: "shop-x",
  rating: { value: 4.2, profileUrl: "https://g.page/shop-x" },
});
const unlinkedRatingFacts: VerifiedFacts = verifiedFactsSchema.parse({
  shopId: "shop-x",
  rating: { value: 4.8 },
});

describe("C1 — unprovable superlatives", () => {
  it("flags '#1 in town'", () => {
    const v = scanSuperlatives("We are the #1 body shop in town.");
    expect(v.map((x) => x.code)).toContain("unprovable_superlative");
  });

  it("flags 'voted best' and 'best in the state'", () => {
    expect(scanSuperlatives("Voted best collision shop.").length).toBeGreaterThan(0);
    expect(scanSuperlatives("The best in the state, hands down.").length).toBeGreaterThan(0);
  });

  it("does not flag honest, non-superlative copy", () => {
    expect(scanSuperlatives("Certified collision repair, trusted since 1969.")).toHaveLength(0);
    expect(scanSuperlatives("We do our best to get you back on the road.")).toHaveLength(0);
  });
});

describe("C1 — undocumentable hard numbers", () => {
  it("flags a repaired-vehicle count", () => {
    const v = scanUnverifiableNumbers("We have repaired over 10,000 cars.");
    expect(v.map((x) => x.code)).toContain("unverifiable_number");
  });

  it("does not flag a founding year or a backed tenure phrase", () => {
    expect(scanUnverifiableNumbers("Serving the area since 1969.")).toHaveLength(0);
    expect(scanUnverifiableNumbers("Over 20 years of collision experience.")).toHaveLength(0);
  });
});

describe("C6 — reviews are the gatekeeper", () => {
  it("rejects a rating when the shop has none on record (never invent)", () => {
    expect(scanRating("Rated 4.9 by our customers.", noRatingFacts.rating).map((x) => x.code)).toContain(
      "unverified_rating",
    );
    expect(scanRating("Over 300 reviews!", noRatingFacts.rating).map((x) => x.code)).toContain(
      "unverified_rating",
    );
  });

  it("allows a rating that is real, ≥4.5★ and linkable", () => {
    expect(scanRating("4.8 stars on Google.", goodRatingFacts.rating)).toHaveLength(0);
    expect(scanRating("Read our 250 reviews.", goodRatingFacts.rating)).toHaveLength(0);
  });

  it("rejects a rating below the ~4.5★ bar (omit, don't dress up)", () => {
    expect(scanRating("4.2 stars.", lowRatingFacts.rating).map((x) => x.code)).toContain(
      "rating_below_threshold",
    );
  });

  it("rejects a rating with no linkable profile", () => {
    expect(scanRating("Rated 4.8.", unlinkedRatingFacts.rating).map((x) => x.code)).toContain(
      "rating_not_linkable",
    );
  });

  it("rejects an over-claimed rating", () => {
    expect(scanRating("We're rated 5.0 stars!", goodRatingFacts.rating).map((x) => x.code)).toContain(
      "overclaimed_rating",
    );
  });

  it("passes copy that makes no rating claim", () => {
    expect(scanRating("Certified collision repair in Lincoln, NE.", noRatingFacts.rating)).toHaveLength(0);
  });
});

describe("checkClaimIntegrity end-to-end (C1/C6 folded into the gate)", () => {
  it("REJECTs a draft that brags '#1 in town'", () => {
    const r = checkClaimIntegrity({
      text: "We're #1 in town for collision repair.",
      manifest: [],
      facts: noRatingFacts,
    });
    expect(r.verdict).toBe("reject");
    expect(r.hardFail).toBe(true);
    expect(r.violations.map((v) => v.code)).toContain("unprovable_superlative");
  });

  it("REJECTs a draft that surfaces a rating with no verified rating", () => {
    const r = checkClaimIntegrity({
      text: "Rated 4.9 stars by our customers.",
      manifest: [],
      facts: noRatingFacts,
    });
    expect(r.verdict).toBe("reject");
    expect(r.violations.map((v) => v.code)).toContain("unverified_rating");
  });

  it("SHIPs a clean draft that names its rating when verified ≥4.5★ + linkable", () => {
    const r = checkClaimIntegrity({
      text: "4.8 stars on Google. Call us to start your repair.",
      manifest: [{ claimText: "4.8 stars on Google", field: "rating", value: "4.8" }],
      facts: goodRatingFacts,
    });
    expect(r.verdict).toBe("ship");
    expect(r.hardFail).toBe(false);
  });

  it("REJECTs a manifest rating claim that over-claims the verified value", () => {
    const r = checkClaimIntegrity({
      text: "A great place.",
      manifest: [{ claimText: "5.0 rating", field: "rating", value: "5.0" }],
      facts: goodRatingFacts,
    });
    expect(r.verdict).toBe("reject");
    expect(r.violations.map((v) => v.code)).toContain("overclaimed_rating");
  });
});
