---
phase: 13-gbp-presence
plan: 03a
type: execute
wave: 1
depends_on: []   # foundation: chains after the 13-02a migration + reuses the 13-01 external_parent_id column; no 13-02b code dependency
files_modified:
  - supabase/migrations/<ts>_gbp_presence_source.sql                    # NEW (3rd CHECK-widen: +'gbp_presence' on both source CHECKs)
  - src/lib/analytics/types.ts                                          # EDIT (SnapshotSource += 'gbp_presence' + NEW GbpPresenceMetrics jsonb type)
  - src/lib/google-oauth/accounts.ts                                    # EDIT (getLinkedAccount: select + return external_parent_id; LinkedAccount += externalParentId)
  - src/lib/google-oauth/__tests__/accounts.test.ts                     # EDIT (+externalParentId returned for gbp w/ parent, null for ga4/gsc)
  - src/lib/report/types.ts                                             # EDIT (NEW GbpPresenceReport + ReportData.gbpPresence?)
  - src/lib/report/report-data.ts                                       # EDIT (MonthlyGbpPresenceReader + buildGbpPresence + additive gbpPresence? — mirror performance)
  - src/lib/report/__tests__/report-data.test.ts                        # EDIT (+gbpPresence present-with-row / absent-omitted)
autonomous: true   # build is LOCAL + test/tsc-gated. NO live Google call, NO ingest, NO prod. Prod migration apply = the 13-04 gate batch under PROTOCOL.
---

<objective>
## Goal
Lay the foundation for the monthly GBP presence + star-rating snapshot: a third CHECK-widening
migration that admits `'gbp_presence'`, the `GbpPresenceMetrics` jsonb type (location state +
average_rating/total_review_count), the one read-side seam fix that unblocks the v4 reviews parent
(`getLinkedAccount` must return `external_parent_id`), and the additive rollup-bypassing
`ReportData.gbpPresence?` block wired exactly like `dimensions?` / `performance?` — all LOCAL,
tsc/test-proven, ZERO prod. The actual ingest (Business-Info `locations.get` + the v4 raw-HTTP
rating aggregate + monthly orchestrator + cron + surface + e2e) is 13-03b.

## Purpose
13-03 is the monthly presence + rating half of Phase 13. Like 13-02 it splits foundation from
ingest: this plan is the cross-cutting, tsc/test-provable half (a migration + a SnapshotSource-only
type + a read-path seam fix + the report data block), 13-03b is the vertical that writes the data and
surfaces it. `'gbp_presence'` is STOCK monthly, so per the codebase's FLOW-vs-STOCK rule it stays a
`SnapshotSource`-only extra (mirroring `performance` / `ga4_dimensions`) and MUST NOT enter the
`AnalyticsSource` union (forcing it in would fabricate a fake daily rollup on a point-in-time average).
The star rating (lifetime `averageRating` + `totalReviewCount`) rides ON the same `gbp_presence` row
jsonb, per 13-03-RESEARCH §Data-model.

## Output
- NEW migration (mirror `20260614202719_gbp_insights_source.sql`): both source CHECKs admit
  `'gbp_presence'`, full prior set preserved.
- `types.ts`: `SnapshotSource` += `'gbp_presence'`; NEW `GbpPresenceMetrics` (open_status,
  primary_category, categories, has_hours, website_uri, has_description, phone_present,
  completeness_score?, average_rating: number|null, total_review_count: number|null).
- `accounts.ts`: `getLinkedAccount` selects + returns `external_parent_id`; `LinkedAccount` gains
  `externalParentId: string | null` (generic — null for ga4/gsc, the `accounts/{aid}` half for gbp).
- `report/types.ts` + `report-data.ts`: NEW `GbpPresenceReport` + `MonthlyGbpPresenceReader` +
  `buildGbpPresence` + additive `ReportData.gbpPresence?` (rollup-bypassing, omitted when no reader/row).
