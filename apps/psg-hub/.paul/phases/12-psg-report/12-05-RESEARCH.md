# Phase 12 / 12-05 Research - GA4-dimensional + real-performance expansion

Extends the live-data BASE report (12-01..12-04) on the SAME 12-04 infra (no new worker): incremental ingest + new operator secrets + redeploy. Pilot shop = Wallace Collision (`https://wallacecollisionrepair.com`). Adds GA4 secondary-dimension sections (traffic drivers, landing pages, device, new-vs-returning), two GA4 metrics, and REAL website-performance metrics from PROPER sources (Google CrUX + PageSpeed Insights + GTMetrix), replacing the dubious GA4 "Performance Status / server response 14:49" block in the old Looker deliverable.

Target app: `apps/psg-hub` (`psg-hub@0.2.0`, Next 16.2.3, React 19.2.4, TS strict, Vercel Fluid Compute Node 24). Existing pipeline DO NOT redesign, EXTEND: `analytics_snapshots` (one jsonb `metrics` row per `(shop_id, source, date, period)`, idempotency = `unique(shop_id,source,date,period)`); `ReportData` (`src/lib/report/types.ts`) flat per-source `SourceReportBlock`; monthly rollup (`src/lib/analytics/rollup.ts`) FLOW summed / STOCK latest / DERIVED recomputed, ratios aggregate-excluded; render (`src/lib/report/render.ts`) builds sections off `SourceReportBlock` only.

## Executive summary

- **Perf is LAB-first, field optional.** CrUX field data is currently ABSENT for the Wallace pilot origin and will be absent for most single-location collision shops below CrUX's undisclosed popularity threshold; PSI Lighthouse lab + GTMetrix are the source of truth, and CrUX field distributions are ingested only when present. A Google Cloud API key is a HARD prerequisite for the ENTIRE perf section (the keyless PSI path is dead, quota=0), not just for field data.
- **Architecture B: monthly ingest, one uniform mechanism.** Store both the GA4-dimensional rows and the perf rows as `period='monthly'` `analytics_snapshots` rows written by a new loose perf/dims-sync cron that runs BEFORE the `0 0 1 * *` report cron. The load-bearing reason is GTMetrix per-day credit-cap idempotency + `report-data.ts` purity + the extend-snapshots precedent (06-04, 09-01), NOT perf MoM trends (which are low-value and noisy).
- **GA4 dimensions: one monthly runReport PER dimension, never combined, never daily.** Roughly 4-5 calls/shop/month; the quota saving comes from one-monthly-call-per-dimension, not from `limit`. Of the "two missing metrics," only `averageSessionDuration` needs a new fetch; `bounce_rate = 1 - engagement_rate` is DERIVABLE from already-ingested data.
- **Lowest-blast-radius data model: new DB sources, NOT new `AnalyticsSource` union members.** Add `ga4_dimensions` + `performance` to the DB CHECK constraint and a separate insert-layer `SnapshotSource`; keep `AnalyticsSource` as the four flat sources so the six exhaustive maps stay untouched. `ReportData` gains additive optional `dimensions` and `performance` blocks read on a separate path that bypasses `rollupMonth`. Eval gate needs no v1 change (tables grounded by construction).

## CrUX availability verdict (the finding that most shapes the plan)

DEFINITE: build 12-05 website-performance on LAB data as the source of truth. CrUX FIELD data is an OPTIONAL enrichment ingested only when present, never a dependency.

### Raw Wallace probe (what we actually have)

The keyless paths are dead, proven by direct probe:

