import "server-only";
import { google } from "googleapis";
import { gbpOAuthClientEnv, mapGoogleApiError } from "./client";

// Phase 13 / 13-01 — Google Business Profile account + location enumeration for the
// link picker. A two-API flow on the post-GMB-split v1 APIs (13-RESEARCH.md
// §Account + location linking):
//   1. My Business Account Management — accounts.list (pageSize<=20). A shop owner
//      may hold a PERSONAL account AND a manager invite to an agency LOCATION_GROUP,
//      so iterate ALL accounts and flatten (mirrors the GA4 accountSummaries flatten).
//   2. My Business Business Information — accounts.locations.list. `readMask` is
//      REQUIRED (omitting it returns HTTP 400, unlike GA4/GSC enumerate).
//
// Resource-name trap: accounts.locations.list takes parent='accounts/{id}', but each
// returned Location.name is the BARE `locations/{id}` (no account prefix). The
// Performance API (13-02) keys off `locations/{id}`, so that bare form is the row's
// external_account_id. We ALSO carry the parent `accounts/{id}` (external_parent_id)
// because the legacy v4 Reviews API (Phase 14) + the 13-03 star-rating aggregate key
// off accounts/{aid}/locations/{lid} — capturing it now avoids re-enumeration later.
//
// Verification: there is NO verificationState field on Location. Read serviceability
// from metadata.hasVoiceOfMerchant (inline, zero extra calls) — insights/performance
// return empty for non-VoM/unverified locations, so the picker flags them.
//
// Wiring idiom (load-bearing, the documented Phase-11 trap): GBP clients live inside
// `googleapis` and take the OAuth2Client via `auth:` (the same as the GSC webmasters
// path) — NOT the gax `authClient:` idiom used by GA4's @google-analytics/data.
// Mixing them fails at request time. Construct exactly like gsc-enumerate.ts.

/** A GBP account (My Business Account Management accounts.list). */
export type GbpAccount = {
  name: string; // 'accounts/{id}'
  accountName: string;
  type: string; // PERSONAL | LOCATION_GROUP | USER_GROUP | ORGANIZATION
  role: string; // PRIMARY_OWNER | OWNER | MANAGER | SITE_MANAGER
  verificationState: string;
};

/** A GBP location, mapped for the picker + persistence. */
export type GbpLocation = {
  id: string; // bare 'locations/{id}' (external_account_id)
  name: string; // title
  address: string | null; // best-effort joined storefrontAddress, for the picker
  parent: string; // 'accounts/{id}' (external_parent_id)
  hasVoiceOfMerchant: boolean; // metadata.hasVoiceOfMerchant — serviceable when true
};

/** Minimal shapes of the raw API objects (only the fields we read). */
export type GbpAccountLike = {
  name?: string | null;
  accountName?: string | null;
  type?: string | null;
  role?: string | null;
  verificationState?: string | null;
};
export type GbpLocationLike = {
  name?: string | null;
  title?: string | null;
  storefrontAddress?: {
    addressLines?: string[] | null;
    locality?: string | null;
    administrativeArea?: string | null;
    postalCode?: string | null;
    regionCode?: string | null;
  } | null;
  metadata?: { hasVoiceOfMerchant?: boolean | null } | null;
};

/** Test seam: one page of accounts.list. */
export type GbpAccountsPageFn = (
  pageToken?: string
) => Promise<{ accounts?: GbpAccountLike[]; nextPageToken?: string }>;
/** Test seam: one page of accounts.locations.list for a parent account. */
export type GbpLocationsPageFn = (
  parent: string,
  pageToken?: string
) => Promise<{ locations?: GbpLocationLike[]; nextPageToken?: string }>;

const LOCATION_READ_MASK = "name,title,storefrontAddress,metadata,openInfo";

function joinAddress(a: GbpLocationLike["storefrontAddress"]): string | null {
  if (!a) return null;
  const parts = [
    ...(a.addressLines ?? []),
    a.locality,
    a.administrativeArea,
    a.postalCode,
  ].filter((p): p is string => typeof p === "string" && p.trim().length > 0);
  return parts.length ? parts.join(", ") : null;
}

/**
 * List all GBP accounts reachable under the fresh `refreshToken`, following
 * pagination. Throws a mapped GoogleApiError on upstream failure. `deps.listPage`
 * injects the response for tests.
 */
