// PSG-159 — QA: BSM cross-module invocation end-to-end.
//
// Exercises the full peer-invocation flow against a realistic single-shop
// fixture (Tracy's Collision, Lincoln NE), proving "agents can invoke each
// other" (PSG-145 item 6):
//   SEO Auditor  → selectKeywordTargets       (ranked, filtered, no mutation)
//   Market Res.  → synthesizeContentBrief      (brief traces back to audit+sentiment)
//   Content Wr.  → buildContentDraftRequest     (deduped, shopId carried)
//   + no-sentiment fallback path.
//
// This is a QA harness, not a unit suite — the per-function unit coverage lives
// in seo-auditor.test.ts / content-writer-handoff.test.ts. Set QA_EMIT_BRIEF=1
// to print the synthesized ContentBrief JSON as pass/fail evidence.

import { describe, it, expect } from "vitest";
import {
  auditReportSchema,
  sentimentReportSchema,
  contentBriefSchema,
  contentDraftRequestSchema,
  selectKeywordTargets,
  synthesizeContentBrief,
  buildContentDraftRequest,
  type AuditReport,
  type SentimentReport,
} from "../index";

const NOW = "2026-06-20T12:00:00.000Z";
const SHOP = "shop-tracys-collision-lincoln-ne";

// ── Fixture: one shop, one AuditReport (≥3 keyword targets), ≥1 SentimentReport ──
const audit: AuditReport = auditReportSchema.parse({
  id: "audit-tracys-2026-06-20",
  shopId: SHOP,
  type: "content_gap",
  findings: [
    { severity: "high", area: "page speed", detail: "LCP 3.8s on mobile homepage" },
    { severity: "medium", area: "local content", detail: "No Lincoln-specific service pages" },
  ],
  recommendations: [
    "Publish a Lincoln, NE collision-repair guide targeting the insurance-paperwork gap",
    "Add a dedicated frame-straightening service page",
  ],
  keywordTargets: [
    { keyword: "collision repair lincoln ne", intent: "local", searchVolume: 880, difficulty: 34, currentRank: null, priority: 92, rationale: "High local volume, not ranking" },
    { keyword: "free collision estimate near me", intent: "transactional", searchVolume: 320, difficulty: 21, currentRank: 14, priority: 78 },
    { keyword: "how long does collision repair take", intent: "informational", searchVolume: 210, difficulty: 12, priority: 55 },
    { keyword: "towing after accident lincoln", intent: "emergency", searchVolume: 90, difficulty: 18, priority: 84 },
    { keyword: "frame straightening", intent: "service", searchVolume: 140, difficulty: 27, priority: 61 },
  ],
  createdAt: NOW,
});

const sentiments: SentimentReport[] = [
  sentimentReportSchema.parse({
    id: "sent-tracys-google-1", shopId: SHOP, source: "google_reviews", topic: "turnaround time",
    sentimentScore: 0.58, trendingTopics: ["rental car help", "insurance paperwork"], createdAt: NOW,
  }),
  sentimentReportSchema.parse({
    id: "sent-tracys-reddit-1", shopId: SHOP, source: "reddit", topic: "insurance disputes",
    sentimentScore: 0.21, trendingTopics: ["insurance paperwork", "OEM parts"], createdAt: NOW,
  }),
  // A different shop's report — must NOT be consumed (provenance correctness).
  sentimentReportSchema.parse({
    id: "sent-other-shop", shopId: "shop-someone-else", source: "google_reviews", topic: "noise",
    sentimentScore: -0.9, trendingTopics: ["bad paint"], createdAt: NOW,
  }),
];

describe("PSG-159 cross-module E2E (Tracy's Collision)", () => {
  it("step 2 — SEO Auditor → content: selectKeywordTargets ranks desc, filters, no mutation", () => {
    const before = audit.keywordTargets.map((t) => t.keyword);

    const ranked = selectKeywordTargets(audit, { limit: 3 });
    expect(ranked.map((t) => t.priority)).toEqual([92, 84, 78]); // priority desc
    expect(ranked.map((t) => t.keyword)).toEqual([
      "collision repair lincoln ne",
      "towing after accident lincoln",
      "free collision estimate near me",
    ]);

    const localish = selectKeywordTargets(audit, { intents: ["local", "emergency"] });
    expect(localish.map((t) => t.intent)).toEqual(["local", "emergency"]);

    // never mutates input
    expect(audit.keywordTargets.map((t) => t.keyword)).toEqual(before);
    expect(ranked).not.toBe(audit.keywordTargets);
  });

  it("step 3 — Market Researcher → brief: brief traces back to audit + sentiment ids", () => {
    const brief = synthesizeContentBrief(audit, sentiments, { briefId: "brief-tracys-1", now: NOW });

    // valid against the contract
    expect(() => contentBriefSchema.parse(brief)).not.toThrow();

    // targetKeywords trace back to the audit (no invented keywords)
    const auditKw = new Set(audit.keywordTargets.map((t) => t.keyword));
    expect(brief.targetKeywords.length).toBeGreaterThan(0);
    for (const t of brief.targetKeywords) expect(auditKw.has(t.keyword)).toBe(true);

    // provenance proves consumption: audit id + EXACTLY this shop's sentiment ids
    expect(brief.sources.auditReportId).toBe(audit.id);
    expect(brief.sources.sentimentReportIds.sort()).toEqual(
      ["sent-tracys-google-1", "sent-tracys-reddit-1"].sort(),
    );
    // the other shop's report was excluded
    expect(brief.sources.sentimentReportIds).not.toContain("sent-other-shop");
    expect(brief.shopId).toBe(SHOP);

    if (process.env.QA_EMIT_BRIEF) {
      // eslint-disable-next-line no-console
      console.log("QA_CONTENT_BRIEF_JSON=" + JSON.stringify(brief, null, 2));
    }
  });

  it("step 4 — Content Writer: buildContentDraftRequest unions selected ∪ mid-draft, deduped, shopId carried", () => {
    const brief = synthesizeContentBrief(audit, sentiments, { briefId: "brief-tracys-1", now: NOW });
    const midDraftAsk = selectKeywordTargets(audit, { intents: ["service"] }); // "frame straightening"

    const req = buildContentDraftRequest(brief, midDraftAsk, "blog_post");
    expect(() => contentDraftRequestSchema.parse(req)).not.toThrow();
    expect(req.keywordTargets.length).toBeGreaterThan(0);
    expect(req.shopId).toBe(SHOP);
    expect(req.shopId).toBe(req.brief.shopId); // carried for claim-integrity gate

    // dedup by keyword: no keyword appears twice
    const kws = req.keywordTargets.map((t) => t.keyword);
    expect(new Set(kws).size).toBe(kws.length);
    // mid-draft ask folded in
    expect(kws).toContain("frame straightening");
  });

  it("step 5 — no-sentiment fallback still yields a valid brief", () => {
    const brief = synthesizeContentBrief(audit, [], { briefId: "brief-tracys-nosent", now: NOW });
    expect(() => contentBriefSchema.parse(brief)).not.toThrow();
    expect(brief.sources.sentimentReportIds).toEqual([]);
    expect(brief.targetKeywords.length).toBeGreaterThan(0);
    // graceful degrade: score is the keyword signal alone (no sentiment drag)
    expect(brief.priorityScore).toBeGreaterThan(0);
    // a draft request can still be built from the fallback brief
    const req = buildContentDraftRequest(brief, [], "service_page");
    expect(req.keywordTargets.length).toBeGreaterThan(0);
  });
});
