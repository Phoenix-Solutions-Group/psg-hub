import "server-only";
import { AnalyticsAdminServiceClient } from "@google-analytics/admin";
import {
  buildOAuth2Client,
  googleOAuthClientEnv,
  mapGoogleApiError,
} from "./client";

// Phase 11 / 11-01 — GA4 property enumeration for the picker.
// Uses the Admin API accountSummaries.list (NOT listAccounts — that returns flat
// accounts with no property summaries and cannot build the picker). Returns one
// entry per GA4 property: { id: 'properties/<numeric>', name: displayName,
// account: accountDisplayName }. Scope analytics.readonly is sufficient. The Admin
// API must be separately enabled in the Cloud project (a 403 SERVICE_DISABLED
// surfaces otherwise — handled at the live gate batch).

export type Ga4Property = { id: string; name: string; account: string };

/** Minimal shape of an Admin API AccountSummary (the fields the picker needs). */
export type AccountSummaryLike = {
  displayName?: string | null;
  propertySummaries?: Array<{
    property?: string | null;
    displayName?: string | null;
  }> | null;
};

/** Test seam: returns the (already-paginated) async stream of account summaries. */
export type Ga4SummariesFn = () => AsyncIterable<AccountSummaryLike>;

/**
 * List the GA4 properties reachable under the fresh `refreshToken`, flattened
 * across account summaries. The async iterator transparently spans pages. Throws
 * a mapped GoogleApiError on upstream failure. `deps.summaries` injects a stream
 * for tests (mirrors customers.ts's `deps.query` seam).
 */
export async function listGa4Properties(
  refreshToken: string,
  deps?: { summaries?: Ga4SummariesFn }
): Promise<Ga4Property[]> {
  let iterable: AsyncIterable<AccountSummaryLike>;
  try {
    iterable = (deps?.summaries ?? defaultSummaries(refreshToken))();
  } catch (err) {
    throw mapGoogleApiError(err);
  }

  const out: Ga4Property[] = [];
  const seen = new Set<string>();
  try {
    for await (const summary of iterable) {
      const account = summary?.displayName?.trim() || "";
      for (const p of summary?.propertySummaries ?? []) {
        const id = (p?.property ?? "").trim(); // 'properties/<numeric>'
        // GA4 ids are 'properties/...', NOT the Ads /^\d{10}$/ form — do not copy
        // that check.
        if (!id.startsWith("properties/")) continue;
        if (seen.has(id)) continue;
        seen.add(id);
        out.push({ id, name: p?.displayName?.trim() || id, account });
      }
    }
  } catch (err) {
    throw mapGoogleApiError(err);
  }
  return out;
}

function defaultSummaries(refreshToken: string): Ga4SummariesFn {
  return () => {
    const { clientId, clientSecret, redirectUri } = googleOAuthClientEnv();
    const auth = buildOAuth2Client({
      clientId,
      clientSecret,
      redirectUri,
      refreshToken,
    });
    // UNVERIFIED (RESEARCH #1): gax clients take the OAuth2Client via `authClient`
    // (NOT `auth` — that is googleapis). Isolated to this one line; a live-smoke
    // mismatch is a one-line fix. Passing `auth:` here would fail at request time.
    const client = new AnalyticsAdminServiceClient({ authClient: auth });
    return client.listAccountSummariesAsync({
      pageSize: 200,
    }) as AsyncIterable<AccountSummaryLike>;
  };
}
