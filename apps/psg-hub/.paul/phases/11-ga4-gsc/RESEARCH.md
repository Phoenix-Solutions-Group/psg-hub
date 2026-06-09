# Phase 11 Research — GA4 + GSC

## Summary

- Phase 11 adds two new daily-ingest sources, GA4 (Google Analytics Data API v1beta) and GSC (Google Search Console / Search Analytics API), to the analytics vertical, mirroring the shipped Phase-10 Google Ads vertical structurally (OAuth link flow -> per-shop picker -> encrypted refresh-token storage -> cron-driven idempotent snapshot ingest -> additive dashboard panels).
- Both sources write into the existing source-agnostic `analytics_snapshots` table and log run-level audit into `analytics_sync_runs`. Both source CHECK constraints **already admit `ga4` and `gsc`**, so there is **zero migration** on the snapshot/ledger layer. The only new schema is account + transient-OAuth-state storage for the two new sources.
- GA4 and GSC can be authorized in a **single combined-scope OAuth consent** (`analytics.readonly` + `webmasters.readonly`) yielding **one refresh token** usable for both APIs. This is the confirmed adversarial verdict and drives the storage design.
- The OAuth state machine, picker -> select HTTP scaffold, anti-tamper offered-set check, HMAC-signed state, AES-256-GCM refresh-token crypto, the `targetDates`/`upsertSnapshots`/`aggregate` core, and the CRON_SECRET-gated cron route are **true code reuse** (with scope + redirect parameterized). The per-source Google API clients (Admin API account enumeration, Data API `runReport`, Search Console `sites.list` + `searchanalytics.query`) are **entirely new** — different Google APIs, different transports.
- Phase 10 is **code-complete but PROD-PENDING, not live** (paused for meetings; cron returns 503 until the 10-03 creds gate). Phase 11 inherits the same gate-batch deploy discipline and crypto choice.
- Net new work is narrow: 2 new tables (one accounts, one transient state), per-source client/enumerate/metrics modules, 2 entry/callback/select route sets, 2 cron routes, 2 dashboard panels, and JSONB metric type docs.

## OAuth

**Single combined-scope consent, one refresh token, both APIs (CONFIRMED).** Do one authorization-code exchange with both scopes space-delimited in the `scope` parameter. The resulting refresh token, when exchanged, mints an access token that "represents the combined authorization and can be used for any of the scope values included in the response." One OAuth client, one user consent, one refresh token, both GA4 and GSC. (Source: oauth2/web-server, Incremental authorization section — adversarially confirmed verbatim.)

**Exact scope strings:**
- GA4 read: `https://www.googleapis.com/auth/analytics.readonly` — sufficient for both `runReport` (Data API) and `accountSummaries.list` (Admin API read).
- GSC read: `https://www.googleapis.com/auth/webmasters.readonly` — sufficient for both `sites.list` and `searchanalytics.query` (CONFIRMED: the query reference lists it under "at least one of the following scopes"). Note the scope name is the legacy `webmasters` family, **not** `searchconsole.readonly`.

**Consent-screen sensitivity:** Both `analytics.readonly` and `webmasters.readonly` are **SENSITIVE** scopes, not restricted. This means they require sensitive-scope verification (brand/consent-screen verification + per-scope justification) before non-test users can grant without the "unverified app" warning, but they do **NOT** trigger the restricted-scope CASA annual third-party security assessment (that is the Gmail/Drive-full/Fitness tier).

**7-day refresh-token expiry trap:** While the OAuth consent screen is in **Testing** status (external user type) and you request these two non-basic scopes, every refresh token **dies 7 days after consent**. This silently breaks any scheduled ingest one week after it starts. The remedy is publishing the consent screen to **In Production** (which requires completing sensitive-scope verification first). Do not rely on Testing beyond local dev. Other invalidation conditions (Production too): user revokes, token unused 6 months, >100 live refresh tokens per Google account per client ID (101st silently evicts the oldest — re-running consent in dev can evict your own token).