```
# PSI v5 runPagespeed, keyless:
curl "https://www.googleapis.com/pagespeedonline/v5/runPagespeed?url=https://wallacecollisionrepair.com&strategy=mobile"
-> {"error":{"code":429,"message":"Quota exceeded for quota metric 'Queries' ... service 'pagespeedonline.googleapis.com'",
    "status":"RESOURCE_EXHAUSTED","details":[{"reason":"RATE_LIMIT_EXCEEDED",
    "metadata":{"quota_limit_value":"0","quota_limit":"defaultPerDayPerProject"}}]}}

# CrUX queryRecord, keyless:
curl -X POST "https://chromeuxreport.googleapis.com/v1/records:queryRecord" -d '{"url":"https://wallacecollisionrepair.com","formFactor":"PHONE"}'
-> {"error":{"code":403,"message":"Method doesn't allow unregistered callers (callers without
    established identity). Please use API Key or other form of API consumer identity to call this API.",
    "status":"PERMISSION_DENIED"}}

# Domain liveness + cold load:
curl -L -o /dev/null -w 'HTTP %{http_code} time=%{time_total}s' https://wallacecollisionrepair.com
-> HTTP 200 time=5.833032s
```

The `quota_limit_value "0"` on `defaultPerDayPerProject` proves the keyless PSI path returns 429 for EVERY call, lab included. So a Google Cloud API key (PageSpeed Insights API + Chrome UX Report API enabled) is a hard prerequisite for the entire performance section.

**Evidence precision (not verdict):** the field-ABSENCE finding for Wallace comes from Treo, a CrUX-backed third-party tool that renders origin-level CrUX (LCP/INP/CLS/TTFB/FCP all show no data on two reads), NOT from a direct authenticated `loadingExperience`/`originLoadingExperience` probe. That keyed probe could not be run because no Google API key exists in the repo env (`.env.local`, `.env.test.local`, `.env.example` carry no PageSpeed/CrUX value, and there is no PSI/CrUX usage in `src/`). The mechanism is documented: CrUX excludes pages/origins below an undisclosed minimum-visitor popularity threshold ENTIRELY (developer.chrome.com/docs/crux/methodology: "Pages and origins that don't meet the popularity threshold are not included in the CrUX dataset"), and the CrUX API returns `404 NOT_FOUND` `"chrome ux report data not found"` for sub-threshold origins. A single-location shop with low traffic and a 5.8s cold load plausibly misses both URL and origin thresholds, matching the Treo result.

### Design directive (definite)

1. **Provision a Google Cloud API key now** (new secret on the 12-04 infra). Enable PageSpeed Insights API + Chrome UX Report API.
2. **Lab is always-present, field is render-if-present.** Always persist `lighthouseResult`-derived lab metrics. Read field via `loadingExperience` (URL) then `originLoadingExperience` (origin); treat field PRESENT only if the block exists AND has a non-empty `metrics` object with an `overall_category`. Equivalently, a direct CrUX `queryRecord` returning `404 NOT_FOUND` means no field data.
3. **Classify CrUX 404 / PSI "no field data" as a successful-EMPTY result, not a failure.** Swallow it; do NOT trip the CircuitBreaker. Apply CircuitBreaker + withRetry to every PSI/CrUX/GTMetrix call per the resilience constraint.
4. **Render field conditionally.** Show CrUX origin distributions when the probe found them; otherwise render lab-only perf with a "lab data" label. Never show an empty or zeroed field block.
5. **Absence is CURRENT, not permanent.** Keep the runtime per-shop field-availability probe so a higher-traffic or multi-location shop that crosses the origin threshold gets field data opportunistically.

Open (build-time): run ONE keyed PSI call against Wallace during the 12-05 build to capture the real JSON shape (confirm `lighthouseResult` present, `loadingExperience` absent or origin-only) and lock the parser against live data.

## Performance data sources

### PSI API v5 (PageSpeed Insights)

