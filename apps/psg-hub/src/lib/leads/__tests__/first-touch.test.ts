import { describe, it, expect } from "vitest";
import {
  FIRST_TOUCH_KEY,
  buildInboundPayload,
  extractAttribution,
  hasAttribution,
  mergeFirstTouch,
  parseStoredAttribution,
  type Attribution,
  type LeadFormFields,
} from "@/lib/leads/first-touch";

const FIELDS: LeadFormFields = {
  shopName: "Sunrise Collision",
  contactName: "Jane Doe",
  email: "jane@sunrise.com",
  phone: "555-111-2222",
  message: "Interested in a demo",
  company_website: "",
};

describe("extractAttribution", () => {
  it("reads all utm + click params from a query string", () => {
    const a = extractAttribution(
      "?utm_source=google&utm_medium=cpc&utm_campaign=spring&utm_content=ad1&gclid=abc&fbclid=xyz",
    );
    expect(a).toEqual({
      utmSource: "google",
      utmMedium: "cpc",
      utmCampaign: "spring",
      utmContent: "ad1",
      gclid: "abc",
      fbclid: "xyz",
    });
  });

  it("omits absent and blank params (no empty-string keys)", () => {
    const a = extractAttribution("?utm_source=google&utm_medium=&utm_campaign=%20");
    expect(a).toEqual({ utmSource: "google" });
    expect(Object.keys(a)).not.toContain("utmMedium");
    expect(Object.keys(a)).not.toContain("utmCampaign");
  });

  it("trims surrounding whitespace", () => {
    const a = extractAttribution(new URLSearchParams({ utm_source: "  google  " }));
    expect(a.utmSource).toBe("google");
  });

  it("returns an empty object when no params are present", () => {
    expect(extractAttribution("")).toEqual({});
  });

  it("accepts a URLSearchParams instance directly", () => {
    const a = extractAttribution(new URLSearchParams({ utm_medium: "email" }));
    expect(a).toEqual({ utmMedium: "email" });
  });
});

describe("hasAttribution", () => {
  it("is false for null/undefined/empty", () => {
    expect(hasAttribution(null)).toBe(false);
    expect(hasAttribution(undefined)).toBe(false);
    expect(hasAttribution({})).toBe(false);
  });
  it("is true when any field is present", () => {
    expect(hasAttribution({ utmSource: "google" })).toBe(true);
  });
  it("treats whitespace-only values as empty", () => {
    expect(hasAttribution({ utmSource: "   " })).toBe(false);
  });
});

describe("mergeFirstTouch (first-touch wins)", () => {
  it("keeps the stored snapshot even when a new touch arrives", () => {
    const stored: Attribution = { utmSource: "google", utmMedium: "cpc" };
    const incoming: Attribution = { utmSource: "facebook", utmMedium: "social" };
    expect(mergeFirstTouch(stored, incoming)).toEqual(stored);
  });

  it("adopts the incoming touch when nothing is stored", () => {
    const incoming: Attribution = { utmSource: "bing" };
    expect(mergeFirstTouch(null, incoming)).toEqual(incoming);
    expect(mergeFirstTouch({}, incoming)).toEqual(incoming);
  });

  it("returns an empty object when neither side has attribution", () => {
    expect(mergeFirstTouch(null, null)).toEqual({});
    expect(mergeFirstTouch({}, {})).toEqual({});
  });
});

describe("parseStoredAttribution", () => {
  it("round-trips a stored JSON snapshot through the allowlist", () => {
    const snap: Attribution = { utmSource: "google", gclid: "abc" };
    const raw = JSON.stringify(snap);
    expect(parseStoredAttribution(raw)).toEqual(snap);
  });

  it("drops unknown/junk keys that aren't in the allowlist", () => {
    const raw = JSON.stringify({ utmSource: "google", evil: "drop-me" });
    const parsed = parseStoredAttribution(raw);
    expect(parsed).toEqual({ utmSource: "google" });
    expect(parsed).not.toHaveProperty("evil");
  });

  it("returns null for null, empty, malformed JSON, or non-object JSON", () => {
    expect(parseStoredAttribution(null)).toBeNull();
    expect(parseStoredAttribution("")).toBeNull();
    expect(parseStoredAttribution("{not json")).toBeNull();
    expect(parseStoredAttribution("\"a string\"")).toBeNull();
    expect(parseStoredAttribution("42")).toBeNull();
  });

  it("ignores non-string values in the stored object", () => {
    const raw = JSON.stringify({ utmSource: "google", utmMedium: 5 });
    expect(parseStoredAttribution(raw)).toEqual({ utmSource: "google" });
  });
});

describe("buildInboundPayload", () => {
  it("maps trimmed form fields to the endpoint contract + honeypot", () => {
    const body = buildInboundPayload(
      { ...FIELDS, shopName: "  Sunrise Collision  " },
      {},
    );
    expect(body).toMatchObject({
      shopName: "Sunrise Collision",
      contactName: "Jane Doe",
      email: "jane@sunrise.com",
      phone: "555-111-2222",
      message: "Interested in a demo",
      company_website: "",
    });
    // Never emits a leadSourceChannel — the server buckets channel from UTMs.
    expect(body).not.toHaveProperty("leadSourceChannel");
  });

  it("attaches first-touch attribution under the camelCase contract keys", () => {
    const body = buildInboundPayload(FIELDS, {
      utmSource: "google",
      utmMedium: "cpc",
      utmCampaign: "spring",
      utmContent: "ad1",
      gclid: "abc",
      fbclid: "xyz",
    });
    expect(body.utmSource).toBe("google");
    expect(body.utmMedium).toBe("cpc");
    expect(body.utmCampaign).toBe("spring");
    expect(body.utmContent).toBe("ad1");
    expect(body.gclid).toBe("abc");
    expect(body.fbclid).toBe("xyz");
  });

  it("omits attribution keys that are absent or blank", () => {
    const body = buildInboundPayload(FIELDS, { utmSource: "google", utmMedium: "  " });
    expect(body.utmSource).toBe("google");
    expect(body).not.toHaveProperty("utmMedium");
  });

  it("passes a filled honeypot through verbatim (server decides it's a bot)", () => {
    const body = buildInboundPayload(
      { ...FIELDS, company_website: "http://spam.example" },
      {},
    );
    expect(body.company_website).toBe("http://spam.example");
  });
});

describe("FIRST_TOUCH_KEY", () => {
  it("is a stable storage key", () => {
    expect(FIRST_TOUCH_KEY).toBe("psg_first_touch");
  });
});