**Reuse of the existing client + 10-04 two-step picker pattern:** Reuse the Phase-10 `oauth.ts` state machine as a **parameterized** module. It already exports `buildAuthorizeUrl`, `verifyAndConsumeState`, `peekState` (verify without consume — the picker path), `stashPendingSelection`, `consumePendingSelection`, `exchangeCodeForTokens`, `revokeAtGoogle`, `StateError`, and the HMAC sign/verify (createHmac sha256 over base64url, `timingSafeEqual`), `STATE_TTL_MS=10min`, atomic consume (`.is('consumed_at', null)`), lazy-GC, and anti-replay. **Two hardcoded ads couplings must be parameterized:** `const SCOPE = "https://www.googleapis.com/auth/adwords"` (oauth.ts:6) and `GOOGLE_ADS_OAUTH_REDIRECT_URI` (read at both authorize and exchange time — the redirect must match between the two or Google rejects the code exchange). Generalize both to per-source scope + per-source redirect.

The 10-04 two-step picker is the right model: callback `peekState` -> if a single account, auto-link; if multiple, `stashPendingSelection` + render a radio picker that POSTs `{state, selected_id}` to `/select`; `/select` re-checks the offered set (`offered.has(id)`) for anti-tamper, then persists. The only thing that changes per source is the enumeration call inside callback (GA4 `accountSummaries.list` / GSC `sites.list` instead of the Ads MCC `customer_client` query).

## GA4 Data API (runReport)

**Endpoint / contract.** `POST https://analyticsdata.googleapis.com/v1beta/{property=properties/*}:runReport`. The `property` path param is `properties/{NUMERIC_GA4_PROPERTY_ID}`, e.g. `properties/123456789` — **NOT** the `G-XXXXXXX` measurement id and **NOT** a UA view id (passing those fails). Find the numeric id in GA4 Admin > Property Settings.

**Node client construction with a refresh token.** Package `@google-analytics/data`, class `BetaAnalyticsDataClient`. Build a `google-auth-library` `OAuth2Client` with the web app client id/secret, call `setCredentials({ refresh_token })`, then inject it via the **`authClient`** field of the gax ClientOptions: `new BetaAnalyticsDataClient({ authClient: oauth2Client })`. The library auto-refreshes the access token on each call. (See Node Libraries section for the critical `authClient` vs `auth` distinction and the UNVERIFIED caveat.)

**Marketing dimensions/metrics.**
- Channel breakout: `sessionDefaultChannelGroup` (session-scoped — the correct one for "sessions by channel"). Distinct from the event/key-event-scoped `defaultChannelGroup` and the acquisition `firstUserDefaultChannelGroup` (CONFIRMED: all three exist with these exact scopes; verify spelling before building — there is no `...Grouping` API variant). Low-cardinality, so safe from `(other)` rollup.
- Date dimension: `date` (returns compact `YYYYMMDD`, e.g. `20260608`).
- Metrics: `sessions`, `totalUsers`, `activeUsers`, `newUsers`, `engagedSessions`, `engagementRate` (float 0..1), `bounceRate` (float), `screenPageViews`, `keyEvents`, `eventCount`.
- **CONVERSIONS RENAME (load-bearing, CONFIRMED):** the `conversions` metric is deprecated (2024-05-06 changelog "New dimensions for key events") and replaced by **`keyEvents`**. Likewise `isConversionEvent` -> `isKeyEvent`. For a 2026 ingest use `keyEvents` as the conversions metric; `conversions` is a legacy alias only.

**Concrete request body** (daily sessions/users/key-events by channel, last 28 days, ordered ascending):

```
await client.runReport({
  property: 'properties/123456789',
  dateRanges: [{ startDate: '28daysAgo', endDate: 'yesterday' }],
  dimensions: [{ name: 'date' }, { name: 'sessionDefaultChannelGroup' }],
  metrics: [{ name: 'sessions' }, { name: 'totalUsers' }, { name: 'activeUsers' },
            { name: 'keyEvents' }, { name: 'engagementRate' }],
  orderBys: [{ dimension: { dimensionName: 'date' }, desc: false }],
  limit: 100000,
  keepEmptyRows: false,
  returnPropertyQuota: true,
});
```

`dateRanges` accept absolute `YYYY-MM-DD` or relative tokens (`today`, `yesterday`, `NdaysAgo`). Note the **two date formats**: dateRanges take `YYYY-MM-DD`, but the `date` dimension returns `YYYYMMDD` (no dashes) — reformat before storing into a DATE column (CONFIRMED).

