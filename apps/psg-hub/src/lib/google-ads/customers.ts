import "server-only";
import { GoogleAdsApi } from "google-ads-api";
import { mapGoogleAdsError } from "./client";
import { getGoogleAdsOAuthCredentials } from "./credentials";
import { AdsApiError } from "./types";

/** A selectable (non-manager) Google Ads client account under the MCC. */
export type ManagedAccount = { id: string; name: string };

/** Test seam: a function that runs a GAQL query and returns raw rows. */
export type AdsQueryFn = (gaql: string) => Promise<unknown[]>;

// 10-04 research finding: `listAccessibleCustomers` returns only the accounts a
// user can reach DIRECTLY (for an MCC login, the manager itself), NOT the child
// hierarchy. Enumerate the linkable client accounts via `customer_client` run
// against the manager (login-customer-id = MCC). Manager rows (incl. the MCC)
// are filtered out.
const MANAGED_QUERY =
  "SELECT customer_client.id, customer_client.descriptive_name, " +
  "customer_client.manager, customer_client.level, customer_client.status " +
  "FROM customer_client WHERE customer_client.status = 'ENABLED'";

type CustomerClientRow = {
  customer_client?: {
    id?: string | number;
    descriptive_name?: string;
    manager?: boolean;
    level?: string | number;
    status?: string;
  };
};

/**
 * List the non-manager client accounts reachable under `mccId`, using the fresh
 * `refreshToken` from the just-completed OAuth consent. Returns bare-10-digit
 * ids with a display name. Throws an `AdsApiError` (mapped) on API failure.
 */
export async function listManagedAccounts(
  refreshToken: string,
  mccId: string,
  deps?: { query?: AdsQueryFn }
): Promise<ManagedAccount[]> {
  let rows: unknown[];
  try {
    const query = deps?.query ?? buildMccQuery(refreshToken, mccId);
    rows = await query(MANAGED_QUERY);
  } catch (err) {
    throw mapGoogleAdsError(err);
  }

  const seen = new Set<string>();
  const accounts: ManagedAccount[] = [];
  for (const r of rows as CustomerClientRow[]) {
    const cc = r?.customer_client;
    if (!cc || cc.manager) continue; // skip manager rows, including the MCC itself
    const id = String(cc.id ?? "");
    if (!/^\d{10}$/.test(id)) continue; // bare 10-digit only (lib sends ids verbatim)
    if (seen.has(id)) continue;
    seen.add(id);
    accounts.push({ id, name: cc.descriptive_name?.trim() || id });
  }
  return accounts;
}

function buildMccQuery(refreshToken: string, mccId: string): AdsQueryFn {
  const developerToken = process.env.GOOGLE_ADS_DEVELOPER_TOKEN;
  if (!developerToken) {
    throw new AdsApiError("upstream", "Server missing Google Ads credentials");
  }
  let clientId: string;
  let clientSecret: string;
  try {
    ({ clientId, clientSecret } = getGoogleAdsOAuthCredentials());
  } catch {
    throw new AdsApiError("upstream", "Server missing Google Ads credentials");
  }
  if (!/^\d{10}$/.test(mccId)) {
    throw new AdsApiError(
      "bad_request",
      "GOOGLE_ADS_LOGIN_CUSTOMER_ID must be a bare 10-digit id"
    );
  }
  const api = new GoogleAdsApi({
    client_id: clientId,
    client_secret: clientSecret,
    developer_token: developerToken,
  });
  const customer = api.Customer({
    customer_id: mccId,
    login_customer_id: mccId,
    refresh_token: refreshToken,
  });
  return (gaql: string) => customer.query(gaql) as Promise<unknown[]>;
}
