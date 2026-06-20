// BSM Phase 0 / PSG-143 — Claim-integrity gate tests.
//
// Maps directly to the Content Writer spec §7 acceptance tests: a clean draft
// with a backed manifest passes; injecting an unbacked claim or a DRP/carrier
// mention (without opt-in) is caught as REJECT. Plus the full agent-wiring §3a
// prohibited-patterns denylist.

import { describe, it, expect } from "vitest";
import {
  checkClaimIntegrity,
  verifyManifest,
  verifiedFactsSchema,
  scanDenylist,
  scanCompetitors,
  scanCarrierDisclosure,
  scanAbsoluteCost,
  scanInsuranceImplication,
  type VerifiedFacts,
} from "../index";

/** A representative opted-OUT shop record (default — never disclose DRP). */
const baseFacts: VerifiedFacts = verifiedFactsSchema.parse({
  shopId: "shop-phil-long",
  certifications: [
    { kind: "i_car", label: "I-CAR Gold Class", level: "Gold Class", issuer: "I-CAR" },
    { kind: "oem", label: "Honda ProFirst", issuer: "Honda" },
  ],
  warranty: { terms: "Lifetime warranty on all repairs", lifetime: true },
  yearsInBusiness: 25,
  approvedReviewQuotes: [{ quote: "They made my car look brand new.", attribution: "Maria G." }],
  drpDisclosure: { allowed: false, authorizedCarriers: [] },
  knownCompetitors: ["Springs Auto Body"],
});

/** Same shop, opted IN to disclose State Farm only. */
const optedInFacts: VerifiedFacts = verifiedFactsSchema.parse({
  ...baseFacts,
  drpDisclosure: {
    allowed: true,
    authorizedCarriers: ["State Farm"],
    authorizedBy: "owner@phillong.example",
    authorizedAt: "2026-06-20T00:00:00Z",
  },
});

describe("verifiedFactsSchema", () => {
  it("applies safe defaults for omitted optional blocks", () => {
    const f = verifiedFactsSchema.parse({ shopId: "s1" });
    expect(f.certifications).toEqual([]);
    expect(f.approvedReviewQuotes).toEqual([]);
    expect(f.drpDisclosure).toEqual({ allowed: false, authorizedCarriers: [] });
    expect(f.knownCompetitors).toEqual([]);
  });

  it("rejects a record without a shopId", () => {
    expect(() => verifiedFactsSchema.parse({})).toThrow();
  });
});

describe("checkClaimIntegrity — happy path", () => {
  it("ships a clean draft whose every claim is backed", () => {
    const res = checkClaimIntegrity({
      text:
        "At our shop we are I-CAR Gold Class certified and Honda ProFirst certified. " +
        "We've served the community for 25 years and back our work with a lifetime warranty. " +
        "We work with all major insurers. Call today for a quote.",
      manifest: [
        { claimText: "I-CAR Gold Class certified", field: "certifications", value: "I-CAR Gold Class" },
        { claimText: "Honda ProFirst certified", field: "certifications", value: "Honda ProFirst" },
        { claimText: "25 years", field: "yearsInBusiness", value: "25" },
        { claimText: "lifetime warranty", field: "warranty", value: "lifetime" },
      ],
      facts: baseFacts,
    });
    expect(res.verdict).toBe("ship");
    expect(res.hardFail).toBe(false);
    expect(res.violations).toHaveLength(0);
  });
});

describe("checkClaimIntegrity — unbacked claims (spec §7)", () => {
  it("rejects an asserted certification not in the record", () => {
    const res = checkClaimIntegrity({
      text: "We are I-CAR Platinum certified.",
      manifest: [{ claimText: "I-CAR Platinum certified", field: "certifications", value: "I-CAR Platinum" }],
      facts: baseFacts,
    });
    expect(res.verdict).toBe("reject");
    expect(res.hardFail).toBe(true);
    expect(res.violations[0]?.code).toBe("unbacked_claim");
  });

  it("rejects a claim whose backing field is absent from the record", () => {
    const noWarranty = verifiedFactsSchema.parse({ shopId: "s2" });
    const res = checkClaimIntegrity({
      text: "Backed by a lifetime warranty.",
      manifest: [{ claimText: "lifetime warranty", field: "warranty", value: "lifetime" }],
      facts: noWarranty,
    });
    expect(res.verdict).toBe("reject");
    expect(res.violations[0]?.code).toBe("missing_backing_field");
  });

  it("rejects over-claiming years in business", () => {
    const res = checkClaimIntegrity({
      text: "Serving drivers for 40 years.",
      manifest: [{ claimText: "40 years", field: "yearsInBusiness", value: "40" }],
      facts: baseFacts,
    });
    expect(res.verdict).toBe("reject");
    expect(res.violations[0]?.code).toBe("unbacked_claim");
  });

  it("allows claiming fewer years than verified", () => {
    expect(
      verifyManifest(
        [{ claimText: "over 20 years", field: "yearsInBusiness", value: "20" }],
        baseFacts,
      ),
    ).toHaveLength(0);
  });

  it("rejects a review quote that is not pre-approved", () => {
    const res = checkClaimIntegrity({
      text: '"Best shop in town!" — a happy customer',
      manifest: [{ claimText: "Best shop in town", field: "approvedReviewQuotes", value: "Best shop in town!" }],
      facts: baseFacts,
    });
    expect(res.verdict).toBe("reject");
    expect(res.violations[0]?.code).toBe("unbacked_claim");
  });
});

