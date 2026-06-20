/**
 * Real auto-discovery provider backed by Google Places (PSG-149, follow-up to
 * PSG-144).
 *
 * Given a shop's name + address, this calls the Google Places API (Text Search,
 * new v1 surface) to resolve the business and pull *authoritative* enrichment:
 * website, phone, opening hours, review summary, and (when available) a
 * canonical postal address. Competitors come from an injectable
 * `CompetitorSource` (the board-gated BigQuery service-radius query — PSG-142);
 * an optional `KeywordSource` (SEMrush) can layer on later. Both are optional so
 * this provider is useful the moment a Google Places key lands, even before the
 * BigQuery geodata schema is approved.
 *
 * Verified-facts mandate (BSM Phase 0 / PSG-142): only fields sourced from an
 * authoritative external system are marked `verified: true`. Anything inferred
 * (e.g. a website guessed from the name when Places has none) or echoed from the
 * user stays `verified: false` — the operator/owner confirms it in the wizard.
 *
 * Resilience + idempotency: every outbound call goes through `withRetry`
 * (lib/resilience.ts) and a `CircuitBreaker`, and the whole discover() result is
 * memoised in a TTL cache keyed by the normalized input, so repeated discovery
 * for the same shop is idempotent and does not re-bill the paid API.
 */

import type {
  DiscoveredCompetitor,
  DiscoveryInput,
  DiscoveryProvider,
  EnrichedShopProfile,
  ReviewSummary,
} from "./types";
import {
  cleanText,
  inferWebsiteCandidate,
  normalizePhone,
  normalizeState,
} from "./normalize";
import { heuristicProvider } from "./heuristic-provider";
import { CircuitBreaker, withRetry, type RetryOptions } from "../../resilience";

const PLACES_SEARCH_URL =
  "https://places.googleapis.com/v1/places:searchText";

/**
 * Field mask sent to the Places API. We only request what we map below — Places
 * bills per requested field SKU, so keep this minimal.
 */
const PLACES_FIELD_MASK = [
  "places.id",
  "places.displayName",
  "places.websiteUri",
  "places.nationalPhoneNumber",
  "places.regularOpeningHours.weekdayDescriptions",
  "places.rating",
  "places.userRatingCount",
  "places.addressComponents",
  "places.location",
].join(",");

/** Minimal shape of a Places API addressComponent we care about. */
interface PlacesAddressComponent {
  longText?: string;
  shortText?: string;
  types?: string[];
}

/** Minimal shape of a Places API place (only the fields we map). */
interface PlacesResult {
  id?: string;
  displayName?: { text?: string };
  websiteUri?: string;
  nationalPhoneNumber?: string;
  regularOpeningHours?: { weekdayDescriptions?: string[] };
  rating?: number;
  userRatingCount?: number;
  addressComponents?: PlacesAddressComponent[];
  location?: { latitude?: number; longitude?: number };
}

interface PlacesSearchResponse {
  places?: PlacesResult[];
}

/** A geo coordinate, used to seed the competitor radius query. */
export interface GeoPoint {
  latitude: number;
  longitude: number;
}

/**
 * Pluggable competitor lookup. The production implementation is the board-gated
 * BigQuery service-radius query (PSG-142); until that schema is approved this is
 * simply omitted and competitors stay `pending`.
 */
export interface CompetitorSource {
  readonly name: string;
  nearby(args: {
    shopName: string;
    center: GeoPoint | null;
    city: string | null;
    state: string | null;
  }): Promise<DiscoveredCompetitor[]>;
}

/** Minimal injectable HTTP surface so tests don't hit the network. */
export type FetchLike = (
  url: string,
  init: {
    method: string;
    headers: Record<string, string>;
    body: string;
  }
) => Promise<{
  ok: boolean;
  status: number;
  json: () => Promise<unknown>;
  text: () => Promise<string>;
}>;

/** TTL cache contract — defaults to an in-process Map, injectable for tests. */
export interface ProfileCache {
  get(key: string): EnrichedShopProfile | undefined;
  set(key: string, value: EnrichedShopProfile): void;
}

/** Simple TTL map cache. Pure aside from the injected clock. */
export function createTtlCache(
  ttlMs: number,
  now: () => number = Date.now
): ProfileCache {
  const store = new Map<string, { value: EnrichedShopProfile; at: number }>();
  return {
    get(key) {
      const hit = store.get(key);
      if (!hit) return undefined;
      if (now() - hit.at > ttlMs) {
        store.delete(key);
        return undefined;
      }
      return hit.value;
    },
    set(key, value) {
      store.set(key, { value, at: now() });
    },
  };
}

