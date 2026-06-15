<!-- Phase 13-03 focused research addendum. Produced 2026-06-14 by ultracode Workflow wf_0906aaba-c3b (10 agents: 6 finders + 3 adversarial verify + 1 synthesize; ~691k tokens, 93 tool uses). Scope: the v4 reviews star-rating AGGREGATE contract for the monthly presence + rating plan. Extends 13-RESEARCH.md §Reviews (Phase-14 scout). Agents re-fetched the official Google v4 REST/RPC references + read live repo files. -->

# Phase 13-03: Reviews star-rating aggregate, focused research addendum

## Executive summary

- Read the location's rating from `averageRating` (a JSON `number`, RPC `double`) on the `accounts.locations.reviews.list` response root, in ONE cheap call with `pageSize: 1`. Do NOT parse the per-review `StarRating` enum, and do NOT paginate-and-average. `averageRating` plus `totalReviewCount` are location-wide, lifetime aggregates returned on the first page independent of which reviews populate `reviews[]`.
- One blocking seam fix, read-side only: `getLinkedAccount` does not select or return `external_parent_id`, so the `accounts/{aid}` half of the parent is unavailable at call time. The WRITE side is already correct: the GBP `select/route.ts` callback passes `externalParentId: pick.parent` into `persistLinkedAccount`, which persists `external_parent_id`. The fix is to widen the reader, not the writer.
- This is a STOCK monthly aggregate. It stays SnapshotSource-only on the existing `gbp_presence` row's `metrics` jsonb. Add exactly two snake_case keys, `average_rating: number | null` and `total_review_count: number | null`. Do NOT add it to the `AnalyticsSource` union (that would fabricate a fake daily rollup on STOCK data).
- Two verifications are NOT confirmable from docs and must resolve at the 13-04 live-smoke gate: (a) `pageSize: 1` actually returns the aggregate (documented-semantics inference, not tested), and (b) the response shape for a non-verified / non-VoM location (the doc says the op is "only valid if verified," which reads as an error gate, not a 200-with-empty). Build defensively for both; the empty-equals-zero pattern is confirmed only for the Performance API, a different API.

## v4 Review schema + StarRating enum

This section documents the per-review schema for completeness and Phase-14 relevance. Phase 13-03 does NOT read or parse any of it. The aggregate path (next section) uses the response-level `averageRating` number, never this enum. Source: developers.google.com/my-business/reference/rest/v4/accounts.locations.reviews#Review.

`Review` resource fields (confidence: high):

| Field | Type | Notes |
|---|---|---|
| `name` | string | `accounts/{aid}/locations/{lid}/reviews/{reviewId}` |
| `reviewId` | string | encrypted unique id; format migrated in v4.8 (Phase-14 concern only) |
| `reviewer` | Reviewer object | `displayName`, `profilePhotoUrl` populated only when `isAnonymous` is false |
| `starRating` | StarRating enum | PER-REVIEW rating, a word enum, NOT a location rating |
| `comment` | string | review body (Content; not stored in 13-03 or anywhere here) |
| `createTime` | Timestamp (RFC 3339 string) | parse as ISO datetime, not epoch |
| `updateTime` | Timestamp (RFC 3339 string) | |
| `reviewReply` | ReviewReply object | `comment` (max 4096 bytes), `updateTime`; null when no owner reply (confidence: medium) |
| `reviewMediaItems[]` | ReviewMediaItem array | |

`StarRating` enum: six values, word strings on the wire (confidence: high on the value set; see flag below):

| Enum value | Numeric mapping |
|---|---|
| `STAR_RATING_UNSPECIFIED` | 0 / null (treat as no rating) |
| `ONE` | 1 |
| `TWO` | 2 |
| `THREE` | 3 |
| `FOUR` | 4 |
| `FIVE` | 5 |

There is no integer ordinal field on `Review`; if a consumer ever aggregates per-review ratings it must map words to numbers itself. Confidence flag: 13-RESEARCH line 161 records that the enum is not inlined in the reachable docs, so the exact value set is "strongly expected" rather than tested against a live response. For 13-03 this is non-load-bearing because 13-03 never touches `starRating`. It becomes load-bearing only if Phase 14 maps per-review ratings, at which point the enum values should be confirmed at the 13-04 live smoke.