- **Endpoint:** `GET https://www.googleapis.com/pagespeedonline/v5/runPagespeed`. Params: `url` (required, full https), `strategy=mobile|desktop` (default mobile), `category=performance`, `&key=PAGESPEED_API_KEY`. The key is URL-safe (no encoding).
- **Auth/quota:** free API key from Google Cloud Console Credentials. Quota 25,000 req/day, 400 req/100s. For a handful of pilot shops x 1-2 strategies/month this is a non-issue; quota is NOT the resilience constraint. Real risks are intermittent 5xx and 10-30s Lighthouse latency, so wrap in CircuitBreaker + withRetry with a >=30-45s timeout; a failed/absent run skips the metric idempotently. Run MOBILE as primary (Google indexes mobile-first); desktop is a separate call only if the report needs a desktop column.
- **One call returns BOTH lab and field:** `lighthouseResult` (lab, always present), `loadingExperience` (URL-level CrUX field), `originLoadingExperience` (origin-level CrUX field).

LAB metric JSON paths (always present, from `lighthouseResult`):

| Report metric | JSON path | Unit / note |
|---|---|---|
| Performance score | `categories.performance.score` | DECIMAL 0..1 — MULTIPLY BY 100 |
| LCP | `audits['largest-contentful-paint'].numericValue` | ms |
| CLS | `audits['cumulative-layout-shift'].numericValue` | unitless |
| TBT | `audits['total-blocking-time'].numericValue` | ms (lab proxy for INP) |
| FCP | `audits['first-contentful-paint'].numericValue` | ms |
| Speed Index | `audits['speed-index'].numericValue` | ms |
| Server response (TTFB) | `audits['server-response-time'].numericValue` | ms — the CORRECT replacement for the bogus GA4 "server response 14:49" |

FIELD/CrUX JSON paths (BEST-EFFORT, may be absent). Per-URL `loadingExperience.metrics.<KEY>`; per-origin `originLoadingExperience.metrics.<KEY>`; each = `{ percentile, category:'FAST'|'AVERAGE'|'SLOW', distributions:[...] }`; overall bucket `loadingExperience.overall_category`. KEYS (easy to mis-spell, fail silently as `undefined` — guard with presence checks and validate against one live Wallace response before locking): `LARGEST_CONTENTFUL_PAINT_MS`, `INTERACTION_TO_NEXT_PAINT` (NO `_MS` suffix), `CUMULATIVE_LAYOUT_SHIFT_SCORE`, `EXPERIMENTAL_TIME_TO_FIRST_BYTE` (note `EXPERIMENTAL_` prefix), `FIRST_CONTENTFUL_PAINT_MS`. GOTCHA: CLS percentile is an INTEGER scaled x100 (percentile 10 = 0.10 actual); LCP/INP/FCP/TTFB percentiles are integer milliseconds. FID is gone (replaced by INP 2024-03-12, removed Sept 2024) but CrUX overall is NOT discontinued — use `INTERACTION_TO_NEXT_PAINT`, never FID.

### GTMetrix API v2.0

- **Base/auth:** `api.gtmetrix.com/api/2.0`, HTTP Basic with the API key as username and a BLANK password.
- **ASYNC two-phase (no synchronous option exists):** POST `/tests` enqueues (returns test id + `state`); POLL GET `/tests/{id}` every 3s through `queued -> started -> completed|error`; on completion a `303` redirect to GET `/reports/{id}`. Typical run is tens of seconds (15-90s). Design must budget polling with a hard max-poll ceiling (e.g. ~20 polls / 60s), state=error handling, and a 429 path.
- **Quota = PER-DAY API-credit allowance (NOT a flat monthly cap, NOT unlimited on paid tiers), refills daily with no carryover, plan-bound:** Micro 10, Growth 100, Team 300, Enterprise 500 credits/day; new keys get 5 trial credits. A full Lighthouse test costs exactly 1 credit. Operator confirms their actual tier in-account.
- **Separate per-60s request rate limit, independent of credit exhaustion:** Basic 240/60s, most PRO 960/60s; error `E42901` / HTTP 429. The poll loop must guard BOTH the max-poll ceiling AND 429 backoff.
- **Report fields (`data.attributes`) beyond PSI:** `fully_loaded_time`, `onload_time`, `page_bytes`, `html_bytes`, `page_requests`, `redirect_duration`, `connect_duration`, `backend_duration`, `time_to_first_byte`, plus `largest_contentful_paint`, `total_blocking_time`, `cumulative_layout_shift`, `speed_index`, `time_to_interactive`, and scores `gtmetrix_grade`, `gtmetrix_score`, `performance_score`, `structure_score`. `data.links`: har, lighthouse, screenshot, filmstrip, video, report_pdf. `backend_duration` / `time_to_first_byte` are the correct real-measurement replacement for the bogus GA4 server-response block.
- **Fleet ceiling (flag for the plan):** 842 shops x 1 Lighthouse credit/day = 842 credits/day, above even Enterprise (500/day). At fleet scale GTMetrix needs a custom/enterprise plan or a throttled rotation; CrUX + PSI (free, higher quota) carry the bulk of fleet perf while GTMetrix is reserved for richer per-shop snapshots. The Wallace pilot fits inside 5 trial credits.

