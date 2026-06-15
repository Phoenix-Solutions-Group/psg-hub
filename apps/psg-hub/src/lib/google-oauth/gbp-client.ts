import "server-only";
import { google, type businessprofileperformance_v1 } from "googleapis";
import { googleOAuthClientEnv, GoogleApiError } from "./client";
import { getLinkedAccount, type LinkedAccount } from "./accounts";

// Phase 13 / 13-02b — Business Profile Performance API client built from a shop's
// linked gbp account. Mirrors the 13-01 gbp-enumerate construction (and gsc-client,
// NOT the gax ga4-client): googleapis vendors its OWN google-auth-library copy, so
// the client takes the OAuth2Client via the `auth` field (NOT the gax `authClient`).
// buildOAuth2Client is the gax (GA4) path; do NOT use it here. ZERO prod contact this
// plan: the metrics path injects deps; this builder only runs at the 13-04 gate batch.

export type GbpPerfClient = Pick<
  businessprofileperformance_v1.Businessprofileperformance["locations"],
  "fetchMultiDailyMetricsTimeSeries"
>;

export type GbpPerfClientHandle = {
  client: GbpPerfClient;
  locationName: string; // bare 'locations/{id}' (external_account_id)
  accountId: string;
};

export type GetGbpPerfClientDeps = {
  /** Test seam — default real getLinkedAccount. */
  getLinkedAccount?: typeof getLinkedAccount;
};

/**
 * Build a Business Profile Performance client for the shop's linked GBP location.
 * Throws GoogleApiError('auth_failed') when no gbp account is linked.
 */
export async function getGbpPerfClient(
  shopId: string,
  deps: GetGbpPerfClientDeps = {}
): Promise<GbpPerfClientHandle> {
  const read = deps.getLinkedAccount ?? getLinkedAccount;
  const account: LinkedAccount | null = await read(shopId, "gbp");
  if (!account) {
    throw new GoogleApiError("auth_failed", "No linked Google Business Profile");
  }

  const { clientId, clientSecret, redirectUri } = googleOAuthClientEnv();
  // googleapis' OWN OAuth2 (google.auth.OAuth2) — its `auth` field only accepts that
  // vendored copy's OAuth2Client. The construction RESEARCH documents for GBP (the
  // documented Phase-11 trap: NOT the gax `authClient:`). Mirror gbp-enumerate.ts.
  const auth = new google.auth.OAuth2(clientId, clientSecret, redirectUri);
  auth.setCredentials({ refresh_token: account.refreshToken });
  const perf = google.businessprofileperformance({ version: "v1", auth });

  return {
    client: perf.locations,
    locationName: account.externalAccountId, // bare 'locations/{id}'
    accountId: account.accountId,
  };
}
