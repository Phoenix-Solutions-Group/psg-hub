import { describe, it, expect, vi } from "vitest";
import {
  createGooglePlacesProvider,
  createTtlCache,
  type CompetitorSource,
  type FetchLike,
} from "../google-places-provider";
import { selectProvider } from "../index";
import type { DiscoveryInput } from "../types";

const INPUT: DiscoveryInput = {
  shopName: "Tracy's Collision Center",
  addressStreet: "1500 Center Park Rd",
  city: "Lincoln",
  state: "ne",
};

/** A complete Places v1 searchText result with every mapped field populated. */
function fullPlacesPayload() {
  return {
    places: [
      {
        id: "places/abc123",
        displayName: { text: "Tracy's Collision Center" },
        websiteUri: "https://tracyscollision.example",
        nationalPhoneNumber: "(402) 441-4800",
        regularOpeningHours: {
          weekdayDescriptions: [
            "Monday: 8:00 AM – 5:00 PM",
            "Tuesday: 8:00 AM – 5:00 PM",
          ],
        },
        rating: 4.7,
        userRatingCount: 132,
        addressComponents: [
          { longText: "1500", types: ["street_number"] },
          { longText: "Center Park Road", types: ["route"] },
          { longText: "Lincoln", types: ["locality"] },
          {
            longText: "Nebraska",
            shortText: "NE",
            types: ["administrative_area_level_1"],
          },
        ],
        location: { latitude: 40.78, longitude: -96.66 },
      },
    ],
  };
}

/** A FetchLike that returns 200 + the given JSON, recording call count. */
function okFetch(json: unknown): { fetchImpl: FetchLike; calls: () => number } {
  let n = 0;
  const fetchImpl: FetchLike = async () => {
    n += 1;
    return {
      ok: true,
      status: 200,
      json: async () => json,
      text: async () => JSON.stringify(json),
    };
  };
  return { fetchImpl, calls: () => n };
}

const noWait = { sleep: async () => {}, jitter: () => 0 };

describe("googlePlacesProvider — authoritative enrichment", () => {
  it("marks Google-sourced fields verified and fills pending", async () => {
    const { fetchImpl } = okFetch(fullPlacesPayload());
    const provider = createGooglePlacesProvider({
      apiKey: "test-key",
      fetchImpl,
    });

    const p = await provider.discover(INPUT);

    expect(p.provider).toBe("google_places");
    expect(p.websiteUrl.value).toBe("https://tracyscollision.example");
    expect(p.websiteUrl.source).toBe("google_places");
    expect(p.websiteUrl.verified).toBe(true);

    expect(p.phone.value).toBe("(402) 441-4800");
    expect(p.phone.verified).toBe(true);

    expect(p.hours.value).toContain("Monday");
    expect(p.hours.verified).toBe(true);

    expect(p.reviewSummary.value).toEqual({ rating: 4.7, count: 132 });
    expect(p.reviewSummary.verified).toBe(true);

    // Canonical address components are authoritative.
    expect(p.addressStreet.value).toBe("1500 Center Park Road");
    expect(p.addressStreet.verified).toBe(true);
    expect(p.addressRegion.value).toBe("NE");
    expect(p.addressRegion.verified).toBe(true);

    // phone/hours/reviews filled → only competitors remains pending.
    expect(p.pending).toEqual(["competitors"]);
  });

  it("never marks an inferred website fallback as verified", async () => {
    const payload = fullPlacesPayload();
    const placeWithoutWebsite = { ...payload.places[0], websiteUri: undefined };
    const { fetchImpl } = okFetch({ places: [placeWithoutWebsite] });
    const provider = createGooglePlacesProvider({
      apiKey: "test-key",
      fetchImpl,
    });

    const p = await provider.discover(INPUT);
    expect(p.websiteUrl.value).toBe("https://www.tracyscollisioncenter.com");
    expect(p.websiteUrl.source).toBe("inferred");
    expect(p.websiteUrl.verified).toBe(false);
  });

  it("leaves missing external fields pending and unverified", async () => {
    // Places resolves the business but exposes no phone/hours/reviews.
    const payload = {
      places: [{ displayName: { text: "Acme" } }],
    };
    const { fetchImpl } = okFetch(payload);
    const provider = createGooglePlacesProvider({
      apiKey: "test-key",
      fetchImpl,
    });

    const p = await provider.discover({ shopName: "Acme" });
    expect(p.phone.value).toBeNull();
    expect(p.phone.verified).toBe(false);
    expect(p.reviewSummary.value).toBeNull();
    expect(p.pending).toEqual(["phone", "hours", "reviews", "competitors"]);
  });
});