### Which metric comes from which source

| Metric | PSI lab | PSI field (CrUX) | GTMetrix | Recommended report source |
|---|---|---|---|---|
| Performance score (0-100) | yes (`categories.performance.score`*100) | - | yes (`performance_score`) | PSI lab (free, always present) |
| LCP | yes (lab ms) | when present (real-user ms) | yes (lab ms) | field if present, else PSI lab |
| CLS | yes | when present | yes | field if present, else PSI lab |
| INP | - (TBT is lab proxy) | when present (`INTERACTION_TO_NEXT_PAINT`) | - (TBT only) | field if present, else PSI TBT as proxy |
| FCP | yes | when present | yes | PSI lab |
| TTFB / server response | yes (`server-response-time`) | when present (`EXPERIMENTAL_TIME_TO_FIRST_BYTE`) | yes (`time_to_first_byte`/`backend_duration`) | GTMetrix backend_duration (richest) or PSI lab |
| Speed Index | yes | - | yes | PSI lab |
| Fully loaded time | - | - | yes (`fully_loaded_time`) | GTMetrix only |
| Page weight (bytes) | - | - | yes (`page_bytes`) | GTMetrix only |
| Request count | - | - | yes (`page_requests`) | GTMetrix only |
| GTMetrix grade | - | - | yes (`gtmetrix_grade`) | GTMetrix only |

**Lab-vs-field reconciliation rule:** when both lab and field exist for the same metric (LCP/CLS/FCP/TTFB), the FIELD (real-user) number is the more honest client-facing headline; show lab as the controllable diagnostic. When field is absent (the Wallace/collision-shop default), render lab-only with a "lab data" label. PSI's unique value is the free CrUX field data + free Lighthouse score; GTMetrix's unique value is configurable test location/device/throttle, waterfall, page weight/requests, and `backend_duration`. They are complementary, not redundant.

## GA4 dimensional ingest

Four secondary-dimension sections + two metric additions. All eight dimension apiNames are valid GA4 Data API identifiers; both metrics are valid.

| Section | Primary dimension apiName | Note |
|---|---|---|
| Top Traffic Drivers | `sessionDefaultChannelGroup` (and/or `sessionSourceMedium`) | channel mix |
| Top Landing Pages | `landingPagePlusQueryString` | high-cardinality |
| Device Breakdown | `deviceCategory` | desktop/mobile/tablet |
| New vs Returning | `newVsReturning` | |

Metrics per call: `sessions`, `totalUsers`, `engagedSessions`, `engagementRate`, plus the section dimension; report `bounceRate` and `averageSessionDuration` where relevant. `bounceRate` is a fraction 0..1 and equals `1 - engagementRate`; `averageSessionDuration` is in SECONDS. Both are ratio-like and aggregate-EXCLUDED (same class as the existing `engagement_rate`/`ctr`/`position`).

**Only `averageSessionDuration` genuinely needs a new fetch.** `bounce_rate = 1 - engagement_rate`, and `engagement_rate` is already ingested daily, so `bounce_rate` is DERIVABLE without a new pull. The "two missing metrics" framing is half right; treat it as one new metric + one derived.