**Response shape.** `dimensionHeaders:[{name}]`, `metricHeaders:[{name,type}]`, `rows:[{dimensionValues:[{value}], metricValues:[{value}]}]`, plus `rowCount`, `metadata` (`ResponseMetaData`), and `propertyQuota` if requested. Header order matches request order; each row's `dimensionValues[i]`/`metricValues[j]` align positionally. **ALL values come back as STRINGS** (e.g. `{value:"2541"}`, `{value:"0.6342"}`) — `Number()` them before arithmetic or numeric columns (CONFIRMED). Max 250,000 rows/request; default page size 10,000; paginate with `offset`+`limit` against `rowCount`. Inspect `metadata.samplingMetadatas`, `metadata.subjectToThresholding`, `metadata.dataLossFromOtherRow` and log them per ingest — sampling/thresholding/`(other)` rollup are silent otherwise.

## GSC Search Analytics API (searchanalytics.query)

**Contract.** `searchAnalytics.query` (POST). The Node client exposes it via `google.searchconsole({version:'v1'}).searchanalytics.query` (equivalently `google.webmasters({version:'v3'})`). `siteUrl` is a method param (URL-encoded into the path by the client), **not** a body field. Required body fields: `startDate`, `endDate`, both `YYYY-MM-DD`, **interpreted in Pacific Time** (`UTC-7/8`), inclusive of both endpoints (CONFIRMED).

**Site URL formats.** Domain property: `sc-domain:example.com` (no scheme, no slash, no www). URL-prefix property: full verified URL with scheme and trailing slash, e.g. `https://www.example.com/`. The string must match the verified property exactly (www vs non-www matters); a mismatch returns 403/404, not an obvious format error (format CONFIRMED; the original docs example uses `http://`, so do not assume `https://`).

**Client construction (refresh token).** Package `googleapis`. `const oauth2 = new google.auth.OAuth2(CLIENT_ID, CLIENT_SECRET, REDIRECT_URI); oauth2.setCredentials({ refresh_token }); const sc = google.searchconsole({ version: 'v1', auth: oauth2 });`. **Note `auth` (not `authClient`) for googleapis** — opposite of the gax GA4 clients.

**Concrete daily query** (one row per day):

```
const res = await sc.searchanalytics.query({
  siteUrl: 'sc-domain:example.com',
  requestBody: {
    startDate: '2026-05-10', endDate: '2026-06-06',
    dimensions: ['date'], type: 'web', dataState: 'final',
    rowLimit: 25000, startRow: 0,
  },
});
const rows = res.data.rows || [];
// each row: { keys: ['2026-06-05'], clicks, impressions, ctr, position }
```

**Metrics.** Per row: `clicks` (double), `impressions` (double), `ctr` (double, 0..1 fraction — `*100` for percent), `position` (double, average; lower is better). `keys[]` holds dimension values in requested order. Allowed dimensions: `date`, `query`, `page`, `country`, `device`, `searchAppearance`, `hour`.

**rowLimit / pagination.** `rowLimit` valid range 1–25,000, default 1,000 (CONFIRMED). The ~50,000 figure is a separate per-day-per-site-per-search-type ceiling, NOT the rowLimit cap (CONFIRMED) — reach rows 25,001–50,000 by paginating `startRow += 25000`. For `dimensions:['date']` over N<=25,000 days, one call suffices.

**Latency / dataState.** `dataState` default is **`final`** (only finalized data) when omitted; `'all'` includes fresh non-final data that can change on re-query; `'hourly_all'` is used when grouping by the `hour` dimension (CONFIRMED for `final`/`all`; see Open Questions for the `hourly_all`-only and 2-3-day-lag claims, which are UNVERIFIED against official docs). `type` enum: `web` (default), `image`, `video`, `news`, `discover`, `googleNews` — run one query per type since the 50k cap is per type.

## Property & Site Enumeration (per-shop picker)

This mirrors the Ads MCC `customer_client` picker, which returns `{id, name}` per managed account. Both new sources are a single API call per source against the freshly minted refresh token.

**GA4 (Admin API).** `accountSummaries.list`: `GET https://analyticsadmin.googleapis.com/v1beta/accountSummaries`. Returns `{ accountSummaries: AccountSummary[], nextPageToken }`; each `AccountSummary` has `displayName` + `propertySummaries[]`, each `PropertySummary` having `property` (`properties/{id}`) and `displayName`. **Use `listAccountSummaries` / `listAccountSummariesAsync`, NOT `listAccounts`** — `listAccounts` returns flat accounts with no property summaries and cannot build the picker. Node: `@google-analytics/admin`, class `AnalyticsAdminServiceClient`, constructed with the same `authClient: oauth2` injection. `listAccountSummariesAsync({ pageSize: 200 })` auto-paginates (pageSize default 50, max 200). Picker shape per property: `{ id: p.property /* 'properties/<id>' */, name: p.displayName, account: summary.displayName }`. Scope `analytics.readonly` is sufficient. **The Admin API must be separately enabled** in the Cloud project (a 403 SERVICE_DISABLED appears if only the Data API is on).

