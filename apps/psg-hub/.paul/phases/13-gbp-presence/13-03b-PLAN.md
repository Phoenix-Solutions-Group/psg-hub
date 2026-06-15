---
phase: 13-gbp-presence
plan: 03b
type: execute
wave: 2
depends_on: ["13-03a"]   # genuine: needs the 'gbp_presence' source CHECK widen + GbpPresenceMetrics type + the getLinkedAccount externalParentId read-side fix + the ReportData.gbpPresence? data block 13-03a landed
files_modified:
  - src/lib/google-oauth/gbp-presence.ts                                 # NEW (Business Information v1 locations.get -> presence state, `auth:` idiom)
  - src/lib/google-oauth/__tests__/gbp-presence.test.ts                  # NEW unit tests
  - src/lib/google-oauth/gbp-reviews.ts                                  # NEW (v4 raw-HTTP reviews aggregate via buildOAuth2Client.request)
  - src/lib/google-oauth/__tests__/gbp-reviews.test.ts                   # NEW unit tests
  - src/lib/google-oauth/gbp-presence-sync.ts                            # NEW (monthly orchestrator, mirror ga4-dims-sync)
  - src/lib/google-oauth/__tests__/gbp-presence-sync.test.ts             # NEW unit tests
  - src/app/api/cron/gbp-presence-sync/route.ts                          # NEW (CRON_SECRET-gated, runtime=nodejs, monthly)
  - src/app/api/cron/gbp-presence-sync/__tests__/route.test.ts           # NEW unit tests
  - vercel.json                                                          # EDIT (+gbp-presence-sync cron 0 4 1 * *, the 9th; slotted after perf-sync, before monthly-report)
  - src/app/reports/[slug]/print/route.ts                                # EDIT (bind readMonthlyGbpPresence in defaultLoader)
  - src/lib/report/render.ts                                             # EDIT (+renderGbpPresenceBlock, slotted after performanceBlock)
  - src/lib/report/__tests__/render.test.ts                              # EDIT (+gbpPresence render unit test)
  - src/lib/analytics/snapshots.ts                                       # EDIT (+getLatestMonthlySnapshot reader for the dashboard current-state card)
  - src/lib/analytics/__tests__/snapshots.test.ts                        # EDIT (+getLatestMonthlySnapshot test)
  - src/app/dashboard/analytics/page.tsx                                 # EDIT (+presence current-state header on the existing 13-02b "Local presence" section, per-shop scope only)
  - e2e/global.setup.ts                                                  # EDIT (+seedGbpPresence monthly row)
  - e2e/analytics-gbp.spec.ts                                            # EDIT (+presence header: star rating + open status assertions)
autonomous: true   # build is LOCAL + test-gated behind deps seams. The FIRST live Business-Information locations.get + v4 reviews aggregate call (real Wallace location under business.manage) is the Phase-13 gate batch (13-04), behind Google Gate A + Gate B.
---

<objective>
## Goal
Build the monthly GBP presence + star-rating INGEST vertical on the 13-03a foundation: a Business
Information v1 `locations.get` presence-state fetch + a legacy v4 raw-HTTP reviews-aggregate fetch, a
monthly `syncGbpPresence` orchestrator (source='gbp_presence', period='monthly', writes the row even
when the rating call fails) + a CRON_SECRET-gated monthly cron, then surface the result BOTH places —
render the `gbpPresence` block in the report PDF (wire the reader + a render block) AND a current-state
presence header (star rating + open status + completeness) on the dashboard "Local presence" section.

## Purpose
13-03a landed the schema, the `GbpPresenceMetrics` type, the `getLinkedAccount` `externalParentId`
read-side fix, and the `ReportData.gbpPresence?` DATA block — but writes NO data, binds NO reader into
the print route, and renders NOTHING. This plan is the ingest + the two surfaces that make the presence
snapshot real. It is the exact mirror of the shipped 12-05 monthly verticals (ga4-dims-sync / perf-sync:
client -> monthly orchestrator -> monthly cron -> report block) plus the 13-02b dashboard-surface mirror,
with one load-bearing difference the research flags: the star rating is a SECOND, legacy-v4 RAW-HTTP call
(no typed client in googleapis@173), defensively null on any failure or a non-VoM location, merged onto
the SAME `gbp_presence` row.

## Output
- NEW `gbp-presence.ts` (`fetchGbpPresence` -> Business Information v1 `locations.get`, `auth:` idiom) +
  `gbp-reviews.ts` (`fetchGbpReviewsAggregate` -> v4 raw-HTTP via `buildOAuth2Client(...).request`).
- NEW `gbp-presence-sync.ts` (`syncGbpPresence`, source='gbp_presence', period='monthly') +
  `/api/cron/gbp-presence-sync` + vercel.json `0 4 1 * *` (9th cron).
- EDIT print route (bind `readMonthlyGbpPresence`) + render.ts (`renderGbpPresenceBlock`) so the PDF shows
  the presence block; EDIT page.tsx (presence current-state header on the existing "Local presence"
  section) + snapshots.ts (`getLatestMonthlySnapshot`) for the dashboard.
- Unit tests (presence map + reviews aggregate + orchestrator + cron + render + reader) + an e2e presence
  assertion. At UNIFY: 13-03b-SUMMARY. LIVE activation (real `locations.get` + v4 aggregate vs Wallace +
  deploy) is the Phase-13 gate batch (13-04).
