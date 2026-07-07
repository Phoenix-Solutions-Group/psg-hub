// BSM Content-Quality Standard v1 — encoding tests (PSG-752).
//
// Covers the C2 conversion-structure gate, the composed machine evaluator
// (C1 + C2 + C6), and the drafting-prompt / human-review text surfaces.

import { describe, it, expect } from "vitest";
import { verifiedFactsSchema, type VerifiedFacts } from "@/lib/claim-integrity";
import type { GeneratedAsset } from "@/lib/agent-engine";
import {
  CONTENT_QUALITY_CHECKS,
  DRAFTING_SELF_CHECKS,
  HUMAN_REVIEW_CHECKS,
  MACHINE_CHECKS,
  buildDraftingGuidance,
  buildHumanReviewChecklist,
  checkConversionStructure,
  evaluateContentQuality,
  isMachinePassing,
} from "../index";

const facts: VerifiedFacts = verifiedFactsSchema.parse({ shopId: "shop-x" });

function servicePage(body: string, title = "Collision Repair"): GeneratedAsset {
  return { shopId: "shop-x", contentType: "service_page", title, body, claimsManifest: [] };
}

const CLEAN_PAGE_BODY = [
  "Wrecked car? [Call Tracy's now](tel:+14025551212) and talk to a real estimator.",
  "We work with all insurance companies and handle your claim — and it's your choice which shop repairs your car.",
  "Get a free estimate today. We're I-CAR trained and back our work.",
  "Ready to start? [Call Tracy's](tel:+14025551212) or request a free estimate online.",
].join("\n\n");

describe("standard metadata", () => {
  it("encodes all 10 checks C1..C10", () => {
    expect(CONTENT_QUALITY_CHECKS).toHaveLength(10);
    expect(CONTENT_QUALITY_CHECKS.map((c) => c.id)).toEqual([
      "C1", "C2", "C3", "C4", "C5", "C6", "C7", "C8", "C9", "C10",
    ]);
  });

  it("marks C1, C2, C6 as the machine-checkable hard blocks", () => {
    expect(MACHINE_CHECKS.map((c) => c.id)).toEqual(["C1", "C2", "C6"]);
    expect(MACHINE_CHECKS.every((c) => c.enforcement === "hard")).toBe(true);
  });

  it("leaves C8 and C10 to human review", () => {
    expect(HUMAN_REVIEW_CHECKS.map((c) => c.id)).toEqual(["C8", "C10"]);
  });

  it("folds C3, C4, C5, C7, C9 into the drafting self-checks", () => {
    expect(DRAFTING_SELF_CHECKS.map((c) => c.id)).toEqual(["C3", "C4", "C5", "C7", "C9"]);
  });
});

describe("drafting + human-review text surfaces", () => {
  it("drafting guidance names the one-job rule, the hard constraints and each self-check", () => {
    const g = buildDraftingGuidance();
    expect(g).toContain("ONE JOB");
    for (const id of ["C1", "C2", "C6", "C3", "C4", "C5", "C7", "C9"]) expect(g).toContain(id);
    expect(g.toLowerCase()).toContain("flag it for human confirmation");
  });

  it("human-review checklist surfaces C8 and C10", () => {
    const c = buildHumanReviewChecklist();
    expect(c).toContain("C8");
    expect(c).toContain("C10");
  });
});

describe("C2 — conversion structure", () => {
  it("passes a shop page with tel: + estimate, early and repeated", () => {
    expect(checkConversionStructure(servicePage(CLEAN_PAGE_BODY))).toHaveLength(0);
  });

  it("flags a missing tap-to-call action", () => {
    const body = "Get a free estimate today. Request a free estimate online.";
    const codes = checkConversionStructure(servicePage(body)).map((v) => v.code);
    expect(codes).toContain("missing_call_action");
  });

  it("flags a missing estimate action and a non-repeated primary action", () => {
    const body = "Questions? [Call us](tel:+14025551212).";
    const codes = checkConversionStructure(servicePage(body)).map((v) => v.code);
    expect(codes).toContain("missing_estimate_action");
    expect(codes).toContain("conversion_action_not_repeated");
  });

  it("flags a tap-to-call buried below the first screen", () => {
    const filler = "We repair collision damage with care. ".repeat(60); // > first-screen cutoff
    const body = `${filler}\n\nGet a free estimate. [Call us](tel:+14025551212). Request a free estimate.`;
    const codes = checkConversionStructure(servicePage(body)).map((v) => v.code);
    expect(codes).toContain("call_action_not_early");
  });

  it("does not apply to blog posts or meta descriptions", () => {
    const blog: GeneratedAsset = {
      shopId: "shop-x", contentType: "blog_post", title: "How long does repair take?",
      body: "It depends on the damage.", claimsManifest: [],
    };
    expect(checkConversionStructure(blog)).toHaveLength(0);
  });
});

describe("evaluateContentQuality (composed C1 + C2 + C6)", () => {
  it("SHIPs a clean shop page and surfaces the human-review checks", () => {
    const r = evaluateContentQuality(servicePage(CLEAN_PAGE_BODY), facts);
    expect(r.verdict).toBe("ship");
    expect(isMachinePassing(r)).toBe(true);
    expect(r.humanReview.map((c) => c.id)).toEqual(["C8", "C10"]);
  });

  it("REJECTs a shop page with a C1 superlative", () => {
    const r = evaluateContentQuality(
      servicePage(`We're #1 in town. ${CLEAN_PAGE_BODY}`),
      facts,
    );
    expect(r.verdict).toBe("reject");
    expect(r.violations.map((v) => v.code)).toContain("unprovable_superlative");
  });

  it("REJECTs a shop page missing its tap-to-call action (C2)", () => {
    const body = "Get a free estimate today. Request a free estimate online.";
    const r = evaluateContentQuality(servicePage(body), facts);
    expect(r.verdict).toBe("reject");
    expect(r.conversionStructure.map((v) => v.code)).toContain("missing_call_action");
  });
});