- Unit tests (accounts externalParentId; report-data gbpPresence present/absent). At UNIFY: 13-03a-SUMMARY.
</objective>

<context>
## Project Context
@.paul/PROJECT.md
@.paul/ROADMAP.md
@.paul/STATE.md

## Phase research (research-first gate — REQUIRED, satisfied)
@.paul/phases/13-gbp-presence/13-RESEARCH.md
# Authoritative: §Data-model mapping (the FLOW-vs-STOCK split — 'gbp_presence' is SnapshotSource-only,
# NOT the union; the three CHECK-widening migrations; the presence jsonb shape at line 187).
@.paul/phases/13-gbp-presence/13-03-RESEARCH.md
# Authoritative for THIS plan's two foundation decisions: (1) the getLinkedAccount external_parent_id
# read-side seam fix (write side already done at 13-01) — §Raw-HTTP auth seam "BLOCKING SEAM GAP";
# (2) the rating lives ON the gbp_presence row as average_rating/total_review_count (both number|null,
# row written even on rating failure) — §Data-model decision.

## Prior work consumed (the foundation + the precedent)
@.paul/phases/13-gbp-presence/13-02a-SUMMARY.md   # the 'gbp' union promotion + the CHECK-widen migration pattern this mirrors (drop+recreate both CHECKs, auto-named sync_runs resolves to standard name)
@.paul/phases/13-gbp-presence/13-01-SUMMARY.md     # external_parent_id column (nullable, holds 'accounts/{id}' for gbp) + persistLinkedAccount writes it

## Patterns to mirror
@supabase/migrations/20260614202719_gbp_insights_source.sql   # the EXACT CHECK-widen migration to clone (+'gbp_presence' instead of +'gbp')
@src/lib/analytics/types.ts                                   # SnapshotSource (= AnalyticsSource | 'ga4_dimensions' | 'performance'); the "monthly-only extra, NOT in the union" doc; GbpMetrics shape style
@src/lib/google-oauth/accounts.ts                            # getLinkedAccount (select l.79, LinkedAccount l.58-62, return l.110-114) — widen all three; persistLinkedAccount already writes external_parent_id
@src/lib/report/types.ts                                     # ReportData.performance? + PerformanceReport — the additive optional block to mirror
@src/lib/report/report-data.ts                              # MonthlyPerformanceReader + buildPerformance + the additive performance? in assembleReportData — the EXACT template for gbpPresence?
@src/lib/report/__tests__/report-data.test.ts               # the present/absent test pattern for an additive monthly block
</context>

<skills>
## Required Skills (research-first gate)

| Skill | Priority | When to Invoke | Loaded? |
|-------|----------|----------------|---------|
| Research-first / per-plan research check | required | Before authoring (this plan) | ✓ — 13-RESEARCH §Data-model + 13-03-RESEARCH (the seam fix + the rating-on-presence-row decision) cover this plan fully |
| Context7 / introspection | n/a | — | Not needed for 13-03a: NO external API surface is touched here (the Business-Info `locations.get` + the v4 reviews `.request` are 13-03b). 13-03a is pure schema/type/data-layer. |

**BLOCKING:** Research gate satisfied. No new external API contract is opened by 13-03a, so no
APPLY-time contract introspection is required (unlike 13-02b / 13-03b).
</skills>

<acceptance_criteria>

## AC-1: migration — both source CHECKs admit 'gbp_presence', full prior set preserved, LOCAL-verified, NOT a union member
```gherkin
Given the analytics_snapshots + analytics_sync_runs source CHECKs admit semrush/google_ads/ga4/gsc/ga4_dimensions/performance/gbp (after 13-02a)
When a new migration <ts>_gbp_presence_source.sql is applied (mirror of 20260614202719_gbp_insights_source)
Then it drops+recreates BOTH source CHECKs to the FULL set + 'gbp_presence'
     (analytics_snapshots keeps the null allowance; analytics_sync_runs stays NOT NULL), using the
     standard constraint names (the auto-named analytics_sync_runs_source_check resolves to the standard
     name — the 12-05b/13-02a path)
And `supabase db reset` exits 0 with the new migration applied last; psql pg_get_constraintdef shows BOTH
     CHECKs admit 'gbp_presence'; a 'gbp_presence' analytics_sync_runs insert is ACCEPTED and a bogus
     source is REJECTED (rolled back)
And NO other migration is edited; ZERO prod contact (prod apply = the 13-04 gate batch under PROTOCOL).
```