</objective>

<context>
## Project Context
@.paul/PROJECT.md
@.paul/ROADMAP.md
@.paul/STATE.md

## Phase research (research-first gate — REQUIRED, satisfied)
@.paul/phases/13-gbp-presence/13-03-RESEARCH.md
# Authoritative for the v4 reviews aggregate (the focused ultracode Workflow wf_0906aaba-c3b output):
# top-level averageRating/totalReviewCount on ONE pageSize:1 call (NOT paginate-and-average); the
# buildOAuth2Client(...).request raw-HTTP seam (NO typed v4 client); the slash-join parent (no
# re-wrap); defensive null on non-2xx AND 200-with-absent + non-VoM; write the row even on rating fail.
@.paul/phases/13-gbp-presence/13-RESEARCH.md
# Authoritative for the PRESENCE state (§Presence + §Data-model): Business Information v1
# accounts.locations / locations.get, readMask REQUIRED (omit -> 400), the gbp_presence jsonb shape
# (open_status from openInfo.status, primary_category + categories, has_hours, website_uri,
# has_description, phone_present, completeness_score?), VoM from metadata.hasVoiceOfMerchant, and the
# monthly cron cadence (0 4 1, AFTER perf 03:00 + ga4-dims 02:00, BEFORE the 05:00 report).

## Prior work consumed (the foundation 13-03b builds on)
@.paul/phases/13-gbp-presence/13-03a-SUMMARY.md   # GbpPresenceMetrics type; SnapshotSource += 'gbp_presence' (NOT the union); getLinkedAccount returns externalParentId; ReportData.gbpPresence? + buildGbpPresence already wired (DATA only)
@.paul/phases/13-gbp-presence/13-02b-SUMMARY.md   # the daily gbp ingest + the "Local presence" dashboard <section> this plan EXTENDS (do not duplicate it)

## Patterns to mirror (MONTHLY orchestrator, raw-HTTP seam, report render, dashboard panel)
@src/lib/google-oauth/ga4-dims-sync.ts            # the MONTHLY orchestrator to mirror (source/period/rowDate=${month}-01, reportMonth/today seam, openLedger/closeLedger, dedupeByShop, contained per-shop catch + markAccountError) — NOT the daily gsc-sync
@src/app/api/cron/ga4-dims-sync/route.ts          # the MONTHLY cron to mirror (CRON_SECRET timingSafeEqual, runtime=nodejs, googleCredsPresent -> 503, inject month=priorMonth(now), GET+POST)
@src/lib/google-oauth/client.ts                   # buildOAuth2Client (the real google-auth-library OAuth2Client with `.request` — the raw-HTTP seam for v4), googleOAuthClientEnv, mapGoogleApiError, GoogleApiError
@src/lib/google-oauth/gbp-enumerate.ts            # the EXACT Business Information v1 `auth:` construction (new google.auth.OAuth2 + google.mybusinessbusinessinformation({version:'v1',auth}) + the REQUIRED readMask) — mirror for the presence-state fetch
@src/lib/google-oauth/accounts.ts                 # getLinkedAccount(shop,'gbp') -> {refreshToken, externalAccountId=bare 'locations/{id}', externalParentId='accounts/{id}'|null, accountId}; markAccountError
@src/lib/analytics/types.ts                       # GbpPresenceMetrics (the snake_case target shape, 13-03a) — every field the mapper writes
@src/lib/analytics/snapshots.ts                   # upsertSnapshots (onConflict shop_id,source,date,period), getMonthlySnapshot (the report read), where getLatestMonthlySnapshot is ADDED for the dashboard
@src/lib/report/report-data.ts                    # buildGbpPresence + MonthlyGbpPresenceReader + AssembleDeps.readMonthlyGbpPresence? already wired (13-03a) — this plan only BINDS the reader + RENDERS
@src/app/reports/[slug]/print/route.ts            # defaultLoader binds readMonthlyDimensions/readMonthlyPerformance — add readMonthlyGbpPresence the SAME way
@src/lib/report/render.ts                          # renderPerformanceBlock (l.474) is the mirror for renderGbpPresenceBlock; renderReportHtml composition (l.594-669) is where it slots after performanceBlock
@src/app/dashboard/analytics/page.tsx             # the 13-02b "Local presence" <section> (GBP_SOURCE l.112) to EXTEND with the presence current-state header
@e2e/analytics-gbp.spec.ts                         # the gbp panel spec (heading "Local presence") to extend with the presence-header assertion
@e2e/global.setup.ts                               # seedGbpSnapshots (l.223, daily) — mirror for a monthly gbp_presence seed
@vercel.json                                       # the cron family (8 crons; add the 9th)
</context>

<skills>
## Required Skills (research-first gate)

