---
phase: 13-gbp-presence
plan: 02a
type: execute
wave: 1
depends_on: []          # 13-01 (the source='gbp' google_oauth_accounts row + GoogleOAuthSource union) is already LOOP CLOSED; this plan needs nothing un-built
files_modified:
  - supabase/migrations/XXXXXXXXXXXXXX_gbp_insights_source.sql   # NEW (widen analytics_snapshots + analytics_sync_runs source CHECKs +'gbp'; mirror 20260612000000)
  - src/lib/analytics/types.ts                                   # EDIT (AnalyticsSource += 'gbp'; NEW GbpMetrics type)
  - src/lib/analytics/rollup.ts                                  # EDIT (METRIC_REGISTRY.gbp — all-FLOW; no deriveMetric branch)
  - src/lib/report/report-data.ts                               # EDIT (SOURCES += 'gbp'; TREND_KEYS.gbp)
  - src/lib/report/prompt.ts                                    # EDIT (SOURCE_LABELS.gbp)
  - src/lib/report/render.ts                                    # EDIT (SOURCE_META.gbp + SOURCE_ORDER += 'gbp' + KPI_SET gbp card)
  - src/lib/report/schema.ts                                    # EDIT (sourceSummaries.gbp.optional())
  - src/lib/report/evaluate.ts                                  # EDIT (SOURCE_NAMES += 'gbp')
  - src/lib/report/__tests__/evaluate-grounding-regression.test.ts  # EDIT (SEED += gbp fixture)
  - src/lib/analytics/__tests__/rollup.test.ts                  # EDIT/NEW (gbp all-flow rollup cases)
  - src/lib/report/__tests__/report-data.test.ts               # EDIT (gbp block assembly + omission)
autonomous: true   # build is LOCAL + test-gated. ZERO prod contact. Prod migration apply + deploy = the Phase-13 gate batch (13-04), behind Google Gate A + Gate B.
---

