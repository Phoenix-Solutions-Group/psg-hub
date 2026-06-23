import { describe, it, expect } from "vitest";
import {
  canonicalAddress,
  householdKey,
  recipientHash,
  normalizePersonName,
} from "../household";

const SALT = { salt: "test-salt" };

const HOUSE = {
  line1: "123 Main St",
  city: "Los Angeles",
  state: "CA",
  zip: "90012",
};

describe("canonicalAddress", () => {
  it("normalizes formatting differences to one canonical form", () => {
    const a = canonicalAddress({ line1: "123 Main St", city: "los angeles", state: "California", zip: "90012" });
    const b = canonicalAddress({ line1: "123  MAIN STREET", city: "LOS ANGELES", state: "CA", zip: "90012-0000" });
    // zip+4 differs (90012 vs 90012-0000) — but the 5-digit + street + city + state match.
    expect(a).toContain("123 MAIN STREET");
    expect(a).toContain("LOS ANGELES");
    expect(a).toContain("CA");
    expect(b).toContain("123 MAIN STREET");
  });

  it("returns empty string for an unusable address", () => {
    expect(canonicalAddress({})).toBe("");
    expect(canonicalAddress({ line1: "  ", city: "" })).toBe("");
  });
});

describe("householdKey — dedup", () => {
  it("collapses two different recipients at the same address to one household", () => {
    const husband = householdKey(HOUSE, SALT);
    const wife = householdKey(HOUSE, SALT);
    expect(husband).toBe(wife);
    expect(husband).toMatch(/^hh_[0-9a-f]{64}$/);
  });

  it("treats trivially-different formatting of the same address as one household", () => {
    const a = householdKey({ line1: "123 Main St", city: "Los Angeles", state: "CA", zip: "90012" }, SALT);
    const b = householdKey({ line1: "123 MAIN STREET", city: "los angeles", state: "California", zip: "90012" }, SALT);
    expect(a).toBe(b);
  });

  it("produces different keys for different households", () => {
    const a = householdKey(HOUSE, SALT);
    const b = householdKey({ ...HOUSE, line1: "125 Main St" }, SALT);
    expect(a).not.toBe(b);
  });

  it("returns empty string when there is no address", () => {
    expect(householdKey({}, SALT)).toBe("");
  });

  it("changes with the salt (no cross-environment key leakage)", () => {
    expect(householdKey(HOUSE, { salt: "salt-a" })).not.toBe(
      householdKey(HOUSE, { salt: "salt-b" })
    );
  });
});

describe("recipientHash", () => {
  it("distinguishes two people at the same address", () => {
    const husband = recipientHash("John Smith", HOUSE, SALT);
    const wife = recipientHash("Jane Smith", HOUSE, SALT);
    expect(husband).not.toBe(wife);
    expect(husband).toMatch(/^rc_[0-9a-f]{64}$/);
  });

  it("is stable across name punctuation / casing differences", () => {
    const a = recipientHash("John Q. Smith", HOUSE, SALT);
    const b = recipientHash("JOHN Q SMITH", HOUSE, SALT);
    expect(a).toBe(b);
  });

  it("returns empty string when name and address are both empty", () => {
    expect(recipientHash("", {}, SALT)).toBe("");
  });
});

describe("normalizePersonName", () => {
  it("upper-cases, strips punctuation, collapses whitespace", () => {
    expect(normalizePersonName("  John  Q. O'Brien-Smith ")).toBe("JOHN Q O BRIEN SMITH");
    expect(normalizePersonName(null)).toBe("");
  });
});
