// BSM Phase 0 / PSG-158 — buildContentDraftRequest behavior coverage.
//
// Covers the Content Writer consumption point: brief.targetKeywords UNION
// mid-draft asks deduped by keyword, shopId carried through (for the PSG-143
// claim-integrity gate downstream), schema validation, and empty-target
// rejection (the writer must be fed).

import { describe, it, expect } from "vitest";
import {
  adaptSeoKeywordTarget,
  adaptSeoKeywordTargets,
  buildContentDraftRequest,
  buildContentDraftRequestFromSeoTargets,
  contentBriefSchema,
  contentDraftRequestSchema,
  keywordTargetSchema,
  type ContentBrief,
  type KeywordTarget,
} from "../index";
import type { KeywordTarget as SeoKeywordTargetDTO } from "@/types/keyword-target";

const NOW = "2026-06-20T00:00:00.000Z";

const briefKeywords: KeywordTarget[] = [
  { keyword: "collision repair lincoln ne", intent: "local", priority: 92 },
  { keyword: "free collision estimate", intent: "transactional", priority: 70 },
];

function briefWith(targetKeywords: KeywordTarget[]): ContentBrief {
  return contentBriefSchema.parse({
    id: "brief-1",
    shopId: "shop-tracys",
    topic: "What to do after a collision in Lincoln, NE",
    targetKeywords,
    competitorGap: "No local shop covers the insurance-paperwork walkthrough",
    audiencePersona: "Recently-in-an-accident local driver",
    priorityScore: 88,
    sources: { auditReportId: "audit-1", sentimentReportIds: ["sent-1"] },
    createdAt: NOW,
  });
}

describe("buildContentDraftRequest", () => {
  it("returns a schema-valid ContentDraftRequest", () => {
    const req = buildContentDraftRequest(briefWith(briefKeywords), [], "blog_post");
    // Round-trip through the schema proves it is genuinely valid.
    expect(() => contentDraftRequestSchema.parse(req)).not.toThrow();
    expect(req.contentType).toBe("blog_post");
    expect(req.brief.id).toBe("brief-1");
  });

  it("carries the brief's shopId through for the claim-integrity gate", () => {
    const req = buildContentDraftRequest(briefWith(briefKeywords), [], "service_page");
    expect(req.shopId).toBe("shop-tracys");
    expect(req.shopId).toBe(req.brief.shopId);
  });

  it("unions brief targets with mid-draft asks", () => {
    const midDraft: KeywordTarget[] = [
      { keyword: "towing after accident", intent: "emergency", priority: 85 },
    ];
    const req = buildContentDraftRequest(briefWith(briefKeywords), midDraft, "blog_post");
    expect(req.keywordTargets.map((t) => t.keyword)).toEqual([
      "collision repair lincoln ne",
      "free collision estimate",
      "towing after accident",
    ]);
  });

  it("dedupes by keyword, with the brief's target winning over a mid-draft ask", () => {
    const midDraft: KeywordTarget[] = [
      // Same keyword as a brief target but with a different priority — should be dropped.
      { keyword: "collision repair lincoln ne", intent: "local", priority: 10 },
      { keyword: "bumper repair", intent: "service", priority: 55 },
    ];
    const req = buildContentDraftRequest(briefWith(briefKeywords), midDraft, "blog_post");
    expect(req.keywordTargets.map((t) => t.keyword)).toEqual([
      "collision repair lincoln ne",
      "free collision estimate",
      "bumper repair",
    ]);
    // First occurrence (the brief's) wins: priority stays 92, not 10.
    const lincoln = req.keywordTargets.find((t) => t.keyword === "collision repair lincoln ne");
    expect(lincoln?.priority).toBe(92);
  });

  it("dedupes repeated mid-draft asks", () => {
    const midDraft: KeywordTarget[] = [
      { keyword: "frame straightening", intent: "service", priority: 60 },
      { keyword: "frame straightening", intent: "service", priority: 99 },
    ];
    const req = buildContentDraftRequest(briefWith([]), midDraft, "blog_post");
    expect(req.keywordTargets).toHaveLength(1);
    expect(req.keywordTargets[0].priority).toBe(60);
  });

  it("rejects an empty effective keyword set (the writer must be fed)", () => {
    expect(() => buildContentDraftRequest(briefWith([]), [], "blog_post")).toThrow();
  });

  it("builds from mid-draft asks alone when the brief has no targets", () => {
    const midDraft: KeywordTarget[] = [
      { keyword: "paintless dent repair", intent: "service", priority: 75 },
    ];
    const req = buildContentDraftRequest(briefWith([]), midDraft, "meta_description");
    expect(req.keywordTargets.map((t) => t.keyword)).toEqual(["paintless dent repair"]);
    expect(req.contentType).toBe("meta_description");
  });

  it("does not mutate the brief's targetKeywords", () => {
    const brief = briefWith(briefKeywords);
    const before = brief.targetKeywords.map((t) => t.keyword);
    buildContentDraftRequest(brief, [{ keyword: "x", intent: "service", priority: 1 }], "blog_post");
    expect(brief.targetKeywords.map((t) => t.keyword)).toEqual(before);
  });
});

