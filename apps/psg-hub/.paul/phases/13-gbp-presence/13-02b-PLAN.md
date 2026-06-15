---
phase: 13-gbp-presence
plan: 02b
type: execute
wave: 2
depends_on: ["13-02a"]   # genuine: needs the GbpMetrics type + the widened analytics_snapshots/sync_runs source CHECKs (+'gbp') 13-02a landed
files_modified:
  - src/lib/google-oauth/gbp-client.ts                                   # NEW (businessprofileperformance v1 client, `auth:` idiom)
  - src/lib/google-oauth/gbp-metrics.ts                                  # NEW (fetchMultiDailyMetricsTimeSeries — FRESH metric-major→date-major parser)
  - src/lib/google-oauth/__tests__/gbp-metrics.test.ts                   # NEW unit tests
  - src/lib/google-oauth/gbp-sync.ts                                     # NEW (orchestrator, clone of gsc-sync)
  - src/lib/google-oauth/__tests__/gbp-sync.test.ts                      # NEW unit tests
  - src/app/api/cron/gbp-sync/route.ts                                   # NEW (CRON_SECRET-gated, runtime=nodejs)
  - src/app/api/cron/gbp-sync/__tests__/route.test.ts                    # NEW unit tests
  - vercel.json                                                          # EDIT (+gbp-sync cron 0 7 * * *)
  - src/app/dashboard/analytics/page.tsx                                 # EDIT (+additive "Local presence" GBP section)
  - e2e/global.setup.ts                                                  # EDIT (+seedGbpSnapshots)
  - e2e/analytics-gbp.spec.ts                                            # NEW (panel round-trip + axe AA)
autonomous: true   # build is LOCAL + test-gated. The FIRST live fetchMultiDailyMetricsTimeSeries call (real GBP location under business.manage) is the Phase-13 gate batch (13-04), behind Google Gate A + Gate B.
---

<objective>
## Goal
Build the daily GBP insights ingest vertical end-to-end on the foundation 13-02a landed: a Business
Profile Performance API client + a FRESH metric-major→date-major parser
(`fetchMultiDailyMetricsTimeSeries` → `Map<date, GbpMetrics>`), a `syncGbpSnapshots` orchestrator
(source='gbp', daily, trailing window) + a CRON_SECRET-gated daily cron, and an additive "Local
presence" dashboard panel — so a linked shop's profile actions (calls, direction requests, website
clicks, conversations, the four impression splits) flow into `analytics_snapshots` and surface on the
analytics page + the monthly report block 13-02a already wired.

## Purpose
13-02a made `'gbp'` a first-class AnalyticsSource (union + both CHECKs + GbpMetrics type + the report
block) but wrote NO data and NO panel — the report omits gbp until rows exist. This plan is the ingest +
surface that produces those rows. It is the exact mirror of the shipped 11-02 GA4 / 11-03 GSC verticals
(client → metrics → orchestrator → cron → panel + e2e), with one load-bearing difference the research
flags: the Performance API response is metric-major + doubly nested, so the parser is FRESH, not a
gsc-metrics clone (only the seam/breaker/retry shell is shared).

## Output
- NEW `gbp-client.ts` (businessprofileperformance v1 via the `googleapis` `auth:` idiom — mirror
  gbp-enumerate.ts / gsc-client.ts, NOT the gax `authClient:`) + `gbp-metrics.ts`
  (`fetchGbpDailyMetrics` → one fetchMulti call, pivot to `Map<date, GbpMetrics>`).
- NEW `gbp-sync.ts` (`syncGbpSnapshots`, source='gbp', GBP_RESYNC_DAYS default 7) + `/api/cron/gbp-sync`
  (mirror gsc-sync route) + vercel.json `0 7 * * *`.
- EDIT page.tsx: an additive "Local presence" section (per-shop + MSO aggregate — ALL gbp metrics are
  summable, so NONE is aggregate-excluded) + the gbp source added to the header `syncedAt` union.
