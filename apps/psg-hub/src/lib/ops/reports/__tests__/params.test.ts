import { describe, it, expect } from "vitest";
import { parseReportParams } from "../params";
import type { ReportDefinition } from "../types";

const baseDef: ReportDefinition = {
  slug: "t",
  title: "T",
  batch: "volume-invoicing",
  description: "",
  params: {
    dateRange: true,
    filters: [
      {
        key: "payType",
        label: "Pay Type",
        type: "enum",
        options: [
          { value: "insurance", label: "Insurance" },
          { value: "customer", label: "Customer Pay" },
        ],
      },
      { key: "shopId", label: "Shop", type: "shop" },
      { key: "min", label: "Min", type: "number" },
    ],
  },
  columns: [],
  dataStatus: "pending-data",
  sampleRows: () => [],
};

function sp(obj: Record<string, string>) {
  return new URLSearchParams(obj);
}

describe("parseReportParams", () => {
  it("accepts valid date range + filters", () => {
    const r = parseReportParams(
      baseDef,
      sp({ start: "2026-05-01", end: "2026-05-31", payType: "insurance", min: "5" }),
    );
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.params.start).toBe("2026-05-01");
      expect(r.params.end).toBe("2026-05-31");
      expect(r.params.filters.payType).toBe("insurance");
      expect(r.params.filters.min).toBe("5");
    }
  });

  it("allows missing dates (caller defaults them)", () => {
    const r = parseReportParams(baseDef, sp({}));
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.params.start).toBeNull();
      expect(r.params.end).toBeNull();
    }
  });

  it("rejects malformed dates", () => {
    const r = parseReportParams(baseDef, sp({ start: "05/01/2026" }));
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.errors.join()).toMatch(/start/);
  });

  it("rejects start after end", () => {
    const r = parseReportParams(baseDef, sp({ start: "2026-06-01", end: "2026-05-01" }));
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.errors.join()).toMatch(/on or before/);
  });

  it("rejects an invalid enum option", () => {
    const r = parseReportParams(baseDef, sp({ payType: "barter" }));
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.errors.join()).toMatch(/Pay Type/);
  });

  it("rejects a non-numeric number filter", () => {
    const r = parseReportParams(baseDef, sp({ min: "abc" }));
    expect(r.ok).toBe(false);
  });

  it("flags a missing required filter", () => {
    const def: ReportDefinition = {
      ...baseDef,
      params: {
        dateRange: false,
        filters: [{ key: "shopId", label: "Shop", type: "shop", required: true }],
      },
    };
    const r = parseReportParams(def, sp({}));
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.errors.join()).toMatch(/Shop is required/);
  });
});