/* -------------------------------------------------------------------------- */
/* PSG-164 — SEO-Auditor loader → canonical KeywordTarget adapter             */
/* -------------------------------------------------------------------------- */

function seoDto(over: Partial<SeoKeywordTargetDTO> = {}): SeoKeywordTargetDTO {
  return {
    keyword: "bumper repair",
    search_volume: 1200,
    competitor_presence: 3,
    gap_opportunity: false,
    priority: "MEDIUM",
    source: "seo-auditor",
    ...over,
  };
}

describe("adaptSeoKeywordTarget", () => {
  it("maps the HIGH/MEDIUM/LOW bucket to a numeric 85/55/25 priority", () => {
    expect(adaptSeoKeywordTarget(seoDto({ priority: "HIGH" })).priority).toBe(85);
    expect(adaptSeoKeywordTarget(seoDto({ priority: "MEDIUM" })).priority).toBe(55);
    expect(adaptSeoKeywordTarget(seoDto({ priority: "LOW" })).priority).toBe(25);
  });

  it("carries search_volume → searchVolume only when > 0 (0 means 'unknown')", () => {
    expect(adaptSeoKeywordTarget(seoDto({ search_volume: 1200 })).searchVolume).toBe(1200);
    // The loader uses 0 for 'no SEMrush volume'; the canonical contract represents
    // that as the optional field being absent, not a real zero-volume keyword.
    expect(adaptSeoKeywordTarget(seoDto({ search_volume: 0 })).searchVolume).toBeUndefined();
  });

  it("folds gap_opportunity + competitor_presence into rationale and drops source", () => {
    const t = adaptSeoKeywordTarget(
      seoDto({ priority: "HIGH", gap_opportunity: true, competitor_presence: 4 }),
    );
    expect(t.rationale).toContain("HIGH priority");
    expect(t.rationale).toContain("content gap");
    expect(t.rationale).toContain("4 competitors ranking");
    // `source` has no canonical field and must not leak through.
    expect(t).not.toHaveProperty("source");
    expect(t).not.toHaveProperty("gap_opportunity");
    expect(t).not.toHaveProperty("competitor_presence");
  });

  it("singularizes the competitor count and omits it at zero", () => {
    expect(adaptSeoKeywordTarget(seoDto({ competitor_presence: 1 })).rationale).toContain(
      "1 competitor ranking",
    );
    expect(adaptSeoKeywordTarget(seoDto({ competitor_presence: 0 })).rationale).not.toContain(
      "competitor",
    );
  });

  it("infers a canonical intent from the keyword, defaulting to service", () => {
    expect(adaptSeoKeywordTarget(seoDto({ keyword: "towing after accident" })).intent).toBe(
      "emergency",
    );
    expect(adaptSeoKeywordTarget(seoDto({ keyword: "free collision estimate" })).intent).toBe(
      "transactional",
    );
    expect(adaptSeoKeywordTarget(seoDto({ keyword: "how long does collision repair take" })).intent).toBe(
      "informational",
    );
    expect(adaptSeoKeywordTarget(seoDto({ keyword: "auto body shop near me" })).intent).toBe(
      "transactional",
    );
    // Locality word without a transaction verb → local.
    expect(adaptSeoKeywordTarget(seoDto({ keyword: "collision repair in lincoln" })).intent).toBe(
      "local",
    );
    // No verb/locality signal → the BSM-default service intent.
    expect(adaptSeoKeywordTarget(seoDto({ keyword: "frame straightening" })).intent).toBe("service");
  });

  it("always produces a schema-valid canonical KeywordTarget", () => {
    const t = adaptSeoKeywordTarget(seoDto({ priority: "LOW", search_volume: 0 }));
    expect(() => keywordTargetSchema.parse(t)).not.toThrow();
  });

  it("never mutates the input DTO", () => {
    const dto = seoDto();
    const snapshot = JSON.stringify(dto);
    adaptSeoKeywordTarget(dto);
    expect(JSON.stringify(dto)).toBe(snapshot);
  });

  it("adaptSeoKeywordTargets maps a batch in order", () => {
    const out = adaptSeoKeywordTargets([
      seoDto({ keyword: "a", priority: "HIGH" }),
      seoDto({ keyword: "b", priority: "LOW" }),
    ]);
    expect(out.map((t) => [t.keyword, t.priority])).toEqual([
      ["a", 85],
      ["b", 25],
    ]);
  });
});