**GSC (Search Console API).** `sites.list`: `GET https://www.googleapis.com/webmasters/v3/sites`, no body. Returns `{ siteEntry: WmxSite[] }`; each `WmxSite` has exactly `siteUrl` + `permissionLevel`. **No display name exists — `siteUrl` is both id and label.** Filter out `permissionLevel === 'siteUnverifiedUser'` (those cannot run queries and cause downstream 403s; usable levels: `siteOwner`, `siteFullUser`, `siteRestrictedUser`). Node: `googleapis`, `google.webmasters({version:'v3', auth: oauth2}).sites.list()` (or `google.searchconsole('v1')`). Picker shape per site: `{ id: s.siteUrl, name: s.siteUrl, permissionLevel: s.permissionLevel }`. Scope `webmasters.readonly` is sufficient.

Because one combined consent yields one refresh token, a single link flow can enumerate **both** GA4 properties and GSC sites for the shop, and the picker can present both source lists (or two pickers, one per source).

## Node Libraries & Versions

Exact latest published versions verified via `npm view` in the findings:
- `@google-analytics/data@6.1.0` — `BetaAnalyticsDataClient` (GA4 Data, runReport). gax/gRPC transport.
- `@google-analytics/admin@9.1.0` — `AnalyticsAdminServiceClient` (GA4 Admin, accountSummaries). gax/gRPC transport.
- `googleapis@173.0.0` — `google.searchconsole` / `google.webmasters` (GSC, REST transport).
- `google-auth-library@10.7.0` — `OAuth2Client` (also re-exported as `google.auth.OAuth2`). All declare `engines node>=18`.

Install: `npm i @google-analytics/data @google-analytics/admin googleapis google-auth-library`.

**The construction idioms are NOT interchangeable (the single easiest mistake):**
- For the **gax clients** (`BetaAnalyticsDataClient`, `AnalyticsAdminServiceClient`) you pass the OAuth client as **`authClient`**: `new BetaAnalyticsDataClient({ authClient: oauth2Client })`. Passing `auth:` to a gax client fails at request time (gax calls `this.auth.getClient()`, which a bare OAuth2Client lacks).
- For **googleapis** (GSC) it is the reverse: pass **`auth`**: `google.searchconsole({ version: 'v1', auth: oauth2Client })`. There is no `authClient` field on googleapis service factories.

Build the shared `OAuth2Client` once per shop from the decrypted refresh token: `new OAuth2Client(clientId, clientSecret, redirectUri); .setCredentials({ refresh_token })`. Scopes are fixed at consent time, not at construction — the `scopes` option is ignored when a pre-authorized refresh token is injected, so the token must already carry both `analytics.readonly` and `webmasters.readonly`. Capture rotated tokens with `oauth2Client.on('tokens', t => { if (t.refresh_token) persist(t.refresh_token); })`. Do not mix with `GOOGLE_APPLICATION_CREDENTIALS`/service-account/ADC — once `authClient`/`auth` is supplied, the injected user OAuth client wins and ADC is never consulted.

**Next 16 server-route caveats (this codebase runs a modified Next — read `node_modules/next/dist/docs/` before coding).** `@google-analytics/data` and `@google-analytics/admin` depend on `google-gax` -> `@grpc/grpc-js` -> native HTTP/2, and `googleapis` is likewise Node-only. None run on the Edge runtime. In every route handler that calls them: `export const runtime = 'nodejs'`. Setting gax `fallback: true` (REST transport) does **not** make them Edge-safe. In `next.config.ts` add `serverExternalPackages: ['@google-analytics/data', '@google-analytics/admin', 'google-gax', '@grpc/grpc-js', 'googleapis']` so the bundler does not try to bundle the native packages (missing `.node`/`http2`/`dns` errors otherwise).

## Quotas, Sampling & Freshness

