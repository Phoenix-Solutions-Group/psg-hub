import { describe, it, expect } from "vitest";
import { buildFirstWinCard, type FirstWinAudit } from "../first-win";
import type { AuditSummary } from "../types";

// Minimal valid summary; individual tests override the fields they exercise.
function summary(overrides: Partial<AuditSummary> = {}): AuditSummary {
  return {
    pagesCrawled: 0,
    keepCount: 0,
    improveCount: 0,
    findingsBySeverity: { critical: 0, high: 0, medium: 0, low: 0 },
    keywordOpportunities: 0,
    plan: null,
    ...overrides,
  };
}

describe("buildFirstWinCard", () => {
  it("reads as pending (never a fabricated result) when no audit has landed", () => {
    const card = buildFirstWinCard(null);
    expect(card.state).toBe("pending");
    if (card.state === "pending") {
      expect(card.detail).toMatch(/running/i);
    }
  });

  it("shows the health score and a fix count for an audited site", () => {
    const audit: FirstWinAudit = {
      mode: "audited",
      healthScore: 72,
      grade: "B",
      summary: summary({ pagesCrawled: 8, improveCount: 3, keepCount: 5 }),
    };
    const card = buildFirstWinCard(audit);
    expect(card.state).toBe("ready");
    if (card.state === "ready") {
      expect(card.badge).toBe("Your first result is ready");
      expect(card.headline).toContain("72/100");
      expect(card.detail).toContain("3 quick fixes");
    }
  });

  it("singularizes a single fix", () => {
    const card = buildFirstWinCard({
      mode: "audited",
      healthScore: 90,
      grade: "A",
      summary: summary({ improveCount: 1 }),
    });
    if (card.state === "ready") {
      expect(card.detail).toContain("1 quick fix");
      expect(card.detail).not.toContain("fixes");
    }
  });

  it("does not scold a clean audited site with zero fixes", () => {
    const card = buildFirstWinCard({
      mode: "audited",
      healthScore: 98,
      grade: "A",
      summary: summary({ improveCount: 0 }),
    });
    if (card.state === "ready") {
      expect(card.headline).toContain("98/100");
      expect(card.detail).toMatch(/good shape|no urgent/i);
    }
  });

  it("frames a build plan (no score) for a greenfield shop", () => {
    const card = buildFirstWinCard({
      mode: "greenfield",
      healthScore: null,
      grade: "—",
      summary: summary({ plan: { pagesToBuild: 12, servicePages: 6, citiesToCover: 3 } }),
    });
    expect(card.state).toBe("ready");
    if (card.state === "ready") {
      // Grounded in the plan — never invents a score for a shop with no live site.
      expect(card.headline).not.toMatch(/\/100/);
      expect(card.detail).toContain("12 pages");
    }
  });

  it("degrades cleanly when a greenfield report has no plan numbers", () => {
    const card = buildFirstWinCard({
      mode: "greenfield",
      healthScore: null,
      grade: "—",
      summary: summary({ plan: null }),
    });
    if (card.state === "ready") {
      expect(card.detail).toMatch(/plan/i);
      expect(card.detail).not.toMatch(/\d+ pages/);
    }
  });
});