| Skill | Priority | When to Invoke | Loaded? |
|-------|----------|----------------|---------|
| Research-first / per-plan research check | required | Before authoring (this plan) | ✓ — `13-03-RESEARCH.md` (v4 reviews aggregate, build-ready) + `13-RESEARCH.md` §Presence/§Data-model (presence state + cron cadence) cover this plan |
| Context7 / `node` introspection (googleapis `mybusinessbusinessinformation` v1) | required | At APPLY, before writing gbp-presence.ts | ○ — confirm in the INSTALLED googleapis@173 that `google.mybusinessbusinessinformation({version:'v1',auth}).locations.get` (single-location read) exists, its `{name, readMask}` PARAM shape, and the exact response field paths the mapper reads (`openInfo.status`, `categories.primaryCategory` / `categories.additionalCategories`, `regularHours`, `profile.description`, `phoneNumbers.primaryPhone`, `websiteUri`, `metadata.hasVoiceOfMerchant`). The readMask MUST list every field the mapper touches or it returns absent. (Same real-contract gate 13-01/13-02b used.) |

**BLOCKING:** Research gate satisfied. The ONE APPLY-time introspection item is the Business Information
`locations.get` method + readMask + field paths (above). The v4 reviews aggregate is RAW-HTTP (no typed
client exists in googleapis@173 — confirmed 13-RESEARCH §Node library gap) and research-settled, so it
needs NO introspection.
</skills>

<acceptance_criteria>

## AC-1: gbp-presence — Business Information v1 `locations.get` presence state, `auth:` idiom, no new dep
```gherkin
Given a shop with a status='linked' source='gbp' google_oauth_accounts row (13-01)
When fetchGbpPresence(shopId, deps?) runs
Then it reads getLinkedAccount(shopId,'gbp') (deps.getLinkedAccount seam), null -> throw
     GoogleApiError('auth_failed'); else builds `new google.auth.OAuth2(...)` + setCredentials and calls
     google.mybusinessbusinessinformation({version:'v1', auth}).locations.get({ name: account
     .externalAccountId /* bare 'locations/{id}' */, readMask: <every mapped field> }) — the `auth:`
     idiom (mirror gbp-enumerate), NOT the gax `authClient:`
And it maps the response to the GbpPresenceMetrics PRESENCE fields: open_status = openInfo.status ?? ''
     (OPEN|CLOSED_PERMANENTLY|CLOSED_TEMPORARILY); primary_category = categories.primaryCategory
     .displayName ?? null; categories = additionalCategories displayNames (or []); has_hours =
     regularHours has >=1 period; website_uri = websiteUri ?? null; has_description =
     (profile.description ?? '').trim().length > 0; phone_present = a non-empty phoneNumbers.primaryPhone;
     completeness_score = round( (count of the 7 present signals [open_status==='OPEN', primary_category!=null,
     categories.length>0, has_hours, website_uri!=null, has_description, phone_present]) / 7 * 100 )
And the rating pair is NOT set here (average_rating/total_review_count come from gbp-reviews, merged by the
     orchestrator); a 404 maps to a "not accessible" error (mapGoogleApiError); NO new runtime dependency;
     the file is server-only; unit tests cover the field map, the completeness formula, the missing-fields
     defaults, the readMask param shape, and the 404 path.
```

## AC-2: gbp-reviews — v4 raw-HTTP aggregate via `buildOAuth2Client.request`, slash-join parent, defensive null
```gherkin
Given a linked gbp account {refreshToken, externalAccountId='locations/{lid}', externalParentId='accounts/{aid}'|null}
When fetchGbpReviewsAggregate(shopId, deps?) runs (deps.getLinkedAccount + deps.request seams)
Then it builds buildOAuth2Client({clientId,clientSecret,refreshToken}) and issues ONE GET to
     `https://mybusiness.googleapis.com/v4/${externalParentId}/${externalAccountId}/reviews` with
     params { pageSize: 1 } — a PLAIN slash-join (both halves already carry their accounts//locations/
     prefixes; NEVER re-wrap as accounts/${x}/locations/${y})
And it returns { average_rating: res.data.averageRating ?? null, total_review_count:
     res.data.totalReviewCount ?? null } (snake_case rename from v4 camelCase; ?? null for BOTH, never ?? 0)
And it is DEFENSIVE: externalParentId === null -> { null, null } (cannot build the v4 parent — an old row
     predating 13-01 parent-capture); a 200 with averageRating ABSENT -> { null, null }; a non-2xx /
     thrown error -> rethrow mapGoogleApiError(err) so the ORCHESTRATOR (AC-3) swallows it to { null, null }
     (this fetch never trips a CircuitBreaker on a non-VoM location)
And NO typed v4 client is used (none exists in googleapis@173); unit tests cover top-level
     averageRating/totalReviewCount -> snake_case, absent -> null pair, null externalParentId -> null pair,
     the pageSize:1 param, the slash-join parent (no double-prefix), and a thrown non-2xx mapped+rethrown.
```

## AC-3: gbp-presence-sync — monthly orchestrator, source='gbp_presence', rating-failure tolerant
```gherkin
Given multiple shops with linked gbp accounts
When syncGbpPresence(service, options?) runs (options.month overrides options.today; period month -> rowDate ${month}-01)
Then it opens an analytics_sync_runs ledger row source='gbp_presence', selects google_oauth_accounts where
     source='gbp' status='linked' ordered by linked_at desc, dedupeByShop (deterministic one-per-shop), and
     per shop: fetchGbpPresence(shop) for the state, then fetchGbpReviewsAggregate(shop) wrapped in its OWN
     try/catch that on ANY failure yields { average_rating:null, total_review_count:null } and LOGS — so a
     rating failure NEVER drops the presence row and NEVER flips the account
