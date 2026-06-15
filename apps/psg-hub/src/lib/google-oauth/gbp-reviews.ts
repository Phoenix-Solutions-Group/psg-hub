import "server-only";
import {
  googleOAuthClientEnv,
  buildOAuth2Client,
  mapGoogleApiError,
} from "./client";
import { getLinkedAccount, type LinkedAccount } from "./accounts";

// Phase 13 / 13-03b — legacy v4 reviews STAR-RATING AGGREGATE (13-03-RESEARCH).
// `averageRating` + `totalReviewCount` are TOP-LEVEL response-root fields on
// accounts.locations.reviews.list — the LIFETIME aggregate for the location, returned
// on ONE cheap call (pageSize:1). NOT paginate-and-average; NOT the per-review
// StarRating enum.
//
// There is NO typed v4 reviews client in googleapis@173, so this is a RAW-HTTP call
// through google-auth-library's OAuth2Client.request (buildOAuth2Client — the real
// client with `.request`, NOT the vendored google.auth.OAuth2 the typed v1 clients use).
//
// DEFENSIVE: a non-VoM / unverified / no-review location may answer with a non-2xx
// OR a 200 with the aggregate absent. Both yield { null, null } (the orchestrator
// swallows a thrown error to the same), never a CircuitBreaker trip and never a
// fabricated 0 — the row is still written so the presence state persists.

const GBP_V4_HOST = "https://mybusiness.googleapis.com";

export type ReviewsAggregate = {
  average_rating: number | null;
  total_review_count: number | null;
};

type ReviewsAggregateResponse = {
  averageRating?: number;
  totalReviewCount?: number;
  reviews?: unknown[];
  nextPageToken?: string;
};

/** Test seam: the OAuth2Client.request shape (Gaxios — returns `.data`). */
export type GbpV4RequestFn = (opts: {
  url: string;
  method: "GET";
  params: Record<string, unknown>;
  timeout: number;
}) => Promise<{ data: ReviewsAggregateResponse }>;

export type FetchGbpReviewsDeps = {
  getLinkedAccount?: (
    shopId: string,
    source: "gbp"
  ) => Promise<LinkedAccount | null>;
  request?: GbpV4RequestFn;
};

/**
 * Fetch a linked shop's lifetime review aggregate. Reads getLinkedAccount(shop,'gbp')
 * (deps seam); a null account OR a null externalParentId yields { null, null } (an old
 * row predating 13-01 parent-capture cannot build the accounts/{aid}/locations/{lid}
 * parent). Otherwise issues ONE GET to v4 .../reviews?pageSize=1 and renames the
 * camelCase aggregate to snake_case (?? null for BOTH — never ?? 0). A thrown / non-2xx
 * response maps via mapGoogleApiError and rethrows; the orchestrator swallows it.
 */
export async function fetchGbpReviewsAggregate(
  shopId: string,
  deps: FetchGbpReviewsDeps = {}
): Promise<ReviewsAggregate> {
  const read = deps.getLinkedAccount ?? getLinkedAccount;
  const account = await read(shopId, "gbp");
  if (!account || account.externalParentId === null) {
    return { average_rating: null, total_review_count: null };
  }

  // both halves already carry their prefixes (accounts/{aid} + locations/{lid}) ->
  // a PLAIN slash-join; NEVER re-wrap as accounts/${x}/locations/${y} (double-prefix).
  const parent = `${account.externalParentId}/${account.externalAccountId}`;

  let request = deps.request;
  if (!request) {
    const { clientId, clientSecret } = googleOAuthClientEnv();
    const oauth2 = buildOAuth2Client({
      clientId,
      clientSecret,
      refreshToken: account.refreshToken,
    });
    request = (opts) => oauth2.request<ReviewsAggregateResponse>(opts);
  }

  try {
    const res = await request({
      url: `${GBP_V4_HOST}/v4/${parent}/reviews`,
      method: "GET",
      params: { pageSize: 1 },
      timeout: 15000,
    });
    return {
      average_rating: res.data?.averageRating ?? null,
      total_review_count: res.data?.totalReviewCount ?? null,
    };
  } catch (err) {
    throw mapGoogleApiError(err);
  }
}