**GA4 Data API (Standard property).** Token-bucket, 5 buckets per request: 200,000 tokens/property/day; 40,000/property/hour; **14,000/project-per-property/hour** (the tightest hourly ceiling for one property under one project); 10 concurrent requests/property; 10 server-errors/project-per-property/hour. (360 = 10x each.) Any empty bucket -> `429 RESOURCE_EXHAUSTED`. Daily buckets reset at **midnight America/Los_Angeles**. A typical request costs ~10 tokens; cost is non-linear (more dimensions, longer ranges, high-cardinality dims cost more; 5 two-day requests can cost ~3x one ten-day request — so prefer one request spanning the trailing window over N single-day requests). Set `returnPropertyQuota: true` to read `propertyQuota` (`tokensPerDay`, `tokensPerHour`, `tokensPerProjectPerHour`, `concurrentRequests`, `serverErrorsPerProjectPerHour`, `potentiallyThresholdedRequestsPerHour`) and back off. A fan-out cron can trip the 10-concurrent cap even with daily tokens remaining — serialize/limit concurrency per property.

**GA4 freshness.** Processing takes 24-48h and values mutate during that window; daily-table latency is ~18h for a Standard "Normal" property. So **today and yesterday are incomplete and will change on re-query.**

**GSC.** Per-site 1,200 QPM, per-user 1,200 QPM, per-project 40,000 QPM / 30,000,000 QPD, plus short-/long-term load quotas. Export cap 50,000 rows/day/site/search-type. Dates are PT.

**GSC freshness.** Per the findings, data is typically available 2-3 days behind; with `dataState:'final'` the most recent days are absent/shifting. (The specific "2-3 day lag, anchor endDate to today_PT-3" guidance was NOT confirmed against the cited official doc — see Open Questions.) Practically: do not treat recent empty GSC days as "no traffic," and widen the GSC trailing window relative to GA4.

**"Yesterday incomplete" + trailing-window idempotency (the load-bearing implication).** Because both APIs reprocess recent dates, a daily run must **re-pull a trailing window and UPSERT**, not insert-once. The existing `upsertSnapshots` uses `onConflict 'shop_id,source,date,period'` — the natural idempotency key. Re-running the trailing window only stays correct because the store upserts on `(shop_id, source, date, period)`; an append-only insert would duplicate or freeze stale partial numbers. Recommended windows: GA4 re-pull last ~3 days (`startDate:'3daysAgo'`, `endDate:'yesterday'`); GSC re-pull a **wider** window (e.g. last ~5-7 days, or anchor `endDate` deeper) to backfill its longer lag. Do **not** naively copy `ADS_RESYNC_DAYS=7` for GSC without accounting for the longer lag. Mixing `dataState:'all'` (fresh, revisable) and `'final'` across runs without an upsert-on-final strategy produces inconsistent stored data; define a finalization boundary (freeze GA4 rows older than ~3 days; freeze GSC rows where `dataState='final'`) to stop re-pulling indefinitely.

## Reuse Map

**Reuse VERBATIM (analytics core, no changes):**
- `src/lib/analytics/snapshots.ts` — `upsertSnapshots(service, rows)` (onConflict `shop_id,source,date,period`), `getSnapshots`, `getSnapshotsForShops`. Source-agnostic; Phase 11 passes `source:'ga4'` / `source:'gsc'`.
- `src/lib/analytics/aggregate.ts` — `aggregateByDate`, `latestSnapshot`, `toSeries`, `trailingWindow`, `latestSyncedAt`, formatters.
- `src/lib/analytics/types.ts` — `AnalyticsSnapshot`, `AnalyticsSnapshotInsert`, `AnalyticsSyncRun`. The `AnalyticsSource` union **already includes** `'ga4'` and `'gsc'` (types.ts:5).
- `src/lib/google-ads/crypto.ts` — data-agnostic despite the name. `encryptRefreshToken` / `decryptRefreshToken`, env `ADS_ENCRYPTION_KEY` (base64 -> 32 bytes) + `_V2.._V10` rotation.
- `@/lib/resilience` — `CircuitBreaker`, `withRetry`, `RetryOptions`. Wrap every upstream Google call.
- `sync.ts` `targetDates(today, resyncDays)` — pure, reuse verbatim (widen `resyncDays` for GSC).

