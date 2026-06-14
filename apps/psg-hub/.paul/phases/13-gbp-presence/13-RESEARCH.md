<!-- Phase 13 research dossier. Produced 2026-06-13 by ultracode Workflow wf_9f94f2c1-01b (10 agents: 7 research + 2 adversarial verify + 1 synthesize; ~792k tokens). Risk-claim verdicts: access-gate = confirmed-with-nuance; reviews-access = confirmed-with-nuance. Agents read live repo files. -->

# Phase 13 — GBP Presence + Insights: Research

## Executive summary

1. **The build is feasible and maps cleanly onto existing infra, but two independent Google approval gates, not one, sit on the critical path.** Gate A is the Business Profile API access request (project quota starts at 0 QPM, flips to 300 QPM on approval). Gate B is OAuth consent-screen verification for the new sensitive scope `https://www.googleapis.com/auth/business.manage`. Both are external Google reviews with real lead time. File Gate A on day 1.

2. **The "reuse the one refresh token" premise breaks at the scope layer.** The Phase-11 consent grants exactly `analytics.readonly webmasters.readonly` (confirmed firsthand in `authorize/route.ts:12-13`). It carries no `business.manage`, so every GBP call returns 403/PERMISSION_DENIED. Every already-linked shop, including the Wallace pilot, must re-consent (incremental authorization) to mint a token carrying the GBP scope. The OAuth table, AES-256-GCM encryption, and link routes are reusable; the existing grant is not.

3. **The pilot is NOT cleanly unblocked by Testing mode — this is the headline correction.** Most upstream findings assumed the OAuth app sits in Testing publishing status, letting the pilot run under the 100-test-user cap without verification. The adversarial verdict refutes this against the repo's own operator runbook: the consent screen was already published **In Production** in Phase 10. Because the app is In Production, the Testing-mode escape hatch does not apply. Appending `business.manage` re-triggers sensitive-scope verification, and the documented Phase-10 failure mode (refresh tokens revoked 7 days after consent while unverified) can break the **pilot**, not only the 842-shop scale-out. Treat **both** pilot and production as activation-pending on Gate B until an empirical pass-gate clears.

4. **The data model splits into two `analytics_snapshots` sources by the codebase's own discriminator.** GBP insights (Performance API daily action counts) are daily FLOW and summable, so they enter the four-value `AnalyticsSource` union as `'gbp'` and earn the dashboard panel, report block, trend, and rollup for free. GBP presence (Business Information location state) is point-in-time STOCK, so it stays a `SnapshotSource`-only monthly extra as `'gbp_presence'`, mirroring the existing `performance` / `ga4_dimensions` precedent. This requires three CHECK-widening migrations and is otherwise pure reuse of the Phases 9/10/11 ingest vertical.

5. **Phase 14 (reviews) is feasible but adds two hard constraints upstream research missed.** Reviews live on the active legacy My Business v4 API (no announced sunset), share Gate A and the `business.manage` re-consent with Phase 13, and have no typed Node client (raw HTTP required). The adversarial verdict adds: Google **prohibits automated review replies without prior express user consent** (a human-approval gate is mandatory), and `updateReply` works only on verified locations.

---

## ⚠️ Lead-time blockers & access gates

**Lead with the adversarial verdict.** The highest-risk claim — "the pilot can proceed immediately under Testing publishing status without verification" — is **refuted by repo evidence**. The verdict's reasoning, verified against `.paul/phases/11-ga4-gsc/11-04-GATE-BATCH.md:37-46`: the OAuth consent screen was **already published In Production by Phase 10 with the adwords scope**. Consequences:

- The Testing-mode escape hatch (`support.google.com/cloud/answer/13464323`, 100-user cap, no verification) **does not apply to this app**, because it is not in Testing.
- Appending `business.manage` to an In-Production app **re-triggers Google's sensitive-scope verification review**.
- While unverified, the documented Phase-10 failure mode applies: refresh tokens minted under the new scope can be **revoked 7 days after consent**. That breaks daily GBP ingest for the pilot, not just scale-out.
- **Net: treat both the pilot and the 842-shop scale-out as activation-pending on the OAuth-verification axis (Gate B).** Phase 13 builds and tests locally; it does not "close activated" until the empirical pass-gate clears.

### Gate A — Business Profile API access request (quota 0 → 300 QPM)