And it pushes EXACTLY ONE row/shop { shop_id, source:'gbp_presence', period:'monthly', date:rowDate,
     metrics: { ...presence, average_rating, total_review_count } } via the idempotent upsertSnapshots
And a single shop's PRESENCE-STATE failure is CONTAINED (no bare catch): an auth_failed flips that account
     via markAccountError and the batch continues (NO row for that shop); a non-auth presence error does NOT
     flip status; the ledger closes success with rows_written, or closes error + rethrows on a top-level
     accounts-read failure
And dedupeByShop + the ledger helpers are CLONED from ga4-dims-sync (ga4-dims-sync/perf-sync left
     untouched); unit tests cover: one monthly row/shop source='gbp_presence' at rowDate; reviews-failure ->
     row STILL written with null rating + account NOT flipped; presence auth_failed -> markAccountError +
     contained + no row; non-auth presence error not flipping status; top-level read error -> ledger error +
     rethrow; double-link dedupe; ledger-open failure non-blocking.
```

## AC-4: cron route + vercel.json — CRON_SECRET-gated, nodejs, monthly 0 4 1
```gherkin
Given Vercel Cron fires GET with Authorization: Bearer ${CRON_SECRET}
When /api/cron/gbp-presence-sync is hit
Then the timingSafeEqual gate runs BEFORE any client construction or shop read (unauthorized = 401, spends
     zero Google units); a missing/!googleCredsPresent state returns 503 gbp_not_configured; an authorized
     call injects month = priorMonth(new Date()...slice(0,7)) and runs syncGbpPresence(service,{month}),
     returning { month, ...result }; GET and POST both supported; `export const runtime = "nodejs"` declared
And vercel.json gains ONE cron { path:"/api/cron/gbp-presence-sync", schedule:"0 4 1 * *" } placed AFTER
     perf-sync (0 3 1) and BEFORE monthly-report (0 5 1) — so the report reads fresh presence rows — leaving
     the existing 8 crons byte-unchanged (9 total)
And route unit tests cover 401 (no/bad/empty secret), 503 (creds absent), and 200 (GET + POST authorized,
     month injected).
```

## AC-5: report render — bind the reader + a renderGbpPresenceBlock in the PDF
```gherkin
Given the print route's defaultLoader binds readMonthlyDimensions + readMonthlyPerformance (12-05c)
When 13-03b wires presence into the PDF
Then defaultLoader adds readMonthlyGbpPresence = ({shopId,month}) => getMonthlySnapshot(service,{shopId,
     source:'gbp_presence',month}) and passes it into assembleReportData (the SAME idiom as the other two;
     report-data.ts already builds ReportData.gbpPresence from it — 13-03a)
And render.ts gains renderGbpPresenceBlock(presence: GbpPresenceReport) (mirror renderPerformanceBlock): a
     "Local presence" <section class="panel"> with a star-rating KPI (averageRating to 1 decimal + "(N
     reviews)", "n/a" when averageRating is null) + open-status + primary-category + a completeness/
     listing-signals readout; it is slotted into renderReportHtml AFTER performanceBlock and rendered ONLY
     when reportData.gbpPresence is present (mirror the `reportData.performance ? ... : ""` guard)
And every visible numeral traces to reportData (the render stays pure/deterministic); a render unit test
     proves: gbpPresence present -> the "Local presence" panel with the rating + listing state; null rating
     -> "n/a" (no "0.0 stars"); gbpPresence absent -> the block is omitted entirely.
```

## AC-6: dashboard presence header — current-state on the "Local presence" section, per-shop scope, e2e
```gherkin
Given the 13-02b "Local presence" <section> renders the DAILY gbp insight panel
When the presence current-state header is added
Then snapshots.ts gains getLatestMonthlySnapshot(client,{shopId,source}) (period='monthly', order date
     desc, limit 1, maybeSingle — robust to the cron-timing/month-boundary blank a fixed-month read would
     show) + a unit test; page.tsx reads the latest source='gbp_presence' row for the in-scope shop and
     renders a current-state header at the TOP of the "Local presence" section: a star rating (averageRating
     + total_review_count, "Not yet rated" when null), open status, and completeness/listing signals
And it renders ONLY in per-shop scope (NOT scopeAll) — a cross-shop average rating is a lie, the same
     principle that aggregate-excludes ga4 engagement_rate / gsc ctr+position; in the MSO aggregate the
     presence header is omitted (the daily gbp panel still aggregates as before, 13-02b unchanged)
And the e2e (extend analytics-gbp.spec, seed a monthly gbp_presence row in global.setup) proves the OWNER
     per-shop view shows the star rating + open status in the "Local presence" section, with axe AA 0
     serious/critical; the existing daily-panel + organic/paid/GA4/GSC assertions stay regression-green.
```

## AC-7: Boundaries — ingest + two surfaces only; no migration, no per-review work, zero prod
```gherkin
Given 13-03a already widened the CHECK (+'gbp_presence'), typed GbpPresenceMetrics, fixed the
     getLinkedAccount externalParentId read, and wired the ReportData.gbpPresence? data block
When 13-03b completes
Then NO new migration (the CHECK already admits 'gbp_presence'), NO new dependency (googleapis@173 +
     google-auth-library are deps), ZERO prod contact (both fetchers behind deps seams; no prod
     migration/secret/deploy/live Google call)