## AC-2: GbpPresenceMetrics type — STOCK monthly shape incl. nullable rating, SnapshotSource-only (NOT the union)
```gherkin
Given the report needs a typed monthly presence + rating shape
When types.ts is edited
Then `SnapshotSource` becomes `AnalyticsSource | "ga4_dimensions" | "performance" | "gbp_presence"`
     (AnalyticsSource is UNCHANGED — 'gbp_presence' is NOT promoted into the union)
And a NEW `GbpPresenceMetrics` type documents the gbp_presence jsonb: open_status (string),
     primary_category (string|null), categories (string[]), has_hours (boolean), website_uri
     (string|null), has_description (boolean), phone_present (boolean), completeness_score (number,
     optional), average_rating (number | null), total_review_count (number | null) — with a doc note
     that it is point-in-time STOCK (never rolled up), the rating fields come from the v4 reviews
     aggregate (13-03b) and are null when that call fails (the row is still written), and that this
     source stays SnapshotSource-only by the FLOW-vs-STOCK rule
And tsc is clean.
```

## AC-3: getLinkedAccount returns external_parent_id (the read-side seam fix), generic, callers unaffected
```gherkin
Given persistLinkedAccount already WRITES external_parent_id (13-01) but getLinkedAccount never reads it back
When accounts.ts is edited
Then getLinkedAccount adds `external_parent_id` to its select, `LinkedAccount` gains
     `externalParentId: string | null`, and the return includes it (the bare value as stored:
     'accounts/{aid}' for gbp, null for ga4/gsc)
And the widening is GENERIC (one reader serves all sources; the field is simply null for ga4/gsc) —
     the existing gbp-client / gsc-client / ga4-client destructures ({accountId, externalAccountId,
     refreshToken}) keep compiling (additive field, no breakage)
And a unit test proves externalParentId is returned (a gbp row with a parent → 'accounts/...'; a
     ga4/gsc row → null); tsc + the existing accounts suite stay green.
```

## AC-4: ReportData.gbpPresence? — additive rollup-bypassing block, mirror of performance?
```gherkin
Given assembleReportData already builds additive dimensions? / performance? off a monthly reader
When report/types.ts + report-data.ts are edited
Then report/types.ts gains a `GbpPresenceReport` type (the report-layer view: openStatus,
     primaryCategory, categories, hasHours, websiteUri, hasDescription, phonePresent,
     completenessScore?, averageRating: number|null, totalReviewCount: number|null) and
     `ReportData.gbpPresence?: GbpPresenceReport` (ADDITIVE + OPTIONAL, parallel to performance?, NOT
     in `sources`, NEVER in the AnalyticsSource union)
And report-data.ts gains a `MonthlyGbpPresenceReader` type + a `buildGbpPresence(row)` (NEVER calls
     rollupMonth — STOCK; maps the snake_case jsonb to the camelCase report shape) + an optional
     `AssembleDeps.readMonthlyGbpPresence?` + the additive `gbpPresence?` spread in the return — an
     EXACT structural mirror of the performance? path (rollup-bypassing, omitted when no reader is
     wired or no monthly row exists; the daily SOURCES loop is byte-unchanged)
And report-data tests prove: gbpPresence present (a fixture monthly row → a populated block with the
     rating mapped) and absent (no reader → gbpPresence undefined, the existing four+gbp blocks
     unchanged); tsc + the existing report suite stay green.
```

