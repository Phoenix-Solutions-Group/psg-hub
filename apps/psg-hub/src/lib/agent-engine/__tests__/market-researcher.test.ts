// BSM Phase 0 / PSG-156 — Market Researcher → ContentBrief synthesis tests.
//
// Covers the acceptance criteria for synthesizeContentBrief:
//   • happy path — produces a schema-valid ContentBrief
//   • keyword survival — targetKeywords are drawn ONLY from the auditor (no invention)
//   • provenance — sources reference the audit id + EXACTLY the sentiment ids used
//   • no-sentiment fallback — degrades gracefully with zero SentimentReports
//   • priorityScore — derived from keyword priority + sentiment signal, bounded 0–100
//   • determinism + no input mutation

import { describe, it, expect } from "vitest";
import {
  auditReportSchema,
  sentimentReportSchema,
  contentBriefSchema,
  synthesizeContentBrief,
  type AuditReport,
  type SentimentReport,
} from "../index";

const NOW = "2026-06-20T00:00:00.000Z";

function makeAudit(overrides: Partial<AuditReport> = {}): AuditReport {
  return auditReportSchema.parse({
    id: "audit-1",
    shopId: "shop-tracys",
    type: "content_gap",
    findings: [{ severity: "high", area: "page speed", detail: "LCP 4.1s on mobile" }],
    recommendations: ["Publish an insurance-paperwork walkthrough"],
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
    ...overrides,
  });
}

function makeSentiment(overrides: Partial<SentimentReport> = {}): SentimentReport {
  return sentimentReportSchema.parse({
    id: "sent-1",
    shopId: "shop-tracys",
    source: "google_reviews",
    topic: "turnaround time",
    sentimentScore: 0.62,
    trendingTopics: ["rental car help", "insurance paperwork"],
    createdAt: NOW,
    ...overrides,
  });
}