**Reuse the PATTERN, parameterize:**
- `src/lib/google-ads/oauth.ts` — the full state machine. Parameterize `SCOPE` (oauth.ts:6, hardcoded `adwords`) and the redirect URI (per-source arg or per-source env).
- `callback/route.ts` + `select/route.ts` — the peek -> auto-link-vs-stash-picker -> offered-set anti-tamper -> `postMessage` success scaffold. The enumeration call inside is new.
- `sync.ts` orchestrator structure — `SyncResult={synced,skipped,failed}`, per-shop try/catch containment, `openLedger`/`closeLedger` against `analytics_sync_runs` with `source` set per vertical, `markAccountAuthFailed`. Write `syncGa4Snapshots` / `syncGscSnapshots`.
- `src/app/dashboard/analytics/page.tsx` — additive panels in the same page. The paid `<section>` (page.tsx:134-163) is the template; copy twice with `GA4_SOURCE='ga4'` / `GSC_SOURCE='gsc'`. Reuse `LineChartCard`/`BarChartCard`/`Sparkline` and Card primitives.
- `src/app/api/cron/google-ads-sync/route.ts` — CRON_SECRET Bearer + `timingSafeEqual` gate before client construction; GET (Vercel cron) + POST (manual); `googleCredsPresent()` -> 503 when creds absent. Copy to `/api/cron/ga4-sync` + `/api/cron/gsc-sync`, swap the orchestrator. Add two staggered `vercel.json` cron entries (semrush is `0 6`, google-ads `15 6`; use e.g. `30 6`, `45 6`).
- `authorize/route.ts` entry pattern — auth + owner-only + tier gate -> `buildAuthorizeUrl`. **Decide tier-gating:** Ads is gated (`assertAdsTier`), but the analytics surface itself is intentionally **ungated** (page.tsx:27-32) — most likely GA4/GSC link should follow the analytics surface's ungated posture; confirm in plan.

**NEW per-source code (no reuse — different Google APIs):** GA4 `client.ts` (`AnalyticsAdminServiceClient` + `BetaAnalyticsDataClient` construction from decrypted token), `enumerate.ts` (`accountSummaries.list`), `metrics.ts` (`runReport`). GSC `client.ts` (`google.searchconsole`), `enumerate.ts` (`sites.list`), `metrics.ts` (`searchanalytics.query`). The Ads `/^\d{10}$/` customer-id validation must **NOT** be copied — GA4 ids are `properties/123456789`, GSC keys are `sc-domain:...` or `https://.../`; format pinning is source-specific.

**Does `analytics_snapshots`/`sync_runs` source CHECK already admit ga4/gsc? YES.** `analytics_snapshots` source CHECK at `20260604000000_analytics_snapshots.sql:38` is `source in ('semrush','google_ads','ga4','gsc')`; `analytics_sync_runs` at `20260605000000_analytics_sync_runs.sql:16` likewise. Do **NOT** add a new ALTER re-adding them — it risks redundant constraint churn on prod. **Zero migration on the snapshot/ledger layer.**

**Smallest NEW schema set:**
1. **One generic accounts table** `public.google_oauth_accounts` for the two new sources only. Columns: `id uuid pk`, `shop_id uuid -> shops`, `source text check (source in ('ga4','gsc'))`, `external_account_id text` (`properties/123` or `sc-domain:x.com`/`https://...`), `display_name text`, `encrypted_refresh_token bytea`, `key_version integer`, `scope text`, `status text check (status in ('linked','revoked','error'))`, `linked_by uuid`, `linked_at`, `revoked_at`, `last_error`, `created_at`, `unique (shop_id, source, external_account_id)`. RLS: membership SELECT (`shop_id in (select public.user_shop_ids())`), writes service-role — mirror the `google_ads_accounts` policy exactly. **Generic over mirror tables** because the codebase's own strongest precedent (`analytics_snapshots`) is deliberately source-agnostic, GA4+GSC share one consent/refresh token, and a shared table saves RLS/types/migration boilerplate at zero logic cost. The ads-only `login_customer_id` (MCC) is correctly absent.
2. **One generic transient state table** `public.google_oauth_pending_states` mirroring `google_ads_oauth_states` (`state_token pk`, `user_id`, `shop_id`, `nonce`, `expires_at`, `consumed_at`) **plus** a `source` column and the pending carry columns (`pending_encrypted_token text`, `pending_key_version integer`, `pending_scope text`, `pending_accounts jsonb`), **dropping** the ads-only `pending_login_customer_id`. RLS enabled, **no policy** (default-deny / service-role only), mirroring `google_ads_oauth_states`.
3. **No migration for metrics types** — `analytics_snapshots.metrics` is open JSONB. Add TS types additively to `analytics/types.ts`: `Ga4Metrics = { sessions; total_users; active_users; engaged_sessions; engagement_rate; key_events; ... }` and `GscMetrics = { clicks; impressions; ctr; position }`.