And NO per-review bodies / replies / sentiment / pagination / reviewId dedupe / Notifications-Pub/Sub
     (those are Phase 14); the daily gbp ingest + the daily "Local presence" panel internals (13-02b), the
     ga4/gsc/perf/dims ingest + crons, crypto/OAuth/the gbp link routes (13-01), and the report
     narrative/eval are untouched (reuse getLinkedAccount/markAccountError/upsertSnapshots/getMonthlySnapshot/
     buildOAuth2Client; CLONE dedupeByShop/ledger from ga4-dims-sync)
And the live calls + deploy are recorded as the 13-04 gate-batch deferral, alongside the research deferrals:
     (a) pageSize:1 returns the aggregate; (b) the non-VoM/non-verified reviews.list response shape; (c)
     CONFIRM/BACKFILL external_parent_id on the Wallace pilot row (if it predates 13-01 parent-capture the
     prod rating is silently always-null and local tests cannot catch it — 13-03-RESEARCH open-item 183).
```

</acceptance_criteria>

<tasks>

<task type="auto">
  <name>Task 1: gbp-presence (Business Information locations.get) + gbp-reviews (v4 raw-HTTP aggregate) + unit tests</name>
  <files>src/lib/google-oauth/gbp-presence.ts, src/lib/google-oauth/__tests__/gbp-presence.test.ts, src/lib/google-oauth/gbp-reviews.ts, src/lib/google-oauth/__tests__/gbp-reviews.test.ts</files>
  <action>
    Context7/introspect FIRST (the required-skill gate): confirm in googleapis@173 that
    `google.mybusinessbusinessinformation({version:'v1',auth}).locations.get` exists, its `{name, readMask}`
    param shape, and the field paths the mapper reads. The readMask MUST enumerate every mapped field.

    gbp-presence.ts (mirror gbp-enumerate's `auth:` construction; server-only):
      - `fetchGbpPresence(shopId, deps?)`: `deps.getLinkedAccount ?? getLinkedAccount`; read (shop,'gbp');
        null -> throw GoogleApiError('auth_failed','No linked Google Business Profile'); else
        `googleOAuthClientEnv()` -> `new google.auth.OAuth2(clientId,clientSecret,redirectUri)` +
        setCredentials({refresh_token}) -> `google.mybusinessbusinessinformation({version:'v1',auth})
        .locations.get({ name: account.externalAccountId, readMask: GBP_PRESENCE_READ_MASK })`. The `auth:`
        idiom (NOT gax `authClient:`; buildOAuth2Client is the v4 path, used only by gbp-reviews here).
      - GBP_PRESENCE_READ_MASK = the comma-joined paths confirmed at introspection (e.g.
        "openInfo,categories,regularHours,profile,phoneNumbers,websiteUri,metadata,title").
      - Map to the GbpPresenceMetrics PRESENCE fields (the 8 non-rating keys + completeness_score):
        open_status = openInfo?.status ?? ''; primary_category = categories?.primaryCategory?.displayName
        ?? null; categories = (categories?.additionalCategories ?? []).map(c=>c.displayName).filter(Boolean);
        has_hours = (regularHours?.periods?.length ?? 0) > 0; website_uri = websiteUri ?? null;
        has_description = (profile?.description ?? '').trim().length > 0; phone_present = a non-empty
        phoneNumbers?.primaryPhone; completeness_score = Math.round( signals/7 * 100 ) where signals counts
        [open_status==='OPEN', primary_category!=null, categories.length>0, has_hours, website_uri!=null,
        has_description, phone_present]. Do NOT set average_rating/total_review_count here.
      - Wrap the call try/catch -> throw mapGoogleApiError(err) (404 -> bad_request/not-accessible).
      - Inject a `deps.get` seam (default binds the real client) so tests run with no network.
    gbp-reviews.ts (the v4 RAW-HTTP seam, per 13-03-RESEARCH §Raw-HTTP auth seam; server-only):
      - `const GBP_V4_HOST = "https://mybusiness.googleapis.com";`
      - `fetchGbpReviewsAggregate(shopId, deps?)`: `deps.getLinkedAccount ?? getLinkedAccount` (shop,'gbp');
        null OR account.externalParentId === null -> return { average_rating:null, total_review_count:null }
        (cannot build the accounts/{aid}/locations/{lid} parent). Else `googleOAuthClientEnv()` ->
        `buildOAuth2Client({clientId,clientSecret,refreshToken})`; parent = `${externalParentId}/${externalAccountId}`
        (PLAIN slash-join — both already prefixed, NEVER re-wrap); request via `deps.request ?? oauth2.request`:
        `{ url: `${GBP_V4_HOST}/v4/${parent}/reviews`, method:'GET', params:{ pageSize:1 }, timeout:15000 }`.
        Return { average_rating: res.data?.averageRating ?? null, total_review_count: res.data?.totalReviewCount
        ?? null } (?? null for BOTH). On throw -> `throw mapGoogleApiError(err)` (the orchestrator swallows).
    Tests:
      - gbp-presence.test (mirror gbp-enumerate.test seams): the field map (a full location -> every
        presence key); the completeness_score formula (a partial location -> the exact rounded score);
        missing-field defaults (empty location -> open_status '', primary_category null, categories [],
        booleans false, completeness 0); the readMask param shape (every mapped path present); the 404 ->
        mapped error; injected `deps.get`, no live network.
      - gbp-reviews.test: top-level averageRating/totalReviewCount -> snake_case; absent fields -> null pair;
        null externalParentId -> null pair (request NOT called); the pageSize:1 param + the slash-join URL
        (assert NO double accounts//locations/ prefix); a thrown non-2xx -> mapGoogleApiError rethrown;
        injected `deps.request` + `deps.getLinkedAccount`, no live network.
    Avoid: gax `authClient:` for the v1 client; a typed v4 reviews client (none exists); re-wrapping the v4
    parent; paginate-and-average (the aggregate is a single-call response-root field); ?? 0 on the rating
    pair; setting the rating fields inside fetchGbpPresence.
  </action>
  <verify>`vitest run` green (new gbp-presence + gbp-reviews tests pass; existing google-oauth suites unchanged); `tsc` clean; `pnpm build` ✓ (no new dep).</verify>
  <done>AC-1 + AC-2 satisfied.</done>
</task>

<task type="auto">
  <name>Task 2: gbp-presence-sync monthly orchestrator + cron route + vercel.json 9th cron + unit tests</name>
  <files>src/lib/google-oauth/gbp-presence-sync.ts, src/lib/google-oauth/__tests__/gbp-presence-sync.test.ts, src/app/api/cron/gbp-presence-sync/route.ts, src/app/api/cron/gbp-presence-sync/__tests__/route.test.ts, vercel.json</files>
  <action>
    gbp-presence-sync.ts — structural CLONE of ga4-dims-sync.ts (the MONTHLY orchestrator, NOT the daily
    gsc-sync): SyncResult {synced,skipped,failed}; GbpPresenceSyncOptions {today?, month?, fetchPresence?,
    fetchReviews?, fetchDeps?}; reportMonth(options) (options.month ?? today.slice(0,7)); rowDate =
    `${periodMonth}-01`; CLONE openLedger/closeLedger (source='gbp_presence') + dedupeByShop.
    `syncGbpPresence(service, options={})`: openLedger; select google_oauth_accounts (id, shop_id,
    external_account_id) where source='gbp' status='linked' order linked_at desc -> dedupeByShop; per shop:
      - presence = await (options.fetchPresence ?? fetchGbpPresence)(shop_id, options.fetchDeps)  // can throw
      - rating: try { rating = await (options.fetchReviews ?? fetchGbpReviewsAggregate)(shop_id,
        options.fetchDeps) } catch (e) { log sanitized; rating = { average_rating:null, total_review_count:null } }
        // a rating failure NEVER drops the row, NEVER flips the account
      - push { shop_id, source:'gbp_presence', period:'monthly', date:rowDate, metrics:{ ...presence,
        ...rating } }
    Contained per-shop catch around the PRESENCE fetch (mirror ga4-dims-sync l.143-159): failed+=1; map the
    error; auth_failed -> markAccountError(account.id); continue (no row). upsertSnapshots; closeLedger
    success with rows_written; top-level accounts-read error -> closeLedger error + rethrow. Keep
    ga4-dims-sync/perf-sync UNTOUCHED.
    route.ts — mirror /api/cron/ga4-dims-sync: `export const runtime = "nodejs"`; authorized()
    timingSafeEqual on `Bearer ${CRON_SECRET}` (unconfigured=locked); googleCredsPresent() = the SAME
    GOOGLE_OAUTH_CLIENT_ID/_SECRET/_ANALYTICS_OAUTH_REDIRECT_URI check; handle(): 401 -> 503
    gbp_not_configured -> createServiceClient() -> month = priorMonth(new Date().toISOString().slice(0,7))
    -> syncGbpPresence(service,{month}) -> NextResponse.json({month, ...result}); export GET+POST delegating.
    vercel.json — insert ONE cron { path:"/api/cron/gbp-presence-sync", schedule:"0 4 1 * *" } in the array
    AFTER the perf-sync (0 3 1) entry and BEFORE the monthly-report (0 5 1) entry; the other 8 byte-unchanged
    (9 total). (Cron order in vercel.json does not gate execution time, but keep the array ordered by
    schedule for readability + to document the "presence lands before the report reads it" intent.)
    Tests: gbp-presence-sync.test (mirror ga4-dims-sync.test): one monthly row/shop source='gbp_presence' at
    rowDate=${month}-01 with merged presence+rating metrics; reviews-failure (fetchReviews throws) -> row
    STILL written, average_rating/total_review_count null, markAccountError NOT called; presence auth_failed
    -> markAccountError + contained + no row + failed+=1; non-auth presence error -> no status flip;
    double-link dedupe (one row); top-level accounts-read error -> ledger closed error + rethrow;
    ledger-open failure non-blocking. route.test: 401 ×3 (missing/bad/empty), 503 (creds absent), 200 GET +
    200 POST (assert month injected + syncGbpPresence called). Inject seams; no live network.
    Avoid: editing ga4-dims-sync/perf-sync; a bare catch; flipping the account on a RATING failure; writing
    a source other than 'gbp_presence'; period other than 'monthly'; a new migration.
  </action>
  <verify>`vitest run` green (gbp-presence-sync + route tests; existing suites unchanged); `pnpm build` ✓ (ƒ /api/cron/gbp-presence-sync runtime=nodejs); vercel.json valid with 9 crons; `tsc` clean.</verify>
  <done>AC-3 + AC-4 satisfied.</done>
</task>

<task type="auto">
  <name>Task 3: report PDF render + dashboard presence header (both surfaces) + e2e</name>
  <files>src/app/reports/[slug]/print/route.ts, src/lib/report/render.ts, src/lib/report/__tests__/render.test.ts, src/lib/analytics/snapshots.ts, src/lib/analytics/__tests__/snapshots.test.ts, src/app/dashboard/analytics/page.tsx, e2e/global.setup.ts, e2e/analytics-gbp.spec.ts</files>
  <action>
    REPORT (PDF) render:
      - print/route.ts defaultLoader: add `const readMonthlyGbpPresence: MonthlyGbpPresenceReader =
        ({shopId:s,month}) => getMonthlySnapshot(service,{shopId:s,source:'gbp_presence',month});` (import
        the type) and pass `readMonthlyGbpPresence` into the assembleReportData deps — EXACTLY as
        readMonthlyDimensions/readMonthlyPerformance are bound (l.61-70). report-data.ts already consumes it.
      - render.ts: add `renderGbpPresenceBlock(presence: GbpPresenceReport): string` (mirror
        renderPerformanceBlock l.474): a `<section class="panel">` with a "Local presence" <h2> (GBP badge),
        a KPI row using perfKpi-style cards — star rating (presence.averageRating==null ? "n/a" :
        averageRating.toFixed(1)) with sub `${totalReviewCount ?? 0} reviews`, open status, primary category
        (or "—"), and a completeness/listing-signals readout (hasHours/hasDescription/website/phone +
        completenessScore when present). Import GbpPresenceReport. In renderReportHtml add `const
        gbpPresenceBlock = reportData.gbpPresence ? renderGbpPresenceBlock(reportData.gbpPresence) : "";`
        and slot `gbpPresenceBlock` into the body composition immediately AFTER `performanceBlock` (l.669).
      - render.test.ts: +a gbpPresence case — present (rating + open status + category render; trace each
        numeral), null rating ("n/a", NOT "0.0"), absent (block omitted from the HTML).
    DASHBOARD presence header:
      - snapshots.ts: add `getLatestMonthlySnapshot(client,{shopId,source})` — select * where shop_id+source,
        period='monthly', order date desc, limit 1, maybeSingle; returns MonthlySnapshotRow|null (mirror
        getMonthlySnapshot's error/empty handling). +snapshots.test for it.
      - page.tsx: in per-shop scope ONLY (`!scopeAll`), read the latest source='gbp_presence' row for the
        shop via getLatestMonthlySnapshot and render a current-state header at the TOP of the EXISTING
        "Local presence" <section> (the 13-02b one): a star rating (average_rating + total_review_count, or
        "Not yet rated" when null), open status, and a completeness/listing-signals line. When scopeAll
        (MSO) OR no presence row, render nothing extra (a cross-shop rating average is a lie — same principle
        as the aggregate-excluded ratio metrics; comment this). Do NOT touch the daily gbp panel body, the
        syncedAt union, or the organic/paid/GA4/GSC sections.
      - e2e/global.setup.ts: add `seedGbpPresence(shopId, {averageRating, totalReviewCount, openStatus})`
        upserting ONE { source:'gbp_presence', period:'monthly', date:<a recent YYYY-MM-01>, metrics:{...} }
        row (onConflict shop_id,source,date,period); seed the OWNER shop (e.g. 4.6 / 87 reviews / OPEN). Do
        NOT seed MEGA (keeps its unlinked state).
      - e2e/analytics-gbp.spec.ts: extend the OWNER per-shop test to assert the "Local presence" section
        shows the seeded star rating (4.6) + open status; run checkA11y (axe AA 0 serious/critical). Keep the
        existing daily-panel + aggregate + unlinked assertions green.
    Avoid: rendering the presence header in the MSO aggregate; touching the daily gbp panel internals or
    other panels; a new dep; a new migration; reading per-review bodies.
  </action>
  <verify>`pnpm build` ✓; `vitest run` green (render + snapshots reader tests; existing suites unchanged); `pnpm test:e2e` green (presence header: star rating + open status in "Local presence", axe AA; daily gbp panel + organic/paid/ga4/gsc regression-green); `tsc` clean.</verify>
  <done>AC-5 + AC-6 satisfied; AC-7 boundaries held (no migration/dep/per-review; zero prod).</done>
</task>

</tasks>

<boundaries>

## DO NOT CHANGE
- 13-03a foundation: the `gbp_presence` source CHECK/migration, the GbpPresenceMetrics type, the
  getLinkedAccount externalParentId fix, and the report-data buildGbpPresence/MonthlyGbpPresenceReader
  (this plan BINDS the reader + RENDERS + INGESTS; it does not re-touch the data block).
- `ga4-dims-sync.ts` / `perf-sync.ts` / `gsc-sync.ts` / `ga4-sync.ts` / `gbp-sync.ts` (13-02b daily) —
  REUSE getLinkedAccount/markAccountError/upsertSnapshots/getMonthlySnapshot/buildOAuth2Client; CLONE
  dedupeByShop/ledger from ga4-dims-sync (do not edit the originals).
- The 13-02b daily "Local presence" panel BODY + the syncedAt union — this plan ADDS a presence header
  above it, nothing more.
- crypto / OAuth / the gbp link routes (13-01); the report narrative + the eval gate; accounts.ts.
- The source CHECKs / any migration — 13-03a already admits 'gbp_presence'; this plan adds NO migration.

## SCOPE LIMITS
- PRESENCE state + the lifetime star-rating AGGREGATE ONLY (Business Information locations.get + the v4
  reviews averageRating/totalReviewCount). NO per-review bodies/replies/sentiment/pagination/reviewId
  dedupe, NO Notifications-Pub/Sub — those are Phase 14.
- ZERO prod contact: both fetchers behind deps seams; no prod migration/secret/deploy/live Google call.
  The live locations.get + v4 aggregate smoke + deploy = the Phase-13 gate batch (13-04), behind Google
  Gate A + Gate B.
- NO new runtime dependency (googleapis@173 ships the v1 Business Information client; google-auth-library
  is already a dep for the v4 raw-HTTP request). NO new env/secret (the cron reuses the Phase-11 Google
  OAuth creds + CRON_SECRET).
- Dashboard presence header = per-shop scope ONLY (the MSO aggregate omits a cross-shop rating average).

</boundaries>

<verification>
Before declaring 13-03b complete:
- [ ] `tsc` clean; `eslint` 0 err / 0 new warn
- [ ] `vitest run` green — gbp-presence (map/completeness/defaults/readMask/404) + gbp-reviews (snake_case/
      absent-null/null-parent/pageSize/slash-join/rethrow) + gbp-presence-sync (row/rating-tolerant/contained-
      auth/dedupe/ledger) + route (401/503/200) + render (present/null/absent) + getLatestMonthlySnapshot;
      existing suites unchanged
- [ ] `pnpm build` ✓ — NO new dep; ƒ /api/cron/gbp-presence-sync runtime=nodejs; vercel.json valid 9 crons
- [ ] `pnpm test:e2e` green — presence header (star rating + open status in "Local presence") + axe AA;
      daily gbp panel + organic/paid/ga4/gsc specs regression-green
- [ ] No new migration; no per-review bodies/replies/sentiment; 13-03a data block + ga4/gsc/perf/dims +
      daily gbp panel body + crypto/OAuth/link routes untouched; ZERO prod contact
- [ ] All ACs met
</verification>

<success_criteria>
- A linked shop's monthly GBP presence state (Business Information locations.get) + lifetime star-rating
  aggregate (v4 reviews) flow into ONE analytics_snapshots row (source='gbp_presence', period='monthly')
  via a CRON_SECRET-gated monthly cron (0 4 1, before the 05:00 report), the row is written even when the
  rating call fails, and it surfaces BOTH in the report PDF (the gbpPresence block) AND on the dashboard
  "Local presence" section (a per-shop current-state header) — all proven LOCAL on seeded fixtures + the
  e2e round-trip, ZERO prod.
- The v4 reviews aggregate is the single-call response-root read (NOT paginate-and-average), defensively
  null on any failure / non-VoM / null parent, and never trips the breaker.
- The first live locations.get + v4 aggregate call is a one-spot change (the deps default) if Google's
  shape differs — isolated to gbp-presence / gbp-reviews, confirmed at the 13-04 gate batch.
</success_criteria>

<output>
After completion, create `.paul/phases/13-gbp-presence/13-03b-SUMMARY.md`. LIVE verification (real
locations.get + v4 reviews aggregate vs Wallace + deploy) is the Phase-13 gate batch (13-04), recorded as
a deferral — done-state for 13-03b is built + locally gate-checked, not live. Then `/paul:plan 13-04`
(the Phase-13 prod activation gate batch: Gate A + Gate B + the 3 migrations under PROTOCOL + Wallace
re-consent + the crons + the empirical 7-day token pass-gate + the live smokes below).

## ⚠️ 13-04 live-smoke deferrals (from 13-03-RESEARCH + this plan)
- (a) `pageSize:1` returns the v4 aggregate (averageRating + totalReviewCount with reviews[] length 1).
- (b) the exact non-verified / non-VoM `reviews.list` response shape (non-2xx vs 200-with-absent).
- (c) **CONFIRM/BACKFILL `external_parent_id` on the Wallace pilot google_oauth_accounts row** — if it
  predates the 13-01 parent-capture, the prod rating is silently always-null and local tests cannot catch
  it (13-03-RESEARCH open-item 183). Re-enumerate or backfill at the gate batch.
- (d) Enable the legacy "Google My Business API" in Cloud Console (Gate A already covers reviews) + verify
  its quota line shows 300 QPM, not 0.

## ⚠️ Phase-13 Google gates still open (unchanged, on the clock — operator, NOT waiting for 13-04)
Gate A (Business Profile API access 0→300 QPM, ~14-day Google review — covers Performance AND v4 reviews),
Gate B (`business.manage` sensitive-vs-restricted OAuth verification; the app is already In Production so
this blocks even the pilot), and revoke the chat-pasted GCP key (26cd29f).
</output>