export async function listGbpAccounts(
  refreshToken: string,
  deps?: { listPage?: GbpAccountsPageFn }
): Promise<GbpAccount[]> {
  const page = deps?.listPage ?? defaultListAccountsPage(refreshToken);
  const out: GbpAccount[] = [];
  try {
    let pageToken: string | undefined;
    do {
      const body = await page(pageToken);
      for (const a of body?.accounts ?? []) {
        const name = (a?.name ?? "").trim();
        if (!name) continue;
        out.push({
          name,
          accountName: a?.accountName ?? "",
          type: a?.type ?? "",
          role: a?.role ?? "",
          verificationState: a?.verificationState ?? "",
        });
      }
      pageToken = body?.nextPageToken || undefined;
    } while (pageToken);
  } catch (err) {
    throw mapGoogleApiError(err);
  }
  return out;
}

/**
 * List the locations under one `accountName` (`accounts/{id}`), following
 * pagination, mapping each to the picker/persistence shape (bare `locations/{id}`
 * id + the parent account + VoM serviceability). `deps.listPage` injects for tests.
 */
export async function listGbpLocations(
  refreshToken: string,
  accountName: string,
  deps?: { listPage?: GbpLocationsPageFn }
): Promise<GbpLocation[]> {
  const page = deps?.listPage ?? defaultListLocationsPage(refreshToken);
  const out: GbpLocation[] = [];
  const seen = new Set<string>();
  try {
    let pageToken: string | undefined;
    do {
      const body = await page(accountName, pageToken);
      for (const l of body?.locations ?? []) {
        // Location.name is the BARE 'locations/{id}' (no account prefix).
        const id = (l?.name ?? "").trim();
        if (!id || seen.has(id)) continue;
        seen.add(id);
        out.push({
          id,
          name: (l?.title ?? "").trim() || id,
          address: joinAddress(l?.storefrontAddress),
          parent: accountName,
          hasVoiceOfMerchant: l?.metadata?.hasVoiceOfMerchant === true,
        });
      }
      pageToken = body?.nextPageToken || undefined;
    } while (pageToken);
  } catch (err) {
    throw mapGoogleApiError(err);
  }
  return out;
}

/**
 * Convenience for the callback: enumerate every account, then flatten the
 * locations across ALL of them (each location carries its parent account). An
 * account that fails location enumeration is skipped, not fatal — a manager invite
 * to one group should not block locations the user owns elsewhere. Dedupes by the
 * bare locations/{id}. Throws only if the top-level accounts.list fails.
 */
export async function listGbpAccountsAndLocations(
  refreshToken: string,
  deps?: {
    listAccountsPage?: GbpAccountsPageFn;
    listLocationsPage?: GbpLocationsPageFn;
  }
): Promise<GbpLocation[]> {
  const accounts = await listGbpAccounts(refreshToken, {
    listPage: deps?.listAccountsPage,
  });
  const out: GbpLocation[] = [];
  const seen = new Set<string>();
  for (const acct of accounts) {
    let locs: GbpLocation[];
    try {
      locs = await listGbpLocations(refreshToken, acct.name, {
        listPage: deps?.listLocationsPage,
      });
    } catch {
      continue; // one account's locations failing is non-fatal
    }
    for (const loc of locs) {
      if (seen.has(loc.id)) continue;
      seen.add(loc.id);
      out.push(loc);
    }
  }
  return out;
}

// --- default googleapis-backed pages (never run under the test seams) ---

function defaultListAccountsPage(refreshToken: string): GbpAccountsPageFn {
  return async (pageToken) => {
    const { clientId, clientSecret, redirectUri } = gbpOAuthClientEnv();
    // googleapis vendors its OWN google-auth-library copy; its `auth` field only
    // accepts that copy's OAuth2Client (the same construction as gsc-enumerate.ts).
    // The redirectUri is immaterial for refresh-token API calls.
    const auth = new google.auth.OAuth2(clientId, clientSecret, redirectUri);
    auth.setCredentials({ refresh_token: refreshToken });
    const am = google.mybusinessaccountmanagement({ version: "v1", auth });
    const res = await am.accounts.list({ pageSize: 20, pageToken });
    return {
      accounts: (res.data.accounts ?? []) as GbpAccountLike[],
      nextPageToken: res.data.nextPageToken ?? undefined,
    };
  };
}

function defaultListLocationsPage(refreshToken: string): GbpLocationsPageFn {
  return async (parent, pageToken) => {
    const { clientId, clientSecret, redirectUri } = gbpOAuthClientEnv();
    const auth = new google.auth.OAuth2(clientId, clientSecret, redirectUri);
    auth.setCredentials({ refresh_token: refreshToken });
    const bi = google.mybusinessbusinessinformation({ version: "v1", auth });
    // readMask is REQUIRED — omitting it 400s.
    const res = await bi.accounts.locations.list({
      parent,
      readMask: LOCATION_READ_MASK,
      pageSize: 100,
      pageToken,
    });
    return {
      locations: (res.data.locations ?? []) as GbpLocationLike[],
      nextPageToken: res.data.nextPageToken ?? undefined,
    };
  };
}
