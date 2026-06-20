import { describe, it, expect } from "vitest";
import { mergePages } from "../merge-pages";
import { GENERIC_COLLISION_V1 } from "../schema";
import type { ExtractionResult } from "../types";

function mkPage(pageIndex: number, fields: Record<string, string | null>, checkboxes: Record<string, boolean | null> = {}): ExtractionResult {
  return {
    driver: "mock",
    pageIndex,
    fields: Object.entries(fields).map(([key, value]) => ({
      key,
      value,
      confidence: 0.9,
      tier: "high" as const,
    })),
    checkboxes,
    latencyMs: 1,
  };
}

describe("mergePages", () => {
  it("single-page merges straight through", () => {
    const pages = [mkPage(0, { OwnerFName: "Brandon", OwnerLName: "Mcilwain" })];
    const { row, conflicts } = mergePages(pages, GENERIC_COLLISION_V1);
    expect(row.OwnerFName).toBe("Brandon");
    expect(row.OwnerLName).toBe("Mcilwain");
    expect(conflicts).toEqual([]);
  });

  it("first non-null wins across pages", () => {
    const pages = [
      mkPage(0, { OwnerFName: "Brandon" }),
      mkPage(1, { OwnerFName: "Brenden", OwnerCity: "Minneapolis" }),
    ];
    const { row, conflicts } = mergePages(pages, GENERIC_COLLISION_V1);
    expect(row.OwnerFName).toBe("Brandon");
    expect(row.OwnerCity).toBe("Minneapolis");
    expect(conflicts).toEqual([{ key: "OwnerFName", values: ["Brandon", "Brenden"] }]);
  });

  it("null values do not override", () => {
    const pages = [
      mkPage(0, { OwnerFName: null }),
      mkPage(1, { OwnerFName: "Brandon" }),
    ];
    const { row } = mergePages(pages, GENERIC_COLLISION_V1);
    expect(row.OwnerFName).toBe("Brandon");
  });

  it("empty/whitespace values do not override", () => {
    const pages = [
      mkPage(0, { OwnerFName: "  " }),
      mkPage(1, { OwnerFName: "Brandon" }),
    ];
    const { row } = mergePages(pages, GENERIC_COLLISION_V1);
    expect(row.OwnerFName).toBe("Brandon");
  });

  it("payType group collapses to ClaimType", () => {
    const pages = [mkPage(0, {}, { PayType_CustomerPay: true, PayType_Claimant: false })];
    const { row } = mergePages(pages, GENERIC_COLLISION_V1);
    expect(row.ClaimType).toBe("Customer Pay");
  });

  it("payType Claimant collapses correctly", () => {
    const pages = [mkPage(0, {}, { PayType_CustomerPay: false, PayType_Claimant: true })];
    const { row } = mergePages(pages, GENERIC_COLLISION_V1);
    expect(row.ClaimType).toBe("Claimant");
  });

  it("no payType checked → no ClaimType", () => {
    const pages = [mkPage(0, {}, { PayType_CustomerPay: false, PayType_Claimant: false, PayType_CustomerInsurance: false })];
    const { row } = mergePages(pages, GENERIC_COLLISION_V1);
    expect(row.ClaimType).toBeUndefined();
  });

  it("null checkbox is ignored", () => {
    const pages = [mkPage(0, {}, { PayType_CustomerPay: null })];
    const { row } = mergePages(pages, GENERIC_COLLISION_V1);
    expect(row.ClaimType).toBeUndefined();
  });
});