- **What:** Submit the "Application for Basic API Access" via the GBP API contact form at `support.google.com/business/contact/api_default`. Until approved, every Business Profile API sits at **0 QPM** and returns errors on every call regardless of correct code. Approval flips the project to **300 QPM** default across the Performance, Account Management, Business Information, Verifications, Lodging, Place Actions, and Notifications APIs.
- **Lead time:** Official anchor is **"Requests are reviewed within 14 days"** (`developers.google.com/my-business/content/faq`). The wider "4 days to 6 weeks" range cited in some findings traces only to a secondary blog and is **unverified** — do not plan against it.
- **Scope of approval:** Per **Google Cloud project**. Approvals do **not** transfer between projects. Access never lets you query a GBP the consenting account lacks a role on.
- **Prerequisites (corrected by the verdict):** Manage a GBP **verified and active 60+ days**, have a live website on the GBP, and submit as an **owner OR manager** on the profile. The findings' "OWNER not manager" and "manager-submitted requests are a documented denial cause" are **refuted** — the official prereqs page says "owner/manager."
- **Per-API quota trap:** Even after approval, a specific API (commonly Account Management) can sit at 0 QPM and 429, blocking `accounts.list` while Performance works. Confirm 300 QPM on **every** API you call, not just one (GBP Community thread 415931676).

### Gate B — OAuth sensitive-scope verification for `business.manage`

- **What:** `business.manage` is absent from the Phase-11 consent. Adding it to the OAuth client re-triggers consent-screen verification because the app is In Production and serves external users (the >100-external-user threshold is confirmed; Testing-mode exemption does not apply).
- **Lead time:** Sensitive-scope verification commonly runs 24–72 hours to ~10 days; secondary sources cite up to 2–6 weeks. Submission typically requires a demo video showing the consent screen and each scope's use.
- **Classification is UNVERIFIED.** Several findings assert `business.manage` is "sensitive." The verdict could not pin sensitive-vs-restricted to a primary source (`developers.google.com/identity/protocols/oauth2/scopes` does not label it). This matters: **restricted** scopes add an annual CASA Tier 2 third-party security assessment (weeks of lead time, paid). The operational gate stands regardless — an external app using `business.manage` for >100 users requires verification — but the timeline cost depends on a classification you must confirm in the Cloud Console OAuth config before committing a date.
- **Per-OAuth-client, not per-flow:** A separate GBP consent flow lowers *token* blast radius (GA4/GSC tokens stay untouched) but **does not avoid Gate B**. Verification attaches to the OAuth client (`client_id`); adding `business.manage` to the same client re-triggers app-wide verification either way.

### The empirical pass-gate (the activation condition)

Before declaring Phase 13 activated for the pilot, run the same empirical check the Phase-11 gate batch prescribes: **a refresh token minted today must still mint an access token >7 days later, with no "Google hasn't verified this app" hard wall.** If that passes, the pilot is live. Until it passes, Phase 13 is activation-pending.

### Comparison to the Phase-10 Google Ads developer-token gate

Same shape (apply via a console form, days-to-weeks review, live website, valid contact). Key difference: Google Ads offers test accounts/MCC to build immediately before token approval. GBP's nearest unblock-while-waiting path would be Testing-mode OAuth — **which this app cannot use** because it is In Production. GBP also adds a second gate (the sensitive OAuth scope) that the Ads developer-token flow does not separately impose.

---

## Auth & consent

- **Single scope spans all GBP APIs.** `https://www.googleapis.com/auth/business.manage` authorizes Account Management, Business Information, Performance, Verifications, Notifications, Place Actions, Q&A, and legacy v4 Reviews. Confirmed verbatim on the Performance API method reference ("Authorization Scopes" = `business.manage`).
- **There is a deprecated alias.** `plus.business.manage` exists for backward compatibility. So "business.manage is the only scope" (asserted in several findings) is wrong — it is the only **non-deprecated** scope, and there is no read-only variant. Request `business.manage`.
- **Existing token cannot be reused as-is.** Scopes are fixed at consent time (`src/lib/google-oauth/client.ts` documents this). The Phase-11 token has no `business.manage`; GBP calls 403. There is no way to add a scope to an already-issued refresh token without a new authorization.
- **Incremental auth mints a combined superset token.** The existing authorize route already hardcodes `prompt=consent`, `access_type=offline`, and `include_granted_scopes=true`. Re-running the flow with the widened scope yields a **new** refresh token covering `analytics.readonly + webmasters.readonly + business.manage`. The new access token covers all previously granted scopes too.
- **Token-overwrite hygiene:** Because every re-run issues a new refresh token, the plan must overwrite the encrypted token on the shop's existing rows (or write once and share) so all sources use the latest combined token. Fragmenting tokens risks the 100-refresh-tokens-per-account-per-client cap silently invalidating an older row over time.

### Link UX decision (two options, conflict noted)