- Unit tests (metrics pivot + sync + route) + an e2e panel round-trip. At UNIFY: 13-02b-SUMMARY.
  LIVE activation (real fetchMulti vs Wallace's location, deploy) is the Phase-13 gate batch (13-04).
</objective>

<context>
## Project Context
@.paul/PROJECT.md
@.paul/ROADMAP.md
@.paul/STATE.md

## Phase research (research-first gate — REQUIRED, satisfied)
@.paul/phases/13-gbp-presence/13-RESEARCH.md
# Authoritative here: §Presence insights — Business Profile Performance API (the fetchMulti method, the
# 12-value DailyMetric enum + the 8 we wire, the metric-major doubly-nested response shape + the parse
# gotchas: int64-as-string value, google.type.Date, empty=valid-zero, 404=not-accessible, ~7-day lag).

## Prior work consumed (the foundation + the precision fixes)
@.paul/phases/13-gbp-presence/13-02a-SUMMARY.md   # GbpMetrics type (9 FLOW keys, impressions_total derived-at-ingest); both source CHECKs admit 'gbp'; the report block is already wired
@.paul/phases/13-gbp-presence/13-01-SUMMARY.md     # gbp-enumerate.ts (the `auth:` idiom + googleOAuthClientEnv) + the source='gbp' google_oauth_accounts row gbp-client reads

## Patterns to mirror (the shipped GA4/GSC verticals — clone the SHELL, not the parser)
@src/lib/google-oauth/gsc-client.ts                # the `auth:` client builder shape (getLinkedAccount → google.X({version,auth}))
@src/lib/google-oauth/gsc-metrics.ts               # the breaker/retry/deps-seam SHELL to mirror; its header WARNS the parser is source-specific — heed that, write a FRESH gbp parser
@src/lib/google-oauth/gsc-sync.ts                  # the orchestrator to CLONE (windowBounds/dedupeByShop/openLedger/closeLedger/contained-catch)
@src/app/api/cron/gsc-sync/route.ts                # the CRON_SECRET gate + googleCredsPresent + 503 + runtime=nodejs to mirror
@src/lib/google-oauth/gbp-enumerate.ts             # the EXACT GBP `auth:` construction (googleOAuthClientEnv + new google.auth.OAuth2 + google.businessprofileperformance)
@src/lib/google-oauth/accounts.ts                  # getLinkedAccount(shop,'gbp') → {refreshToken, externalAccountId=bare 'locations/{id}', accountId}; markAccountError
@src/lib/analytics/snapshots.ts                    # upsertSnapshots (onConflict shop_id,source,date,period) / getSnapshots / getSnapshotsForShops
@src/lib/analytics/types.ts                        # GbpMetrics (the 9-key target shape, 13-02a)
@src/app/dashboard/analytics/page.tsx              # the GSC `<section>` to mirror for the GBP panel + the syncedAt union
@e2e/analytics-gsc.spec.ts                         # the panel spec to mirror (per-shop / aggregate / unlinked + axe)
@e2e/global.setup.ts                               # seedGscSnapshots (l.192) — mirror for seedGbpSnapshots
@vercel.json                                       # the cron family (7 crons; add the 8th)
</context>

<skills>
## Required Skills (research-first gate)

| Skill | Priority | When to Invoke | Loaded? |
|-------|----------|----------------|---------|
| Research-first / per-plan research check | required | Before authoring (this plan) | ✓ — `13-RESEARCH.md` §Presence insights covers the fetchMulti method, the DailyMetric enum, the response shape + every parse gotcha |
| Context7 (googleapis businessprofileperformance v1) | required | At APPLY, before writing gbp-metrics.ts | ○ — confirm in the installed googleapis@173 the `locations.fetchMultiDailyMetricsTimeSeries` PARAM shape (how `dailyMetrics[]` repeats + how `dailyRange.startDate/endDate.{year,month,day}` are passed — dotted keys vs nested) and the response object path |

**BLOCKING:** Research gate satisfied. The one item to verify against the installed lib at APPLY is the
exact fetchMulti param/response shape (Context7 / `node` introspection, as 13-01 did for the GBP
enumerate surfaces) — the `auth:` idiom + the 8 enum metrics + the parse gotchas are research-settled.
</skills>

<acceptance_criteria>

## AC-1: gbp-client — Performance API client off the linked gbp account, `auth:` idiom, no new dep
```gherkin
Given a shop with a status='linked' source='gbp' google_oauth_accounts row (13-01)
When getGbpPerfClient(shopId, deps?) runs
Then it reads getLinkedAccount(shopId,'gbp'), builds `new google.auth.OAuth2(...)` + setCredentials, and
     returns google.businessprofileperformance({version:'v1', auth}).locations bound to the BARE
     `locations/{id}` (account.externalAccountId) — the `auth:` idiom (mirror gbp-enumerate/gsc-client),
     NOT the gax `authClient:`; throws GoogleApiError('auth_failed') when no gbp account is linked
And NO new runtime dependency is added; every new file is server-only; `pnpm build` succeeds.
```

## AC-2: gbp-metrics — one fetchMulti call, 8 enum metrics, FRESH metric-major→date-major parser
```gherkin
Given a window {startDate,endDate} (YYYY-MM-DD)
When fetchGbpDailyMetrics(shopId, window, deps?) runs
Then it issues ONE locations.fetchMultiDailyMetricsTimeSeries with EXACTLY 8 DailyMetric enum values
     (BUSINESS_IMPRESSIONS_DESKTOP_MAPS, _DESKTOP_SEARCH, _MOBILE_MAPS, _MOBILE_SEARCH,
     BUSINESS_CONVERSATIONS, BUSINESS_DIRECTION_REQUESTS, CALL_CLICKS, WEBSITE_CLICKS) and a
     dailyRange built as {year,month,day} bounds — impressions_total is NEVER sent (not an enum value)
And it PIVOTS the metric-major doubly-nested response
     (multiDailyMetricTimeSeries[].dailyMetricTimeSeries[] → {dailyMetric, timeSeries.datedValues[]})
     into Map<dateISO, GbpMetrics>, mapping each enum back to its GbpMetrics key
And the parse handles every gotcha: `value` is an int64 serialized AS A STRING (Number()); dates are
     google.type.Date {year,month,day} ASSEMBLED to ISO (never string-reformatted); an absent value = 0;
     an empty timeSeries yields no rows and is a VALID zero (NOT a CircuitBreaker failure); a 404 maps to
     a "not accessible / not linked" error, not an upstream error
And impressions_total is computed per day as the sum of the four impression splits (derived-at-ingest),
     and every Map entry is a full GbpMetrics (missing keys default 0)
And CircuitBreaker + withRetry wrap the call (isRetryableGbpError = timeout/upstream/rate_limited), with
     an injectable deps.fetch seam; unit tests cover the pivot, int64-string, date assembly, empty-window,
     impressions_total derivation, the 404 path, and the request param shape (8 metrics + range + location).
```

## AC-3: gbp-sync — daily orchestrator, source='gbp', trailing window, contained per-shop failure
```gherkin
Given multiple shops with linked gbp accounts
When syncGbpSnapshots(service, options?) runs
Then it opens an analytics_sync_runs ledger row source='gbp', selects google_oauth_accounts where
     source='gbp' status='linked' ordered by linked_at desc, dedupeByShop (deterministic one-per-shop),
     and for each shop fetches a trailing window [yesterday-(GBP_RESYNC_DAYS-1)..yesterday]
     (GBP_RESYNC_DAYS default env or 7, per the ~7-day lag) and fans the Map to one
     analytics_snapshots row/date {source:'gbp', period:'daily'} via the idempotent upsertSnapshots
And a single shop's failure is CONTAINED (no bare catch): an auth_failed flips that account via
     markAccountError and the batch continues; the ledger closes success with rows_written, or closes
     error + rethrows on a top-level read failure
And windowBounds/dedupeByShop are CLONED (gsc-sync left untouched); unit tests cover window width,
     linked-gbp-only fan with source='gbp', double-link dedupe, contained auth_failed (+markError), a
     non-auth error not flipping status, a top-level read error closing the ledger error, and a
     ledger-open failure being non-blocking.
```

## AC-4: cron route + vercel.json — CRON_SECRET-gated, nodejs, daily 0 7
```gherkin
Given Vercel Cron fires GET with Authorization: Bearer ${CRON_SECRET}
When /api/cron/gbp-sync is hit
Then the timingSafeEqual gate runs BEFORE any client construction or shop read (unauthorized = 401,
     spends zero Google units); a missing/!googleCredsPresent state returns 503 gbp_not_configured;
     an authorized call runs syncGbpSnapshots and returns its result; GET and POST both supported;
     `export const runtime = "nodejs"` is declared
And vercel.json gains ONE cron {path:/api/cron/gbp-sync, schedule:"0 7 * * *"} (after gsc-sync 45 6),
     leaving the existing 7 crons byte-unchanged
And route unit tests cover 401 (no/bad/empty secret), 503 (creds absent), and 200 (GET + POST authorized).
```

## AC-5: dashboard "Local presence" panel — per-shop + MSO aggregate (all summable), unlinked state, e2e
```gherkin
Given the analytics surface (page.tsx) renders organic + paid + GA4 + GSC sections
When the GBP panel is added
Then an additive "Local presence" <section> reads source='gbp' (per-shop getSnapshots / MSO
     getSnapshotsForShops + aggregateByDate), renders KPI cards (calls, website clicks, direction
     requests, profile impressions) + two charts (calls + website clicks), with its OWN "No Google
     Business Profile linked" unlinked state
And because every gbp metric is FLOW/summable, GBP_AGGREGATE_KPIS == the per-shop KPI set — NOTHING is
     aggregate-excluded (unlike ga4 engagement_rate / gsc ctr+position / ads cpl); a comment records this
And the header syncedAt union includes gbpSnapshots; the existing organic/paid/GA4/GSC sections + the
     owner connect cards are byte-untouched
And an e2e spec (mirror analytics-gsc.spec) proves: OWNER per-shop renders the heading + a real call_clicks
     KPI + a real chart SVG; a MULTI aggregate SUMS call_clicks across shops with ALL gbp KPIs still shown
     (none excluded); a MEGA shop with no gbp gets the unlinked state; axe AA 0 serious/critical on each.
```

## AC-6: Boundaries — ingest + panel only; no migration, no presence/reviews, zero prod
```gherkin
Given 13-02a already widened the CHECKs + promoted the union, and 13-03 owns presence
When 13-02b completes
Then NO new migration (the CHECK already admits 'gbp'), NO new dependency, ZERO prod contact (fetchMulti
     behind the deps seam; no prod migration/secret/deploy/live Google call)
And NO 'gbp_presence' / Business-Information presence / star rating / v4 reviews / searchkeywords-monthly
     (those are 13-03 / Phase 14); the report-lib (13-02a) and the GA4/GSC/ads ingest + accounts.ts are
     untouched (reuse getLinkedAccount/markAccountError/upsertSnapshots/CircuitBreaker/withRetry; CLONE
     windowBounds/dedupeByShop)
And the live fetchMulti smoke + prod deploy are recorded as the 13-04 gate-batch deferral.
```

</acceptance_criteria>

<tasks>

<task type="auto">
  <name>Task 1: gbp-client + gbp-metrics (fetchMulti, FRESH metric-major→date-major parser) + unit tests</name>
  <files>src/lib/google-oauth/gbp-client.ts, src/lib/google-oauth/gbp-metrics.ts, src/lib/google-oauth/__tests__/gbp-metrics.test.ts</files>
  <action>
    Context7/introspect FIRST: confirm `google.businessprofileperformance({version:'v1',auth}).locations
    .fetchMultiDailyMetricsTimeSeries` exists in googleapis@173 and its PARAM shape (how `dailyMetrics[]`
    repeats + whether `dailyRange.startDate/endDate.{year,month,day}` are dotted keys or a nested object)
    and the response object path. (13-01 confirmed the method is present.)
    gbp-client.ts (mirror gsc-client.ts + gbp-enumerate's `auth:` construction):
      - `getGbpPerfClient(shopId, deps?)`: `deps.getLinkedAccount ?? getLinkedAccount`; read (shop,'gbp');
        null → throw GoogleApiError('auth_failed','No linked Google Business Profile'); else
        `googleOAuthClientEnv()` → `new google.auth.OAuth2(clientId,clientSecret,redirectUri)` +
        setCredentials({refresh_token}) → `google.businessprofileperformance({version:'v1', auth})`;
        return {client: perf.locations, locationName: account.externalAccountId /* bare 'locations/{id}' */,
        accountId}. The `auth:` idiom, NOT gax `authClient:` (buildOAuth2Client is the GA4 path — do NOT use).
    gbp-metrics.ts (mirror the gsc-metrics SHELL: GbpWindow type, isRetryableGbpError, a default
    CircuitBreaker, deps {fetch?, breaker?, retry?}; FRESH parser):
      - Define `GBP_DAILY_METRICS` = the 8 enum strings and `METRIC_KEY_BY_ENUM` mapping each enum →
        its GbpMetrics key (DESKTOP_MAPS→impressions_desktop_maps, …, CALL_CLICKS→call_clicks,
        WEBSITE_CLICKS→website_clicks, BUSINESS_CONVERSATIONS→conversations, BUSINESS_DIRECTION_REQUESTS
        →direction_requests). impressions_total is NOT in the request set.
      - `fetchGbpDailyMetrics(shopId, window, deps?)`: build the request (location, dailyMetrics = the 8,
        dailyRange from window split to {year,month,day}); breaker.execute(()=>withRetry(()=>fetch(req)));
        map upstream errors via mapGoogleApiError (404 → not-accessible). PIVOT: for each
        multiDailyMetricTimeSeries[].dailyMetricTimeSeries[] entry, key = METRIC_KEY_BY_ENUM[dailyMetric];
        for each datedValues[] {date:{year,month,day}, value}: isoDate = `${y}-${pad(m)}-${pad(d)}`,
        n = Number(value ?? 0) (int64-as-string), accumulate into out.get(iso)[key]. After the pivot, for
        every date set impressions_total = sum of the 4 split keys and default any missing GbpMetrics key
        to 0 so each entry is a full GbpMetrics. An empty/absent timeSeries simply yields no entries (valid
        zero, never a thrown/breaker failure). Return Map<string, GbpMetrics>.
      - `deps.fetch` seam: default binds getGbpPerfClient(shopId) + calls
        client.fetchMultiDailyMetricsTimeSeries(params) and returns res.data; tests inject a fake.
    Tests (mirror gsc-metrics.test): pivot (2 metrics × 2 days → 2 full rows correctly keyed);
    int64-string coercion; google.type.Date → ISO assembly (zero-pad); empty response → empty Map;
    impressions_total = sum of the four splits; a 404 → mapped not-accessible error; the request body shape
    (8 dailyMetrics + the {year,month,day} range + the bare location). Injectable seams; no live network.
    Avoid: gax `authClient:`; sending impressions_total (or BOOKINGS/FOOD_*) as a dailyMetric; cloning the
    gsc parser (the shapes differ); treating an empty timeSeries as an error; reformatting a date string.
  </action>
  <verify>`vitest run` green (new gbp-metrics tests pass; existing google-oauth suites unchanged); `tsc` clean; `pnpm build` ✓ (no new dep).</verify>
  <done>AC-1 + AC-2 satisfied.</done>
</task>

<task type="auto">
  <name>Task 2: gbp-sync orchestrator + cron route + vercel.json + unit tests</name>
  <files>src/lib/google-oauth/gbp-sync.ts, src/lib/google-oauth/__tests__/gbp-sync.test.ts, src/app/api/cron/gbp-sync/route.ts, src/app/api/cron/gbp-sync/__tests__/route.test.ts, vercel.json</files>
  <action>
    gbp-sync.ts — structural CLONE of gsc-sync.ts: SyncResult; GbpSyncOptions {today?, resyncDays?,
    fetchMetrics?, fetchDeps?}; resyncWindow() reads GBP_RESYNC_DAYS (default 7); CLONE windowBounds +
    dedupeByShop + openLedger/closeLedger (source='gbp'); `syncGbpSnapshots(service, options={})`:
    select google_oauth_accounts (id, shop_id, external_account_id) where source='gbp' status='linked'
    order linked_at desc → dedupeByShop → per shop try fetchGbpDailyMetrics(shop_id,{startDate,endDate},
    fetchDeps) → push one row/date {shop_id, source:'gbp', period:'daily', date, metrics}; contained catch
    maps the error, auth_failed → markAccountError(account.id), continue; upsertSnapshots; close ledger
    success; top-level read error closes ledger error + rethrows. Keep gsc-sync/ga4-sync UNTOUCHED.
    route.ts — mirror /api/cron/gsc-sync: `runtime="nodejs"`; authorized() timingSafeEqual on
    `Bearer ${CRON_SECRET}` (unconfigured=locked); googleCredsPresent() = the SAME check gsc-sync uses
    (GBP perf calls go through googleOAuthClientEnv — the same OAuth creds); handle(): 401 unauthorized →
    503 gbp_not_configured → createServiceClient() → syncGbpSnapshots → NextResponse.json(result); export
    GET+POST delegating to handle.
    vercel.json — append ONE cron {path:"/api/cron/gbp-sync", schedule:"0 7 * * *"} after the gsc-sync
    45 6 entry; the other 7 crons byte-unchanged.
    Tests: gbp-sync.test (mirror gsc-sync.test — window 7-wide; linked-gbp-only fan, rows source='gbp';
    double-link dedupe; auth_failed contained → markError + continue; non-auth error does NOT flip status;
    accounts-read error → ledger error + rethrow; ledger-open failure non-blocking) + route.test
    (401 ×3 [missing/bad/empty], 503 creds-absent, 200 GET, 200 POST). Inject seams; no live network.
    Avoid: editing gsc-sync/ga4-sync; a bare catch; writing source other than 'gbp'; a new migration.
  </action>
  <verify>`vitest run` green (gbp-sync + route tests; existing suites unchanged); `pnpm build` ✓ (ƒ /api/cron/gbp-sync runtime=nodejs); vercel.json valid with 8 crons; `tsc` clean.</verify>
  <done>AC-3 + AC-4 satisfied.</done>
</task>

<task type="auto">
  <name>Task 3: dashboard "Local presence" GBP panel + e2e round-trip</name>
  <files>src/app/dashboard/analytics/page.tsx, e2e/global.setup.ts, e2e/analytics-gbp.spec.ts</files>
  <action>
    page.tsx (mirror the GSC section, l.555-633): add `const GBP_SOURCE = "gbp" as const;` + `GBP_KPIS`
    [{call_clicks,"Calls"},{website_clicks,"Website clicks"},{direction_requests,"Direction requests"},
    {impressions_total,"Profile impressions"}] and `GBP_AGGREGATE_KPIS = GBP_KPIS` (with a comment: every
    gbp metric is FLOW/summable, so NOTHING is aggregate-excluded — unlike ga4/gsc/ads). Read gbpSnapshots
    (scopeAll ? getSnapshotsForShops : getSnapshots, source=GBP_SOURCE) → gbpRows (aggregateByDate when
    scopeAll) → gbpLatest → gbpKpis → callsSeries (call_clicks) + websiteClicksSeries (website_clicks),
    each formatShortDate-mapped. Add an additive `<section aria-labelledby="presence-heading">` titled
    "Local presence" with the KPI grid + a LineChartCard (Calls) + BarChartCard (Website clicks) + its own
    `gbpRows.length === 0` → "No Google Business Profile linked" Card (mirroring the GSC unlinked card;
    invite to the connect card below). Add gbpSnapshots to the `latestSyncedAt([...])` header union. Place
    the section BELOW "Search performance", ABOVE the owner "Connect more sources" block. Leave organic /
    paid / GA4 / GSC / connect sections byte-untouched.
    e2e/global.setup.ts: add `seedGbpSnapshots(shopId, days, callsBase)` mirroring seedGscSnapshots
    (l.192) — per-day metrics: call_clicks = callsBase + i, website_clicks, direction_requests,
    conversations, the 4 impression splits, impressions_total = their sum; upsert onConflict
    shop_id,source,date,period. Seed OWNER 30d + shop A 14d + shop B 14d; leave MEGA WITHOUT gbp (drives
    the unlinked state) — mirror the gsc seeding calls (l.320-322).
    e2e/analytics-gbp.spec.ts (mirror analytics-gsc.spec): OWNER per-shop (heading "Local presence" +
    a real call_clicks KPI value + a real chart SVG path); MULTI aggregate (switch to All shops, assert
    call_clicks SUMS across A+B, and ALL gbp KPI labels remain — NONE excluded, the inverse of the gsc
    aggregate assertion); MEGA unlinked ("No Google Business Profile linked"); checkA11y + shoot on each.
    Avoid: excluding any gbp KPI from the aggregate; touching the other panels; a new dep.
  </action>
  <verify>`pnpm build` ✓; `pnpm test:e2e` green (gbp panel: per-shop value + chart SVG, aggregate sum with all KPIs, unlinked state, axe AA 0 serious/critical); existing analytics specs (organic/paid/ga4/gsc) regression-green.</verify>
  <done>AC-5 satisfied; AC-6 boundaries held (no migration/dep/presence/reviews; zero prod).</done>
</task>

</tasks>

<boundaries>

## DO NOT CHANGE
- The 13-02a union promotion (types/rollup/report-data/prompt/render/schema/evaluate) — already shipped;
  this plan writes DATA + a panel, it does not re-touch the report-lib.
- `gsc-sync.ts` / `ga4-sync.ts` / `accounts.ts` — REUSE getLinkedAccount/markAccountError, CLONE
  windowBounds/dedupeByShop (do not edit the originals).
- The shipped GA4/GSC/Ads ingest + their cron routes + the organic/paid/GA4/GSC page sections.
- crypto / OAuth / the gbp link routes (13-01) — untouched.
- The source CHECKs / any migration — 13-02a already admits 'gbp'; this plan adds NO migration.

## SCOPE LIMITS
- Daily insights ONLY: the Performance API fetchMulti action counts. NO 'gbp_presence' (Business-Info
  location state), NO star rating, NO v4 reviews, NO searchkeywords-monthly — those are 13-03 / Phase 14.
- ZERO prod contact: fetchMulti behind the deps seam; no prod migration/secret/deploy/live Google call.
  The live fetchMulti smoke + deploy = the Phase-13 gate batch (13-04), behind Google Gate A + Gate B.
- NO new runtime dependency (googleapis@173 ships the v1 client). ONE new tunable env GBP_RESYNC_DAYS
  (default 7); the cron reuses the existing Google OAuth creds (no new secret here).

</boundaries>

<verification>
Before declaring 13-02b complete:
- [ ] `tsc` clean; `eslint` 0 err
- [ ] `vitest run` green — new gbp-metrics (pivot/int64/date/empty/impressions_total/404/params) + gbp-sync (window/dedupe/contained-failure/ledger) + route (401/503/200) tests; existing suites unchanged
- [ ] `pnpm build` ✓ — NO new dep; ƒ /api/cron/gbp-sync runtime=nodejs; vercel.json valid 8 crons
- [ ] `pnpm test:e2e` green — gbp panel per-shop value + chart SVG, MSO aggregate SUM (all gbp KPIs shown), unlinked state, axe AA; organic/paid/ga4/gsc specs regression-green
- [ ] No new migration; no 'gbp_presence'/reviews/star-rating/searchkeywords; report-lib + ga4/gsc/accounts untouched; ZERO prod contact
- [ ] All ACs met
</verification>

<success_criteria>
- A linked shop's daily GBP profile actions flow into analytics_snapshots (source='gbp') via a
  CRON_SECRET-gated daily cron, surface on an additive "Local presence" dashboard panel (per-shop + a
  fully-summable MSO aggregate), and feed the monthly report block 13-02a already wired — all proven
  LOCAL on seeded fixtures + the e2e round-trip, ZERO prod.
- The parser is FRESH (metric-major→date-major pivot) and correct on every research-flagged gotcha;
  the orchestrator/cron/panel are faithful mirrors of the shipped GA4/GSC verticals.
- The first live fetchMultiDailyMetricsTimeSeries call is a one-spot change (the deps.fetch default) if
  Google's shape differs — isolated to gbp-metrics, confirmed at the 13-04 gate batch.
</success_criteria>

<output>
After completion, create `.paul/phases/13-gbp-presence/13-02b-SUMMARY.md`. LIVE verification (real
fetchMulti vs Wallace's location + deploy) is the Phase-13 gate batch (13-04), recorded as a deferral —
done-state for 13-02b is built + locally gate-checked, not live. Then `/paul:plan 13-03` (monthly
presence + star rating — `'gbp_presence'` SnapshotSource-only + Business-Info location state + the v4
reviews star-rating aggregate keyed off the stored external_parent_id `accounts/{id}`).

## ⚠️ Phase-13 Google gates still open (from 13-01 — unchanged, still on the clock)
Gate A (Business Profile API access 0→300 QPM, ~14-day Google review), Gate B (`business.manage`
sensitive-vs-restricted OAuth verification), and the revoked-key confirmation. 13-02a/02b build LOCAL;
the live Performance API smoke + prod migration + deploy are the 13-04 gate batch behind A + B.
</output>