### Recommended runReport call structure (~4-5 calls/shop/month)

One monthly-window `runReport` PER dimension (single `dateRange` = the report month, one secondary dimension, NO `date` dimension), sessions descending, reusing `getGa4DataClient(shopId)` + the existing CircuitBreaker + withRetry, `returnPropertyQuota: true`. Keep the existing date-dimension daily fetch unchanged.

- **NEVER combine the section dimensions into one report.** Multiple dimensions Cartesian-product into a cross join (Device 3 x Age 6 = up to 18 rows; high-cardinality `landingPagePlusQueryString` crossed against channel/device/newVsReturning explodes the row count). Once the cross product exceeds the 50k-row-per-report-per-day cap, overflow rows collapse into `(other)` and EVERY re-derived marginal is corrupted simultaneously. Combined is both more expensive AND wrong.
- **NEVER pull daily dimensional rows.** Daily dimensional pulls cost ~rows x days and are LESS accurate, because `(other)` bucketing and thresholding bite harder at finer per-day granularity than on one monthly window.
- **The quota lever is request COUNT, date-range LENGTH, and CARDINALITY — NOT `limit`/top-N.** Reducing returned rows via `limit` does not materially cut token cost (GA4 quota docs + quota-management guidance). Keep top-N for payload/render size; attribute the quota saving to one-monthly-call-per-dimension. Standard quota is 1,250 tokens/hour, 25,000/day per property; most requests charge <=10 tokens, so ~4-5 monthly calls/shop is trivial.

### Top-N + "(other)" handling

Emit top-N rows by sessions descending plus one synthetic `(other)` remainder row = monthly total minus the sum of the top-N. This keeps each section's marginal honest (the section total always reconciles) and bounds render size. Decide top-N depth (cap at ingest vs slice at render) at plan time.

## Architecture decision: cadence (fetch-live vs monthly-ingest)

**RECOMMENDED: Architecture B — monthly ingest into `analytics_snapshots`, `period='monthly'`, nested dimensional/perf jsonb, for BOTH GA4-dimensional sections AND perf.** One uniform mechanism. A separate loose perf/dims-sync cron runs BEFORE the `0 0 1 * *` report cron (e.g. `0 4 1 * *`, or late on the last day) so the report reads freshly-stored rows; if a sync is late, the report degrades gracefully to last-good rows (mirror the existing "omit source on no current data" rule).

Rationale (the load-bearing reasons, in order):

1. **GTMetrix per-day credit-cap idempotency is the decisive tie-breaker.** `monthly.ts` re-runs: the held path (verdict != 'pass') re-attempts on the next cron, and `deps.force` re-renders/re-emails even when already sent. Under fetch-live (A), every report rebuild re-hits GTMetrix and re-burns metered daily credits, breaking the per-period idempotency the rest of the system enforces. To fetch-live safely you would have to reinvent an "already-fetched-this-period?" guard, which is itself a stored row. Storing perf in a separate idempotent monthly job (one fetch per shop per period, keyed on `unique(shop_id,source,date,period)`) is the only credit-safe design.
2. **`report-data.ts` purity.** The module injects `readSnapshots` + `generatedAt`, never imports server-only, and runs under vitest node env. A live GA4-dimensional/PSI/GTMetrix call inside assembly violates that unless threaded as an injected dep; monthly ingest keeps `assembleReportData` a pure snapshot reader.
3. **Extend-snapshots precedent (06-04, 09-01).** `ga4-sync.ts` is a ready-made template: `analytics_sync_runs` ledger, contained per-shop failure, idempotent `upsertSnapshots`, CircuitBreaker + withRetry on every external call.