Findings split on the link-flow shape:

- **Option A — widen the existing combined consent** to a 3-scope string (`analytics.readonly webmasters.readonly business.manage`) and add a GBP checkbox to the one consent. Cleaner for the single-token model; forces every already-linked shop to re-consent.
- **Option B — a separate "Connect Google Business Profile" flow** with its own `/api/.../gbp/{authorize,callback,select}` routes and its own `google_oauth_accounts` row (`source='gbp'`, own refresh token). Lower **token** blast radius (GA4/GSC tokens untouched), matches the per-source row design in `accounts.ts`.

**Both options re-trigger Gate B** (same OAuth client). The choice is about token blast radius and route surface, not about dodging verification. See the recommendation below.

### Wiring idiom (load-bearing, the documented Phase-11 trap)

GBP clients live inside `googleapis` and use the **`auth: oauth2`** injection idiom — the same as the existing GSC `google.webmasters` path — **NOT** the gax `authClient:` idiom used by GA4's `@google-analytics/data`. Mixing these fails at request time. Construct like `gsc-client.ts`: `const auth = new google.auth.OAuth2(...); auth.setCredentials({refresh_token}); const perf = google.businessprofileperformance({version:'v1', auth});`.

---

## Presence insights — Business Profile Performance API

- **Service:** `https://businessprofileperformance.googleapis.com`, API version **v1**. Discovery doc at `.../$discovery/rest?version=v1`.
- **Primary daily call (recommended):** `locations.fetchMultiDailyMetricsTimeSeries` — `GET .../v1/{location=locations/*}:fetchMultiDailyMetricsTimeSeries`. Query params: repeated `dailyMetrics[]` (required), `dailyRange.startDate.{year,month,day}`, `dailyRange.endDate.{year,month,day}`. Empty body. Fetches **multiple metrics for ONE location** in one call ("Multi" = multiple metrics, not multiple locations).
- **Single-metric call:** `locations.getDailyMetricsTimeSeries` — current and documented in v1, supports `dailySubEntityType.dayOfWeek` (MONDAY..SUNDAY) and `dailySubEntityType.timeOfDay` breakdowns on supported metrics. (Note: some 2026 third-party articles claim this method was "deprecated/removed" — that refers to the **old v4** method; the v1 method is live. Prefer `fetchMulti` to minimize call count.)
- **Search keywords (separate, MONTHLY):** `locations.searchkeywords.impressions.monthly.list` — `monthlyRange.startMonth/endMonth.{year,month}`, `pageSize` default/max 100, `pageToken`. Low-volume terms return an `insightsValue.threshold` floor instead of an exact `value`; UI must render "fewer than N."

### DailyMetric enum (12 values, verified)

`DAILY_METRIC_UNKNOWN`, `BUSINESS_IMPRESSIONS_DESKTOP_MAPS`, `BUSINESS_IMPRESSIONS_DESKTOP_SEARCH`, `BUSINESS_IMPRESSIONS_MOBILE_MAPS`, `BUSINESS_IMPRESSIONS_MOBILE_SEARCH`, `BUSINESS_CONVERSATIONS`, `BUSINESS_DIRECTION_REQUESTS`, `CALL_CLICKS`, `WEBSITE_CLICKS`, `BUSINESS_BOOKINGS`, `BUSINESS_FOOD_ORDERS`, `BUSINESS_FOOD_MENU_CLICKS`.

**Collision-repair relevance:** `CALL_CLICKS` (highest-intent phone leads), `BUSINESS_DIRECTION_REQUESTS` (drive-to-shop intent), `WEBSITE_CLICKS`, `BUSINESS_CONVERSATIONS` (GBP messaging), and the four impression splits (Search vs Maps × desktop vs mobile). **N/A — will return empty/zero, do not wire panels:** `BUSINESS_BOOKINGS`, `BUSINESS_FOOD_ORDERS`, `BUSINESS_FOOD_MENU_CLICKS`.

### Response shape and parsing gotchas

- **`fetchMulti`:** `{ multiDailyMetricTimeSeries: [ { dailyMetricTimeSeries: [ { dailyMetric, dailySubEntityType, timeSeries: { datedValues: [ { date: {year,month,day}, value } ] } } ] } ] }`.
- **`value` is an int64 serialized AS A STRING** (Go struct json tag `value,omitempty,string`). Parse with `Number()`/`parseInt`; an absent value means 0. Do not assume a numeric field or you get NaN / silent data loss.
- **Dates are `google.type.Date` objects** (`{year,month,day}`), not ISO strings. A date range needs six query params (three per bound).
- **Impressions are de-duplicated per unique user per day.** Summing daily impressions over a month is an upper bound, not unique visitors — set that expectation in dashboard copy.
- **Empty vs error (reported, not crisply documented):** the API returns HTTP 200 with empty/zero `timeSeries` for no-activity dates and for newly verified locations in their data-latency window. Treat empty as a valid **zero**, not a failure, or the CircuitBreaker/withRetry path will misclassify normal empty days as errors. A valid `locationId` can also 404 when the location is not accessible to the authorized account — map that to a "not linked / not accessible" state. **Verify exact shapes at the live-smoke gate.**

