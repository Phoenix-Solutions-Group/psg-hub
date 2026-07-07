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

// PSG-775 — C1 hardening: digit-form rank brags and vague / adjective-padded
// quantity boasts that slipped past the human review in PSG-762 QA must now be
// caught by the machine, WITHOUT any new false positive on honest tenure /
// contact / address / service copy. Fixtures are 1:1 with the C1 Hardening Spec.
describe("C1 hardening (PSG-775) — MUST-BLOCK rank & quantity brags", () => {
  const MUST_BLOCK: readonly [string, string][] = [
    // [pattern, copy]
    ["1b", "We're number 1 in Westchester"],
    ["1b", "The number one collision shop in town"],
    ["1c", "No. 1 rated body shop"],
    ["1a", "#1 rated auto body"],
    ["1e", "The best body shop in Yonkers"],
    ["1d", "Top-rated collision repair — guaranteed"],
    ["1d", "Yonkers' premier auto body center"],
    ["1d", "Unbeatable prices, unbeatable service"],
    ["2a", "We've repaired thousands of cars"],
    ["2a", "Hundreds of happy customers"],
    ["2b", "5,000 happy families served"],
    ["2a", "Countless satisfied drivers"],
  ];

  for (const [pattern, copy] of MUST_BLOCK) {
    it(`[${pattern}] BLOCKS: ${copy}`, () => {
      const v = [...scanSuperlatives(copy), ...scanUnverifiableNumbers(copy)];
      expect(v.length, `expected a C1 violation for "${copy}"`).toBeGreaterThan(0);
    });
  }
});

describe("C1 hardening (PSG-775) — MUST-PASS honest copy (zero false positives)", () => {
  const MUST_PASS: readonly string[] = [
    // Tenure
    "Serving Yonkers since 1969",
    "Family-owned for over 20 years",
    "22 years in business",
    // Phone
    "Call (914) 555-0100",
    "Text us at 914-555-0199",
    // Address / bay numbers
    "1 Tuckahoe Road, Yonkers, NY",
    "No. 5 Central Ave",
    "Drop-off at Bay 1",
    // Service copy
    "We handle all insurance claims",
    "Free estimates",
    "I-CAR Gold Class certified",
    // Adverbial "best" — not a business superlative
    "We'll do our best to get you back on the road",
  ];

  for (const copy of MUST_PASS) {
    it(`PASSES: ${copy}`, () => {
      expect(scanSuperlatives(copy), `superlative false-positive on "${copy}"`).toHaveLength(0);
      expect(scanUnverifiableNumbers(copy), `number false-positive on "${copy}"`).toHaveLength(0);
    });
  }
});

// PSG-793 — two narrow edges found in Lee's PSG-775 sign-off. Neither changes
// any behavior on the shipped acceptance set; they close a title-cased brag that
// slipped through and stop over-flagging one honest phrase.
describe("C1 polish (PSG-793) — title-cased 'best in <place>' is caught", () => {
  const MUST_BLOCK: readonly string[] = [
    "Best in Town", // title-cased closed place-word (the reported gap)
    "Best in Town — call today!",
    "BEST IN THE STATE", // all-caps headline
    "Best in the State", // title-cased with a lowercase article before the noun
    "Best in Yonkers", // title-cased proper-noun place
  ];
  for (const copy of MUST_BLOCK) {
    it(`BLOCKS: ${copy}`, () => {
      expect(scanSuperlatives(copy).length, `expected a C1 violation for "${copy}"`).toBeGreaterThan(0);
    });
  }
});

describe("C1 polish (PSG-793) — honest 'best work' copy is no longer over-flagged", () => {
  const MUST_PASS: readonly string[] = [
    "Our best work shows in every repair",
    "We take pride in our best work",
  ];
  for (const copy of MUST_PASS) {
    it(`PASSES: ${copy}`, () => {
      expect(scanSuperlatives(copy), `superlative false-positive on "${copy}"`).toHaveLength(0);
    });
  }

  it("still blocks a genuine business superlative like 'best body shop'", () => {
    expect(scanSuperlatives("The best body shop around").length).toBeGreaterThan(0);
  });

  it("still lets a capital-required proper noun distinguish an innocent 'best in <lowercase>' phrase", () => {
    // "class" is a lowercase common noun, not a proper-noun place, so the
    // capital-sensitive proper-noun rule leaves it alone (pre-existing behavior,
    // preserved after the leading-word case-fold).
    expect(scanSuperlatives("Best in class turnaround time")).toHaveLength(0);
  });
});

describe("C1 hardening (PSG-775) — attribution escape hatch (a linked source clears it)", () => {
  it("passes a superlative attributed to a named third party WITH a link", () => {
    const copy = "Voted best body shop — Westchester Magazine 2026 https://westchestermagazine.com/best-of";
    expect(scanSuperlatives(copy)).toHaveLength(0);
  });

  it("still BLOCKS the same superlative when there is NO link (no link, no pass)", () => {
    const copy = "Voted best body shop — Westchester Magazine 2026";
    expect(scanSuperlatives(copy).length).toBeGreaterThan(0);
  });

  it("passes an attributed count WITH a link", () => {
    const copy = "Over 5,000 vehicles repaired — verified on Google https://g.page/shop-x";
    expect(scanUnverifiableNumbers(copy)).toHaveLength(0);
  });

  it("does not let a link two sentences away excuse an unattributed brag", () => {
    const copy = "We're #1 in town. Visit us at https://ourshop.com";
    expect(scanSuperlatives(copy).length).toBeGreaterThan(0);
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