## AC-5: Boundaries — foundation only; no ingest/fetch/render/dashboard; no union promotion; zero prod
```gherkin
Given 13-03b owns the ingest + surface and 13-04 owns prod
When 13-03a completes
Then there is NO orchestrator, NO cron, NO Business-Info locations.get fetch, NO v4 reviews .request,
     NO render.ts/prompt.ts CONSUMPTION of gbpPresence, NO dashboard panel (all 13-03b), and NO live
     Google call
And 'gbp_presence' is NOT added to the AnalyticsSource union / METRIC_REGISTRY / the union's exhaustive
     maps (render SOURCE_META/SOURCE_ORDER/KPI_SET, prompt SOURCE_LABELS, schema sourceSummaries,
     evaluate SOURCE_NAMES, report-data SOURCES/TREND_KEYS) — it is SnapshotSource-only
And the shipped GA4/GSC/Ads/gbp ingest + the report narrative/eval binding are untouched; ZERO prod
     contact (LOCAL `supabase db reset` only; prod migration apply = 13-04).
```

</acceptance_criteria>

<tasks>

<task type="auto">
  <name>Task 1: 3rd CHECK-widen migration (+'gbp_presence') + GbpPresenceMetrics type + SnapshotSource</name>
  <files>supabase/migrations/&lt;ts&gt;_gbp_presence_source.sql, src/lib/analytics/types.ts</files>
  <action>
    Migration: `supabase migration new gbp_presence_source` → mirror 20260614202719_gbp_insights_source.sql
    EXACTLY, swapping the added value to 'gbp_presence'. Drop+recreate BOTH source CHECKs to the full set
    `('semrush','google_ads','ga4','gsc','ga4_dimensions','performance','gbp','gbp_presence')`:
    analytics_snapshots keeps its null allowance (source can be null per the inherited table); analytics_sync_runs
    stays NOT NULL. Use the standard constraint names `analytics_snapshots_source_check` /
    `analytics_sync_runs_source_check` with `drop constraint if exists` (the auto-named sync_runs constraint
    resolves to the standard name — proven on prod in 12-05c, locally in 13-02a). Do NOT edit any prior migration.
    types.ts: `export type SnapshotSource = AnalyticsSource | "ga4_dimensions" | "performance" | "gbp_presence";`
    (leave AnalyticsSource UNCHANGED). Add `GbpPresenceMetrics` near GbpMetrics with a doc block: point-in-time
    STOCK monthly (one row per (shop,'gbp_presence',YYYY-MM-01), read via getMonthlySnapshot, NEVER rolled up,
    NOT in the union); fields: open_status: string; primary_category: string | null; categories: string[];
    has_hours: boolean; website_uri: string | null; has_description: boolean; phone_present: boolean;
    completeness_score?: number; average_rating: number | null; total_review_count: number | null. Doc the
    rating pair: lifetime aggregate from the v4 reviews call (13-03b), both null when that call fails OR the
    location has no reviews (the orchestrator still writes the presence row — that is why both are nullable,
    per 13-03-RESEARCH §Data-model).
    LOCAL VERIFY: start Docker/supabase if needed → `supabase db reset` exit 0 → psql:
    `select pg_get_constraintdef(oid) from pg_constraint where conname like '%source_check%';` shows both admit
    'gbp_presence'; insert a 'gbp_presence' analytics_sync_runs row (accepted) + a bogus source (rejected, rollback).
    Avoid: a DO-block (the standard-name drop-if-exists is enough — 13-02a proved it); adding 'gbp_presence' to
    AnalyticsSource; touching google_oauth_accounts / RLS; any prod contact.
  </action>
  <verify>`supabase db reset` exit 0 (new migration last); psql shows BOTH CHECKs admit 'gbp_presence' + reject bogus; `tsc` clean (GbpPresenceMetrics compiles; AnalyticsSource unchanged).</verify>
  <done>AC-1 + AC-2 satisfied.</done>