describe("DRP / carrier disclosure (spec §5)", () => {
  it("rejects naming a carrier when the shop has NOT opted in", () => {
    const res = checkClaimIntegrity({
      text: "We are a State Farm direct repair shop.",
      manifest: [],
      facts: baseFacts,
    });
    expect(res.verdict).toBe("reject");
    expect(res.violations.some((v) => v.code === "carrier_disclosure_not_allowed")).toBe(true);
  });

  it("rejects a manifest DRP claim when not opted in", () => {
    const res = checkClaimIntegrity({
      text: "We handle your claim end to end.",
      manifest: [{ claimText: "DRP relationship", field: "drpDisclosure", value: "State Farm" }],
      facts: baseFacts,
    });
    expect(res.verdict).toBe("reject");
    expect(res.violations[0]?.code).toBe("carrier_disclosure_not_allowed");
  });

  it("allows an authorized carrier when the shop HAS opted in", () => {
    const res = checkClaimIntegrity({
      text: "As a State Farm direct repair program shop, we streamline your repair.",
      manifest: [{ claimText: "State Farm DRP", field: "drpDisclosure", value: "State Farm" }],
      facts: optedInFacts,
    });
    expect(res.verdict).toBe("ship");
  });

  it("rejects naming a carrier that is opted-in but NOT authorized", () => {
    const res = checkClaimIntegrity({
      text: "We work directly with Geico on your repair.",
      manifest: [],
      facts: optedInFacts, // only State Farm authorized
    });
    expect(res.verdict).toBe("reject");
    expect(res.violations.some((v) => v.code === "carrier_not_authorized")).toBe(true);
  });

  it('allows generic "all major insurers" phrasing', () => {
    expect(scanCarrierDisclosure("We work with all major insurers.", baseFacts.drpDisclosure)).toHaveLength(0);
  });

  // PSG-150 regression: a generic phrase must NOT suppress carrier flagging.
  it("rejects a named carrier riding alongside a generic phrase (opt-out)", () => {
    const res = checkClaimIntegrity({
      text: "We work with all major insurers, including State Farm and Geico.",
      manifest: [],
      facts: baseFacts, // opted OUT
    });
    expect(res.verdict).toBe("reject");
    const carrierViolations = res.violations.filter((v) => v.code === "carrier_disclosure_not_allowed");
    expect(carrierViolations.map((v) => v.evidence)).toEqual(
      expect.arrayContaining(["State Farm", "Geico"]),
    );
    expect(carrierViolations).toHaveLength(2);
  });

  it("does not flag a generic phrase with no named carrier (opt-out, no false-positive)", () => {
    const res = checkClaimIntegrity({
      text: "We work with all major insurers.",
      manifest: [],
      facts: baseFacts, // opted OUT
    });
    expect(res.verdict).toBe("ship");
    expect(res.violations).toHaveLength(0);
  });

  it("ships an authorized carrier named alongside a generic phrase (opt-in)", () => {
    const res = checkClaimIntegrity({
      text: "We work with all major insurers, including State Farm, our direct repair partner.",
      manifest: [{ claimText: "State Farm DRP", field: "drpDisclosure", value: "State Farm" }],
      facts: optedInFacts, // State Farm authorized
    });
    expect(res.verdict).toBe("ship");
    expect(res.violations).toHaveLength(0);
  });
});

describe("prohibited-patterns denylist (agent-wiring §3a)", () => {
  it("flags competitor mentions — built-in consolidators", () => {
    expect(scanCompetitors("Unlike Caliber Collision, we put you first.")).toHaveLength(1);
  });

  it("flags per-shop competitor mentions", () => {
    const v = scanDenylist("Better than Springs Auto Body.", baseFacts.drpDisclosure, baseFacts.knownCompetitors);
    expect(v.some((x) => x.code === "competitor_mention")).toBe(true);
  });

  it("flags absolute-cost promises", () => {
    expect(scanAbsoluteCost("There is no charge to you.").length).toBeGreaterThan(0);
    expect(scanAbsoluteCost("Your deductible is waived.").length).toBeGreaterThan(0);
    expect(scanAbsoluteCost("Enjoy a free rental while we work.").length).toBeGreaterThan(0);
    expect(scanAbsoluteCost("We waive your deductible.").length).toBeGreaterThan(0);
  });

  it("does not flag neutral cost language", () => {
    expect(scanAbsoluteCost("We'll walk you through your estimate and any deductible.")).toHaveLength(0);
  });

  it("flags implying every job is an insurance claim", () => {
    expect(scanInsuranceImplication("Every repair is an insurance claim with us.").length).toBeGreaterThan(0);
  });

  it("does not flag normal copy", () => {
    expect(scanDenylist("Quality collision repair you can trust.", baseFacts.drpDisclosure)).toHaveLength(0);
  });
});

describe("multiple violations accumulate", () => {
  it("collects every distinct violation in one pass", () => {
    const res = checkClaimIntegrity({
      text:
        "Unlike Caliber Collision, we are I-CAR Platinum certified, work with State Farm, " +
        "and there is no charge to you.",
      manifest: [{ claimText: "I-CAR Platinum", field: "certifications", value: "I-CAR Platinum" }],
      facts: baseFacts,
    });
    expect(res.verdict).toBe("reject");
    const codes = res.violations.map((v) => v.code);
    expect(codes).toContain("unbacked_claim");
    expect(codes).toContain("competitor_mention");
    expect(codes).toContain("carrier_disclosure_not_allowed");
    expect(codes).toContain("absolute_cost_promise");
  });
});