**Do NOT touch the shipped `google_ads_accounts` / `google_ads_oauth_states`** — they are in the prod gate-batch pipeline; refactoring them is prod-migration risk for no functional gain (the same reasoning 10-01 used to reject pgsodium).

**Refresh-token crypto: reuse AES-GCM app-key, NOT pgsodium — ROADMAP reconciliation.** PROJECT.md/ROADMAP states "pgsodium encryption at rest for OAuth refresh tokens." This is a **recorded, operator-approved deviation** (20260608000000_google_ads_tables.sql:11-17): the inherited code is built + unit-tested with versioned app-key AES-256-GCM (genuine encryption-at-rest), and the migration comment explicitly binds Phase 11: "Phase 11 (GA4+GSC) inherits this choice for refresh-token consistency." **Reuse `crypto.ts` as-is, share `ADS_ENCRYPTION_KEY` across all Google sources, do not re-key.** Optionally add a neutral `GOOGLE_OAUTH_ENCRYPTION_KEY` alias with `ADS_*` fallback. **bytea round-trip trap (inherited 10-01 finding):** refresh tokens must be written as Postgres `\x<hex>` TEXT form, not a raw Buffer (PostgREST JSON-serializes a Buffer wrong); the read helper must decode `\x`-prefixed strings back to Buffer before decrypt. Replicate this exact hex round-trip.

**Call-log decision:** `ads_api_call_log` has an ads-coupled method CHECK (`GET,MUTATE,SEARCH,REVOKE`) read by `withAdsRateLimit`. Do **NOT** reuse it. Recommend **no per-call ledger** for Phase 11 (GA4/GSC quotas are generous per-property/site, unlike the ads developer-token tier); rely on `analytics_sync_runs` for run-level audit.

**Aggregate (MSO "all shops") view must drop ratio metrics.** `aggregateByDate` sums numeric JSONB keys per date; summing `ctr`, `position`, or `engagement_rate` produces a lie (same rule that already drops `authority_score` and `cpl`). GA4/GSC aggregate KPI sets keep only summable counts (clicks, impressions, sessions, users, key_events).

## Open Questions / Risks for /paul:plan

1. **UNVERIFIED — `authClient` injection has no official-doc support.** The structural chain (gax `ClientOptions extends GoogleAuthOptions`; `GoogleAuthOptions.authClient` accepts an `OAuth2Client`; gax `GrpcClient` short-circuits to it) is confirmed in **source** (gax `grpc.ts`, google-auth-library `googleauth.ts`, `oauth2client.ts`) and in the published `google-auth-library@10.7.0` jsdocs, but the **official rendered reference (cloud.google.com) tops out at v9.0.0 and does not list `authClient` at all**. The technique is real but officially undocumented. **Action: run a live smoke test of `new BetaAnalyticsDataClient({ authClient: oauth2Client }).runReport(...)` against a real GA4 property early in the phase**, before building both clients on the assumption.

2. **UNVERIFIED — GSC `dataState:'hourly_all'` "only valid with hour dimension."** The official query reference says `hourly_all` *should be used when grouping by the HOUR dimension* (a recommendation), not that it is the *only* valid context. Treat as guidance, not a hard constraint.

3. **UNVERIFIED — GSC "2-3 day lag, anchor endDate to today_PT minus 3."** The cited official query reference says nothing about a 2-3 day lag or an endDate-anchoring rule; this is operational advice not grounded in the doc. The PT timezone for dates IS confirmed. **Action: empirically probe the latest available date** (query `dimensions:['date']` over the last ~10 days, read the max returned date) per site at ingest time rather than hardcoding a fixed offset.

4. **UNVERIFIED — Node client auto-URL-encodes `siteUrl`.** The site-URL formats are confirmed, but the claim that the Node client URL-encodes `siteUrl` for you appears only in non-official GitHub issues and was historically version-dependent (older versions did NOT auto-encode). **Action: verify against the installed `googleapis@173` behavior** with a real `sc-domain:` and `https://.../` site; be prepared to `encodeURIComponent` manually if a query 404s.

