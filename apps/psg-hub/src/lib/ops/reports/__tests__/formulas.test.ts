import { describe, expect, it } from "vitest";
import {
  FORMULA_TOLERANCES,
  REPORT_FORMULA_MAPPINGS,
  REPORT_PARITY_FIXTURES,
  formulasForReport,
  recomputeAverage,
  recomputePercent,
} from "../formulas";
import { REPORTS } from "../registry";

describe("report formula mappings", () => {
  it("maps every FileMaker-parity operational report to at least one BSM field", () => {
    const extensionSlugs = new Set(["call-tracking-summary"]);
    const parityReports = REPORTS.filter((report) => !extensionSlugs.has(report.slug));

    expect(parityReports).toHaveLength(27);

    for (const report of parityReports) {
      const mappings = formulasForReport(report.slug);
      expect(mappings.length, report.slug).toBeGreaterThan(0);
      for (const mapping of mappings) {
        expect(mapping.reportSlug).toBe(report.slug);
        expect(report.columns.some((column) => column.key === mapping.fieldKey)).toBe(true);
        expect(mapping.sourceFields.length).toBeGreaterThan(0);
        expect(mapping.formula.length).toBeGreaterThan(0);
      }
    }
  });

  it("makes every deferral explicit and labels estimate-only output", () => {
    const deferred = REPORT_FORMULA_MAPPINGS.filter(
      (mapping) => mapping.status === "deferred",
    );

    expect(deferred).toHaveLength(1);
    expect(deferred[0]).toMatchObject({
      reportSlug: "unresolved-issue",
      fieldKey: "daysOpen",
      estimateLabelRequired: true,
    });
    expect(deferred[0].reason).toContain("no resolution timestamp");
  });

  it("records Tess-style parity tolerances for money, date, count, percent, and rounding", () => {
    expect(FORMULA_TOLERANCES.money).toMatchObject({ type: "currency", tolerance: 0.01 });
    expect(FORMULA_TOLERANCES.date).toMatchObject({ type: "date", tolerance: 0 });
    expect(FORMULA_TOLERANCES.count).toMatchObject({ type: "number", tolerance: 0 });
    expect(FORMULA_TOLERANCES.percent).toMatchObject({ type: "percent", tolerance: 0.01 });
    expect(FORMULA_TOLERANCES.score).toMatchObject({ type: "number", tolerance: 0.1 });
  });
});

describe("report parity formula helpers", () => {
  it("recomputes percentages from raw numerator and denominator values", () => {
    expect(recomputePercent(17, 40)).toBe(42.5);
    expect(recomputePercent(1, 3)).toBe(33.3);
    expect(recomputePercent(3, 0)).toBeNull();
    expect(recomputePercent(null, 10)).toBeNull();
  });

  it("recomputes averages from raw sums and raw counts", () => {
    expect(recomputeAverage(3000, 2)).toBe(1500);
    expect(recomputeAverage(1000, 3, "percent")).toBe(333.3);
    expect(recomputeAverage(1000, 0)).toBeNull();
  });

  it("reruns the high-value FileMaker-vs-BSM fixtures deterministically", () => {
    expect(REPORT_PARITY_FIXTURES.map((fixture) => fixture.reportSlug)).toEqual([
      "invoicing-recap",
      "performance-dashboard",
      "pay-type-analysis",
      "recap-trailing",
    ]);

    for (const fixture of REPORT_PARITY_FIXTURES) {
      expect(fixture.run()).toEqual(fixture.expected);
      expect(fixture.run()).toEqual(fixture.run());
    }
  });
});
