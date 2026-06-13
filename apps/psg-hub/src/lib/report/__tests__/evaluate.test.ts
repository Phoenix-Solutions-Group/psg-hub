import { describe, it, expect } from "vitest";
import { evaluateReport } from "../evaluate";
import type { ReportData } from "../types";
import type { ReportNarrative } from "../schema";

/** ga4 sessions 1,500 (+20%); gsc clicks 4 (-20%), impressions 372 (+24%). */
function reportData(): ReportData {
  return {
    shopId: "shop-1",
    periodMonth: "2026-06",
    window: { start: "2026-06-01", end: "2026-06-30" },
    sources: {
      ga4: {
        source: "ga4",
        current: { sessions: 1500 },
        prior: { sessions: 1250 },
        momDelta: { sessions: 0.2 },
        trend: {},
      },
      gsc: {
        source: "gsc",
        current: { clicks: 4, impressions: 372 },
        prior: { clicks: 5, impressions: 300 },
        momDelta: { clicks: -0.2, impressions: 0.24 },
        trend: {},
      },
    },
    linkedSources: ["ga4", "gsc"],
    sourcesWithPriorMonth: ["ga4", "gsc"],
    generatedAt: "2026-07-01T00:00:00Z",
  };
}

/** A clean, already-substituted narrative that should PASS. */
function goodNarrative(): ReportNarrative {
  return {
    headline: "June traffic and search both moved up.",
    executiveSummary:
      "Website sessions reached 1,500 this month, up +20% from the prior month. Search clicks held at 4.",
    sourceSummaries: {
      ga4: "Sessions came in at 1,500, a +20% improvement over the prior month.",
      gsc: "Clicks were 4 for the month, down -20%, while impressions were 372.",
    },
    recommendations: [
      "Focus on the service pages that drove the 1,500 sessions.",
      "Improve local listings to lift the 372 impressions.",
    ],
  };
}

describe("evaluateReport", () => {
  it("passes a clean, grounded, brand-compliant narrative", () => {
    const result = evaluateReport(goodNarrative(), reportData());
    expect(result.verdict).toBe("pass");
    expect(result.violations).toEqual([]);
    expect(result.judge).toBeNull();
  });

  it("BLOCKS a fabricated number (F1)", () => {
    const n = goodNarrative();
    n.executiveSummary = "Website sessions reached 1,800 this month."; // 1,800 not in the data
    const result = evaluateReport(n, reportData());
    expect(result.verdict).toBe("block");
    expect(result.violations.some((v) => v.code === "F1")).toBe(true);
  });

  it("BLOCKS an inverted MoM direction (F2)", () => {
    const n = goodNarrative();
    n.sourceSummaries.ga4 = "Sessions fell +20% this month."; // +20% is real, but "fell" contradicts the sign
    const result = evaluateReport(n, reportData());
    expect(result.verdict).toBe("block");
    expect(result.violations.some((v) => v.code === "F2")).toBe(true);
  });

  it("BLOCKS an em dash (brand)", () => {
    const n = goodNarrative();
    n.headline = "June was strong — traffic climbed.";
    const result = evaluateReport(n, reportData());
    expect(result.verdict).toBe("block");
    expect(result.violations.some((v) => v.code === "brand")).toBe(true);
  });

  it("BLOCKS a cross-source mis-attribution (F3)", () => {
    const n = goodNarrative();
    // 1,500 is a GA4 number; using it in the GSC summary is mis-attribution.
    n.sourceSummaries.gsc = "Search clicks reached 1,500 this month.";
    const result = evaluateReport(n, reportData());
    expect(result.verdict).toBe("block");
    expect(result.violations.some((v) => v.code === "F3")).toBe(true);
  });

  it("BLOCKS an unresolved placeholder (brand)", () => {
    const n = goodNarrative();
    n.headline = "Traffic reached {{ga4_sessions}} this month."; // substitution failure
    const result = evaluateReport(n, reportData());
    expect(result.verdict).toBe("block");
    expect(result.violations.some((v) => v.code === "brand")).toBe(true);
  });
});
