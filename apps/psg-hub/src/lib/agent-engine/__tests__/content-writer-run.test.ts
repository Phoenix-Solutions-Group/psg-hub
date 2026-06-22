// BSM Phase 0 / PSG-191 — Content Writer run harness coverage.
//
// Proves the generate → gate → persist chokepoint: a fact-backed asset ships and
// shapes into a content_items draft; an unbacked claim or a denylist hit (a
// competitor mention) HARD-FAILs and can never reach persistence.

import { describe, it, expect } from "vitest";
import {
  gateGeneratedAsset,
  isShippable,
  renderAssetText,
  toContentItemDraft,
  type GeneratedAsset,
} from "../index";
import { verifiedFactsSchema, type VerifiedFacts } from "@/lib/claim-integrity";

const SHOP_ID = "shop-tracys";
const LOCATION_ID = "loc-tracys-1";

const facts: VerifiedFacts = verifiedFactsSchema.parse({
  shopId: SHOP_ID,
  certifications: [{ kind: "i_car", label: "I-CAR Gold Class", level: "Gold Class", issuer: "I-CAR" }],
  warranty: { terms: "Lifetime warranty on all collision repairs", lifetime: true },
  yearsInBusiness: 30,
  approvedReviewQuotes: [{ quote: "They made my car look brand new.", attribution: "Maria G." }],
  drpDisclosure: { allowed: false, authorizedCarriers: [] },
  knownCompetitors: ["Joe's Body Shop"],
});

function backedAsset(): GeneratedAsset {
  return {
    shopId: SHOP_ID,
    contentType: "service_page",
    title: "Collision Repair in Lincoln, NE",
    body:
      "Our I-CAR Gold Class technicians have repaired Lincoln's vehicles for 30 years. " +
      "Every repair is backed by a lifetime warranty on all collision repairs.",
    metaDescription: "I-CAR Gold Class collision repair in Lincoln, NE — lifetime warranty. Call for an estimate.",
    claimsManifest: [
      { claimText: "I-CAR Gold Class technicians", field: "certifications", value: "I-CAR Gold Class" },
      { claimText: "for 30 years", field: "yearsInBusiness", value: "30" },
      { claimText: "lifetime warranty on all collision repairs", field: "warranty", value: "Lifetime warranty on all collision repairs" },
    ],
  };
}

describe("renderAssetText", () => {
  it("includes title, body and meta so the denylist scans the full surface", () => {
    const text = renderAssetText(backedAsset());
    expect(text).toContain("Collision Repair in Lincoln");
    expect(text).toContain("lifetime warranty");
    expect(text).toContain("Call for an estimate"); // from metaDescription
  });
});

describe("gateGeneratedAsset", () => {
  it("ships an asset whose every claim resolves to verified facts", () => {
    const gated = gateGeneratedAsset(backedAsset(), facts);
    expect(gated.result.verdict).toBe("ship");
    expect(gated.result.hardFail).toBe(false);
    expect(gated.result.violations).toHaveLength(0);
    expect(isShippable(gated)).toBe(true);
  });

  it("HARD-FAILs an unbacked claim (years exceeding the record)", () => {
    const asset = backedAsset();
    asset.body = asset.body.replace("for 30 years", "for 50 years");
    asset.claimsManifest = asset.claimsManifest.map((c) =>
      c.field === "yearsInBusiness" ? { ...c, claimText: "for 50 years", value: "50" } : c,
    );
    const gated = gateGeneratedAsset(asset, facts);
    expect(gated.result.verdict).toBe("reject");
    expect(gated.result.hardFail).toBe(true);
    expect(isShippable(gated)).toBe(false);
  });

  it("HARD-FAILs a denylist hit (naming a competitor) even with a clean manifest", () => {
    const asset = backedAsset();
    asset.body += " Unlike Joe's Body Shop, we get it right the first time.";
    const gated = gateGeneratedAsset(asset, facts);
    expect(gated.result.hardFail).toBe(true);
    expect(gated.result.violations.some((v) => v.code === "competitor_mention")).toBe(true);
  });
});

describe("toContentItemDraft", () => {
  it("shapes a shipped asset into a draft row carrying its manifest + verdict", () => {
    const gated = gateGeneratedAsset(backedAsset(), facts);
    const draft = toContentItemDraft(gated, LOCATION_ID);
    expect(draft.status).toBe("draft");
    expect(draft.shopId).toBe(SHOP_ID);
    expect(draft.locationId).toBe(LOCATION_ID);
    expect(draft.type).toBe("service_page");
    expect(draft.title).toBe("Collision Repair in Lincoln, NE");
    expect(draft.claimsManifest).toHaveLength(3);
    expect(draft.claimIntegrityVerdict.verdict).toBe("ship");
  });

  it("nulls the title for a bare meta_description asset", () => {
    const asset = backedAsset();
    asset.contentType = "meta_description";
    asset.body = "I-CAR Gold Class collision repair in Lincoln, NE — lifetime warranty.";
    asset.metaDescription = undefined;
    const draft = toContentItemDraft(gateGeneratedAsset(asset, facts), LOCATION_ID);
    expect(draft.type).toBe("meta_description");
    expect(draft.title).toBeNull();
  });

  it("refuses to persist an asset that failed the gate", () => {
    const asset = backedAsset();
    asset.body += " Unlike Joe's Body Shop, we get it right the first time.";
    const gated = gateGeneratedAsset(asset, facts);
    expect(isShippable(gated)).toBe(false);
    expect(() => toContentItemDraft(gated, LOCATION_ID)).toThrow(/claim-integrity/);
  });
});