## Aggregate read contract

`averageRating` and `totalReviewCount` ARE top-level response fields. This is ONE cheap call, not paginate-and-average. Two independent Google references agree on field names and types, and the adversarial pass confirmed it against a fresh fetch (confidence: high).

Response body root (`ListReviewsResponse`):

| JSON field | Type (REST / RPC) | Meaning |
|---|---|---|
| `reviews[]` | array of Review | per-page slice (ignored by 13-03) |
| `averageRating` | number / `double` | average star rating of ALL reviews for this location, scale 1 to 5 |
| `totalReviewCount` | integer / `int32` | total number of reviews for this location |
| `nextPageToken` | string | present only when more pages exist (ignored) |

`averageRating` is the LIFETIME mean over every review for the location. It is NOT a trailing-30-day or current-month window. It is correct for "capture the lifetime average once per month to build a trend line." It will NOT give "average of reviews left this month," which is impossible in one call (would require paginating all reviews and filtering by `createTime`). Build the lifetime-trend version.

Exact request:

- Base URL (host): `https://mybusiness.googleapis.com` (the LEGACY v4 host, not the v1 enumeration hosts `mybusinessaccountmanagement` / `mybusinessbusinessinformation`).
- Method / path: `GET https://mybusiness.googleapis.com/v4/{parent=accounts/*/locations/*}/reviews`
- `parent` = `accounts/{aid}/locations/{lid}` (both halves required).
- Query params: `pageSize: 1` (minimize payload). `orderBy` is irrelevant for an aggregate read and should be omitted. `pageToken` not used.
- Scope: `https://www.googleapis.com/auth/business.manage`.

`pageSize: 1` returning the aggregate is documented-semantics inference (the aggregate is structurally a response-root field, not page-scoped), not empirically tested. Do not use `pageSize: 0` (Google AIP convention: 0 means server default, roughly 20, not "return zero"). Confirm `pageSize: 1` yields `averageRating` + `totalReviewCount` with `reviews[]` length 1 at the 13-04 live smoke.

## Raw-HTTP auth seam

There is no typed v4 reviews client in `googleapis@173`. Use a raw HTTP call through `google-auth-library`'s `OAuth2Client.request`. Use `buildOAuth2Client` from `client.ts` (a real `google-auth-library` `OAuth2Client`, which exposes `.request`), NOT the vendored `google.auth.OAuth2` that `gbp-enumerate.ts` uses for the typed v1 clients. The two are not interchangeable for the raw-request idiom.

Token + ids: reuse `getLinkedAccount(shop, 'gbp')` for the decrypted refresh token and `external_account_id` (bare `locations/{lid}`), plus `external_parent_id` (`accounts/{aid}`) for the account half of the parent.

BLOCKING SEAM GAP (read-side only). `getLinkedAccount` selects `id, external_account_id, encrypted_refresh_token, key_version` (accounts.ts:79) and returns `{accountId, externalAccountId, refreshToken}` (accounts.ts:110-114). `external_parent_id` is WRITTEN but never read back, so the `accounts/{aid}` half is unavailable at call time. The write side is already done: `persistLinkedAccount` persists `external_parent_id` (accounts.ts:38), and the GBP `select/route.ts` callback supplies it (`externalParentId: pick.parent ?? null`). The plan must:

1. Add `external_parent_id` to the `getLinkedAccount` select.
2. Add `externalParentId: string | null` to the `LinkedAccount` type.
3. Return it.

Decide whether to widen `getLinkedAccount` generically (it also serves ga4/gsc, where `external_parent_id` is null, which is harmless) or add a GBP-specific reader. Generic widening is the lower-surprise choice; the field is simply null for the other two sources.

Parent construction: `external_parent_id` already carries the `accounts/` prefix and `external_account_id` already carries the `locations/` prefix (confirmed in gbp-enumerate.ts:144 and accounts.ts:21). So the URL is a plain slash-join. Do NOT re-wrap as `accounts/${x}/locations/${y}` or you double-prefix.