</task>

<task type="auto">
  <name>Task 2: getLinkedAccount externalParentId fix + ReportData.gbpPresence? wiring + unit tests</name>
  <files>src/lib/google-oauth/accounts.ts, src/lib/google-oauth/__tests__/accounts.test.ts, src/lib/report/types.ts, src/lib/report/report-data.ts, src/lib/report/__tests__/report-data.test.ts</files>
  <action>
    accounts.ts (the read-side seam fix — write side already done at 13-01):
      - getLinkedAccount select (l.79): add `external_parent_id` →
        `.select("id, external_account_id, external_parent_id, encrypted_refresh_token, key_version")`.
      - `LinkedAccount` type (l.58-62): add `externalParentId: string | null`.
      - return (l.110-114): add `externalParentId: (row.external_parent_id as string | null) ?? null`.
      Generic widen — null for ga4/gsc, 'accounts/{aid}' for gbp. The existing gbp-client/gsc-client/ga4-client
      destructure only {accountId, externalAccountId, refreshToken}; an added field is non-breaking.
    accounts.test.ts: extend the getLinkedAccount tests (mirror the existing makeService/mock pattern) — a gbp
      row with external_parent_id='accounts/123' → externalParentId 'accounts/123'; a ga4/gsc row with null →
      externalParentId null. Keep all existing assertions green.
    report/types.ts: add `GbpPresenceReport` (report-layer camelCase view: openStatus: string;
      primaryCategory: string | null; categories: string[]; hasHours: boolean; websiteUri: string | null;
      hasDescription: boolean; phonePresent: boolean; completenessScore?: number; averageRating: number | null;
      totalReviewCount: number | null) + `gbpPresence?: GbpPresenceReport` on ReportData (doc it ADDITIVE +
      OPTIONAL, parallel to performance?, STOCK, never rolled up, never in the union).
    report-data.ts (mirror the performance? path EXACTLY): add `MonthlyGbpPresenceReader` type (same signature
      as MonthlyPerformanceReader); `buildGbpPresence(row: MonthlySnapshotRow): GbpPresenceReport` that reads
      `row.metrics as Partial<GbpPresenceMetrics>` and maps snake_case→camelCase (NEVER calls rollupMonth);
      add `readMonthlyGbpPresence?: MonthlyGbpPresenceReader` to AssembleDeps; in assembleReportData add the
      additive block after `performance` (`let gbpPresence; if (deps.readMonthlyGbpPresence) { const row =
      await deps.readMonthlyGbpPresence({shopId, month: periodMonth}); if (row) gbpPresence =
      buildGbpPresence(row); }`) and spread `...(gbpPresence ? { gbpPresence } : {})` in the return. The daily
      SOURCES loop + dimensions?/performance? stay byte-unchanged.
    report-data.test.ts: +2 — gbpPresence present (a fixture gbp_presence monthly row via a stub
      readMonthlyGbpPresence → a populated GbpPresenceReport with average_rating/total_review_count mapped) and
      absent (no reader → gbpPresence undefined; the existing assembly unchanged).
    Avoid: rendering/prompting gbpPresence (13-03b); adding 'gbp_presence' to SOURCES/TREND_KEYS (union-only);
      calling rollupMonth on presence; editing the daily loop or the dimensions/performance blocks.
  </action>
  <verify>`tsc` clean; `vitest run` green — new accounts (externalParentId) + report-data (gbpPresence present/absent) tests pass, existing suites unchanged; `pnpm build` ✓ (no new dep).</verify>
  <done>AC-3 + AC-4 satisfied; AC-5 boundaries held.</done>
</task>

</tasks>

<boundaries>