NOT a rationale: perf MoM trends. CrUX/PSI/GTMetrix are point-in-time STOCK measures of the live site; there is nothing to roll up and perf MoM is low-value and noisy. The "B needs new block types" cost is NOT an A-vs-B discriminator — both architectures require the same new dimensional/perf block types and render sections; the only real delta is the ingest cron + stored rows.

GTMetrix's async + 300s Fluid Compute timeout: the POST-then-poll(3s)-to-completed loop (~30-90s) survives one Fluid invocation for the Wallace pilot, but is fragile inside the tight per-shop report loop (A); the dedicated loose perf-sync cron (B) isolates the wait and the credit spend. If shop count grows past a safe per-invocation poll budget, split GTMetrix into a two-phase submit-then-collect design (submit on one run, retrieve on the next) rather than poll-in-loop.

**Defensible hybrid (smallest footprint this cycle):** GA4 dims fetched-live (synchronous, same OAuth client, no credit cap) while perf is ingested. This splits the report into a pure-read path plus an injected live-fetch path. Prefer full-B for one uniform mechanism unless the operator explicitly wants minimum surface now.

## Data-model + ReportData extension

### Storage (new DB sources, NOT new `AnalyticsSource` union members)

Adding to the `AnalyticsSource` union (`src/lib/analytics/types.ts:5`, the four flat sources) forces six exhaustive-map changes (`render.ts`, `rollup.ts`, `report-data.ts`, `prompt.ts`, `schema.ts`, and the flat `SourceReportBlock`). Lower blast radius: add `ga4_dimensions` and `performance` to the DB `analytics_snapshots_source_check` CHECK constraint via migration, and a separate insert-layer `SnapshotSource` type for the DB/upsert path only. Keep `AnalyticsSource` as `"semrush" | "google_ads" | "ga4" | "gsc"`. `AnalyticsPeriod` already includes `'monthly'` (declared, no monthly rows written yet), so the idempotency key `unique(shop_id,source,date,period)` accommodates a monthly row at `date=YYYY-MM-01` with no key migration. Recommend distinct sources (one external API per source per the existing one-source-per-vertical pattern); flag the exact naming as a plan open question.

Store both as ONE `period='monthly'` row per `(shop, new-source, first-of-month)` with arrays nested INSIDE `metrics` jsonb:

```
ga4_dimensions.metrics = {
  topChannels:      [{ name, sessions, users }, ...],   // + (other) remainder
  topSourceMedium:  [{ name, sessions, users }, ...],
  topLandingPages:  [{ name, sessions, users }, ...],
  devices:          [{ name, sessions, users }, ...],
  newVsReturning:   [{ name, sessions, users }, ...],
  averageSessionDuration: <seconds>                     // bounce_rate derived, not stored
}
performance.metrics = {
  psi: { perf_score, lab_lcp_ms, lab_cls, lab_tbt_ms, lab_fcp_ms,
         lab_speed_index_ms, lab_ttfb_ms,
         field: { lcp_ms, inp_ms, cls, fcp_ms, ttfb_ms, categories } | null,
         origin_field: <bool> },
  gtmetrix: { fully_loaded_time, time_to_first_byte, backend_duration, page_bytes,
              page_requests, largest_contentful_paint, total_blocking_time,
              cumulative_layout_shift, gtmetrix_grade, performance_score, structure_score } | null,
  crux: <origin distributions> | null
}
```

These rows read via a SEPARATE path and NEVER enter `METRIC_REGISTRY` / `rollupMonth`. They have no FLOW/STOCK/DERIVED home: perf is point-in-time STOCK, dimensional top-N is not summable from daily rows, and the quota is non-linear. `assembleReportData` gains a parallel monthly reader (the current `SnapshotReader` is daily) that bypasses rollup; do NOT add the new sources to `report-data.ts`'s `SOURCES` rollup array.

### ReportData type extension (additive, optional)

Extend `ReportData` with `dimensions?` and `performance?` blocks OUTSIDE `sources` (parallel to `SourceReportBlock`, not threaded through it). Add `bounce_rate` and `average_session_duration` as flat derived GA4 keys if surfaced as scalar KPIs. The extension is additive and optional so existing assembly/render stays valid when a shop has no perf/dims rows.

