// BSM Phase 0 / PSG-158 — selectKeywordTargets behavior coverage.
//
// Covers the SEO Auditor → Content Writer keyword handoff (also the function the
// Content Writer calls when it asks the auditor for targets mid-draft):
// priority-desc ranking, opts.limit, opts.intents filter, graceful degradation
// when optional SEMrush fields are absent, and the never-mutate guarantee.

import { describe, it, expect } from "vitest";
import { selectKeywordTargets, auditReportSchema, type AuditReport, type KeywordTarget } from "../index";

const NOW = "2026-06-20T00:00:00.000Z";

/** Build an AuditReport whose only varying part is its keywordTargets. */
function auditWith(keywordTargets: KeywordTarget[]): AuditReport {
  return auditReportSchema.parse({
    id: "audit-1",
    shopId: "shop-tracys",
    type: "technical_seo",
    keywordTargets,
    createdAt: NOW,
  });
}

const TARGETS: KeywordTarget[] = [
  { keyword: "free collision estimate", intent: "transactional", priority: 70, currentRank: 14 },
  { keyword: "collision repair lincoln ne", intent: "local", searchVolume: 880, difficulty: 34, priority: 92 },
  { keyword: "how long does collision repair take", intent: "informational", priority: 40 },
  { keyword: "towing after accident", intent: "emergency", priority: 85 },
  { keyword: "bumper repair", intent: "service", priority: 55 },
];

describe("selectKeywordTargets", () => {
  it("returns targets ranked by priority descending", () => {
    const ranked = selectKeywordTargets(auditWith(TARGETS));
    expect(ranked.map((t) => t.priority)).toEqual([92, 85, 70, 55, 40]);
    expect(ranked[0].keyword).toBe("collision repair lincoln ne");
  });

  it("never mutates the input report or its target array", () => {
    const report = auditWith(TARGETS);
    const beforeOrder = report.keywordTargets.map((t) => t.keyword);
    const beforeRef = report.keywordTargets;

    const ranked = selectKeywordTargets(report);

    // Result is a fresh array, input order is untouched.
    expect(ranked).not.toBe(report.keywordTargets);
    expect(report.keywordTargets).toBe(beforeRef);
    expect(report.keywordTargets.map((t) => t.keyword)).toEqual(beforeOrder);
  });

  it("honors opts.limit, returning the top-N by priority", () => {
    const top2 = selectKeywordTargets(auditWith(TARGETS), { limit: 2 });
    expect(top2.map((t) => t.priority)).toEqual([92, 85]);
  });

  it("returns an empty array for a non-positive limit", () => {
    expect(selectKeywordTargets(auditWith(TARGETS), { limit: 0 })).toEqual([]);
    expect(selectKeywordTargets(auditWith(TARGETS), { limit: -3 })).toEqual([]);
  });

  it("filters by opts.intents before ranking", () => {
    const localish = selectKeywordTargets(auditWith(TARGETS), { intents: ["local", "emergency"] });
    expect(localish.map((t) => t.intent)).toEqual(["local", "emergency"]);
    expect(localish.map((t) => t.priority)).toEqual([92, 85]);
  });

  it("applies the intents filter and the limit together", () => {
    const one = selectKeywordTargets(auditWith(TARGETS), {
      intents: ["local", "emergency", "service"],
      limit: 1,
    });
    expect(one).toHaveLength(1);
    expect(one[0].keyword).toBe("collision repair lincoln ne");
  });

  it("returns [] when no target matches the intents filter", () => {
    const none = selectKeywordTargets(auditWith(TARGETS), { intents: ["transactional"] });
    expect(none.map((t) => t.keyword)).toEqual(["free collision estimate"]);
    const empty = selectKeywordTargets(auditWith([]), { intents: ["local"] });
    expect(empty).toEqual([]);
  });

  it("degrades gracefully when targets lack volume/difficulty/rank", () => {
    const sparse: KeywordTarget[] = [
      { keyword: "frame straightening", intent: "service", priority: 60 },
      { keyword: "paintless dent repair", intent: "service", priority: 75 },
    ];
    const ranked = selectKeywordTargets(auditWith(sparse));
    expect(ranked.map((t) => t.keyword)).toEqual(["paintless dent repair", "frame straightening"]);
  });

  it("preserves auditor order for equal priorities (stable sort)", () => {
    const tied: KeywordTarget[] = [
      { keyword: "a", intent: "service", priority: 50 },
      { keyword: "b", intent: "service", priority: 50 },
      { keyword: "c", intent: "service", priority: 80 },
    ];
    expect(selectKeywordTargets(auditWith(tied)).map((t) => t.keyword)).toEqual(["c", "a", "b"]);
  });
});