### Granularity, lag, quotas

- **Granularity:** strictly daily for the action metrics; monthly only for search keywords.
- **Data-freshness lag:** **NOT officially documented** (confidence low). Community sources cite ~4 days. Do not hardcode a guessed lag. Re-fetch a **trailing window** (~7-day lookback ending T-1) each run and lean on the `unique(shop_id, source, date, period)` idempotency key to absorb restated days. Verify empirically against Wallace once linked.
- **Max date range per request:** no official cap found. Do not assume unlimited; chunk if a live test rejects long ranges.
- **Quota math:** one `fetchMulti` call per shop per run pulls all insight metrics. At 300 QPM, ~842 shops is well within quota (~1 QPM/shop), but the daily cron still needs the existing CircuitBreaker + withRetry batching/throttling.

---

## Account + location linking

Linking is a two-API flow on the post-GMB split APIs:

1. **My Business Account Management API v1** — `accounts.list`: `GET https://mybusinessaccountmanagement.googleapis.com/v1/accounts`. Empty body. `pageSize` default/max **20**, `pageToken`, `filter` (only `type=`). Account fields: `name` (`accounts/{id}`), `accountName`, `type` (`PERSONAL | LOCATION_GROUP | USER_GROUP | ORGANIZATION`), `role` (`PRIMARY_OWNER | OWNER | MANAGER | SITE_MANAGER`), `verificationState`. A single-shop owner is usually `type=PERSONAL`. Iterate all accounts and flatten (a shop owner may have a PERSONAL account plus a manager invite to an agency LOCATION_GROUP), mirroring the GA4 `accountSummaries` flatten.

2. **My Business Business Information API v1** — `accounts.locations.list`: `GET https://mybusinessbusinessinformation.googleapis.com/v1/{parent=accounts/*}/locations`. **`readMask` is REQUIRED** (omitting it returns HTTP 400 — unlike GA4/GSC enumerate). `pageSize` default 10 / max 100, `pageToken`. A minimal picker readMask: `name,title,storefrontAddress,metadata,openInfo`.

### Resource-name shape (a real trap)

`accounts.locations.list` takes `parent='accounts/{id}'`, but each returned `Location.name` is the **bare `locations/{locationId}`** (no account prefix). The Performance and Verifications APIs key off `locations/{id}`. **Store the bare `locations/{id}`** as `google_oauth_accounts.external_account_id` for `source='gbp'`, mirroring how GA4 stores `properties/<id>`. It feeds the Performance call with no reshaping.

> **Phase-14 forward-capture note:** legacy v4 Reviews uses the **different** `accounts/{aid}/locations/{lid}` form. If you store only `locations/{id}` now, Phase 14 must re-enumerate to recover the account id. Recommend capturing the account id alongside (display_name or a dedicated column) to avoid re-enumeration later.

### Verification-state caveats

- **There is no `verificationState` field on `Location`.** Do not infer serviceability from `Account.verificationState=VERIFIED`.
- **Read per-location eligibility two ways:** (a) `Location.metadata.hasVoiceOfMerchant` (boolean, inline — zero extra calls), or (b) the My Business Verifications API `locations.getVoiceOfMerchantState` (`GET .../v1/{name=locations/*}/VoiceOfMerchantState`), which also returns a `gain_voice_of_merchant_action` union. `hasVoiceOfMerchant=true` means the location is in good standing and serviceable; **insights/performance return empty for non-VoM/unverified locations.**
- **Open unknown:** whether `metadata` (or `metadata.hasVoiceOfMerchant`) is accepted as a `readMask` path on `accounts.locations.list`, or whether a separate `getVoiceOfMerchantState` call is needed. Confirm at the live-smoke gate.

### Multi-location pagination

A multi-location agency account returns many locations. Phase 13 pilot is one Wallace location, but the select route must paginate (`nextPageToken`) and let the operator pick the right `locations/{id}`. `accounts.list` max page is 20; `accounts.locations.list` max 100.

---

## Reviews access (Phase-14 scout)

