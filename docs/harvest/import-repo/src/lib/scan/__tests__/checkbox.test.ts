import { describe, it, expect } from "vitest";
import { normalizeCheckbox } from "../checkbox";

describe("normalizeCheckbox", () => {
  it("passes through booleans", () => {
    expect(normalizeCheckbox(true)).toBe(true);
    expect(normalizeCheckbox(false)).toBe(false);
  });
  it("nullish in → null out", () => {
    expect(normalizeCheckbox(null)).toBeNull();
    expect(normalizeCheckbox(undefined)).toBeNull();
  });
  it("unicode checkbox tokens", () => {
    expect(normalizeCheckbox("☑")).toBe(true);
    expect(normalizeCheckbox("☒")).toBe(true);
    expect(normalizeCheckbox("☐")).toBe(false);
  });
  it("string truthy tokens", () => {
    for (const t of ["true", "True", "TRUE", "yes", "YES", "Yes", "x", "X", "1"]) {
      expect(normalizeCheckbox(t)).toBe(true);
    }
  });
  it("string falsy tokens", () => {
    for (const t of ["false", "False", "FALSE", "no", "NO", "No", "0", ""]) {
      expect(normalizeCheckbox(t)).toBe(false);
    }
  });
  it("numeric tokens 1/0", () => {
    expect(normalizeCheckbox(1)).toBe(true);
    expect(normalizeCheckbox(0)).toBe(false);
    expect(normalizeCheckbox(2)).toBeNull();
  });
  it("unknown tokens → null (no guessing)", () => {
    expect(normalizeCheckbox("maybe")).toBeNull();
    expect(normalizeCheckbox("?")).toBeNull();
    expect(normalizeCheckbox({})).toBeNull();
  });
  it("trims whitespace", () => {
    expect(normalizeCheckbox("  true  ")).toBe(true);
    expect(normalizeCheckbox("  ☑ ")).toBe(true);
  });
});
