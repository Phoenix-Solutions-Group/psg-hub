import { describe, it, expect } from "vitest";
import { REPORTS, REPORTS_BY_SLUG, getReport, reportsForBatch } from "../registry";
import { BATCHES } from "../types";

// The exact slug set is frozen by PLANNING.md (the public report ids).
const EXPECTED_SLUGS = [
  // volume-invoicing (5)
  "processing-recap",
  "invoicing-recap",
  "reprint-recap",
  "recap-trailing",
  "audit",
  // survey-csi (8)
  "performance-dashboard",
  "market-dashboard",
  "monthly-csi-display",
  "estimator-csi",
  "body-tech-performance",
  "painter-performance",
  "survey-alert-recap",
  "rental-car-analysis",
  // customer-insurance (8)
  "pay-type-analysis",
  "vehicle-analysis-make",
  "vehicle-analysis-model",
  "referral-directory",
  "agent-capture",
  "agent-sales",
  "claims-review",
  "name-recap-by-shop",
  // individual-survey (5 + referral-comparison)
  "perfect-score",
  "mis-fire",
  "hot-spot",
  "unresolved-issue",
  "referral-noted",
  "referral-comparison",
];

describe("reports registry", () => {
  it("registers exactly the 26 (+1) named reports", () => {
    expect(REPORTS).toHaveLength(27);
    expect(new Set(REPORTS.map((r) => r.slug))).toEqual(new Set(EXPECTED_SLUGS));
  });

  it("has unique slugs and a matching lookup map", () => {
    const slugs = REPORTS.map((r) => r.slug);
    expect(new Set(slugs).size).toBe(slugs.length);
    expect(REPORTS_BY_SLUG.size).toBe(REPORTS.length);
    for (const r of REPORTS) expect(getReport(r.slug)).toBe(r);
  });

  it("places every report in a known batch and covers each batch", () => {
    const batchIds = new Set(BATCHES.map((b) => b.id));
    for (const r of REPORTS) expect(batchIds.has(r.batch)).toBe(true);
    for (const b of BATCHES) expect(reportsForBatch(b.id).length).toBeGreaterThan(0);
  });

  it("every report has columns, a param spec, and deterministic sample rows", () => {
    const params = { start: "2026-05-01", end: "2026-05-31", filters: {} };
    for (const r of REPORTS) {
      expect(r.columns.length).toBeGreaterThan(0);
      expect(r.title.length).toBeGreaterThan(0);
      const a = r.sampleRows(params);
      const b = r.sampleRows(params);
      expect(a.length).toBeGreaterThan(0);
      // deterministic: identical input -> identical output
      expect(b).toEqual(a);
      // every sample row only uses declared column keys
      const keys = new Set(r.columns.map((c) => c.key));
      for (const row of a) {
        for (const k of Object.keys(row)) expect(keys.has(k)).toBe(true);
      }
    }
  });
});