**Lead with the verdict: feasible in 2026 for an eligible, approved developer, with constraints the upstream "FEASIBLE" headline under-weighted.**

- **Reviews remain on legacy My Business v4** (`mybusiness.googleapis.com/v4`), and they are **active, not deprecated.** The official sunset-dates registry lists no turndown for any reviews endpoint. The change-log shows reviews were **extended** in 2026 (ReviewMediaItems via get/list/batchGetReviews on 2026-04-20; ReviewReplyState moderation status on 2026-04-01). Only `accounts`, `accounts.admins`, `accounts.invitations`, and `accounts.locations.admins` were deprecated out of v4 (moved to v1 Account Management) — **not** reviews. The task's "v4.9" label and "v4" base path are consistent: v4.9 is the API revision; reviews serve at the `/v4` path.
- **Endpoints:** `accounts.locations.reviews.list` (`GET .../v4/{parent=accounts/*/locations/*}/reviews`, `pageSize` max 50, `orderBy` in `rating | rating desc | updateTime desc`), `reviews.get`, `batchGetReviews`, `reviews.updateReply` (`PUT .../reviews/*/reply`), `reviews.deleteReply`.
- **`updateReply` is an idempotent UPSERT** ("a reply is created if one does not exist") — safe to replay. **But it only works on verified locations** (verdict correction); unverified locations reject replies.
- **Google PROHIBITS automated replies without prior express consent** (verdict correction, Prohibited practices > Automated use): "You must not automate or trigger review replies... without the user's prior specific and express consent." An LLM auto-reply pipeline **must** route through a human-approval gate. The existing `/api/reviews/[id]/approve-response` route fits this.

### Access decision is SHARED with Phase 13

- Same Gate A allowlist (0 → 300 QPM Basic API Access). **Start it during Phase 13, not Phase 14.**
- Same `business.manage` re-consent (the current grant lacks it; every shop including Wallace re-links).
- Reviews depend on `accounts.list` + locations enumeration, which are **separately quota-gated** — confirm Account Management and Business Information quotas are non-zero, not just the reviews project.

### Node library gap

The `googleapis` v173 library (verified in-repo) has **no typed v4 reviews client** — `google.mybusiness === undefined`, and there is no `mybusiness` v4 folder in `node_modules`. Issue #2700 (open since 2021) confirms the discovery doc omits reviews. Phase 14 must use **raw HTTP** via `OAuth2Client.request({ url, method, data })` (google-auth-library, already a dep). Do not assume a typed reviews client exists.

### Existing code is not reusable for Phase 14

`src/lib/reviews/google.ts` is the **Places API** (`maps.googleapis.com`, `GOOGLE_PLACES_API_KEY`, ~5 reviews, no reply capability). Unusable for read/reply — Phase 14 needs a new adapter, not an extension.

### Phase-14 open design choices (not Phase-13 blockers)

- **Real-time vs polling:** the My Business Notifications API delivers Cloud Pub/Sub notifications for new/updated reviews (one `NotificationSetting` per account, route to a Pub/Sub topic, grant `pubsub.topics.publish` to `mybusiness-api-pubsub@system.gserviceaccount.com`). Avoids per-shop polling at 842 shops (pageSize 50, 300 QPM ceiling) but adds Pub/Sub infra. Polling fits the existing `analytics_sync_runs` pattern but scales worse.
- **Review-ID format migrated in v4.8** — old IDs resolve but Google asks you to refresh stored IDs within 30 days. Use the current `reviewId` as the dedupe key.
- **Storage shape:** reviews are event-shaped (per-review rows with reply state), not daily time-series, so `analytics_snapshots` may be a poor fit — a dedicated reviews table is likely better. Decide at Phase-14 schema design.
- **`business.manage` classification** (sensitive vs restricted) still unconfirmed; restricted adds CASA Tier 2. **LLM sentiment is entirely PSG-side** — no Google API provides it.
- **StarRating enum** not inlined in the reachable docs; strongly expected `STAR_RATING_UNSPECIFIED, ONE..FIVE`. Confirm against a live response before mapping to a numeric rating.

---

## Data-model mapping & ingest architecture

**Decision: two `analytics_snapshots` source values, split by the codebase's own FLOW-vs-STOCK discriminator.**

| Source | Class | Period | Where it lives | Why |
|---|---|---|---|---|
| `'gbp'` | INSIGHTS (Performance API daily action counts) | `daily` | **Promote into the four-value `AnalyticsSource` union** (`src/lib/analytics/types.ts`) | Daily FLOW, summable — earns the panel, `SourceReportBlock`, `TREND_KEYS`, and rollup registry for free, exactly like `ga4`/`gsc` |
| `'gbp_presence'` | PRESENCE (Business Information Location state) | `monthly` | **`SnapshotSource`-only extra (NOT in the union)**, read via `getMonthlySnapshot` | Point-in-time STOCK — mirrors the existing `performance` / `ga4_dimensions` precedent (`types.ts`: "these extra sources live ONLY on the write/read path") |

