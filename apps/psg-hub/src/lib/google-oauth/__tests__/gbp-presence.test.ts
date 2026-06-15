import { describe, it, expect, vi } from "vitest";
import {
  fetchGbpPresence,
  mapLocationToPresence,
  GBP_PRESENCE_READ_MASK,
  type GbpLocationStateLike,
} from "@/lib/google-oauth/gbp-presence";
import { GoogleApiError } from "@/lib/google-oauth/client";
import type { LinkedAccount as Acct } from "@/lib/google-oauth/accounts";

// The deps.getLinkedAccount + deps.get seams inject the account + the raw location
// body; the default googleapis Business Information client never runs.

const ACCT: Acct = {
  accountId: "row-1",
  externalAccountId: "locations/555",
  externalParentId: "accounts/111",
  refreshToken: "rt",
};

const FULL_LOCATION: GbpLocationStateLike = {
  openInfo: { status: "OPEN" },
  categories: {
    primaryCategory: { displayName: "Auto body shop" },
    additionalCategories: [
      { displayName: "Car repair and maintenance" },
      { displayName: "" }, // blank is filtered out
    ],
  },
  regularHours: { periods: [{}, {}] },
  profile: { description: "  We fix cars.  " },
  phoneNumbers: { primaryPhone: "+1 555 0100" },
  websiteUri: "https://example.com",
};

describe("mapLocationToPresence", () => {
  it("maps a full location to every presence field + a 100 completeness score", () => {
    const p = mapLocationToPresence(FULL_LOCATION);
    expect(p).toEqual({
      open_status: "OPEN",
      primary_category: "Auto body shop",
      categories: ["Car repair and maintenance"],
      has_hours: true,
      website_uri: "https://example.com",
      has_description: true,
      phone_present: true,
      completeness_score: 100,
    });
  });

  it("computes the completeness score as round(present-signals / 7 * 100)", () => {
    // OPEN + primary_category + website only -> 3 of 7 signals -> round(3/7*100)=43.
    const p = mapLocationToPresence({
      openInfo: { status: "OPEN" },
      categories: { primaryCategory: { displayName: "Auto body shop" } },
      websiteUri: "https://example.com",
    });
    expect(p.completeness_score).toBe(43);
    expect(p.has_hours).toBe(false);
    expect(p.categories).toEqual([]);
  });

  it("defaults every missing field and scores 0 for an empty listing", () => {
    const p = mapLocationToPresence({});
    expect(p).toEqual({
      open_status: "",
      primary_category: null,
      categories: [],
      has_hours: false,
      website_uri: null,
      has_description: false,
      phone_present: false,
      completeness_score: 0,
    });
  });

  it("does not count a CLOSED status or a whitespace-only description as a signal", () => {
    const p = mapLocationToPresence({
      openInfo: { status: "CLOSED_PERMANENTLY" },
      profile: { description: "   " },
      phoneNumbers: { primaryPhone: "  " },
    });
    expect(p.open_status).toBe("CLOSED_PERMANENTLY");
    expect(p.has_description).toBe(false);
    expect(p.phone_present).toBe(false);
    expect(p.completeness_score).toBe(0);
  });
});

describe("fetchGbpPresence", () => {
  it("reads the location via the get seam with the full readMask + bare locations/{id} name", async () => {
    const get = vi.fn(async () => FULL_LOCATION);
    const out = await fetchGbpPresence("shop-1", {
      getLinkedAccount: async () => ACCT,
      get,
    });
    expect(get).toHaveBeenCalledTimes(1);
    expect(get).toHaveBeenCalledWith("locations/555", GBP_PRESENCE_READ_MASK);
    expect(out.open_status).toBe("OPEN");
    expect(out.completeness_score).toBe(100);
    // the rating pair is NOT set here (the orchestrator merges gbp-reviews).
    expect(out).not.toHaveProperty("average_rating");
    expect(out).not.toHaveProperty("total_review_count");
  });

  it("throws GoogleApiError('auth_failed') when no gbp account is linked", async () => {
    await expect(
      fetchGbpPresence("shop-1", {
        getLinkedAccount: async () => null,
        get: vi.fn(),
      })
    ).rejects.toMatchObject({ code: "auth_failed" });
  });

  it("maps a 404 from the location read to a bad_request GoogleApiError", async () => {
    const get = vi.fn(async () => {
      throw Object.assign(new Error("not found"), { response: { status: 404 } });
    });
    const err = await fetchGbpPresence("shop-1", {
      getLinkedAccount: async () => ACCT,
      get,
    }).catch((e) => e);
    expect(err).toBeInstanceOf(GoogleApiError);
    expect(err).toMatchObject({ code: "bad_request" });
  });
});
