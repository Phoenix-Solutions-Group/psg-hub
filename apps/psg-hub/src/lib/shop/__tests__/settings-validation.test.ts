import { describe, it, expect } from "vitest";
import {
  validateShopSettings,
  isValidUsPhone,
  isHttpsUrl,
  SETTINGS_MESSAGES,
} from "@/lib/shop/settings-validation";

/** A fully-valid input used as the base for single-field failure cases. */
const VALID = {
  name: "Shelton Collision",
  telephone: "(203) 555-0148",
  url: "https://sheltoncollision.com",
  radius: "25",
  address_street: "421 River Rd",
  address_locality: "Shelton",
  address_region: "ct",
  address_postal_code: "06484",
  hours: "Mon–Fri 8–6",
};

describe("isValidUsPhone", () => {
  it("accepts formatted 10-digit", () => {
    expect(isValidUsPhone("(203) 555-0148")).toBe(true);
  });
  it("accepts 11-digit with leading 1", () => {
    expect(isValidUsPhone("1-203-555-0148")).toBe(true);
  });
  it("rejects too few digits", () => {
    expect(isValidUsPhone("555-0148")).toBe(false);
  });
  it("rejects 11-digit not starting with 1", () => {
    expect(isValidUsPhone("2035550148 9")).toBe(false);
  });
});

describe("isHttpsUrl", () => {
  it("accepts https", () => {
    expect(isHttpsUrl("https://shop.com")).toBe(true);
  });
  it("rejects http", () => {
    expect(isHttpsUrl("http://shop.com")).toBe(false);
  });
  it("rejects garbage", () => {
    expect(isHttpsUrl("shop.com")).toBe(false);
  });
});

describe("validateShopSettings — happy path", () => {
  it("returns normalized values (state upper-cased, radius coerced to int)", () => {
    const r = validateShopSettings(VALID);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.values).toEqual({
      name: "Shelton Collision",
      telephone: "(203) 555-0148",
      url: "https://sheltoncollision.com",
      radius: 25,
      address_street: "421 River Rd",
      address_locality: "Shelton",
      address_region: "CT",
      address_postal_code: "06484",
      hours: "Mon–Fri 8–6",
    });
  });

  it("accepts a numeric radius (not just a string)", () => {
    const r = validateShopSettings({ ...VALID, radius: 25 });
    expect(r.ok).toBe(true);
  });

  it("optional address_locality / region / postal / hours may be blank", () => {
    const r = validateShopSettings({
      ...VALID,
      address_locality: "",
      address_region: "",
      address_postal_code: "",
      hours: "",
    });
    expect(r.ok).toBe(true);
  });
});

describe("validateShopSettings — required fields", () => {
  it("blank name → plain message", () => {
    const r = validateShopSettings({ ...VALID, name: "   " });
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.fieldErrors.name).toBe(SETTINGS_MESSAGES.name_required);
  });

  it("blank street → plain message", () => {
    const r = validateShopSettings({ ...VALID, address_street: "" });
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.fieldErrors.address_street).toBe(
      SETTINGS_MESSAGES.address_street_required
    );
  });
});

describe("validateShopSettings — phone", () => {
  it("blank → required message", () => {
    const r = validateShopSettings({ ...VALID, telephone: "" });
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.fieldErrors.telephone).toBe(SETTINGS_MESSAGES.telephone_required);
  });
  it("bad format → invalid message", () => {
    const r = validateShopSettings({ ...VALID, telephone: "123" });
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.fieldErrors.telephone).toBe(SETTINGS_MESSAGES.telephone_invalid);
  });
});

describe("validateShopSettings — website (campaign flow)", () => {
  it("blank → required", () => {
    const r = validateShopSettings({ ...VALID, url: "" });
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.fieldErrors.url).toBe(SETTINGS_MESSAGES.url_required);
  });
  it("http (not https) → invalid", () => {
    const r = validateShopSettings({ ...VALID, url: "http://shop.com" });
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.fieldErrors.url).toBe(SETTINGS_MESSAGES.url_invalid);
  });
});

describe("validateShopSettings — radius (campaign flow)", () => {
  it("blank → required", () => {
    const r = validateShopSettings({ ...VALID, radius: "" });
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.fieldErrors.radius).toBe(SETTINGS_MESSAGES.radius_required);
  });
  it("0 → invalid (out of 1–100)", () => {
    const r = validateShopSettings({ ...VALID, radius: "0" });
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.fieldErrors.radius).toBe(SETTINGS_MESSAGES.radius_invalid);
  });
  it("101 → invalid (out of 1–100)", () => {
    const r = validateShopSettings({ ...VALID, radius: "101" });
    expect(r.ok).toBe(false);
  });
  it("non-integer '25.5' → invalid", () => {
    const r = validateShopSettings({ ...VALID, radius: "25.5" });
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.fieldErrors.radius).toBe(SETTINGS_MESSAGES.radius_invalid);
  });
});

describe("validateShopSettings — optional-if-present", () => {
  it("bad state code → invalid", () => {
    const r = validateShopSettings({ ...VALID, address_region: "Connecticut" });
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.fieldErrors.address_region).toBe(
      SETTINGS_MESSAGES.address_region_invalid
    );
  });
  it("bad ZIP → invalid", () => {
    const r = validateShopSettings({ ...VALID, address_postal_code: "648" });
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.fieldErrors.address_postal_code).toBe(
      SETTINGS_MESSAGES.address_postal_code_invalid
    );
  });
  it("hours over 200 chars → too long", () => {
    const r = validateShopSettings({ ...VALID, hours: "x".repeat(201) });
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.fieldErrors.hours).toBe(SETTINGS_MESSAGES.hours_too_long);
  });
});

describe("validateShopSettings — collects multiple errors", () => {
  it("reports every failing field at once", () => {
    const r = validateShopSettings({});
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(Object.keys(r.fieldErrors).sort()).toEqual(
      ["address_street", "name", "radius", "telephone", "url"].sort()
    );
  });
});