<objective>
## Goal
Make `'gbp'` a first-class member of the `AnalyticsSource` union so daily GBP insights (built in
13-02b) earn the dashboard panel, the monthly report block, the trend series, and the monthly rollup
"for free" — exactly as `ga4`/`gsc` do. This is the cross-cutting half of the 13-02 daily-insights
vertical: ONE additive migration widening both analytics source CHECKs to admit `'gbp'`, the new
`GbpMetrics` jsonb type, and the union promotion across all SIX exhaustive report/analytics maps plus
`TREND_KEYS` and the rollup `METRIC_REGISTRY` (RESEARCH §Data-model: "the deliberate price of getting
the panel/report for free"). No Performance API call, no sync, no cron, no panel — those are 13-02b.

## Purpose
`'gbp'` is the FIRST source added to the union AFTER the Phase-12 report was built, so unlike the
11-02/11-03 GA4/GSC verticals it must touch every report map (the report did not yet exist in Phase 11).
Splitting that promotion (compiles + verifies on synthetic fixtures, report gracefully omits gbp until
data exists) away from the live ingest (13-02b) keeps each APPLY under the 50%-context rule and prevents
a half-promoted union from leaving the build uncompilable mid-execution. 13-02b's `gbp-metrics` /
`gbp-sync` / cron depend on the widened CHECK + the `GbpMetrics` type this plan lands.

## Output
- 1 NEW migration (LOCAL-applied only): `analytics_snapshots` + `analytics_sync_runs` source CHECKs both
  gain `'gbp'` (preserving `ga4_dimensions` + `performance`). NOT `'gbp_presence'` — that is 13-03.
- `GbpMetrics` type (9 FLOW keys; `impressions_total` derived-at-ingest; ALL summable — no ratio,
  so NO aggregate-exclusion, unlike `ga4.engagement_rate` / `gsc.ctr`+`position` / `ads.cpl`).
- `AnalyticsSource` widened to `… | "gbp"` and the 11 dependent sites updated (enumerated in Task 2).
- Unit tests: gbp all-FLOW rollup; report-data assembles a gbp block and omits it when absent.
- At UNIFY: 13-02a-SUMMARY. Then 13-02b (ingest + panel + e2e, `depends_on: ["13-02a"]`).
</objective>

<context>
## Project Context
@.paul/PROJECT.md
@.paul/ROADMAP.md
@.paul/STATE.md

## Phase research (research-first gate — REQUIRED, satisfied)
@.paul/phases/13-gbp-presence/13-RESEARCH.md
# Authoritative here: §Data-model mapping & ingest architecture (the FLOW-vs-STOCK split: 'gbp' daily
# enters the union, 'gbp_presence' does NOT — it is 13-03's SnapshotSource-only monthly extra), §"Three
# CHECK-widening migrations" (the auto-named analytics_sync_runs trap), §"Cost of promoting 'gbp'" (six
# maps + TREND_KEYS + METRIC_REGISTRY), §jsonb shapes (the insights metric set, all FLOW).

## Prior work consumed
@.paul/phases/13-gbp-presence/13-01-SUMMARY.md   # 13-01 already widened google_oauth_accounts source +'gbp' + GoogleOAuthSource union; this plan does NOT re-touch that table

## The migration to mirror EXACTLY (proven on prod in 12-05c — drop-if-exists by name + verify-at-apply)
@supabase/migrations/20260612000000_performance_source.sql       # the template: drop+recreate BOTH CHECKs listing the FULL set; analytics_snapshots keeps the null allowance; analytics_sync_runs is NOT NULL + carries the auto-named verify note
@supabase/migrations/20260604000000_analytics_snapshots.sql      # line 35-38: analytics_snapshots_source_check (named)
@supabase/migrations/20260605000000_analytics_sync_runs.sql      # line 16: inline (auto-named) source CHECK — verify the live name at apply

## The union + the maps to promote (exhaustive — a missed Record<AnalyticsSource,…> is a tsc error)
@src/lib/analytics/types.ts            # line 5 AnalyticsSource union; the per-source GbpMetrics type lands here (mirror Ga4Metrics/GscMetrics doc style)
@src/lib/analytics/rollup.ts           # line 24-69 METRIC_REGISTRY (Record<AnalyticsSource,…>); line 115-130 deriveMetric (NO new branch — gbp has no derived metric)
@src/lib/report/report-data.ts         # line 26 SOURCES[]; line 29-34 TREND_KEYS (Record<AnalyticsSource,…>)
@src/lib/report/prompt.ts              # line 12-17 SOURCE_LABELS (Record<AnalyticsSource,string>)
@src/lib/report/render.ts              # line 33-38 SOURCE_META (Record<AnalyticsSource,…>); line 41 SOURCE_ORDER[]; line 44-49 KPI_SET (per-entry source discriminator)
@src/lib/report/schema.ts              # line 28-33 sourceSummaries zod object (per-source .optional())
@src/lib/report/evaluate.ts            # line 47 SOURCE_NAMES[] (longest-first prefix matcher for placeholder keys)
@src/lib/report/__tests__/evaluate-grounding-regression.test.ts  # line 20 SEED (Record<AnalyticsSource,…> fixture)

## Migration-safety protocol (LOCAL apply only this plan; prod apply is the 13-04 gate batch)
@.paul/phases/06-rbac-rls-spine/PROTOCOL-migration-safety.md
@.paul/phases/06-rbac-rls-spine/CHECKLIST-rls-review.md
</context>

<skills>
## Required Skills (research-first gate)

| Skill | Priority | When to Invoke | Loaded? |
|-------|----------|----------------|---------|
| Research-first / per-plan research check | required | Before authoring (this plan) | ✓ — `13-RESEARCH.md` (ultracode Workflow wf_9f94f2c1-01b, 10 agents) covers the data-model split, the three CHECK-widening migrations, the auto-named trap, and the insights metric set |
| Context7 (Vercel AI SDK zod schema) | optional | At APPLY, only if the `sourceSummaries` zod edit is non-obvious | ○ — confirm the `z.object` `.optional()` field add does not break the AI SDK `Output.object` binding (schema.ts) |

**BLOCKING:** Research gate satisfied. No NEW external API surface is touched in 13-02a (the Performance
API lands in 13-02b) — this plan is migration + TypeScript exhaustive-map promotion + unit tests only.
</skills>

<acceptance_criteria>

## AC-1: One migration, LOCAL-applied, additive — BOTH source CHECKs admit 'gbp'
```gherkin
Given analytics_snapshots.source CHECK and analytics_sync_runs.source CHECK currently admit
      ('semrush','google_ads','ga4','gsc','ga4_dimensions','performance') (the latter two from 12-05a/b)
When `supabase migration new gbp_insights_source` is authored mirroring 20260612000000_performance_source.sql
     and applied via `supabase db reset` (LOCAL only)
Then BOTH CHECKs are dropped-and-recreated listing the FULL set PLUS 'gbp'
     (analytics_snapshots keeps `source is null or source in (...)`; analytics_sync_runs is NOT NULL)
And the analytics_sync_runs constraint is dropped by the standard name with a verify-at-apply note
     (`\d+ public.analytics_sync_runs` confirms `analytics_sync_runs_source_check` — the 12-05b precedent that succeeded on prod)
And 'gbp_presence' is NOT added (it is 13-03's SnapshotSource-only monthly value)
And NO ALTER touches google_oauth_accounts (13-01 already widened it) and existing rows + RLS are intact.
```

## AC-2: GbpMetrics type — 9 FLOW keys, all summable, no aggregate-excluded ratio
```gherkin
Given the daily insights jsonb shape (RESEARCH §jsonb shapes)
When GbpMetrics is added to src/lib/analytics/types.ts (mirroring the Ga4Metrics/GscMetrics doc style)
Then it declares: impressions_desktop_maps, impressions_desktop_search, impressions_mobile_maps,
     impressions_mobile_search, impressions_total, website_clicks, call_clicks, direction_requests, conversations
And a doc comment states ALL nine are FLOW counts that sum honestly — there is NO ratio/derived metric,
     so (unlike ga4/gsc/ads) NOTHING is aggregate-excluded from the MSO KPIs
And impressions_total is documented as derived-at-ingest (the per-day sum of the four impression splits,
     computed by 13-02b's parser — NOT a Performance API DailyMetric enum value).
```

## AC-3: AnalyticsSource union widened +'gbp' AND every exhaustive map updated; tsc clean
```gherkin
Given AnalyticsSource = "semrush" | "google_ads" | "ga4" | "gsc" (types.ts:5)
When it widens to "… | gbp"
Then ALL of these gain a 'gbp' entry/member (each enumerated; a miss is a compile error):
     1. types.ts:5 AnalyticsSource union
     2. rollup.ts METRIC_REGISTRY (Record<AnalyticsSource,…>) — gbp: { flow: [the 9 keys], stock: [], derived: [] }
     3. report-data.ts SOURCES[] (display order)
     4. report-data.ts TREND_KEYS (Record<AnalyticsSource,string[]>) — gbp headline trends (recommend ["call_clicks","website_clicks"])
     5. prompt.ts SOURCE_LABELS (Record<AnalyticsSource,string>) — e.g. "Google Business Profile (local presence + actions)"
     6. render.ts SOURCE_META (Record<AnalyticsSource,…>) — { badge, title } for the report section
     7. render.ts SOURCE_ORDER[] — 'gbp' placed sensibly (local presence near gsc)
     8. render.ts KPI_SET — one gbp headline card (e.g. { source:'gbp', metric:'call_clicks', label:'Profile calls' })
     9. schema.ts sourceSummaries zod object — gbp: sourceSummary.optional()
    10. evaluate.ts SOURCE_NAMES[] — 'gbp' added (no prefix collision; placeholder keys are 'gbp_<metric>')
    11. evaluate-grounding-regression.test.ts SEED (Record<AnalyticsSource,…>) — a gbp apr/may fixture
And `tsc` is clean — the exhaustive Record<AnalyticsSource,…> maps PROVE no site was missed.
```

## AC-4: rollup correctness — gbp is all-FLOW, no derived branch
```gherkin
Given METRIC_REGISTRY.gbp lists all 9 metric keys under flow (stock: [], derived: [])
When rollupMonth('gbp', dailyRows) runs over a calendar month of gbp daily rows
Then every metric is summed across the month (FLOW), there is NO STOCK latest-value read and NO DERIVED
     recompute, deriveMetric gains NO 'gbp' branch, and an empty month returns null (not a zero-filled object)
And a unit test asserts: a 2-row month sums each key; impressions_total sums independently of its four
     component splits (no double-count, since they are distinct stored keys); empty -> null.
```

## AC-5: report block for free — gbp assembled when present, omitted when absent
```gherkin
Given the union + SOURCES + TREND_KEYS + render/prompt/schema/evaluate now carry 'gbp'
When assembleReportData runs for a shop with gbp daily rows in the report month
Then it produces a gbp SourceReportBlock (current rolled-up, prior, MoM delta, trend series from TREND_KEYS.gbp),
     exactly like the ga4/gsc blocks, with NO change to the existing four blocks
And when a shop has NO gbp rows, the gbp block is OMITTED (graceful — the existing cold-start/omission path),
     so existing reports for shops without GBP are byte-unchanged
And a unit test covers both (gbp present -> block with MoM + trend; gbp absent -> omitted), and the existing
     report-data / evaluate / narrative / render suites stay green.
```

## AC-6: Boundaries — promotion only, no ingest, no presence, zero prod
```gherkin
Given this plan is the cross-cutting promotion half of 13-02
When 13-02a completes
Then there is NO gbp-metrics / gbp-sync / cron / Performance API call (no fetchMultiDailyMetricsTimeSeries),
     NO dashboard panel edit (page.tsx untouched), NO 'gbp_presence', NO star rating / reviews / searchkeywords
And NO new runtime dependency, ZERO prod contact (migration LOCAL via db reset only)
And the GA4/GSC/google_ads ingest paths, the existing report output, and the eval gate are untouched & green.
```

</acceptance_criteria>

<tasks>

<task type="auto">
  <name>Task 1: Migration (LOCAL) — widen both analytics source CHECKs +'gbp'; add GbpMetrics type</name>
  <files>supabase/migrations/XXXXXXXXXXXXXX_gbp_insights_source.sql, src/lib/analytics/types.ts</files>
  <action>
    `supabase migration new gbp_insights_source` (never hand-invent a timestamp). Author it as a near-exact
    mirror of 20260612000000_performance_source.sql:
    (a) analytics_snapshots: `drop constraint if exists analytics_snapshots_source_check;` then re-add
        `check (source is null or source in ('semrush','google_ads','ga4','gsc','ga4_dimensions','performance','gbp'))`
        — preserve the NULL allowance and the full prior set; ADD ONLY 'gbp'.
    (b) analytics_sync_runs: `drop constraint if exists analytics_sync_runs_source_check;` then re-add
        `check (source in ('semrush','google_ads','ga4','gsc','ga4_dimensions','performance','gbp'))`
        — NOT NULL (no null allowance here). Carry the SAME comment 12-05b carries: the 20260605 inline
        CHECK was auto-named, so verify the live name is `analytics_sync_runs_source_check` with
        `\d+ public.analytics_sync_runs` before trusting the drop (the proven 12-05b approach — drop-if-exists
        by the standard name, NOT a DO-block; it succeeded on prod in 12-05c).
    (c) DO NOT add 'gbp_presence' (13-03). NO ALTER to google_oauth_accounts (13-01 did it). NO RLS touch.
    Apply LOCAL via `supabase db reset`; docker-exec psql `\d+` BOTH tables to confirm each CHECK admits 'gbp'
    and rejects a bogus source, and that no other column/policy changed.
    types.ts: add the `GbpMetrics` type per AC-2 (9 FLOW keys; doc that all sum honestly with NO aggregate-
    excluded ratio; impressions_total = derived-at-ingest sum of the four splits, computed by 13-02b). Mirror
    the Ga4Metrics/GscMetrics comment style. Do NOT yet widen the AnalyticsSource union (Task 2) — keep this
    task's diff = migration + the standalone type, so tsc still passes between tasks.
    Avoid: editing 20260604/20260605/20260611/20260612 migrations; adding 'gbp_presence'; any prod contact.
  </action>
  <verify>`supabase db reset` exit 0; psql `\d+ public.analytics_snapshots` + `\d+ public.analytics_sync_runs` show both source CHECKs admit 'gbp' (+ reject a bogus value) with the full prior set preserved; grep confirms NO 'gbp_presence' and the four prior migrations unedited; `tsc` clean (GbpMetrics compiles standalone).</verify>
  <done>AC-1 + AC-2 satisfied.</done>
</task>

<task type="auto">
  <name>Task 2: Promote 'gbp' across the AnalyticsSource union (all 11 sites) + rollup/report-data tests</name>
  <files>src/lib/analytics/types.ts, src/lib/analytics/rollup.ts, src/lib/report/report-data.ts, src/lib/report/prompt.ts, src/lib/report/render.ts, src/lib/report/schema.ts, src/lib/report/evaluate.ts, src/lib/report/__tests__/evaluate-grounding-regression.test.ts, src/lib/analytics/__tests__/rollup.test.ts, src/lib/report/__tests__/report-data.test.ts</files>
  <action>
    Widen `AnalyticsSource` (types.ts:5) to add `'gbp'`, then update EVERY dependent site (let tsc drive you —
    each unhandled exhaustive Record<AnalyticsSource,…> is a compile error; the 11 sites are listed in AC-3):
      - rollup.ts METRIC_REGISTRY: `gbp: { flow: [all 9 GbpMetrics keys], stock: [], derived: [] }`. Add NO
        branch to deriveMetric (gbp has no derived metric — the all-FLOW property is the whole point).
      - report-data.ts: append 'gbp' to SOURCES (display order — near gsc); TREND_KEYS.gbp = ["call_clicks","website_clicks"].
      - prompt.ts SOURCE_LABELS.gbp = "Google Business Profile (local presence + actions)" (or close).
      - render.ts: SOURCE_META.gbp = { badge:"Google Business Profile", title:"Local profile activity" } (match
        the existing copy register); add 'gbp' to SOURCE_ORDER; add ONE gbp KPI_SET card
        ({ source:'gbp', metric:'call_clicks', label:'Profile calls' }).
      - schema.ts: add `gbp: sourceSummary.optional()` to the sourceSummaries z.object.
      - evaluate.ts SOURCE_NAMES: add 'gbp' (no prefix collision; keep the longest-first ordering convention).
      - evaluate-grounding-regression.test.ts SEED: add a gbp { apr:{…}, may:{…} } fixture (mirror the gsc shape;
        keep the regression assertions passing — gbp numbers join the allowed-number set, none fabricated).
    Tests:
      - rollup.test.ts: gbp all-FLOW (2-row month sums each of the 9 keys; impressions_total sums independently
        of its 4 component splits; empty month -> null; assert NO derived/stock behavior for gbp).
      - report-data.test.ts: (1) a shop with synthetic gbp daily rows -> ReportData.sources.gbp present with
        current/prior/MoM + trend keyed by TREND_KEYS.gbp; (2) a shop with NO gbp rows -> gbp OMITTED, the four
        existing blocks unchanged.
    Avoid: a deriveMetric gbp branch; aggregate-excluding any gbp metric (all FLOW); touching page.tsx (13-02b);
    adding 'gbp_presence' anywhere; reshaping the existing four sources' entries.
  </action>
  <verify>`tsc` clean (exhaustiveness across every Record<AnalyticsSource,…> proves all 11 sites updated); `vitest run` green — new gbp rollup cases + the report-data gbp present/absent cases pass, and the existing rollup/report-data/evaluate/narrative/render suites are unchanged-green; `eslint` 0 err.</verify>
  <done>AC-3 + AC-4 + AC-5 satisfied; AC-6 boundaries held (no ingest/panel/presence; zero prod; no new dep).</done>
</task>

</tasks>

<boundaries>

## DO NOT CHANGE
- The Performance API ingest (`gbp-metrics` / `gbp-sync` / `/api/cron/gbp-sync` / vercel.json) — that is
  13-02b. This plan adds ZERO live API code; the union promotion is verified on synthetic fixtures.
- `src/app/dashboard/analytics/page.tsx` — the GBP dashboard panel is 13-02b.
- The shipped 12-05a/b migrations (20260611/20260612) and the 20260604/20260605 originals — widen via the
  NEW migration only, mirroring 20260612.
- `google_oauth_accounts` (13-01 already widened its source CHECK + GoogleOAuthSource union).
- The existing four sources' entries in every map (semrush/google_ads/ga4/gsc) — gbp is ADDITIVE.
- crypto / OAuth / link routes — untouched (13-01 owns them).

## SCOPE LIMITS
- Promotion + migration + unit tests ONLY. NO Performance API call, NO sync orchestrator, NO cron, NO panel,
  NO report-render smoke beyond unit assertions.
- `'gbp'` ONLY. `'gbp_presence'` (monthly STOCK presence + star rating) is 13-03 and must NOT enter the union
  or either CHECK here (it is a SnapshotSource-only value, RESEARCH §Data-model).
- ZERO prod contact: migration LOCAL via db reset; no prod migration/secret/deploy/live Google call.
- NO new runtime dependency.

</boundaries>

<verification>
Before declaring 13-02a complete:
- [ ] `supabase db reset` exit 0; psql `\d+` on analytics_snapshots AND analytics_sync_runs shows both source CHECKs admit 'gbp' with the full prior set; no 'gbp_presence'; the four prior migrations unedited
- [ ] `tsc` clean — every Record<AnalyticsSource,…> map carries a gbp entry (exhaustiveness proves completeness)
- [ ] `vitest run` green — new gbp rollup (all-flow, empty->null) + report-data (gbp present/absent) cases; existing rollup/report-data/evaluate/narrative/render suites unchanged
- [ ] `eslint` 0 err; GbpMetrics documented all-FLOW with impressions_total derived-at-ingest
- [ ] NO ingest code, NO page.tsx edit, NO cron, NO 'gbp_presence'; zero prod contact; no new dep
- [ ] All ACs met
</verification>

<success_criteria>
- `'gbp'` is a first-class AnalyticsSource: both analytics source CHECKs admit it, the rollup classes it as
  all-FLOW, and the report assembler produces a gbp block when data exists and omits it cleanly when it does not.
- The promotion is proven by `tsc` exhaustiveness (no map missed) + unit tests on synthetic fixtures, with the
  existing four-source report output and the numeric-groundedness eval gate untouched and green.
- 13-02b can now build the live ingest + panel against a real `GbpMetrics` type and a CHECK that accepts 'gbp',
  with `depends_on: ["13-02a"]`.
</success_criteria>

<output>
After completion, create `.paul/phases/13-gbp-presence/13-02a-SUMMARY.md`. Then `/paul:plan 13-02b`
(ingest + dashboard panel + e2e, `depends_on: ["13-02a"]`).

## Carry-forward to 13-02b (the live ingest — record so it is not rediscovered)
- **gbp-metrics is a FRESH parser, not a gsc clone.** Mirror only the seam/breaker/retry SHELL of
  gsc-metrics.ts. The `fetchMultiDailyMetricsTimeSeries` body is metric-major + doubly nested:
  `multiDailyMetricTimeSeries[].dailyMetricTimeSeries[].timeSeries.datedValues[]`. The parser must PIVOT
  metric-major -> date-major into `Map<date, GbpMetrics>`. Parse traps (RESEARCH §Response shape):
  `value` is an int64 serialized AS A STRING (`Number()`); dates are `google.type.Date {year,month,day}`
  (ASSEMBLE to ISO, never reformat a string); an absent value = 0; an empty `timeSeries` is a VALID ZERO,
  not a CircuitBreaker failure; a 404 = "not accessible / not linked", not an upstream error.
- **8 enum metrics requested, 9 stored keys.** Request exactly EIGHT DailyMetric enum values
  (BUSINESS_IMPRESSIONS_DESKTOP_MAPS, _DESKTOP_SEARCH, _MOBILE_MAPS, _MOBILE_SEARCH, BUSINESS_CONVERSATIONS,
  BUSINESS_DIRECTION_REQUESTS, CALL_CLICKS, WEBSITE_CLICKS). `impressions_total` is the 9th metrics KEY,
  computed at parse time as the per-day sum of the four impression splits — it is NOT an enum value and must
  NOT be sent as a dailyMetric (sending it 400s). Do NOT wire BUSINESS_BOOKINGS / BUSINESS_FOOD_ORDERS /
  BUSINESS_FOOD_MENU_CLICKS (always empty for collision repair).
- **The `auth:` idiom (mirror gbp-enumerate.ts), NOT gax `authClient:`.** Construct
  `google.businessprofileperformance({ version:'v1', auth })`. Reuse getLinkedAccount(shop,'gbp') /
  markAccountError / upsertSnapshots / CircuitBreaker / withRetry. GBP_RESYNC_DAYS default 7 (data-lag).
- **Cron:** `/api/cron/gbp-sync` (CRON_SECRET timingSafeEqual, runtime='nodejs', `gbp_not_configured` 503),
  vercel.json daily at `"0 7 * * *"` (after gsc-sync 45 6). Panel: additive "Local presence" section on
  page.tsx (per-shop + MSO aggregate — ALL metrics summable, no exclusion) + own unlinked state + e2e.

## ⚠️ The three Phase-13 day-1 operator gates remain open (from 13-01 — still on the clock)
Gate A (Business Profile API access 0->300 QPM, ~14-day Google review), Gate B (`business.manage`
sensitive-vs-restricted OAuth verification), and the revoked-key confirmation. 13-02a/02b build LOCAL; the
live Performance API smoke + prod migration + deploy are the 13-04 gate batch behind A + B.
</output>
