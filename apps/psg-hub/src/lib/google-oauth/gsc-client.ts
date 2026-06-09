import "server-only";
import { google, type searchconsole_v1 } from "googleapis";
import { googleOAuthClientEnv, GoogleApiError } from "./client";
import { getLinkedAccount, type LinkedAccount } from "./accounts";

// Phase 11 / 11-03 — GSC Search Console client built from a shop's linked gsc
// account. Mirrors the 11-01 gsc-enumerate construction (NOT the gax ga4-client):
// googleapis vendors its OWN google-auth-library copy, so the client takes the
// OAuth2Client via the `auth` field (NOT the gax `authClient`). buildOAuth2Client
// is the gax (GA4) path; do NOT use it here. ZERO prod contact this plan: the
// metrics path injects deps; this builder only runs at the live gate batch.

export type GscClient = Pick<
  searchconsole_v1.Searchconsole["searchanalytics"],
  "query"
>;

export type GscClientHandle = {
  client: GscClient;
  siteUrl: string; // 'sc-domain:<host>' | 'https://.../'
  accountId: string;
};

export type GetGscClientDeps = {
  /** Test seam — default real getLinkedAccount. */
  getLinkedAccount?: typeof getLinkedAccount;
};

/**
 * Build a Search Console client for the shop's linked GSC site. Throws
 * GoogleApiError('auth_failed') when no gsc account is linked.
 */
export async function getGscClient(
  shopId: string,
  deps: GetGscClientDeps = {}
): Promise<GscClientHandle> {
  const read = deps.getLinkedAccount ?? getLinkedAccount;
  const account: LinkedAccount | null = await read(shopId, "gsc");
  if (!account) {
    throw new GoogleApiError("auth_failed", "No linked GSC site");
  }

  const { clientId, clientSecret, redirectUri } = googleOAuthClientEnv();
  // googleapis' OWN OAuth2 (google.auth.OAuth2) — its `auth` field only accepts
  // that vendored copy's OAuth2Client (the shared buildOAuth2Client client is a
  // nominally-different type). This is the construction RESEARCH documents for GSC.
  const auth = new google.auth.OAuth2(clientId, clientSecret, redirectUri);
  auth.setCredentials({ refresh_token: account.refreshToken });
  const sc = google.searchconsole({ version: "v1", auth });

  return {
    client: sc.searchanalytics,
    siteUrl: account.externalAccountId,
    accountId: account.accountId,
  };
}