The split is the codebase's own rule: `ga4_dimensions`/`performance` were kept out of the union because they are not daily-FLOW-rollup-able. GBP insights **are**, so by that same criterion they belong in the union. Forcing `gbp_presence` into the union would fabricate a fake rollup on STOCK data.

### Three CHECK-widening migrations (not two)

1. `analytics_snapshots` source CHECK → add `'gbp'`, `'gbp_presence'`.
2. `analytics_sync_runs` source CHECK → add both.
3. `google_oauth_accounts` source CHECK (currently `'ga4' | 'gsc'`) → add `'gbp'`; plus widen the `GoogleOAuthSource` TS union in `src/lib/google-oauth/accounts.ts`.

> **Auto-named-constraint trap (documented in the 12-05a/b migrations):** the `analytics_sync_runs` source CHECK is an inline column constraint that Postgres auto-named. A `drop constraint if exists analytics_sync_runs_source_check` silently no-ops if the live name differs, leaving the old constraint rejecting `'gbp'`. **Verify the live constraint name at apply** (`\d+ public.analytics_sync_runs`).

### jsonb shapes

- **Insights (`source='gbp'`, `period='daily'`, one row per `(shop, 'gbp', date)`):** four raw impression surfaces (`impressions_desktop_maps/_desktop_search/_mobile_maps/_mobile_search`), derived `impressions_total`, plus `website_clicks`, `call_clicks`, `direction_requests`, `conversations`. All FLOW counts that sum honestly — no ratios, so no aggregate-exclusion needed (unlike GA4 `engagement_rate` / GSC `ctr`/`position`).
- **Presence (`source='gbp_presence'`, `period='monthly'`, one row per `(shop, 'gbp_presence', YYYY-MM-01)`):** `open_status` (`openInfo.status`: `OPEN | CLOSED_PERMANENTLY | CLOSED_TEMPORARILY`), `primary_category` + `categories`, `has_hours`, `website_uri`, `has_description`, `phone_present`, plus an optional derived `completeness_score`. Verification reads from `metadata.hasVoiceOfMerchant` (or the Verifications sub-resource), not a Location field.

### Ingest vertical — pure reuse, build-local → operator-gate

Copy the `ga4-dims-sync.ts` / `perf-sync.ts` structure for **two** orchestrators (daily insights, monthly presence):

`cron route (CRON_SECRET timingSafeEqual, runtime='nodejs', not-configured 503 guard)` → `orchestrator: openLedger(source)/closeLedger, dedupeByShop over google_oauth_accounts where source='gbp' status='linked', per-shop try/catch with markAccountError on auth_failed` → `idempotent upsertSnapshots(service, rows)` → `dashboard panel + report block`.

- **Daily insights** re-fetches a trailing ~7-day window ending T-1; idempotency key self-heals late/restated days.
- **Cron cadence** (slot into the existing family): insights daily at `0 7 * * *` (after gsc-sync 06:45); presence monthly at `0 4 1 * *` (after perf 03:00 and ga4-dims 02:00, before the 05:00 monthly report, so the report reads fresh rows).
- **Read paths reuse existing functions verbatim:** dashboard/insights → `getSnapshots(client, {source:'gbp', period:'daily', from, to})` under RLS; report presence → `getMonthlySnapshot(client, {shopId, source:'gbp_presence', month})`. The report gets an additive optional `gbpPresence?` block on `ReportData`, exactly like `dimensions?` / `performance?`.

### Reuse vs new (mirroring Phases 9/11)

- **Reuse:** OAuth table + AES-256-GCM encryption + link routes, `upsertSnapshots`/`getSnapshots`/`getMonthlySnapshot`, the `analytics_sync_runs` ledger, the CRON_SECRET gate, CircuitBreaker + withRetry, the `googleapis` dep (typed v1 clients for all three Phase-13 APIs already ship in v173).
- **New:** two sync orchestrators + two cron routes, a GBP-location enumeration branch in the select flow, a presence panel/report section, the three migrations, and the union-promotion edits.
- **Cost of promoting `'gbp'` into the union:** it touches **six exhaustive maps** (render/rollup/report-data/prompt/schema/`SourceReportBlock`) + `TREND_KEYS` + the rollup `METRIC_REGISTRY`. That is the deliberate price of getting the panel/report for free. `'gbp_presence'` must **not** enter the union.

