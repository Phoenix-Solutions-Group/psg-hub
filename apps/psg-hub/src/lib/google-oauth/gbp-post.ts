import "server-only";
import { z } from "zod";
import {
  gbpOAuthClientEnv,
  buildOAuth2Client,
  mapGoogleApiError,
  GoogleApiError,
} from "./client";
import { getLinkedAccount, type LinkedAccount } from "./accounts";

// PSG-247 / Wave 2 (G-b) — Google Business Profile local-post WRITE adapter.
//
// Same legacy-v4 RAW-HTTP path as the review-reply write (gbp-reviews-reply.ts):
// googleapis ships no typed v4 `localPosts` client, so this POSTs/DELETEs through
// google-auth-library's OAuth2Client.request (Gaxios). The shop's `business.manage`
// consent (already granted by the Phase-13 GBP link) is the single scope that
// spans Account Management, Business Information, Performance, Reviews AND local
// posts — so NO new scope/consent is required to post; the existing linked token
// works. The post is PUBLISHED only via the PSG-245 approval gate's publisher
// (gbp-post-publisher.ts), never autonomously.
//
// Resource path: a local post lives under the FULL account+location path,
// `accounts/{aid}/locations/{lid}/localPosts`. external_account_id is the BARE
// `locations/{lid}`; external_parent_id is `accounts/{aid}` (persisted at link
// time, 13-01). We rebuild `${parent}/${location}/localPosts` and guard a
// null parent (a legacy link without it cannot post — fail fast PSG-side).

const GBP_V4_HOST = "https://mybusiness.googleapis.com";

// LocalPost.summary max is 1500 CHARACTERS (the v4 contract). Enforce PSG-side so a
// guaranteed 400 never round-trips. (Reviews used a 4096-BYTE cap; posts are chars.)
export const MAX_SUMMARY_CHARS = 1500;

// CallToAction.actionType enum (v4). CALL has no URL (it dials the listing's
// phone); every other type REQUIRES an http(s) url. ACTION_TYPE_UNSPECIFIED is
// rejected. Keep the set explicit so a bad draft is caught before the API.
export const GBP_CTA_ACTION_TYPES = [
  "BOOK",
  "ORDER",
  "SHOP",
  "LEARN_MORE",
  "SIGN_UP",
  "CALL",
] as const;
export type GbpCtaActionType = (typeof GBP_CTA_ACTION_TYPES)[number];

/** Validated draft of a STANDARD ("what's new") GBP local post. Media is deferred
 *  (a v4 media upload is a separate multi-step flow); a text+CTA post is the
 *  highest-leverage local-SEO surface and what the gbp-post agent drafts. */
export const localPostInputSchema = z
  .object({
    summary: z.string().trim().min(1).max(MAX_SUMMARY_CHARS),
    languageCode: z.string().trim().min(2).max(10).default("en-US"),
    callToAction: z
      .object({
        actionType: z.enum(GBP_CTA_ACTION_TYPES),
        // URL is validated against actionType in superRefine below.
        url: z.string().trim().url().max(2000).optional(),
      })
      .optional(),
  })
  .superRefine((val, ctx) => {
    if (val.callToAction) {
      const { actionType, url } = val.callToAction;
      if (actionType !== "CALL" && !url) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["callToAction", "url"],
          message: `callToAction.url is required for actionType ${actionType}`,
        });
      }
      if (actionType === "CALL" && url) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["callToAction", "url"],
          message: "callToAction.url must be omitted for actionType CALL",
        });
      }
    }
  });

// The INPUT type (what a caller passes): languageCode is optional — the schema
// defaults it. The parsed OUTPUT type (languageCode resolved) is what
// buildLocalPostBody consumes after validation.
export type LocalPostInput = z.input<typeof localPostInputSchema>;
export type LocalPostParsed = z.infer<typeof localPostInputSchema>;

/** The v4 LocalPost create result fields we surface. `state` is OUTPUT-ONLY:
 *  LIVE (published), PROCESSING (accepted, not yet live), REJECTED (policy fail).
 *  The caller MUST reflect a non-LIVE state — never report a bare 200 as live. */
export type LocalPostResult = {
  name: string | null; // accounts/{aid}/locations/{lid}/localPosts/{id}
  state: string | null; // LIVE | PROCESSING | REJECTED | null
  searchUrl: string | null;
};

/** Build the v4 LocalPost request body from a validated draft. STANDARD topic
 *  (a "what's new" update); EVENT/OFFER carry extra required fields, out of scope. */
export function buildLocalPostBody(input: LocalPostParsed): Record<string, unknown> {
  const body: Record<string, unknown> = {
    languageCode: input.languageCode,
    summary: input.summary,
    topicType: "STANDARD",
  };
  if (input.callToAction) {
    const cta: Record<string, unknown> = {
      actionType: input.callToAction.actionType,
    };
    if (input.callToAction.url) cta.url = input.callToAction.url;
    body.callToAction = cta;
  }
  return body;
}

