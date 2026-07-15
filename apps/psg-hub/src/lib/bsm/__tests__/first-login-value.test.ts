import { describe, expect, it } from "vitest";
import { buildFirstLoginValueState } from "@/lib/bsm/first-login-value";
import type { ShopAuditReport } from "@/lib/seo-audit/types";

function report(overrides: Partial<ShopAuditReport> = {}): ShopAuditReport {
  return {
    shopId: "s1",
    businessName: "Tracy's Collision",
    domain: "https://example.com",
    generatedAt: "2026-07-14T00:00:00.000Z",
    mode: "audited",
    healthScore: 82,
    grade: "B",
    summary: {
      pagesCrawled: 3,
      keepCount: 2,
      improveCount: 1,
      findingsBySeverity: { critical: 0, high: 0, medium: 1, low: 0 },
      keywordOpportunities: 4,
      plan: null,
    },
    findings: [],
    recommendations: [],
    inventory: [],
    keywordTargets: [],
    ...overrides,
  };
}

describe("buildFirstLoginValueState", () => {
  it("does not invent a finding when no audit has run", () => {
    expect(buildFirstLoginValueState(null)).toMatchObject({
      status: "pending",
      title: "Your first check has not run yet.",
      detail:
        "Run a quick, free shop check first. This does not connect Google, publish anything, or change your public listing.",
      nextStepLabel: "Start free check",
      nextStepHref: "/dashboard/onboarding",
    });
  });

  it("shows an honest no-website finding for greenfield audits", () => {
    expect(
      buildFirstLoginValueState(
        report({ mode: "greenfield", domain: null, healthScore: null, grade: "—" }),
      ),
    ).toMatchObject({
      status: "found",
      title: "BSM did not find a live website to score.",
      nextStepHref: "/dashboard/analytics",
    });
  });

  it("summarizes a real improve count from the audit", () => {
    expect(buildFirstLoginValueState(report()).title).toBe("1 page needs attention.");
    expect(buildFirstLoginValueState(report({ summary: { ...report().summary, improveCount: 2 } })).title).toBe(
      "2 pages need attention.",
    );
  });

  it("shows clean-so-far without claiming final success", () => {
    expect(
      buildFirstLoginValueState(
        report({ summary: { ...report().summary, improveCount: 0 } }),
      ),
    ).toMatchObject({
      status: "ready",
      title: "Your website check is clean for now.",
      nextStepLabel: "Connect Google",
    });
  });
});