describe("synthesizeContentBrief (PSG-156)", () => {
  it("happy path: produces a schema-valid ContentBrief from audit + sentiment", () => {
    const audit = makeAudit();
    const sentiment = makeSentiment();

    const brief = synthesizeContentBrief(audit, [sentiment], { briefId: "brief-1", now: NOW });

    // Validates against the contract independently of the impl's own parse().
    expect(() => contentBriefSchema.parse(brief)).not.toThrow();
    expect(brief.id).toBe("brief-1");
    expect(brief.shopId).toBe("shop-tracys");
    expect(brief.createdAt).toBe(NOW);
    expect(brief.status).toBe("draft");
    expect(brief.topic.length).toBeGreaterThan(0);
    expect(brief.competitorGap.length).toBeGreaterThan(0);
    expect(brief.audiencePersona.length).toBeGreaterThan(0);
  });

  it("keyword survival: targetKeywords are drawn ONLY from the auditor, ranked by priority", () => {
    const audit = makeAudit();
    const brief = synthesizeContentBrief(audit, [makeSentiment()], { briefId: "b", now: NOW });

    const briefKeywords = brief.targetKeywords.map((k) => k.keyword).sort();
    const auditKeywords = audit.keywordTargets.map((k) => k.keyword).sort();
    expect(briefKeywords).toEqual(auditKeywords);

    // No invented keywords: every brief keyword exists in the audit.
    const auditSet = new Set(audit.keywordTargets.map((k) => k.keyword));
    for (const k of brief.targetKeywords) expect(auditSet.has(k.keyword)).toBe(true);

    // Highest-priority target ranked first.
    expect(brief.targetKeywords[0].keyword).toBe("collision repair lincoln ne");
  });

  it("provenance: sources reference the audit id + EXACTLY the sentiment ids used", () => {
    const audit = makeAudit();
    const s1 = makeSentiment({ id: "sent-1" });
    const s2 = makeSentiment({ id: "sent-2", topic: "paint quality", sentimentScore: 0.4 });

    const brief = synthesizeContentBrief(audit, [s1, s2], { briefId: "b", now: NOW });

    expect(brief.sources.auditReportId).toBe("audit-1");
    expect(brief.sources.sentimentReportIds.sort()).toEqual(["sent-1", "sent-2"]);
  });

  it("provenance: ignores sentiment reports for a different shop", () => {
    const audit = makeAudit();
    const sameShop = makeSentiment({ id: "sent-same" });
    const otherShop = makeSentiment({ id: "sent-other", shopId: "shop-wallace" });

    const brief = synthesizeContentBrief(audit, [sameShop, otherShop], { briefId: "b", now: NOW });

    expect(brief.sources.sentimentReportIds).toEqual(["sent-same"]);
    expect(brief.sources.sentimentReportIds).not.toContain("sent-other");
  });

  it("no-sentiment fallback: degrades gracefully with zero SentimentReports", () => {
    const audit = makeAudit();
    const brief = synthesizeContentBrief(audit, [], { briefId: "b", now: NOW });

    expect(() => contentBriefSchema.parse(brief)).not.toThrow();
    expect(brief.sources.sentimentReportIds).toEqual([]);
    // With no sentiment, priorityScore is the keyword signal: mean(92, 70) = 81.
    expect(brief.priorityScore).toBe(81);
    // Keywords still survive.
    expect(brief.targetKeywords).toHaveLength(2);
  });

  it("priorityScore: derived from keyword priority + sentiment, bounded 0–100", () => {
    const audit = makeAudit();
    // Positive sentiment + trending topics should lift the score above the
    // keyword-only baseline (81); negative/quiet sentiment should pull it down.
    const positive = synthesizeContentBrief(audit, [makeSentiment({ sentimentScore: 1 })], {
      briefId: "b",
      now: NOW,
    });
    const negative = synthesizeContentBrief(
      audit,
      [makeSentiment({ sentimentScore: -1, trendingTopics: [] })],
      { briefId: "b", now: NOW },
    );

    expect(positive.priorityScore).toBeGreaterThanOrEqual(0);
    expect(positive.priorityScore).toBeLessThanOrEqual(100);
    expect(negative.priorityScore).toBeGreaterThanOrEqual(0);
    expect(positive.priorityScore).toBeGreaterThan(negative.priorityScore);
  });

  it("respects maxKeywords without inventing or reordering", () => {
    const audit = makeAudit();
    const brief = synthesizeContentBrief(audit, [], { briefId: "b", now: NOW, maxKeywords: 1 });
    expect(brief.targetKeywords).toHaveLength(1);
    expect(brief.targetKeywords[0].keyword).toBe("collision repair lincoln ne");
  });

  it("is deterministic and does not mutate its inputs", () => {
    const audit = makeAudit();
    const sentiment = makeSentiment();
    const auditSnapshot = JSON.stringify(audit);
    const sentimentSnapshot = JSON.stringify(sentiment);

    const a = synthesizeContentBrief(audit, [sentiment], { briefId: "b", now: NOW });
    const b = synthesizeContentBrief(audit, [sentiment], { briefId: "b", now: NOW });

    expect(a).toEqual(b);
    // Inputs untouched.
    expect(JSON.stringify(audit)).toBe(auditSnapshot);
    expect(JSON.stringify(sentiment)).toBe(sentimentSnapshot);
  });

  it("handles an audit with zero keyword targets without throwing", () => {
    const audit = makeAudit({ keywordTargets: [], recommendations: [], findings: [] });
    const brief = synthesizeContentBrief(audit, [makeSentiment()], { briefId: "b", now: NOW });

    expect(() => contentBriefSchema.parse(brief)).not.toThrow();
    expect(brief.targetKeywords).toEqual([]);
    expect(brief.topic.length).toBeGreaterThan(0);
    expect(brief.competitorGap.length).toBeGreaterThan(0);
  });
});
