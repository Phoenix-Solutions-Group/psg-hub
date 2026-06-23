// PSG-352 — unit tests for the canonical invoiced-$ + pay-type helpers.
import { describe, it, expect } from "vitest";
import { dollarsToCents, normalizePayType } from "@/lib/ops/import/amounts";

describe("dollarsToCents", () => {
  it("converts a plain number of dollars to integer cents", () => {
    expect(dollarsToCents(1234.56)).toBe(123456);
    expect(dollarsToCents(0.01)).toBe(1);
    expect(dollarsToCents(100)).toBe(10000);
  });

  it("parses human strings ($, commas, whitespace)", () => {
    expect(dollarsToCents("$1,234.56")).toBe(123456);
    expect(dollarsToCents("  1234.56 ")).toBe(123456);
    expect(dollarsToCents("$0.00")).toBe(0);
  });

  it("rounds to the nearest cent (no float drift)", () => {
    expect(dollarsToCents(1234.555)).toBe(123456);
    expect(dollarsToCents(0.005)).toBe(1);
    expect(dollarsToCents("19.99")).toBe(1999);
  });

  it("returns null — NEVER 0 — for a missing/empty/non-numeric input", () => {
    expect(dollarsToCents(null)).toBeNull();
    expect(dollarsToCents(undefined)).toBeNull();
    expect(dollarsToCents("")).toBeNull();
    expect(dollarsToCents("   ")).toBeNull();
    expect(dollarsToCents("N/A")).toBeNull();
    expect(dollarsToCents("abc")).toBeNull();
    expect(dollarsToCents(Number.NaN)).toBeNull();
    expect(dollarsToCents(Number.POSITIVE_INFINITY)).toBeNull();
  });

  it("handles negative amounts (credits / reversals)", () => {
    expect(dollarsToCents(-50)).toBe(-5000);
    expect(dollarsToCents("-$12.50")).toBe(-1250);
  });
});

// Matching is EXACT (case- + surrounding-whitespace-insensitive) against the
// PAY_TYPE_ALIASES map — an unrecognized token is null, never a wrong bucket.
describe("normalizePayType", () => {
  it("maps insurance aliases", () => {
    expect(normalizePayType("Insurance")).toBe("insurance");
    expect(normalizePayType("INS")).toBe("insurance");
    expect(normalizePayType("claim")).toBe("insurance");
    expect(normalizePayType("3rd party")).toBe("insurance");
    expect(normalizePayType("Third Party")).toBe("insurance");
  });

  it("maps customer-pay aliases", () => {
    expect(normalizePayType("Customer")).toBe("customer");
    expect(normalizePayType("Cust")).toBe("customer");
    expect(normalizePayType("Customer Pay")).toBe("customer");
    expect(normalizePayType("CP")).toBe("customer");
    expect(normalizePayType("self")).toBe("customer");
    expect(normalizePayType("Retail")).toBe("customer");
  });

  it("maps internal / shop-rework aliases", () => {
    expect(normalizePayType("Internal")).toBe("internal");
    expect(normalizePayType("Comeback")).toBe("internal");
    expect(normalizePayType("Rework")).toBe("internal");
  });

  it("maps warranty aliases", () => {
    expect(normalizePayType("Warranty")).toBe("warranty");
    expect(normalizePayType("MFG Warranty")).toBe("warranty");
    expect(normalizePayType("Factory")).toBe("warranty");
  });

  it("is case- and surrounding-whitespace-insensitive", () => {
    expect(normalizePayType("  insurance  ")).toBe("insurance");
    expect(normalizePayType("CUSTOMER PAY")).toBe("customer");
  });

  it("returns null for unknown/empty/partial — never a bogus bucket", () => {
    expect(normalizePayType(null)).toBeNull();
    expect(normalizePayType(undefined)).toBeNull();
    expect(normalizePayType("")).toBeNull();
    expect(normalizePayType("   ")).toBeNull();
    expect(normalizePayType("misc")).toBeNull();
    expect(normalizePayType("unknown")).toBeNull();
    // Exact-match: a longer free-text string that merely contains an alias
    // fragment does NOT match (honest — blank over a wrong cell).
    expect(normalizePayType("insurance claim - customer copay")).toBeNull();
    expect(normalizePayType("warranty rework")).toBeNull();
  });
});
