import "server-only";
import { google } from "googleapis";
import { googleOAuthClientEnv, mapGoogleApiError } from "./client";

// Phase 11 / 11-01 — GSC site enumeration for the picker.
// Uses Search Console sites.list (no body). Each WmxSite has exactly siteUrl +
// permissionLevel — there is NO display name, so siteUrl is both id and label.
// siteUnverifiedUser sites are EXCLUDED: they can't run searchanalytics queries
// and cause downstream 403s. Usable: siteOwner / siteFullUser / siteRestrictedUser.
// Scope webmasters.readonly is sufficient. Site id formats: 'sc-domain:<host>' or
// 'https://.../' — do NOT copy the Ads /^\d{10}$/ check.

export type GscSite = { id: string; name: string; permissionLevel: string };

/** Minimal shape of a Search Console WmxSite. */
export type WmxSiteLike = {
  siteUrl?: string | null;
  permissionLevel?: string | null;
};

/** Test seam: returns the raw sites.list response body. */
export type GscSitesFn = () => Promise<{ siteEntry?: WmxSiteLike[] }>;

/**
 * List the verified GSC sites reachable under the fresh `refreshToken`, dropping
 * siteUnverifiedUser entries. Throws a mapped GoogleApiError on upstream failure.
 * `deps.listSites` injects the response for tests.
 */
export async function listGscSites(
  refreshToken: string,
  deps?: { listSites?: GscSitesFn }
): Promise<GscSite[]> {
  let body: { siteEntry?: WmxSiteLike[] };
  try {
    body = await (deps?.listSites ?? defaultListSites(refreshToken))();
  } catch (err) {
    throw mapGoogleApiError(err);
  }

  const out: GscSite[] = [];
  const seen = new Set<string>();
  for (const s of body?.siteEntry ?? []) {
    const id = (s?.siteUrl ?? "").trim();
    const level = s?.permissionLevel ?? "";
    if (!id) continue;
    if (level === "siteUnverifiedUser") continue; // cannot query -> exclude
    if (seen.has(id)) continue;
    seen.add(id);
    out.push({ id, name: id, permissionLevel: level });
  }
  return out;
}

function defaultListSites(refreshToken: string): GscSitesFn {
  return async () => {
    const { clientId, clientSecret, redirectUri } = googleOAuthClientEnv();
    // GSC uses googleapis' OWN bundled OAuth2 (google.auth.OAuth2), NOT the shared
    // google-auth-library client: googleapis vendors its own google-auth-library
    // copy, so its `auth` field only accepts that copy's OAuth2Client (the two
    // declarations differ by a private field). This is the construction RESEARCH
    // documents for GSC. The gax GA4 path keeps the shared buildOAuth2Client.
    const auth = new google.auth.OAuth2(clientId, clientSecret, redirectUri);
    auth.setCredentials({ refresh_token: refreshToken });
    // googleapis takes the OAuth2Client via `auth` (NOT authClient — reverse of
    // the gax GA4 clients).
    const sc = google.webmasters({ version: "v3", auth });
    const res = await sc.sites.list();
    return { siteEntry: (res.data.siteEntry ?? []) as WmxSiteLike[] };
  };
}
