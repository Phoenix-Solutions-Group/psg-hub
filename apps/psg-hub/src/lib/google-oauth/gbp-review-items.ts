import "server-only";
import {
  gbpOAuthClientEnv,
  buildOAuth2Client,
  mapGoogleApiError,
} from "./client";
import { getLinkedAccount, type LinkedAccount } from "./accounts";

// Phase 14 / 14-01 — per-review legacy v4 reviews fetch (14-RESEARCH).
// Companion to gbp-reviews.ts (which fetches ONLY the lifetime aggregate at pageSize:1
// and stays decoupled — 14-RESEARCH #11). This module paginates the FULL per-review
// list (accounts.locations.reviews.list, pageSize:50, orderBy 'updateTime desc') and
// maps each Review into the review_items column shape.
//
// Same RAW-HTTP path as the aggregate seam: there is no typed v4 reviews client in
// googleapis@173, so this calls google-auth-library's OAuth2Client.request directly.
//
// DEFENSIVE (AC-2): a non-VoM / unverified / no-review location answers with a 200
// whose `reviews` array is absent — that yields an empty result (NO fabricated rows,
// NO breaker trip). A genuine non-2xx maps via mapGoogleApiError and rethrows; the
// orchestrator contains it per-shop and flips the account only on auth_failed.

const GBP_V4_HOST = "https://mybusiness.googleapis.com";

export type GbpReviewRow = {
  external_review_id: string;
  platform: "google";
  rating: number | null;
  text: string | null;
  author: string | null;
  reviewed_at: string | null; // v4 createTime (RFC3339, passed through)
  updated_at: string | null; // v4 updateTime
};

// v4 StarRating is a WORD enum, not an int (14-RESEARCH corrected the finder error).
// UNSPECIFIED / absent / any unknown string -> null rating (never 0).
const STAR_RATING: Record<string, number> = {
  ONE: 1,
  TWO: 2,
  THREE: 3,
  FOUR: 4,
  FIVE: 5,
};

type V4Review = {
  name?: string;
  starRating?: string;
  comment?: string;
  createTime?: string;
  updateTime?: string;
  reviewer?: { displayName?: string; isAnonymous?: boolean };
};

type V4ReviewsResponse = {
  reviews?: V4Review[];
  nextPageToken?: string;
  averageRating?: number;
  totalReviewCount?: number;
};

/** Test seam: the OAuth2Client.request shape (Gaxios — returns `.data`). */
export type GbpReviewsRequestFn = (opts: {
  url: string;
  method: "GET";
  params: Record<string, unknown>;
  timeout: number;
}) => Promise<{ data: V4ReviewsResponse }>;

export type FetchGbpReviewItemsDeps = {
  getLinkedAccount?: (
    shopId: string,
    source: "gbp"
  ) => Promise<LinkedAccount | null>;
  request?: GbpReviewsRequestFn;
};

function mapReview(r: V4Review): GbpReviewRow | null {
  // ponytail: a review with no resource name has no stable dedupe key, so it cannot
  // upsert onConflict(shop_id, external_review_id) — skip it rather than fabricate one.
  if (!r.name) return null;
  const rating = r.starRating ? (STAR_RATING[r.starRating] ?? null) : null;
  const author = r.reviewer?.isAnonymous
    ? null
    : (r.reviewer?.displayName ?? null);
  return {
    external_review_id: r.name,
    platform: "google",
    rating,
    text: r.comment ?? null,
    author,
    reviewed_at: r.createTime ?? null,
    updated_at: r.updateTime ?? null,
  };
}

/**
 * Fetch a linked shop's full per-review list, paginated to completion. Reads
 * getLinkedAccount(shop,'gbp') (deps seam); a null account OR a null externalParentId
 * yields [] (an old row predating 13-01 parent-capture cannot build the
 * accounts/{aid}/locations/{lid} parent). Otherwise loops GET v4 .../reviews?pageSize=50
 * &orderBy=updateTime desc, following nextPageToken, and maps every Review to the
 * review_items shape. A 200 with `reviews` absent returns [] (never throws); a thrown /
 * non-2xx response maps via mapGoogleApiError and rethrows.
 */
export async function fetchGbpReviews(
  shopId: string,
  deps: FetchGbpReviewItemsDeps = {}
): Promise<GbpReviewRow[]> {
  const read = deps.getLinkedAccount ?? getLinkedAccount;
  const account = await read(shopId, "gbp");
  if (!account || account.externalParentId === null) {
    return [];
  }

  // both halves already carry their prefixes (accounts/{aid} + locations/{lid}) ->
  // a PLAIN slash-join; NEVER re-wrap as accounts/${x}/locations/${y} (double-prefix).
  const parent = `${account.externalParentId}/${account.externalAccountId}`;

  let request = deps.request;
  if (!request) {
    const { clientId, clientSecret } = gbpOAuthClientEnv();
    const oauth2 = buildOAuth2Client({
      clientId,
      clientSecret,
      refreshToken: account.refreshToken,
    });
    request = (opts) => oauth2.request<V4ReviewsResponse>(opts);
  }

  const out: GbpReviewRow[] = [];
  let pageToken: string | undefined;
  try {
    do {
      const params: Record<string, unknown> = {
        pageSize: 50,
        orderBy: "updateTime desc",
      };
      if (pageToken) params.pageToken = pageToken;
      const res = await request({
        url: `${GBP_V4_HOST}/v4/${parent}/reviews`,
        method: "GET",
        params,
        timeout: 15000,
      });
      for (const r of res.data?.reviews ?? []) {
        const mapped = mapReview(r);
        if (mapped) out.push(mapped);
      }
      pageToken = res.data?.nextPageToken;
    } while (pageToken);
  } catch (err) {
    throw mapGoogleApiError(err);
  }
  return out;
}
