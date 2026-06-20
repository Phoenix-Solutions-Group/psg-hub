// BSM Phase 0 / PSG-158 — buildContentDraftRequest behavior coverage.
//
// Covers the Content Writer consumption point: brief.targetKeywords UNION
// mid-draft asks deduped by keyword, shopId carried through (for the PSG-143
// claim-integrity gate downstream), schema validation, and empty-target
// rejection (the writer must be fed).

import { describe, it, expect } from "vitest";
import {
  buildContentDraftRequest,
  contentBriefSchema,
  contentDraftRequestSchema,
  type ContentBrief,
  type KeywordTarget,
} from "../index";

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