Errors reuse `mapGoogleApiError` unchanged. `.request` is Gaxios and throws a `GaxiosError` carrying `.response.status`, which `mapGoogleApiError` already classifies (401/403 to `auth_failed`, 429 to `rate_limited`, etc.). Wrap in try/catch and rethrow `mapGoogleApiError(err)`, identical to the enumerate idiom.

Minimal TS sketch (server-only), consistent with the repo's `gbp-enumerate` / `accounts` / `client` patterns:

```ts
import "server-only";
import { googleOAuthClientEnv, buildOAuth2Client, mapGoogleApiError } from "./client";

const GBP_V4_HOST = "https://mybusiness.googleapis.com";

type ReviewsAggregateResponse = {
  averageRating?: number;
  totalReviewCount?: number;
  reviews?: unknown[];
  nextPageToken?: string;
};

// acct MUST come from an EXTENDED getLinkedAccount that returns externalParentId.
export async function fetchGbpReviewsAggregate(acct: {
  refreshToken: string;
  externalAccountId: string; // bare 'locations/{lid}'
  externalParentId: string; // 'accounts/{aid}'
}): Promise<{ averageRating: number | null; totalReviewCount: number | null }> {
  const { clientId, clientSecret } = googleOAuthClientEnv();
  const oauth2 = buildOAuth2Client({ clientId, clientSecret, refreshToken: acct.refreshToken });
  // both halves already carry their prefixes -> plain slash-join, do NOT re-wrap
  const parent = `${acct.externalParentId}/${acct.externalAccountId}`;
  try {
    const res = await oauth2.request<ReviewsAggregateResponse>({
      url: `${GBP_V4_HOST}/v4/${parent}/reviews`,
      method: "GET",
      params: { pageSize: 1 },
      timeout: 15000,
    });
    return {
      averageRating: res.data.averageRating ?? null,
      totalReviewCount: res.data.totalReviewCount ?? null,
    };
  } catch (err) {
    throw mapGoogleApiError(err);
  }
}
```

Note the return uses `?? null` for BOTH fields (not `?? 0` for the count), to stay consistent with the nullable Section 6 keys and the "null = no data" precedent.

## Access + quota gate

Same Gate A. v4 reviews ride the SAME Business Profile API access approval and the SAME `business.manage` scope as the Performance API. There is no separate access form and no separate approval for v4 reviews. A single approved "Application for Basic API Access" grants the standard default quota across all the Business Profile APIs at once (confidence: high; adversarial verdict: confirmed). The scope match means any Gate-B OAuth-verification tier (sensitive vs restricted) applies equally to reviews and Performance, with no asymmetry.

GCP APIs to enable (all gated behind the one approval, then enabled per-API in Cloud Console):

1. My Business Account Management API (`accounts.list`, already used by 13-01 enumeration).
2. My Business Business Information API (`accounts.locations.list`, already used by 13-01).
3. Legacy "Google My Business API" (hosts v4 `accounts.locations.reviews.list`). This API is only visible/enablable AFTER the access request is approved.

Quota: default 300 QPM per API after approval; v4 traffic is metered under "V4 General Requests per minute." No lighter read-only tier exists; read and write share the 300 QPM. For 13-03's pilot (one Wallace call per month) quota is a non-issue; fleet batching is a Phase-13 follow-on, not a 13-03 blocker.

Lead-time: Gate A is one human-reviewed approval that unblocks Performance metrics and v4 reviews together. Official SLA is review within ~14 days; real-world ranges from same-day to ~6 weeks. Do not commit a fixed client date. Operational caveat: confirm post-approval that EACH enabled API shows 300 QPM (documented cases of a per-API line lagging at 0 after project approval). Because Phase 13 already requires Gate A for Performance, 13-03 adds no new approval, only the enablement of the legacy Google My Business API if not already enabled.

## Data-model decision

STOCK monthly aggregate stays SnapshotSource-only. It goes on the EXISTING `gbp_presence` row's `metrics` jsonb, NOT into the `AnalyticsSource` union and NOT as a new sibling SnapshotSource.

Reasoning, in order of strength:

- The union rule (FLOW-vs-STOCK) EXCLUDES the third option (forcing the rating into the daily-rollupable `AnalyticsSource` union, which would fabricate a fake rollup on a STOCK average), but it does NOT by itself pick same-row over sibling. Both are SnapshotSource-only monthly STOCK.
- Same-row beats sibling because the rating shares the presence row's grain, read path, and write cadence exactly: one row per `(shop, 'gbp_presence', YYYY-MM-01)`, read via `getMonthlySnapshot(client, {shopId, source: 'gbp_presence', month})`, written by the same monthly presence orchestrator (the v4 aggregate is one extra call in the same run). A sibling source would be a second row at the identical conflict key `(shop_id, source, date, period)`. `ga4_dimensions` / `performance` earned their own sources because each is its own orchestrator + report block + fetch vertical; the star rating is enrichment of the presence block, not a separate vertical.
- The committed Phase-13 boundary already assigns the star rating to the `gbp_presence` row (13-02b-SUMMARY line 71; 13-RESEARCH rec 4), so same-row is the codebase's own decision, not a new convention.

Exact jsonb keys to ADD to the line-187 `gbp_presence` shape (snake_case to match every existing jsonb shape; v4's camelCase `averageRating` / `totalReviewCount` must be renamed):

- `average_rating: number | null`
- `total_review_count: number | null`

Both nullable. `average_rating` must be nullable: a shop with 0 reviews has no average, and 0 would be a false 1-to-5 rating. `total_review_count` is `number | null` to follow the codebase's own "null = no data, not a real 0" precedent (`GoogleAdsMetrics.cpl`, every `PsiFieldMetrics` field). The one dependency the plan must commit on: `number | null` is REQUIRED if the monthly presence orchestrator writes the `gbp_presence` row even when the v4 reviews call fails (so a failed aggregate is not persisted as a false 0). `number` would suffice only if the row is written solely on v4 success. Recommend writing the row regardless of v4 success (presence state is independently valuable), therefore `number | null` for both, and document the choice on the type. This aggregate is lifetime, not month-windowed; the monthly cadence captures successive lifetime snapshots to build a trend.

## Pitfalls + read-only safety

- Write/mutation prohibition, not "reply-only." The automated-without-consent prohibition targets write actions (review replies, Q&As, listing creations, listing edits, "or other actions"), which is broader than the task's "reply-only" framing. Either way, READS are unrestricted. An aggregate read needs no human-consent gate; a reply pipeline would. Phase 13-03 is read-only and unaffected.
- Empty/zero for non-VoM is UNCERTAIN for v4 reviews. The v4 doc says `reviews.list` is "only valid if the specified location is verified," which reads as an error/reject gate, not a 200-with-empty-aggregate. The empty-equals-valid-zero pattern is CONFIRMED only for the Performance API, a DIFFERENT API. Do not parrot "mirror the Performance-API empty-for-non-VoM behavior." Build defensively for BOTH: a non-2xx reject AND a 200 with `averageRating` absent. Map either to a "no rating available" presence state (`average_rating: null`, `total_review_count: null`), NOT a CircuitBreaker failure. Map verification to the repo's existing `metadata.hasVoiceOfMerchant` signal already captured at 13-01. Confirm the real non-verified shape at the 13-04 live smoke.
- Thresholds do NOT apply to review counts. `totalReviewCount` is an exact integer. The `insightsValue.threshold` floor ("fewer than N") belongs to the search-keywords monthly endpoint, a different API. Do not apply low-volume-floor logic to review counts.
- reviewId migration is N/A for the aggregate. The v4.8 reviewId format migration and the 30-day refresh obligation apply only when you STORE per-review IDs. 13-03 stores neither `reviewId` nor review bodies, so this is irrelevant. It returns in Phase 14 if per-review rows are persisted.
- Content-storage policy is already satisfied. The policy bars aggregating stored review TEXT, which is exactly why 13-03 consumes Google's PRE-COMPUTED `averageRating` / `totalReviewCount` and stores no bodies or IDs. Storing Google's scalars is not "you aggregating Content." Storing the scalars indefinitely takes the same position the already-shipped 12-05b/13-02b numeric-metric ingests took; treat as already-accepted, not a per-plan re-litigation.

## Adversarial verdicts

| Load-bearing claim | Verdict | Deciding evidence | Build implication / what 13-04 must confirm |
|---|---|---|---|
| `reviews.list` returns top-level `averageRating` + `totalReviewCount` (one cheap call, not paginate-and-average) | confirmed | REST response body lists both at root; RPC types `double` / `int32`; descriptions say "all reviews for this location" (location-wide, not page-scoped) | Build the single-call aggregate. No pagination. |
| StarRating enum (`STAR_RATING_UNSPECIFIED`, `ONE`..`FIVE` = 1..5) is HOW you read a LOCATION's rating | refuted | `Review.starRating` (enum) is "the star rating of the review" (per-review); the location rating is `ListReviewsResponse.averageRating` (a number). Wrong type, wrong level | 13-03 reads `averageRating` (number), never the enum. The enum values are real (per-review) but unused here. 13-04 confirms the enum value set ONLY if Phase 14 maps per-review ratings. |
| v4 reviews ride the SAME Gate A access + `business.manage` scope as Performance, no separate approval (legacy GMB API may need enablement) | confirmed | basic-setup: GMB API visible only after the single access form; scope on both endpoints is identical `business.manage` | No new approval for 13-03. Enable the legacy Google My Business API in Cloud Console; verify its quota line shows 300 QPM post-approval (per-API lag is documented). |
| `pageSize: 1` returns the aggregate with a minimal payload | uncertain | Aggregate is structurally a response-root field, but "returns on pageSize=1" is documented-semantics inference, not tested | Default to `pageSize: 1`. At 13-04 confirm `averageRating` + `totalReviewCount` present with `reviews[]` length 1. If absent, fall back to a small pageSize that still returns aggregates. |
| Non-verified / non-VoM location returns 200-with-empty (mirrors Performance API) | uncertain | v4 doc says op "only valid if verified" (error-gate language); empty-equals-zero confirmed only for the Performance API | Handle BOTH non-2xx and 200-with-absent-`averageRating`; map to "no rating available" presence state, not a breaker trip. At 13-04 capture the real shape against a non-VoM location and pin the handling. |
| `getLinkedAccount` can supply the `accounts/{aid}` parent today | refuted | accounts.ts:79 select omits `external_parent_id`; `LinkedAccount` (58-62) and the return (110-114) omit `externalParentId` | Extend the reader (select + type + return) before the seam can build the parent. Write side is already correct (select/route.ts passes `pick.parent`), so this is read-side only. No live-gate dependency; verify by unit test. |

## Open items for the 13-03 plan

- [ ] Extend `getLinkedAccount`: add `external_parent_id` to the select, add `externalParentId: string | null` to `LinkedAccount`, return it. Decide generic-widening (recommended; null for ga4/gsc) vs a GBP-specific reader.
- [ ] Confirm `external_parent_id` is populated for the Wallace pilot row (it should be: `select/route.ts` passes `pick.parent`); if the pilot row predates that wiring, plan a backfill or re-enumeration.
- [ ] Add `average_rating: number | null` and `total_review_count: number | null` (snake_case) to the line-187 `gbp_presence` jsonb shape in `types.ts`. Document the nullability rationale on the type.
- [ ] Commit the write semantic: write the `gbp_presence` row even when the v4 reviews call fails (both keys null on failure). This is why both are `number | null`.
- [ ] Build `fetchGbpReviewsAggregate` as a raw-HTTP seam via `buildOAuth2Client(...).request`, host `https://mybusiness.googleapis.com`, `params: { pageSize: 1 }`, parent = slash-join (no re-wrap), errors via `mapGoogleApiError`.
- [ ] Wire the call into the monthly presence orchestrator (one extra call in the same run), renaming camelCase to snake_case at the boundary.
- [ ] Enable the legacy Google My Business API in Cloud Console (Gate A already covers reviews); verify its quota line is 300 QPM, not 0.
- [ ] Defensive non-VoM handling: map both a non-2xx reject and a 200-with-absent-`averageRating` to "no rating available," not a CircuitBreaker failure.
- [ ] Defer to 13-04 live smoke: (a) `pageSize: 1` returns the aggregate; (b) the exact non-verified / non-VoM response shape; (c) the StarRating enum value set, only if Phase 14 needs per-review mapping.
- [ ] Keep all per-review work (bodies, replies, sentiment, pagination, reviewId dedupe) OUT of 13-03; that is Phase 14.
