import "server-only";
import { BetaAnalyticsDataClient } from "@google-analytics/data";
import {
  buildOAuth2Client,
  googleOAuthClientEnv,
  GoogleApiError,
} from "./client";
import { getLinkedAccount, type LinkedAccount } from "./accounts";

// Phase 11 / 11-02 — GA4 Data API client built from a shop's linked ga4 account.
// Mirrors the 11-01 ga4-enumerate construction: the gax client takes the
// OAuth2Client via `authClient` (NOT googleapis `auth`). The injection is the
// one UNVERIFIED-at-runtime line (RESEARCH #1, compile-confirmed in 11-01) — a
// live-smoke mismatch is a one-line fix here. ZERO prod contact this plan: the
// metrics path injects deps; this builder only runs at the live gate batch.

export type Ga4DataClient = {
  /** runReport(request) -> [response, ...] (gax tuple). */
  runReport: BetaAnalyticsDataClient["runReport"];
};

export type Ga4ClientHandle = {
  client: Ga4DataClient;
  property: string; // 'properties/<numeric>'
  accountId: string;
};

export type GetGa4DataClientDeps = {
  /** Test seam — default real getLinkedAccount. */
  getLinkedAccount?: typeof getLinkedAccount;
};

/**
 * Build a BetaAnalyticsDataClient for the shop's linked GA4 property. Throws
 * GoogleApiError('auth_failed') when no ga4 account is linked.
 */
export async function getGa4DataClient(
  shopId: string,
  deps: GetGa4DataClientDeps = {}
): Promise<Ga4ClientHandle> {
  const read = deps.getLinkedAccount ?? getLinkedAccount;
  const account: LinkedAccount | null = await read(shopId, "ga4");
  if (!account) {
    throw new GoogleApiError("auth_failed", "No linked GA4 property");
  }

  const { clientId, clientSecret, redirectUri } = googleOAuthClientEnv();
  const authClient = buildOAuth2Client({
    clientId,
    clientSecret,
    redirectUri,
    refreshToken: account.refreshToken,
  });

  // gax clients take the OAuth2Client as `authClient` (NOT `auth`). Passing
  // `auth:` would fail at request time. Isolated to this one line.
  const client = new BetaAnalyticsDataClient({ authClient });

  return {
    client,
    property: account.externalAccountId,
    accountId: account.accountId,
  };
}