## DO NOT CHANGE
- The `AnalyticsSource` union or its exhaustive maps (rollup METRIC_REGISTRY, report-data SOURCES/TREND_KEYS,
  render SOURCE_META/SOURCE_ORDER/KPI_SET, prompt SOURCE_LABELS, schema sourceSummaries, evaluate SOURCE_NAMES).
  'gbp_presence' is SnapshotSource-ONLY — adding it to the union would fabricate a fake daily rollup on STOCK.
- The shipped GA4/GSC/Ads/gbp ingest (sync orchestrators, cron routes, metrics/client modules) + the daily
  dashboard panels — untouched.
- The report NARRATIVE / EVAL binding (prompt buildPlaceholders, evaluate) — 13-03a only adds the DATA block to
  ReportData; render/prompt CONSUMPTION of gbpPresence is 13-03b (avoids the 12-04 grounding trap).
- prior migrations (20260604/05/11/12, 20260614194040, 20260614202719) — unedited.
- crypto / OAuth / the gbp link routes (13-01) — untouched (getLinkedAccount widen is additive, read-only).

## SCOPE LIMITS
- Foundation ONLY: migration + types + the getLinkedAccount read-side fix + the ReportData.gbpPresence? data
  block. NO ingest (Business-Info locations.get / v4 reviews .request / orchestrator / cron / vercel.json), NO
  render/dashboard surface, NO e2e — all 13-03b.
- ZERO prod contact: LOCAL `supabase db reset` + psql only. Prod migration apply = the 13-04 gate batch under
  PROTOCOL.
- NO new dependency. NO live Google call (13-03a touches no external API surface).

</boundaries>

<verification>
Before declaring 13-03a complete:
- [ ] `supabase db reset` exit 0 (new gbp_presence migration applied last); psql: BOTH source CHECKs admit 'gbp_presence' + reject bogus; auto-named sync_runs constraint resolved by standard name
- [ ] `tsc` clean (SnapshotSource += 'gbp_presence'; AnalyticsSource UNCHANGED; GbpPresenceMetrics + GbpPresenceReport compile)
- [ ] `vitest run` green — new accounts (externalParentId) + report-data (gbpPresence present/absent) tests; existing suites unchanged
- [ ] `pnpm build` ✓ — no new dep
- [ ] eslint 0 err / 0 new warn
- [ ] 'gbp_presence' NOT in the AnalyticsSource union or any exhaustive map; no ingest/cron/fetch/render/dashboard; report narrative/eval untouched; ZERO prod contact
- [ ] All ACs met
</verification>

<success_criteria>
- The schema, types, read-path seam, and report data block needed by the 13-03b monthly presence + rating
  ingest are in place, LOCAL-verified and tsc/test-proven, with ZERO prod contact and no union pollution.
- `getLinkedAccount` now returns the `accounts/{aid}` parent (the one read-side blocker the v4 reviews call
  needs), generically and without breaking the ga4/gsc/gbp callers.
- `ReportData.gbpPresence?` assembles from a monthly row exactly like `performance?` — ready for 13-03b to feed
  and a later render/prompt to consume.
</success_criteria>

<output>
After completion, create `.paul/phases/13-gbp-presence/13-03a-SUMMARY.md`. Then `/paul:plan 13-03b`
(Business-Info locations.get presence fetch + the v4 raw-HTTP rating aggregate + the monthly presence
orchestrator + cron 0 4 1 + vercel.json 9th cron + render/dashboard surface + e2e). LIVE verification
(real locations.get + the v4 reviews call vs Wallace + deploy) is the Phase-13 gate batch (13-04).

## ⚠️ Phase-13 Google gates still open (unchanged, still on the clock)
Gate A (Business Profile API access 0→300 QPM — covers Performance AND v4 reviews per 13-03-RESEARCH; the
legacy "Google My Business API" still needs ENABLEMENT in the GCP project), Gate B (`business.manage`
verification), and the revoked-key confirmation. 13-03a/03b build LOCAL; the live calls + prod migration +
deploy are the 13-04 gate batch behind A + B.
</output>