### Do-not-confuse

The pre-existing `google_profile_*` / `market_map` layer (place_id, rating, category, lat/long matched by shop name) is PSG's **scraped 842-shop market-intelligence data** — not the per-shop OAuth profile. Do **not** map GBP insights/presence onto `place_id`. Location identity for the OAuth path is `locations/{id}`, enumerated via Account Management + Business Information, persisted on the new `google_oauth_accounts` row.

---

## Recommended architecture

The shape I recommend, with tradeoffs shown:

**1. Link flow: a separate "Connect Google Business Profile" consent (Option B), with its own `google_oauth_accounts` row (`source='gbp'`, own encrypted refresh token), reusing the existing `/api/analytics/google/*` route family via a scope branch — not a new auth subsystem.** Rationale: it keeps GA4/GSC tokens untouched (token blast radius stays small), it matches the per-source row design already in `accounts.ts`, and `state.ts` is already per-flow generalized for `scope` and `include_granted_scopes`. The honest tradeoff: this does **not** avoid Gate B — adding `business.manage` to the same OAuth client re-triggers consent-screen verification regardless. If you would rather pay one re-consent across all shops and carry a single combined token, Option A is defensible; I prefer B because a broken GBP re-consent should never be able to invalidate a working GA4/GSC token.

**2. Data model: the two-source split above.** `'gbp'` daily into the union (earns the full panel/report path), `'gbp_presence'` monthly as a write/read-only extra. This is the lowest-surprise choice because it follows the codebase's own FLOW-vs-STOCK discriminator rather than inventing a new convention.

**3. Sequencing: file Gate A on day 1, then build entirely against the pilot locally while the clock runs.** Resolve Wallace's `locations/{id}` once approved, smoke-test `fetchMultiDailyMetricsTimeSeries` and the empty/404 behaviors, wire the daily + monthly orchestrators, then run the empirical 7-day token pass-gate. **Phase 13 closes activation-pending until that pass-gate clears for the pilot, and remains activation-pending for the 842-shop fleet behind production OAuth verification.** This mirrors how Phase 11 batched its gate.

**4. Presence panel enrichment: include the GBP star rating + review count in the `gbp_presence` monthly row via one extra v4 `accounts.locations.reviews.list` aggregate call** (`averageRating` + `totalReviewCount`), without touching review bodies/replies/sentiment (the real Phase-14 work). Tradeoff: it pulls one v4 call (and the account-id resource form) into Phase 13, but a presence panel without a star rating is the weak version, and the marginal cost is one read. If you want a hard Phase-13/14 boundary, defer it — but I recommend pulling it in.

**5. Fleet batching is a deferred follow-on, not a Phase-13 blocker.** One call/shop at 300 QPM is fine on quota, but 842 shops against the Fluid 300s ceiling needs the same batching/queue plan already flagged for perf-sync. Pilot scope is Wallace only, so this is a later concern.

---

## Open questions for /paul:plan

1. **GCP project approval status — 0 vs 300 QPM.** Has the project already cleared Gate A, or must the access request be filed? This is the single biggest schedule risk. Check the Cloud Console Quotas page immediately.
2. **Single vs multiple GCP projects.** Does psg-hub use one Cloud project for the OAuth client across prod + staging, or separate projects? If separate, each needs its own Gate A request (approvals do not transfer).
3. **OAuth publishing status confirmation.** The verdict establishes the app is In Production (per `11-04-GATE-BATCH.md`). Confirm in-console, because it decides whether Gate B blocks the pilot (it does, if In Production).
4. **`business.manage` classification — sensitive vs restricted.** Confirm in the Cloud Console OAuth consent config. Restricted adds a CASA Tier 2 assessment (weeks, paid) and materially changes the timeline.
5. **Re-verification effort for adding one scope to an already-verified app.** Does Google require a fresh demo video, or only a re-review? Verify once publishing status is confirmed.
6. **Wallace's GBP role.** Is the linked Google account an **owner/manager on the GBP location** (not only on GA4/GSC)? `business.manage` + project access is necessary but insufficient without a role on that specific location.
7. **Data-freshness lag.** Empirically measure the Performance API daily lag against Wallace once linked, to size the trailing re-fetch window (currently a ~7-day guess).
8. **Empty-vs-error and 404 response shapes.** Confirm at the live-smoke gate so the CircuitBreaker/withRetry classification treats empty as zero and inaccessible-id as "not linked," not as upstream errors.
9. **Minimal readMask for `hasVoiceOfMerchant`.** Confirm whether `metadata` is accepted as a readMask path on `accounts.locations.list`, or whether a separate `getVoiceOfMerchantState` call is required.
10. **Link UX copy.** Whichever option, the re-consent prompt must explain to already-linked shops why they are re-authorizing.
11. **External_account_id shape.** Store bare `locations/{id}` (sufficient for Phase 13), or capture the account id alongside to pre-stage Phase 14 reviews? Recommend capturing the account id now.
12. **Presence star rating decision.** Include the v4 reviews aggregate in `gbp_presence` (recommended) or defer to Phase 14?