5. **Risk — consent-screen verification lead time.** Sensitive-scope verification (brand verification, consent-screen review, per-scope justification) is required before production use without the unverified-app warning, and the 7-day Testing-mode refresh-token death will silently break scheduled ingest. Plan the verification + publish-to-Production timeline before relying on the cron.

6. **Decision needed — tier-gating GA4/GSC link.** The analytics surface is ungated; Ads link is tier-gated. Confirm whether GA4/GSC linking should be ungated (likely) or gated.

7. **Risk — Admin API enablement.** GA4 Admin API must be enabled in the Cloud project separately from the Data API, or enumeration 403s with SERVICE_DISABLED. Verify both APIs are enabled in the OAuth client's project during the creds gate.

8. **Deploy discipline.** Phase 10 is code-complete but PROD-PENDING (not live; cron 503 until creds gate). Phase 11 inherits the gate-batch deploy discipline (PROTOCOL-migration-safety.md, advisor baseline+diff). Do not describe either vertical as "shipped to prod."

## Citations

GA4 Data API:
- https://developers.google.com/analytics/devguides/reporting/data/v1/rest/v1beta/properties/runReport
- https://developers.google.com/analytics/devguides/reporting/data/v1/api-schema
- https://developers.google.com/analytics/devguides/reporting/data/v1/changelog
- https://developers.google.com/analytics/devguides/reporting/data/v1/rest/v1beta/DateRange
- https://developers.google.com/analytics/devguides/reporting/data/v1/rest/v1beta/DimensionValue
- https://developers.google.com/analytics/devguides/reporting/data/v1/rest/v1beta/Row
- https://developers.google.com/analytics/devguides/reporting/data/v1/quotas
- https://developers.google.com/analytics/devguides/reporting/data/v1/rest/v1beta/PropertyQuota
- https://developers.google.com/analytics/devguides/reporting/data/v1/rest/v1beta/ResponseMetaData
- https://developers.google.com/analytics/devguides/reporting/data/v1/reporting-data-expectations

GA4 Admin API:
- https://developers.google.com/analytics/devguides/config/admin/v1/rest/v1beta/accountSummaries/list
- https://developers.google.com/analytics/devguides/config/admin/v1

Google Search Console API:
- https://developers.google.com/webmaster-tools/v1/searchanalytics/query
- https://developers.google.com/webmaster-tools/v1/sites/list
- https://developers.google.com/webmaster-tools/v1/sites/get
- https://developers.google.com/webmaster-tools/v1/how-tos/all-your-data
- https://developers.google.com/webmaster-tools/limits
- https://developers.google.com/search/blog/2025/04/san-hourly-data
- https://developers.google.com/search/blog/2022/10/performance-data-deep-dive

OAuth 2.0:
- https://developers.google.com/identity/protocols/oauth2/web-server
- https://developers.google.com/identity/protocols/oauth2/scopes
- https://developers.google.com/identity/protocols/oauth2/production-readiness/sensitive-scope-verification
- https://support.google.com/cloud/answer/15549945

Node libraries:
- https://www.npmjs.com/package/@google-analytics/data
- https://www.npmjs.com/package/@google-analytics/admin
- https://www.npmjs.com/package/googleapis
- https://www.npmjs.com/package/google-auth-library
- https://googleapis.dev/nodejs/googleapis/latest/searchconsole/
- https://github.com/googleapis/gax-nodejs/blob/main/gax/src/grpc.ts
- https://github.com/googleapis/google-auth-library-nodejs/blob/main/src/auth/googleauth.ts
- https://nextjs.org/docs/app/api-reference/config/next-config-js/serverExternalPackages

Codebase (reuse map):
- src/lib/analytics/types.ts:5, src/lib/analytics/snapshots.ts:19, src/lib/analytics/aggregate.ts
- src/lib/google-ads/oauth.ts:6, src/lib/google-ads/crypto.ts, src/lib/google-ads/sync.ts:64
- supabase/migrations/20260604000000_analytics_snapshots.sql:38, 20260605000000_analytics_sync_runs.sql:16
- supabase/migrations/20260608000000_google_ads_tables.sql:11-17,33-50, 20260609000000_google_ads_oauth_pending.sql
- src/app/dashboard/analytics/page.tsx:27-32,134-163, src/app/api/cron/google-ads-sync/route.ts:14-22, vercel.json