export interface GooglePlacesProviderDeps {
  /** Google Places API key. When absent the provider reports unconfigured. */
  apiKey?: string;
  /** Injectable fetch (defaults to global fetch). */
  fetchImpl?: FetchLike;
  /** Optional BigQuery-backed competitor radius source (PSG-142). */
  competitorSource?: CompetitorSource;
  /** Result cache (defaults to a 1h in-process TTL cache). */
  cache?: ProfileCache;
  /** Retry tuning forwarded to withRetry (tests inject no-op sleep/jitter). */
  retryOptions?: RetryOptions;
  /** Circuit breaker (shared across calls by default). */
  breaker?: CircuitBreaker;
}

/** External fields a fully-loaded Google Places lookup can fill. */
const EXTERNAL_FIELDS = ["phone", "hours", "reviews", "competitors"] as const;

const DEFAULT_TTL_MS = 60 * 60 * 1000; // 1 hour

/** Build the Places free-text query from the structured input. */
function buildTextQuery(input: DiscoveryInput): string {
  return [input.shopName, input.addressStreet, input.city, input.state]
    .map((p) => (p ?? "").trim())
    .filter(Boolean)
    .join(", ");
}

/** Deterministic cache key from the normalized input. */
function cacheKey(input: DiscoveryInput): string {
  return JSON.stringify({
    n: input.shopName.trim().toLowerCase(),
    s: cleanText(input.addressStreet)?.toLowerCase() ?? null,
    c: cleanText(input.city)?.toLowerCase() ?? null,
    r: normalizeState(input.state),
  });
}

/** Pull a single address component's value by Places type. */
function findComponent(
  components: PlacesAddressComponent[] | undefined,
  type: string,
  prefer: "long" | "short" = "long"
): string | null {
  const match = components?.find((c) => c.types?.includes(type));
  if (!match) return null;
  const v = prefer === "short" ? match.shortText : match.longText;
  return cleanText(v) ?? null;
}

/**
 * 5xx / network errors are transient and worth retrying; 4xx (bad key, quota,
 * malformed request) are not.
 */
function isRetryableStatus(status: number): boolean {
  return status >= 500 || status === 429;
}

class PlacesHttpError extends Error {
  constructor(
    readonly status: number,
    message: string
  ) {
    super(message);
    this.name = "PlacesHttpError";
  }
}

/**
 * Create a Google Places discovery provider.
 *
 * The factory is the testable surface (inject fetch/cache/clock); the module
 * also exports a lazy env-backed `googlePlacesProvider` used by the registry.
 */