---

## Sources

- https://developers.google.com/my-business/content/prereqs
- https://developers.google.com/my-business/content/faq
- https://developers.google.com/my-business/content/limits
- https://developers.google.com/my-business/content/basic-setup
- https://developers.google.com/my-business/content/implement-oauth
- https://developers.google.com/my-business/content/oauth-setup
- https://developers.google.com/my-business/content/performance
- https://developers.google.com/my-business/content/change-log
- https://developers.google.com/my-business/content/sunset-dates
- https://developers.google.com/my-business/content/policies
- https://developers.google.com/my-business/content/review-data
- https://developers.google.com/my-business/content/notification-setup
- https://developers.google.com/my-business/reference/performance/rest
- https://developers.google.com/my-business/reference/performance/rest/v1/DailyMetric
- https://developers.google.com/my-business/reference/performance/rest/v1/locations/fetchMultiDailyMetricsTimeSeries
- https://developers.google.com/my-business/reference/performance/rest/v1/locations/getDailyMetricsTimeSeries
- https://developers.google.com/my-business/reference/performance/rest/v1/locations.searchkeywords.impressions.monthly/list
- https://developers.google.com/my-business/reference/accountmanagement/rest/v1/accounts/list
- https://developers.google.com/my-business/reference/accountmanagement/rest/v1/accounts#Account
- https://developers.google.com/my-business/reference/businessinformation/rest/v1/accounts.locations/list
- https://developers.google.com/my-business/reference/businessinformation/rest/v1/accounts.locations#Location
- https://developers.google.com/my-business/reference/verifications/rest/v1/locations/getVoiceOfMerchantState
- https://developers.google.com/my-business/reference/notifications/rest/v1/NotificationSetting
- https://developers.google.com/my-business/reference/rest/v4/accounts.locations.reviews/list
- https://developers.google.com/my-business/reference/rest/v4/accounts.locations.reviews/updateReply
- https://developers.google.com/my-business/reference/rest/v4/accounts.locations.reviews
- https://developers.google.com/identity/protocols/oauth2/web-server
- https://developers.google.com/identity/protocols/oauth2
- https://developers.google.com/identity/protocols/oauth2/scopes
- https://developers.google.com/identity/protocols/oauth2/policies
- https://developers.google.com/identity/protocols/oauth2/production-readiness/sensitive-scope-verification
- https://developers.google.com/identity/protocols/oauth2/production-readiness/restricted-scope-verification
- https://support.google.com/business/contact/api_default
- https://support.google.com/business/thread/415931676
- https://support.google.com/cloud/answer/13464323
- https://support.google.com/cloud/answer/13804565
- https://googleapis.dev/nodejs/googleapis/latest/Businessprofileperformance.html
- https://googleapis.dev/nodejs/googleapis/latest/Mybusinessaccountmanagement.html
- https://googleapis.dev/nodejs/googleapis/latest/Mybusinessbusinessinformation.html
- https://pkg.go.dev/google.golang.org/api/businessprofileperformance/v1
- https://github.com/googleapis/google-api-nodejs-client/issues/2700
- https://www.npmjs.com/package/@googleapis/businessprofileperformance
- https://www.npmjs.com/package/@googleapis/mybusinessaccountmanagement
- https://slashpost.ai/blogs/google-business-profile/google-business-profile-api-documentation-2026
- https://xovionlabs.com/blog/google-business-profile-api-hidden-gate/
- https://www.sterlingsky.ca/interpret-google-business-profile-performance/
- https://support.powermyanalytics.com/portal/en/kb/articles/missing-or-delayed-data-in-google-business-profile
- repo: `src/app/api/analytics/google/authorize/route.ts:9-13` (consent string `analytics.readonly` + `webmasters.readonly`, both SENSITIVE, Phase-11 gate batch)
- repo: `.paul/phases/11-ga4-gsc/11-04-GATE-BATCH.md:37-46` (OAuth consent screen already published In Production by Phase 10 with adwords scope; adding sensitive scopes may re-trigger verification; refresh token revoked 7 days after consent while unverified)