describe("googlePlacesProvider — idempotency & resilience", () => {
  it("caches by normalized input so repeat discovery does not re-bill", async () => {
    const { fetchImpl, calls } = okFetch(fullPlacesPayload());
    const provider = createGooglePlacesProvider({
      apiKey: "test-key",
      fetchImpl,
      cache: createTtlCache(60_000),
    });

    const a = await provider.discover(INPUT);
    // Same shop, different casing/spacing → same cache key.
    const b = await provider.discover({
      ...INPUT,
      shopName: "  tracy's collision center  ",
      state: "NE",
    });

    expect(calls()).toBe(1);
    expect(a).toEqual(b);
  });

  it("retries transient 5xx then succeeds (withRetry)", async () => {
    let n = 0;
    const fetchImpl: FetchLike = async () => {
      n += 1;
      if (n === 1) {
        return {
          ok: false,
          status: 503,
          json: async () => ({}),
          text: async () => "unavailable",
        };
      }
      return {
        ok: true,
        status: 200,
        json: async () => fullPlacesPayload(),
        text: async () => "",
      };
    };
    const provider = createGooglePlacesProvider({
      apiKey: "test-key",
      fetchImpl,
      retryOptions: noWait,
    });

    const p = await provider.discover(INPUT);
    expect(n).toBe(2);
    expect(p.phone.verified).toBe(true);
  });

  it("falls back to heuristic (not throw) on a non-retryable 4xx", async () => {
    const fetchImpl: FetchLike = async () => ({
      ok: false,
      status: 403,
      json: async () => ({}),
      text: async () => "bad key",
    });
    const provider = createGooglePlacesProvider({
      apiKey: "test-key",
      fetchImpl,
      retryOptions: noWait,
    });

    const p = await provider.discover(INPUT);
    // Degraded to the offline provider — onboarding keeps working.
    expect(p.provider).toBe("heuristic");
    expect(p.phone.verified).toBe(false);
  });
});

describe("googlePlacesProvider — competitors (BigQuery seam)", () => {
  it("fills competitors from an injected CompetitorSource and clears pending", async () => {
    const { fetchImpl } = okFetch(fullPlacesPayload());
    const competitorSource: CompetitorSource = {
      name: "bigquery-stub",
      nearby: async () => [
        { name: "Rival Auto Body", distanceMiles: 2.3, source: "web" },
      ],
    };
    const provider = createGooglePlacesProvider({
      apiKey: "test-key",
      fetchImpl,
      competitorSource,
    });

    const p = await provider.discover(INPUT);
    expect(p.competitors).toHaveLength(1);
    expect(p.competitors[0].name).toBe("Rival Auto Body");
    expect(p.pending).toEqual([]);
  });

  it("keeps competitors pending when the source errors (best-effort)", async () => {
    const { fetchImpl } = okFetch(fullPlacesPayload());
    const competitorSource: CompetitorSource = {
      name: "flaky",
      nearby: async () => {
        throw new Error("bigquery down");
      },
    };
    const provider = createGooglePlacesProvider({
      apiKey: "test-key",
      fetchImpl,
      competitorSource,
    });

    const p = await provider.discover(INPUT);
    expect(p.competitors).toEqual([]);
    expect(p.pending).toContain("competitors");
  });
});

describe("googlePlacesProvider — config gating", () => {
  it("reports unconfigured and degrades to heuristic when no key is present", async () => {
    const provider = createGooglePlacesProvider({});
    expect(provider.isConfigured?.()).toBe(false);
    const p = await provider.discover(INPUT);
    expect(p.provider).toBe("heuristic");
  });

  it("selectProvider returns google_places only when configured", () => {
    // No GOOGLE_PLACES_API_KEY in the test env → degrade to heuristic.
    expect(selectProvider("google_places").name).toBe("heuristic");
  });

  it("does not call fetch at all when unconfigured", async () => {
    const fetchImpl = vi.fn();
    const provider = createGooglePlacesProvider({
      fetchImpl: fetchImpl as unknown as FetchLike,
    });
    await provider.discover(INPUT);
    expect(fetchImpl).not.toHaveBeenCalled();
  });
});
