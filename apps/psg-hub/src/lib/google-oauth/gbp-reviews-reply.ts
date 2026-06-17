import "server-only";
import {
  googleOAuthClientEnv,
  buildOAuth2Client,
  mapGoogleApiError,
  GoogleApiError,
} from "./client";
import { getLinkedAccount, type LinkedAccount } from "./accounts";

// Phase 14 / 14-02 — legacy v4 reply WRITE adapter (14-RESEARCH §updateReply WRITE contract).
// Companion to the read adapters (gbp-reviews.ts aggregate, gbp-review-items.ts per-review).
// Same RAW-HTTP path: no typed v4 reviews client in googleapis@173, so this PUTs/DELETEs through
// google-auth-library's OAuth2Client.request (Gaxios).
//
// The review resource name (external_review_id from 14-01) is ALREADY the full
// accounts/{aid}/locations/{lid}/reviews/{rid} path, so the reply URL is reviewName + '/reply' —
// do NOT re-prefix with the account parent (that would double-prefix). The shop's gbp account is
// read only for its refresh token (the URL is self-contained).
//
// Policy/activation note: nothing in 14-02 calls these on a deploy-live, user-reachable path —
// the only invokers are unit tests (injected deps) and the UNSCHEDULED publish cron. Live publish
// is gated behind the consent/authorization decision (14-RESEARCH §Policy).

const GBP_V4_HOST = "https://mybusiness.googleapis.com";
// updateReply comment max is 4096 BYTES (not chars) — enforce with Buffer.byteLength, never
// string .length (multibyte chars consume >1 byte). Fail fast PSG-side, do not round-trip a 400.
const MAX_REPLY_BYTES = 4096;

/** Test seam: the OAuth2Client.request shape for the reply WRITE (PUT/DELETE + optional body). */
export type GbpReplyRequestFn = (opts: {
  url: string;
  method: "PUT" | "DELETE";
  data?: Record<string, unknown>;
  timeout: number;
}) => Promise<{ data: { reviewReplyState?: string; comment?: string } }>;

export type GbpReplyDeps = {
  getLinkedAccount?: (
    shopId: string,
    source: "gbp"
  ) => Promise<LinkedAccount | null>;
  request?: GbpReplyRequestFn;
};

/** Resolve a request fn for the shop: deps.request (tests) or one bound to the live token. */
async function resolveRequest(
  shopId: string,
  deps: GbpReplyDeps
): Promise<GbpReplyRequestFn> {
  if (deps.request) return deps.request;
  const read = deps.getLinkedAccount ?? getLinkedAccount;
  const account = await read(shopId, "gbp");
  if (!account) {
    throw new GoogleApiError("bad_request", "no linked gbp account");
  }
  const { clientId, clientSecret } = googleOAuthClientEnv();
  const oauth2 = buildOAuth2Client({
    clientId,
    clientSecret,
    refreshToken: account.refreshToken,
  });
  return (opts) =>
    oauth2.request<{ reviewReplyState?: string; comment?: string }>(opts);
}

/**
 * PUT v4 .../reviews/{rid}/reply { comment } — create-or-update (upsert) the owner reply.
 * The 4096-BYTE limit is enforced PSG-side BEFORE any request (fail fast). Only `comment` is
 * sent (the other ReviewReply fields are output-only; sending them risks a READ_ONLY reject).
 * Returns the output-only reviewReplyState (a PENDING value means pending moderation, NOT
 * published — the caller must reflect it, never report a bare 200 as "published"). A thrown /
 * non-2xx maps via mapGoogleApiError and rethrows (the orchestrator contains it per-row).
 */
export async function publishReply(
  shopId: string,
  reviewName: string,
  comment: string,
  deps: GbpReplyDeps = {}
): Promise<{ reviewReplyState: string | null }> {
  if (Buffer.byteLength(comment, "utf8") > MAX_REPLY_BYTES) {
    // PSG-side reject — never round-trip a guaranteed 400.
    throw new GoogleApiError(
      "bad_request",
      `reply exceeds ${MAX_REPLY_BYTES} bytes`
    );
  }
  const request = await resolveRequest(shopId, deps);
  try {
    const res = await request({
      url: `${GBP_V4_HOST}/v4/${reviewName}/reply`,
      method: "PUT",
      data: { comment },
      timeout: 15000,
    });
    return { reviewReplyState: res.data?.reviewReplyState ?? null };
  } catch (err) {
    throw mapGoogleApiError(err);
  }
}

/**
 * DELETE v4 .../reviews/{rid}/reply — the rollback path for a posted reply (empty body, also
 * gated on a verified location). Built for the consent-gated activation; unused build-local.
 */
// ponytail: symmetric rollback the consent-gated activation needs; not wired in 14-02.
export async function deleteReply(
  shopId: string,
  reviewName: string,
  deps: GbpReplyDeps = {}
): Promise<void> {
  const request = await resolveRequest(shopId, deps);
  try {
    await request({
      url: `${GBP_V4_HOST}/v4/${reviewName}/reply`,
      method: "DELETE",
      timeout: 15000,
    });
  } catch (err) {
    throw mapGoogleApiError(err);
  }
}
