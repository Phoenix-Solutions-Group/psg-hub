import "server-only";
import { google } from "googleapis";
import { gbpOAuthClientEnv, GoogleApiError, mapGoogleApiError } from "./client";
import { getLinkedAccount, type LinkedAccount } from "./accounts";
import type { GbpPresenceMetrics } from "@/lib/analytics/types";

// Phase 13 / 13-03b — Business Information v1 location-state fetch for the monthly
// GBP presence snapshot. Reads ONE location via the TOP-LEVEL `locations.get`
// (NOT accounts.locations.list, the 13-01 enumeration path) and maps the listing
// state into the PRESENCE subset of GbpPresenceMetrics. The star-rating pair is a
// SEPARATE legacy-v4 call (gbp-reviews.ts) merged onto the same row by the
// orchestrator — it is intentionally NOT set here.
//
// Wiring idiom (the documented Phase-11 trap, same as gbp-enumerate): the
// googleapis-vendored Business Information client takes the OAuth2Client via `auth:`,
// NOT the gax `authClient:`. buildOAuth2Client (the real google-auth-library client
// with `.request`) is the v4 raw-HTTP path used ONLY by gbp-reviews.ts.
//
// readMask is REQUIRED (omitting it 400s) AND must enumerate every field the mapper
// reads or the API returns it absent. Field paths confirmed against the installed
// googleapis@173 Schema$Location (openInfo.status, categories.primaryCategory /
// .additionalCategories[].displayName, regularHours.periods[], profile.description,
// phoneNumbers.primaryPhone, websiteUri).

/** The readMask sent to locations.get — every mapped field plus metadata/title. */
export const GBP_PRESENCE_READ_MASK =
  "openInfo,categories,regularHours,profile,phoneNumbers,websiteUri,metadata,title";

/** Minimal shape of the Schema$Location fields the mapper reads (only these). */
export type GbpLocationStateLike = {
  openInfo?: { status?: string | null } | null;
  categories?: {
    primaryCategory?: { displayName?: string | null } | null;
    additionalCategories?: ({ displayName?: string | null } | null)[] | null;
  } | null;
  regularHours?: { periods?: unknown[] | null } | null;
  profile?: { description?: string | null } | null;
  phoneNumbers?: { primaryPhone?: string | null } | null;
  websiteUri?: string | null;
  metadata?: { mapsUri?: string | null } | null;
};

/** Test seam: fetch one location's state by resource name + readMask (returns the
 *  unwrapped Schema$Location body). The default binds the real googleapis client. */
export type GbpLocationGetFn = (
  name: string,
  readMask: string
) => Promise<GbpLocationStateLike>;

/** The presence (non-rating) subset of GbpPresenceMetrics this fetch produces. The
 *  orchestrator merges the rating pair (gbp-reviews) onto it for the stored row. */
export type GbpPresenceState = Omit<
  GbpPresenceMetrics,
  "average_rating" | "total_review_count"
>;

export type FetchGbpPresenceDeps = {
  getLinkedAccount?: (
    shopId: string,
    source: "gbp"
  ) => Promise<LinkedAccount | null>;
  get?: GbpLocationGetFn;
};

/**
 * Map a Business Information location body to the presence state. Missing fields
 * collapse to safe defaults (open_status '', primary_category null, categories [],
 * booleans false). completeness_score = round( present-signals / 7 * 100 ) over the
 * seven listing signals; a fully-empty listing scores 0.
 */
export function mapLocationToPresence(
  loc: GbpLocationStateLike
): GbpPresenceState {
  const open_status = loc.openInfo?.status ?? "";
  const primary_category = loc.categories?.primaryCategory?.displayName ?? null;
  const categories = (loc.categories?.additionalCategories ?? [])
    .map((c) => c?.displayName ?? "")
    .filter((d): d is string => d.trim().length > 0);
  const has_hours = (loc.regularHours?.periods?.length ?? 0) > 0;
  const website_uri = loc.websiteUri ?? null;
  const has_description = (loc.profile?.description ?? "").trim().length > 0;
  const phone_present = (loc.phoneNumbers?.primaryPhone ?? "").trim().length > 0;
  const maps_uri = loc.metadata?.mapsUri ?? null;

  const signals = [
    open_status === "OPEN",
    primary_category !== null,
    categories.length > 0,
    has_hours,
    website_uri !== null,
    has_description,
    phone_present,
  ].filter(Boolean).length;
  const completeness_score = Math.round((signals / 7) * 100);

  return {
    open_status,
    primary_category,
    categories,
    has_hours,
    website_uri,
    has_description,
    phone_present,
    completeness_score,
    maps_uri,
  };
}

/**
 * Fetch one linked shop's GBP presence state. Reads getLinkedAccount(shop,'gbp')
 * (deps seam) — null throws GoogleApiError('auth_failed') so the orchestrator flips
 * the account; else fetches the location via the `auth:` Business Information client
 * and maps it. Upstream failures (incl. 404 -> bad_request) map via mapGoogleApiError.
 */
export async function fetchGbpPresence(
  shopId: string,
  deps: FetchGbpPresenceDeps = {}
): Promise<GbpPresenceState> {
  const read = deps.getLinkedAccount ?? getLinkedAccount;
  const account = await read(shopId, "gbp");
  if (!account) {
    throw new GoogleApiError(
      "auth_failed",
      "No linked Google Business Profile"
    );
  }
  const get = deps.get ?? defaultLocationGet(account.refreshToken);
  try {
    const loc = await get(account.externalAccountId, GBP_PRESENCE_READ_MASK);
    return mapLocationToPresence(loc);
  } catch (err) {
    throw mapGoogleApiError(err);
  }
}

// --- default googleapis-backed location.get (never runs under the test seam) ---

function defaultLocationGet(refreshToken: string): GbpLocationGetFn {
  return async (name, readMask) => {
    const { clientId, clientSecret, redirectUri } = gbpOAuthClientEnv();
    // googleapis vendors its OWN google-auth-library copy; its `auth` field only
    // accepts that copy's OAuth2Client (same construction as gbp-enumerate.ts).
    const auth = new google.auth.OAuth2(clientId, clientSecret, redirectUri);
    auth.setCredentials({ refresh_token: refreshToken });
    const bi = google.mybusinessbusinessinformation({ version: "v1", auth });
    const res = await bi.locations.get({ name, readMask });
    return (res.data ?? {}) as GbpLocationStateLike;
  };
}