### Eval / groundedness gate (no v1 change)

`evaluateReport` inspects PROSE only; the new sections render as TABLES grounded by construction, so no gate change is needed for v1. CAVEAT for the plan: any FUTURE narrative that cites a dimensional or perf number hits F1 (hallucinated number) at 100% unless that number is emitted through `buildPlaceholders` into the allowed-number set. If the LLM narrative is later extended to reference these numbers, extend `buildPlaceholders` to key the allowed set by `(source, metric, period)` including the new sources.

## Report sections

Four GA4 dimensional sections + one perf block, all in the canon design language (`table.psg` midnight headers + `tabular-nums`, `.badge-src` source tag, `.panel` cards, KPI stat cards, color-classed deltas, GA4 strings HTML-escaped, `@media print` `break-inside:avoid`).

1. **Top Traffic Drivers** — `.panel` + `.badge-src` (GA4) + `table.psg`. Columns: Channel (`sessionDefaultChannelGroup`) / Sessions / Users / Share %. Top-N rows + `(other)`.
2. **Top Landing Pages** — `.panel` + `.badge-src` + `table.psg`. Columns: Landing page (`landingPagePlusQueryString`, escaped, truncated) / Sessions / Engagement rate. Top-N + `(other)`.
3. **Device Breakdown** — `.panel` + `.badge-src` + `table.psg` (or CSS bar-fill `.trend-row` per device). Columns: Device (`deviceCategory`) / Sessions / Share %.
4. **New vs Returning** — `.panel` + `.badge-src` + two-row `table.psg` or bar-fill. Columns: Segment (`newVsReturning`) / Sessions / Share %.
5. **Website performance** (REPLACES the dubious GA4 "Performance Status" block) — KPI/status block across PSI lab + GTMetrix + optional CrUX. Cards: Performance score (0-100, good/warn/danger by class), LCP, CLS, TTFB/server response (GTMetrix `backend_duration` or PSI `server-response-time`), fully loaded time + page weight (GTMetrix). Field row rendered only when CrUX present (Wallace badge good/info pattern); when `crux` is null, render lab-only with a "lab data" label, never a blank field block.

Section order and whether the masthead "Sources" line lists CrUX / PageSpeed / GTMetrix are plan-time render decisions.

## Likely plan split

Mirror the Phase 9/10/11 and 12-04 build-local -> gate-batch pattern (everything build-local lands green with zero prod contact; secrets + redeploy gate to the operator).

- **12-05a — GA4 dimensional ingest + sections (build-local).** New `src/lib/google-oauth/ga4-dimensions.ts` (per-dimension monthly `runReport`, the new `averageSessionDuration` metric, `bounce_rate` derived) + a `ga4-dims-sync` orchestrator mirroring `ga4-sync.ts` writing `period='monthly'` `ga4_dimensions` rows. DB CHECK-constraint migration for the new source. `ReportData.dimensions` type + parallel monthly reader + the four render sections. Pure/testable; no new secret. Uses the same per-shop OAuth refresh token already in place.
- **12-05b — Performance sources (build-local + operator-gate for keys).** New `src/lib/perf/psi.ts`, `src/lib/perf/crux.ts`, `src/lib/perf/gtmetrix.ts` (each CircuitBreaker + withRetry; gtmetrix.ts POST-then-poll-to-completed with max-poll ceiling + 429 backoff; CrUX 404 = successful-empty) + `src/lib/perf/perf-sync.ts` orchestrator (ledger, idempotent upsert, contained failure) writing `period='monthly'` `performance` rows. `ReportData.performance` type + the perf render block. Build-local lands behind a `configured()` guard returning a designed 503 until keys are set.
- **12-05c — Cron wiring + operator gate batch.** New `src/app/api/cron/perf-sync/route.ts` (+ ga4-dims if separated), CRON_SECRET-gated, `runtime='nodejs'`; `vercel.json` cron(s) scheduled BEFORE `0 0 1 * *`. GATE BATCH (operator): set `PAGESPEED_API_KEY` (+ CRUX-enabled key) and `GTMETRIX_API_KEY` as Vercel secrets, redeploy, run ONE keyed PSI call against Wallace to lock the field-key parser, live-smoke the perf/dims sync then the report for the pilot. Folds into / follows the 12-04 gate.