/** Test seam: the OAuth2Client.request shape for the local-post write (POST/DELETE). */
export type GbpPostRequestFn = (opts: {
  url: string;
  method: "POST" | "DELETE";
  data?: Record<string, unknown>;
  timeout: number;
}) => Promise<{
  data: { name?: string; state?: string; searchUrl?: string };
}>;

export type GbpPostDeps = {
  getLinkedAccount?: (
    shopId: string,
    source: "gbp"
  ) => Promise<LinkedAccount | null>;
  request?: GbpPostRequestFn;
  /** Override the resolved `accounts/{aid}/locations/{lid}` path (tests). */
  resourcePath?: string;
};

/** Resolve a request fn + the location resource path for the shop. deps.request
 *  (tests) short-circuits the live token; otherwise build an OAuth2Client from the
 *  decrypted refresh token and derive the full account/location path. */
async function resolve(
  shopId: string,
  deps: GbpPostDeps
): Promise<{ request: GbpPostRequestFn; resourcePath: string }> {
  if (deps.request && deps.resourcePath) {
    return { request: deps.request, resourcePath: deps.resourcePath };
  }
  const read = deps.getLinkedAccount ?? getLinkedAccount;
  const account = await read(shopId, "gbp");
  if (!account) {
    throw new GoogleApiError("bad_request", "no linked gbp account");
  }
  // localPosts requires the FULL account+location path. external_parent_id holds
  // `accounts/{aid}`; a legacy link without it cannot post (fail fast, no API call).
  if (!account.externalParentId) {
    throw new GoogleApiError(
      "bad_request",
      "linked gbp account is missing its parent account id; re-link to post"
    );
  }
  const resourcePath =
    deps.resourcePath ??
    `${account.externalParentId}/${account.externalAccountId}`;

  if (deps.request) return { request: deps.request, resourcePath };

  const { clientId, clientSecret } = gbpOAuthClientEnv();
  const oauth2 = buildOAuth2Client({
    clientId,
    clientSecret,
    refreshToken: account.refreshToken,
  });
  const request: GbpPostRequestFn = (opts) =>
    oauth2.request<{ name?: string; state?: string; searchUrl?: string }>(opts);
  return { request, resourcePath };
}

/**
 * POST v4 .../localPosts { summary, topicType, callToAction? } — create a local
 * post on the shop's linked GBP location. The 1500-char summary limit + the
 * CTA-url/actionType coupling are validated PSG-side (localPostInputSchema) BEFORE
 * any request; this is a defensive re-check so a direct caller can't bypass it.
 * Returns the output-only `state` (PROCESSING/REJECTED is reflected, never coerced
 * to live). A thrown / non-2xx maps via mapGoogleApiError and rethrows so the
 * approval gate's publisher records it as a publish failure.
 */
export async function createLocalPost(
  shopId: string,
  input: LocalPostInput,
  deps: GbpPostDeps = {}
): Promise<LocalPostResult> {
  // Defensive re-validation (the route already validated; a direct/agent caller
  // might not). Throws a bad_request rather than round-tripping a guaranteed 400.
  const parsed = localPostInputSchema.safeParse(input);
  if (!parsed.success) {
    throw new GoogleApiError(
      "bad_request",
      `invalid local post: ${parsed.error.issues.map((i) => i.message).join("; ")}`
    );
  }

  const { request, resourcePath } = await resolve(shopId, deps);
  try {
    const res = await request({
      url: `${GBP_V4_HOST}/v4/${resourcePath}/localPosts`,
      method: "POST",
      data: buildLocalPostBody(parsed.data),
      timeout: 15000,
    });
    return {
      name: res.data?.name ?? null,
      state: res.data?.state ?? null,
      searchUrl: res.data?.searchUrl ?? null,
    };
  } catch (err) {
    throw mapGoogleApiError(err);
  }
}

/**
 * DELETE v4 .../localPosts/{id} — take down a posted local post (the rollback path
 * a rejected/expired post needs). `postName` is the full resource name returned by
 * createLocalPost. Built for the approval-gated activation; not auto-wired.
 */
// ponytail: symmetric takedown the gated activation needs; not invoked build-local.
export async function deleteLocalPost(
  shopId: string,
  postName: string,
  deps: GbpPostDeps = {}
): Promise<void> {
  // For a delete the URL is self-contained in postName; still resolve to bind the
  // live request fn (resourcePath is unused but resolve needs the linked account).
  const { request } = await resolve(shopId, {
    ...deps,
    resourcePath: deps.resourcePath ?? "accounts/_/locations/_",
  });
  try {
    await request({
      url: `${GBP_V4_HOST}/v4/${postName}`,
      method: "DELETE",
      timeout: 15000,
    });
  } catch (err) {
    throw mapGoogleApiError(err);
  }
}
