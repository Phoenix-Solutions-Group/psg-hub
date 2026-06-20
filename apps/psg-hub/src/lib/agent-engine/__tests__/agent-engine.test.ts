// BSM Phase 0 / PSG-153 — Agent-engine contract tests.
//
// Proves the cross-module data contracts compile and validate end to end:
// an SEO AuditReport (with keyword targets) + a scraper SentimentReport flow
// into a ContentBrief, which flows into a Content Writer ContentDraftRequest.
// The synthesis/selection functions themselves are seams (implemented by the
// PSG-153 child issues) and are asserted here only to be present + not-yet-impl,
// so the contract is locked before parallel implementation begins.

import { describe, it, expect } from "vitest";
import {
  auditReportSchema,
  sentimentReportSchema,
  contentBriefSchema,
  contentDraftRequestSchema,
  keywordTargetSchema,
  KEYWORD_INTENTS,
  CONTENT_BRIEF_STATUSES,
  synthesizeContentBrief,
  selectKeywordTargets,
  buildContentDraftRequest,
  type AuditReport,
  type SentimentReport,
  type ContentBrief,
} from "../index";

const NOW = "2026-06-20T00:00:00.000Z";

const sampleAudit: AuditReport = auditReportSchema.parse({
  id: "audit-1",
  shopId: "shop-tracys",
  type: "technical_seo",
  findings: [{ severity: "high", area: "page speed", detail: "LCP 4.1s on mobile" }],
  recommendations: ["Compress hero image", "Defer non-critical JS"],
  keywordTargets: [
    {
      keyword: "collision repair lincoln ne",
      intent: "local",
      searchVolume: 880,
      difficulty: 34,
      currentRank: null,
      priority: 92,
      rationale: "High local volume, not ranking",
    },
    {
      keyword: "free collision estimate",
      intent: "transactional",
      searchVolume: 320,
      difficulty: 21,
      currentRank: 14,
      priority: 70,
    },
  ],
  createdAt: NOW,
});

const sampleSentiment: SentimentReport = sentimentReportSchema.parse({
  id: "sent-1",
  shopId: "shop-tracys",
  source: "google_reviews",
  topic: "turnaround time",
  sentimentScore: 0.62,
  trendingTopics: ["rental car help", "insurance paperwork"],
  createdAt: NOW,
});

describe("agent-engine contracts", () => {
  it("validates the SEO Auditor → keyword-target handoff payload", () => {
    expect(sampleAudit.keywordTargets).toHaveLength(2);
    expect(KEYWORD_INTENTS).toContain(sampleAudit.keywordTargets[0].intent);
    // priority is bounded 0–100
    expect(() => keywordTargetSchema.parse({ keyword: "x", intent: "local", priority: 150 })).toThrow();
  });

  it("validates a ContentBrief that carries audit keywords + scraper provenance", () => {
    const brief: ContentBrief = contentBriefSchema.parse({
      id: "brief-1",
      shopId: "shop-tracys",
      topic: "What to do after a collision in Lincoln, NE",
      targetKeywords: sampleAudit.keywordTargets,
      competitorGap: "No local shop covers the insurance-paperwork walkthrough",
      audiencePersona: "Recently-in-an-accident local driver, stressed, time-poor",
      priorityScore: 88,
      status: "draft",
      sources: { auditReportId: sampleAudit.id, sentimentReportIds: [sampleSentiment.id] },
      createdAt: NOW,
    });
    // The SEO Auditor signal survives into the brief.
    expect(brief.targetKeywords.map((k) => k.keyword)).toContain("collision repair lincoln ne");
    // Provenance lets QA prove upstream data was consumed.
    expect(brief.sources.auditReportId).toBe("audit-1");
    expect(brief.sources.sentimentReportIds).toContain("sent-1");
    expect(CONTENT_BRIEF_STATUSES).toContain(brief.status);
  });

  it("validates the Content Writer ContentDraftRequest consumption point", () => {
    const brief = contentBriefSchema.parse({
      id: "brief-1",
      shopId: "shop-tracys",
      topic: "Post-collision guide",
      targetKeywords: sampleAudit.keywordTargets,
      competitorGap: "gap",
      audiencePersona: "persona",
      priorityScore: 88,
      sources: { auditReportId: "audit-1", sentimentReportIds: [] },
      createdAt: NOW,
    });
    const req = contentDraftRequestSchema.parse({
      shopId: "shop-tracys",
      brief,
      keywordTargets: sampleAudit.keywordTargets,
      contentType: "blog_post",
    });
    expect(req.keywordTargets.length).toBeGreaterThan(0);
    // A draft request with zero keyword targets is rejected (writer must be fed).
    expect(() =>
      contentDraftRequestSchema.parse({ shopId: "s", brief, keywordTargets: [], contentType: "blog_post" }),
    ).toThrow();
  });

  // All three PSG-153 cross-module seams are now implemented:
  //  • synthesizeContentBrief (PSG-156) — Market Researcher; behavior coverage in
  //    market-researcher.test.ts.
  //  • selectKeywordTargets / buildContentDraftRequest (PSG-158) — SEO Auditor →
  //    Content Writer; behavior coverage in seo-auditor.test.ts and
  //    content-writer-handoff.test.ts.
  // The assertions below are the integration smoke test that they are wired in.
  describe("synthesis/selection seams (PSG-153 children)", () => {
    it("synthesizeContentBrief is implemented and returns a validated brief (PSG-156)", () => {
      expect(typeof synthesizeContentBrief).toBe("function");
      const brief = synthesizeContentBrief(sampleAudit, [sampleSentiment], { briefId: "b", now: NOW });
      expect(brief.id).toBe("b");
      expect(brief.sources.auditReportId).toBe(sampleAudit.id);
    });
    it("selectKeywordTargets is implemented (PSG-158)", () => {
      expect(typeof selectKeywordTargets).toBe("function");
      expect(() => selectKeywordTargets(sampleAudit)).not.toThrow();
    });
    it("buildContentDraftRequest is implemented (PSG-158)", () => {
      expect(typeof buildContentDraftRequest).toBe("function");
      const brief = contentBriefSchema.parse({
        id: "brief-1",
        shopId: "shop-tracys",
        topic: "t",
        targetKeywords: sampleAudit.keywordTargets,
        competitorGap: "g",
        audiencePersona: "p",
        priorityScore: 50,
        sources: { auditReportId: "audit-1", sentimentReportIds: [] },
        createdAt: NOW,
      });
      expect(() => buildContentDraftRequest(brief, sampleAudit.keywordTargets, "blog_post")).not.toThrow();
    });
  });
});
