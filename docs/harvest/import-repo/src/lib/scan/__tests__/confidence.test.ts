import { describe, it, expect } from "vitest";
import { validateField, classifyConfidence, CONFIDENCE_FLOOR } from "../confidence";
import type { FormFieldSpec } from "../schema";

const phone: FormFieldSpec = { key: "p", label: "P", type: "phone", required: false };
const zip: FormFieldSpec = { key: "z", label: "Z", type: "zip", required: false };
const vin: FormFieldSpec = { key: "v", label: "V", type: "vin", required: false };
const date: FormFieldSpec = { key: "d", label: "D", type: "date", required: false };
const state: FormFieldSpec = { key: "s", label: "S", type: "state", required: false };
const email: FormFieldSpec = { key: "e", label: "E", type: "email", required: false };
const requiredStr: FormFieldSpec = { key: "n", label: "N", type: "string", required: true };
const optionalStr: FormFieldSpec = { key: "n", label: "N", type: "string", required: false };

describe("validateField", () => {
  it("passes valid phone formats", () => {
    for (const v of ["5551234567", "555-123-4567", "(555) 123-4567", "555.123.4567"]) {
      expect(validateField(phone, v).ok).toBe(true);
    }
  });
  it("rejects invalid phones", () => {
    for (const v of ["abc", "12345", "555-12-4567"]) {
      expect(validateField(phone, v).ok).toBe(false);
    }
  });
  it("validates zip5 and zip9", () => {
    expect(validateField(zip, "12345").ok).toBe(true);
    expect(validateField(zip, "12345-6789").ok).toBe(true);
    expect(validateField(zip, "1234").ok).toBe(false);
  });
  it("validates VIN (17 alnum, no I O Q)", () => {
    expect(validateField(vin, "1HGBH41JXMN109186").ok).toBe(true);
    expect(validateField(vin, "1HGBH41JXMN10918").ok).toBe(false); // 16 chars
    expect(validateField(vin, "1HGBH41JXMN109I86").ok).toBe(false); // contains I
  });
  it("validates MM/DD/YYYY dates", () => {
    expect(validateField(date, "04/24/2026").ok).toBe(true);
    expect(validateField(date, "4/24/2026").ok).toBe(true);
    expect(validateField(date, "13/24/2026").ok).toBe(false);
    expect(validateField(date, "2026-04-24").ok).toBe(false);
  });
  it("validates 2-letter state codes", () => {
    expect(validateField(state, "MN").ok).toBe(true);
    expect(validateField(state, "Mn").ok).toBe(false);
    expect(validateField(state, "Minnesota").ok).toBe(false);
  });
  it("validates emails", () => {
    expect(validateField(email, "a@b.co").ok).toBe(true);
    expect(validateField(email, "not-an-email").ok).toBe(false);
  });
  it("required empty fails, optional empty passes", () => {
    expect(validateField(requiredStr, "").ok).toBe(false);
    expect(validateField(requiredStr, null).ok).toBe(false);
    expect(validateField(optionalStr, "").ok).toBe(true);
    expect(validateField(optionalStr, null).ok).toBe(true);
  });
  it("required whitespace-only fails", () => {
    expect(validateField(requiredStr, "   ").ok).toBe(false);
  });
});

describe("classifyConfidence", () => {
  it("invalid when valid=false regardless of raw", () => {
    expect(classifyConfidence(0.99, false)).toBe("invalid");
  });
  it("high at >= 0.9", () => {
    expect(classifyConfidence(0.9, true)).toBe("high");
    expect(classifyConfidence(0.95, true)).toBe("high");
  });
  it("medium between floor and 0.9", () => {
    expect(classifyConfidence(CONFIDENCE_FLOOR, true)).toBe("medium");
    expect(classifyConfidence(0.8, true)).toBe("medium");
  });
  it("low below floor", () => {
    expect(classifyConfidence(0.5, true)).toBe("low");
  });
  it("respects per-field floor override", () => {
    expect(classifyConfidence(0.7, true, 0.8)).toBe("low");
  });
});