describe("buildContentDraftRequestFromSeoTargets (both-halves merge)", () => {
  it("merges the canonical brief with adapted SEO loader targets", () => {
    const seoTargets: SeoKeywordTargetDTO[] = [
      seoDto({ keyword: "bumper repair", priority: "HIGH", search_volume: 2000 }),
    ];
    const req = buildContentDraftRequestFromSeoTargets(
      briefWith(briefKeywords),
      seoTargets,
      "blog_post",
    );
    // Round-trips through the canonical schema → the adapter produced valid targets.
    expect(() => contentDraftRequestSchema.parse(req)).not.toThrow();
    expect(req.keywordTargets.map((t) => t.keyword)).toEqual([
      "collision repair lincoln ne",
      "free collision estimate",
      "bumper repair",
    ]);
    const bumper = req.keywordTargets.find((t) => t.keyword === "bumper repair");
    expect(bumper?.priority).toBe(85);
    expect(bumper?.searchVolume).toBe(2000);
  });

  it("lets the brief's canonical target win over an SEO loader collision", () => {
    const seoTargets: SeoKeywordTargetDTO[] = [
      // Same keyword as a brief target — the brief's richer target must win.
      seoDto({ keyword: "collision repair lincoln ne", priority: "LOW" }),
    ];
    const req = buildContentDraftRequestFromSeoTargets(
      briefWith(briefKeywords),
      seoTargets,
      "blog_post",
    );
    const lincoln = req.keywordTargets.find((t) => t.keyword === "collision repair lincoln ne");
    // Brief priority (92) survives, not the adapted LOW (25).
    expect(lincoln?.priority).toBe(92);
    expect(req.keywordTargets).toHaveLength(2);
  });

  it("builds from SEO loader targets alone when the brief has no targets", () => {
    const seoTargets: SeoKeywordTargetDTO[] = [seoDto({ keyword: "paintless dent repair" })];
    const req = buildContentDraftRequestFromSeoTargets(briefWith([]), seoTargets, "service_page");
    expect(req.keywordTargets.map((t) => t.keyword)).toEqual(["paintless dent repair"]);
  });

  it("rejects an empty effective keyword set (no brief targets, no SEO targets)", () => {
    expect(() => buildContentDraftRequestFromSeoTargets(briefWith([]), [], "blog_post")).toThrow();
  });
});
