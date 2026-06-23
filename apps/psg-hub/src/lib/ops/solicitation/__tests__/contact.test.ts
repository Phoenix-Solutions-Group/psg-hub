import { describe, it, expect } from "vitest";
import {
  normalizeEmail,
  normalizePhone,
  normalizeContact,
  contactHash,
} from "../contact";

const SALT = "test-salt";

describe("normalizeEmail", () => {
  it("lower-cases and trims a valid address", () => {
    expect(normalizeEmail("  Jordan@Shop.COM ")).toBe("jordan@shop.com");
  });
  it("rejects a value with no @x.y shape", () => {
    expect(normalizeEmail("not-an-email")).toBe("");
    expect(normalizeEmail("a@b")).toBe("");
    expect(normalizeEmail("")).toBe("");
    expect(normalizeEmail(null)).toBe("");
  });
});

describe("normalizePhone", () => {
  it("formats a bare 10-digit US number to E.164", () => {
    expect(normalizePhone("(555) 867-5309")).toBe("+15558675309");
    expect(normalizePhone("555.867.5309")).toBe("+15558675309");
  });
  it("treats a 1-prefixed 11-digit number as US", () => {
    expect(normalizePhone("1 555 867 5309")).toBe("+15558675309");
  });
  it("keeps an already +-prefixed E.164 number", () => {
    expect(normalizePhone("+44 20 7946 0958")).toBe("+442079460958");
  });
  it("rejects implausible numbers", () => {
    expect(normalizePhone("12345")).toBe("");
    expect(normalizePhone("")).toBe("");
    expect(normalizePhone(null)).toBe("");
  });
});

describe("contactHash", () => {
  it("matches across formatting differences (the STOP↔send join)", () => {
    const a = contactHash("sms", "(555) 867-5309", { salt: SALT });
    const b = contactHash("sms", "+1 555-867-5309", { salt: SALT });
    expect(a).toBe(b);
    expect(a.startsWith("ph_")).toBe(true);
  });
  it("matches an email regardless of case/whitespace", () => {
    const a = contactHash("email", " Jordan@Shop.com", { salt: SALT });
    const b = contactHash("email", "jordan@shop.com", { salt: SALT });
    expect(a).toBe(b);
    expect(a.startsWith("em_")).toBe(true);
  });
  it("binds the channel into the hash (no cross-channel collision)", () => {
    // Even if a phone and an email normalized to the same string, the channel
    // prefix + binding keep them distinct. Different prefixes guarantee it.
    const phone = contactHash("sms", "5558675309", { salt: SALT });
    const email = contactHash("email", "jordan@shop.com", { salt: SALT });
    expect(phone.slice(0, 3)).not.toBe(email.slice(0, 3));
  });
  it("returns '' for an unusable contact", () => {
    expect(contactHash("email", "nope", { salt: SALT })).toBe("");
    expect(contactHash("sms", "123", { salt: SALT })).toBe("");
  });
  it("is salt-sensitive (no fixed-salt leakage)", () => {
    const a = contactHash("email", "jordan@shop.com", { salt: "s1" });
    const b = contactHash("email", "jordan@shop.com", { salt: "s2" });
    expect(a).not.toBe(b);
  });
});

describe("normalizeContact", () => {
  it("dispatches by channel", () => {
    expect(normalizeContact("email", "A@B.co")).toBe("a@b.co");
    expect(normalizeContact("sms", "5558675309")).toBe("+15558675309");
  });
});