export function createGooglePlacesProvider(
  deps: GooglePlacesProviderDeps = {}
): DiscoveryProvider {
  const apiKey = deps.apiKey;
  const fetchImpl: FetchLike =
    deps.fetchImpl ?? ((url, init) => fetch(url, init) as ReturnType<FetchLike>);
  const cache = deps.cache ?? createTtlCache(DEFAULT_TTL_MS);
  const breaker = deps.breaker ?? new CircuitBreaker();
  const competitorSource = deps.competitorSource;

  async function searchPlace(
    input: DiscoveryInput
  ): Promise<PlacesResult | null> {
    const body = JSON.stringify({
      textQuery: buildTextQuery(input),
      maxResultCount: 1,
    });
    const run = () =>
      breaker.execute(async () => {
        const res = await fetchImpl(PLACES_SEARCH_URL, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "X-Goog-Api-Key": apiKey ?? "",
            "X-Goog-FieldMask": PLACES_FIELD_MASK,
          },
          body,
        });
        if (!res.ok) {
          throw new PlacesHttpError(
            res.status,
            `Places searchText failed: ${res.status} ${await res
              .text()
              .catch(() => "")}`
          );
        }
        return (await res.json()) as PlacesSearchResponse;
      });

    const data = await withRetry(run, {
      retries: 3,
      isRetryable: (e) =>
        e instanceof PlacesHttpError ? isRetryableStatus(e.status) : true,
      ...deps.retryOptions,
    });
    return data.places?.[0] ?? null;
  }

  async function discover(input: DiscoveryInput): Promise<EnrichedShopProfile> {
    const shopName = input.shopName.trim();

    // Not configured → degrade to the offline provider (verified-facts safe).
    if (!apiKey) {
      return heuristicProvider.discover(input);
    }

    const key = cacheKey(input);
    const cached = cache.get(key);
    if (cached) return cached;

    let place: PlacesResult | null = null;
    try {
      place = await searchPlace(input);
    } catch {
      // External enrichment failed (bad key / quota / outage). Never break
      // onboarding — fall back to the deterministic heuristic profile.
      return heuristicProvider.discover(input);
    }

    const pending = new Set<string>(EXTERNAL_FIELDS);

    // --- website -----------------------------------------------------------
    const placesWebsite = cleanText(place?.websiteUri);
    const inferred = inferWebsiteCandidate(shopName);
    const websiteUrl = placesWebsite
      ? {
          value: placesWebsite,
          confidence: 0.95,
          source: "google_places" as const,
          verified: true,
        }
      : {
          value: inferred,
          confidence: inferred ? 0.25 : 0,
          source: "inferred" as const,
          verified: false,
        };

    // --- phone -------------------------------------------------------------
    const phoneValue = normalizePhone(place?.nationalPhoneNumber);
    const phone = phoneValue
      ? {
          value: phoneValue,
          confidence: 0.95,
          source: "google_places" as const,
          verified: true,
        }
      : {
          value: null,
          confidence: 0,
          source: "inferred" as const,
          verified: false,
        };
    if (phoneValue) pending.delete("phone");

    // --- hours -------------------------------------------------------------
    const hoursText =
      place?.regularOpeningHours?.weekdayDescriptions &&
      place.regularOpeningHours.weekdayDescriptions.length > 0
        ? place.regularOpeningHours.weekdayDescriptions.join("; ")
        : null;
    const hours = hoursText
      ? {
          value: hoursText,
          confidence: 0.9,
          source: "google_places" as const,
          verified: true,
        }
      : {
          value: null,
          confidence: 0,
          source: "inferred" as const,
          verified: false,
        };
    if (hoursText) pending.delete("hours");

    // --- reviews -----------------------------------------------------------
    const hasReviews =
      typeof place?.rating === "number" ||
      typeof place?.userRatingCount === "number";
    const reviewValue: ReviewSummary | null = hasReviews
      ? {
          rating: place?.rating ?? null,
          count: place?.userRatingCount ?? null,
        }
      : null;
    const reviewSummary = hasReviews
      ? {
          value: reviewValue,
          confidence: 0.95,
          source: "google_places" as const,
          verified: true,
        }
      : {
          value: null,
          confidence: 0,
          source: "inferred" as const,
          verified: false,
        };
    if (hasReviews) pending.delete("reviews");

    // --- canonical address (authoritative when Places resolves it) ---------
    const street = (() => {
      const num = findComponent(place?.addressComponents, "street_number");
      const route = findComponent(place?.addressComponents, "route");
      const joined = [num, route].filter(Boolean).join(" ").trim();
      return joined.length > 0 ? joined : null;
    })();
    const locality =
      findComponent(place?.addressComponents, "locality") ??
      findComponent(place?.addressComponents, "postal_town");
    const region = normalizeState(
      findComponent(place?.addressComponents, "administrative_area_level_1", "short")
    );

    const addressStreet = street
      ? {
          value: street,
          confidence: 0.9,
          source: "google_places" as const,
          verified: true,
        }
      : {
          value: cleanText(input.addressStreet),
          confidence: input.addressStreet ? 1 : 0,
          source: "user" as const,
          verified: false,
        };
    const addressLocality = locality
      ? {
          value: locality,
          confidence: 0.9,
          source: "google_places" as const,
          verified: true,
        }
      : {
          value: cleanText(input.city),
          confidence: input.city ? 1 : 0,
          source: "user" as const,
          verified: false,
        };
    const addressRegion = region
      ? {
          value: region,
          confidence: 0.9,
          source: "google_places" as const,
          verified: true,
        }
      : {
          value: normalizeState(input.state),
          confidence: normalizeState(input.state) ? 1 : 0,
          source: "user" as const,
          verified: false,
        };

    // --- competitors (board-gated BigQuery source — optional) --------------
    let competitors: DiscoveredCompetitor[] = [];
    if (competitorSource) {
      try {
        competitors = await competitorSource.nearby({
          shopName,
          center:
            typeof place?.location?.latitude === "number" &&
            typeof place?.location?.longitude === "number"
              ? {
                  latitude: place.location.latitude,
                  longitude: place.location.longitude,
                }
              : null,
          city: cleanText(input.city),
          state: normalizeState(input.state),
        });
        if (competitors.length > 0) pending.delete("competitors");
      } catch {
        // Competitor enrichment is best-effort; leave it pending on failure.
        competitors = [];
      }
    }

    const profile: EnrichedShopProfile = {
      shopName: {
        value: cleanText(place?.displayName?.text) ?? shopName,
        confidence: 1,
        source: place?.displayName?.text ? "google_places" : "user",
        // The displayName is Google's canonical name — authoritative.
        verified: Boolean(place?.displayName?.text),
      },
      websiteUrl,
      phone,
      hours,
      addressStreet,
      addressLocality,
      addressRegion,
      reviewSummary,
      competitors,
      pending: [...pending],
      provider: "google_places",
    };

    cache.set(key, profile);
    return profile;
  }

  return {
    name: "google_places",
    isConfigured: () => Boolean(apiKey),
    discover,
  };
}

/**
 * Env-backed singleton used by the provider registry. Reads
 * `GOOGLE_PLACES_API_KEY` lazily so importing this module never throws when the
 * board-gated key is absent — `isConfigured()` reports false and the registry
 * degrades to the heuristic provider.
 */
export const googlePlacesProvider: DiscoveryProvider = createGooglePlacesProvider(
  { apiKey: process.env.GOOGLE_PLACES_API_KEY }
);