Build-local boundary: all ingest modules, types, render sections, migration, and tests land with `tsc 0 / eslint 0 / vitest green` and zero prod contact. Operator-gate boundary: the three new secrets (Google API key, GTMetrix key) + redeploy + the live smoke — outside autonomous scope, same as 12-04 Stage D/E/F.

## Open questions for the operator

1. **GTMetrix plan tier / credit budget.** Confirm the exact Daily API Credit allowance in-account (Micro 10 / Growth 100 / Team 300 / Enterprise 500; new key 5 trial). Confirm it covers one Lighthouse test per shop per month with headroom for held/force re-runs, and whether the plan permits `simulate_device` (PRO-only) and a pinned non-default test location for stable month-over-month comparison.
2. **Mobile vs desktop.** Mobile-only (1 PSI call/shop) or also a desktop column (2 calls/shop)?
3. **Top-N depth** per GA4 section, and cap-at-ingest vs slice-at-render.
4. **Tested URL per shop.** Homepage only, or a small set of key landing pages (each page is its own PSI call + its own `loadingExperience`; origin field is shared)?
5. **Field-absent rendering.** Silently omit the field block, or show "insufficient real-user data" so the client understands why CrWV numbers are missing for low-traffic sites?
6. **Source naming** in the DB/insert layer (`ga4_dimensions` + `performance` vs `crux`/`psi`/`gtmetrix` split) — affects how many monthly rows and the read keys.
7. **Cron ordering / freshness.** Confirm the perf/dims-sync schedule lands before `0 0 1 * *` and that the report degrades to last-good monthly rows if a sync is late.
8. **Architecture choice.** Full-B (uniform monthly ingest) vs the GA4-dims-live hybrid (smallest footprint).
9. **Headline lab-vs-field.** When both lab and field exist for LCP/CLS, show field as headline + lab as diagnostic — confirm.

## Adversarial verification results

All three risky claims were CONFIRMED with refinements; none was refuted outright. The conclusion-changing refinements are noted.

| Risky claim | Verdict | Note |
|---|---|---|
| CrUX field data is NOT reliably available for the collision fleet; perf must be lab-first | **Confirmed (nuanced)** | Field-absence evidence is from Treo (CrUX-backed proxy) confirmed twice, NOT a keyed `loadingExperience` probe (no API key in repo env). Added: the Google API key is a HARD prerequisite for the ENTIRE perf section (keyless PSI quota=0), lab included; absence is current, not permanent. |
| GTMetrix is async POST-then-poll; quota is per-DAY credits (not monthly cap, not unlimited) | **Confirmed** | No synchronous alternative exists. Use the verifier's plan-bound daily numbers: Micro 10 / Growth 100 / Team 300 / Enterprise 500; 5 trial credits; 1 credit/Lighthouse test. Separate per-60s rate limit (E42901/429) independent of credit exhaustion; poll loop guards both. Fleet ceiling 842/day > Enterprise 500. |
| GA4 dimensions: one monthly runReport per dimension, never combined, never daily | **Confirmed (refined)** | Two refinements that change conclusions: (1) `limit`/top-N is NOT the token lever — the levers are request COUNT, date-range LENGTH, CARDINALITY; (2) only `averageSessionDuration` needs a new fetch, `bounce_rate = 1 - engagement_rate` is DERIVABLE. Combined report is both more expensive AND wrong (cross-product + `(other)` corrupts marginals). |
