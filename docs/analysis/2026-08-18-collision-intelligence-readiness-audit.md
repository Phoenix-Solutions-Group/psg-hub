# Collision Intelligence Readiness Audit

**Audited:** 2026-08-18; updated 2026-08-20
**Verdict:** pilot analytics foundation is implemented; the full project is not complete

## 2026-08-20 update

- The first governed FileMaker repair export/import is reconciled. FileMaker returned
  330,535 rows across 34 pages with exactly 15 allowlisted fields and zero direct
  customer or agent PII fields. Supabase accepted 330,533 rows, rejected two with
  recorded reasons, superseded the prior snapshot, and retained no old-source facts.
- The latest read-only 2026-08-20 FileMaker preflight reports 330,778 available rows,
  exactly 15 allowlisted fields, and zero direct PII fields. The 243-row source delta
  was not exported or imported. An exact mapped-shop-name query still returns 3,420
  rows through 2025-12-24, so the new source rows do not unblock the pilot forecast.
- The refresh service is staged with its timer disabled. The imported feed is current,
  but the single mapped pilot's latest repair arrival remains 2025-12-24, so all four
  forecasts remain correctly gated rather than published.
- Live source reconciliation found 3,986 provisional SPC events from August 1–16
  without a matching source-ledger row. This branch adds an idempotent provenance
  backfill, a service-role-only reconciliation view, and a cron health gate. They are
  tested locally but are not applied or deployed to production.
- A current read-only FileMaker recheck found both the midnight and 3:00 AM August 20
  backups completed with all five hosted files. They still share a root that is now
  93% used with 5.6 GB free. The 92 overnight script messages are now classified:
  55 server-incompatible UI commands, 22 file/object-in-use cleanup steps, and 15
  missing-record navigation results. The first class is explainable noise; the latter
  two still need explicit handling and processed-row evidence. No server state changed;
  restore proof, script disposition, capacity disposition, and alert ownership still
  gate the disabled refresh timer.
- The superadmin Data Review page supports explicit source-shop mapping approval
  with target selection, written identity evidence, confirmation, and an atomic audit
  entry. This branch also adds repair freshness, storm-ledger reconciliation, KDOT
  coverage, and multi-shop forecast readiness without exposing service-role access to
  the browser. Forecast readiness now covers every mapped shop across all four target
  horizons rather than sampling four rows globally. One mapping remains active; 198
  candidates remain unapproved.
- Shop address evidence is now modeled as a separate service-only, audited
  Supabase decision before mapping. The branch keeps the two researched pilot
  addresses as clearly labeled display-only previews, adds a superadmin evidence
  form, and adds a database trigger that rejects missing or mismatched evidence.
  This migration is rollback-tested but not applied to production.
- Pre-mapping forecast evidence is now modeled as a reproducible service-only
  snapshot keyed by source shop, completed-week cutoff, input hash, and evaluator
  hash. It cannot map, approve, score, or publish. The branch reads the newest
  governed snapshot when present and labels the current code fallback as preview.
- The review route is discoverable in dashboard navigation only for superadmins. The
  page and mutation endpoint retain independent server-side role checks.
- The branch preview is deployed at
  `https://psg-hub-git-codex-collision-preview-20260819-psg-digital.vercel.app`.
  Authenticated desktop and mobile review passes. The insurer review was also checked
  against live data: searching `U S A A` returns its saved reporting name plus four
  official NAIC legal entities and never saves a fuzzy result automatically.
  Unauthenticated HTTP checks confirm the collision route redirects to login. The
  earlier draft PR [#18](https://github.com/Phoenix-Solutions-Group/psg-hub/pull/18)
  is closed; production release remains a separate gate.
- A linked `supabase db push --dry-run` made no production changes and stopped on the
  shared project's historical migration-ledger drift. Five already-applied collision
  migrations have the same names under different timestamps; older sibling-app drift
  also exists. Do not run global `migration repair` or `db pull` for this release.
- A fresh name-based live ledger reconciliation shows 13 local collision-scoped
  migration names remain unapplied. The refresh runbook now lists
  the complete timestamp-ordered release set and postflight contract; production is
  unchanged.
- Three legacy collision/accident RPCs and the browser grants on legacy accident,
  NHTSA, storm, and ZIP source relations now have service-role-only hardening staged
  and rollback-tested. This is the third pending collision migration; it is not applied
  to production.
- A fourth pending migration corrects weather coverage semantics. The live view
  currently treats a ZIP-month with no storm event as missing coverage and averages
  17.15% for the mapped shop. Loaded ZIP boundaries cover 99.36% of its historical
  repair volume; the corrected view reports that geographic coverage while retaining
  zero exposure for event-free months. Production remains unchanged.
- Read-only four-horizon evaluation identified two fresh, exact-address Lincoln
  candidates. PS228 and PS229 both pass the historical promotion gates; PS229 is the
  stronger first pilot. Neither source is mapped, and both target Hub shops currently
  have zero shop members, so no evidence was staged and no forecast was written.
- The review UI and evaluator preflight now show or check the target's customer
  audience. The pending staging and approval functions also require at least one
  assigned customer member; model rejection remains available if the audience is
  later removed. These guards are verified locally and are not applied to production.
- A read-only PS177 preflight exercises the mapped path: its historical evaluation
  passes, but its live member count is zero, so `review_staging_ready` is false.
- The customer dashboard now offers an active-shop-scoped CSV report using the same
  governed aggregate model as the screen. The export carries source freshness,
  forecast intervals and held-out evidence, weather/crash caveats, unknown-payment
  disclosure, matched signal/control windows, prospective paired rates, and the
  explicit no-individual-crash/no-claim-volume limitation. It labels prospective
  weather evidence descriptive-only and states that it cannot enable notifications or
  operational changes. Scheduled notifications remain disabled.
- A leakage-safe historical alert proxy now compares 21,795 severe-threshold
  shop/ZIP-months with 391,458 no-threshold controls. Follow-through is 4.89% versus
  4.39%, only a 0.50-point lift. Even ZIPs with 25+ prior repairs improve just 2.16
  points over their matched exposure control. The UI now says `Severe threshold met`
  rather than implying repair demand, and notifications remain disabled.
- Forecast and mapping review cards with an empty customer audience now link to the
  existing audited User Access workflow with the exact Hub shop preselected for both
  invitations and existing-user assignments. The workflow does not guess the intended
  customer or create a membership automatically.
- Forecast staging and approval now join `app_user_roles` directly and require the
  assigned shop member's authoritative global role to be `customer`. This closes the
  partial-release window in which a PSG staff membership could satisfy the RPC before
  the later audience triggers landed. A rollback-only runtime check proved staff-only
  staging and approval fail without mutation, while a real customer membership enables
  all four review horizons and approval. Production remains unchanged.
- The NAICS 811121 importer now accepts all three modeled evidence levels instead of
  silently making state authorization and PSG policy observations impossible to load.
  The pending database contract requires state authorization and policy evidence to
  name a legal NAIC company, requires state-specific evidence where applicable, and
  requires an active policy observation to include a term end date. Carrier marketing
  appetite remains explicitly separate from state availability and bindability.

### Fresh exact-address forecast candidates

The evaluator was frozen at completed Monday 2026-08-03, with 52 calibration weeks
and 52 chronological holdout weeks. It selected `seasonal_recent_blend_v1` at every
horizon for both candidates. The reported interval coverage is the separately held-out
shop policy after calibration; it is not a claim that every individual shop interval
will cover exactly 80% of future weeks.

| Source                                 | Exact Hub target                                         | Current history                                       | Holdout repairs | Four-horizon MAE improvement | Four-horizon WAPE | Held-out-shop interval coverage | Result and gate                                         |
| -------------------------------------- | -------------------------------------------------------- | ----------------------------------------------------- | --------------: | ---------------------------: | ----------------: | ------------------------------: | ------------------------------------------------------- |
| PS228 · Tracy's Collision Center North | North Lincoln · 4538 Cornhusker Hwy, Lincoln, NE 68504   | Through 2026-08-12; one 46-week internal gap excluded |             531 |                  16.5%–21.0% |       27.5%–29.1% |                     80.4%–85.1% | All four horizons pass; unmapped; 0 target-shop members |
| PS229 · Tracy's Collision Center South | South Lincoln · 1500 Center Park Road, Lincoln, NE 68512 | Through 2026-08-12; no long internal gap              |             844 |                  20.1%–24.1% |       17.7%–18.7% |                     80.4%–85.1% | All four horizons pass; unmapped; 0 target-shop members |

PS229 is the recommended first live pilot because its current segment is continuous,
its holdout contains more repair arrivals, and its error is materially lower at every
horizon. The exact-address evidence makes it eligible for human mapping review, not
automatic mapping. Before staging model evidence, PSG must confirm the target shop,
establish the intended shop-member audience, and approve the mapping. Mapping, review
staging, model approval, scoring, and publication remain separate audited actions.

## Requirement status

| Goal requirement                                                    | Status                                                     | Current evidence                                                                                                                                                                                                                                                                                                                                        | Remaining work                                                                                                                                                                                                       |
| ------------------------------------------------------------------- | ---------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Clean, documented, privacy-safe data                                | First manual refresh reconciled; recurring operation gated | 330,533 FileMaker facts reconcile to 330,535 parsed rows and two recorded rejections; direct PII and raw identifiers are absent; the restricted export contains exactly 15 approved fields; hardened service is staged with timer disabled                                                                                                              | Resolve the duplicate backup schedule, name an alert owner, prove restore recovery, apply storm provenance reconciliation, then separately approve recurring refresh                                                 |
| Consistent repair, insurance, geography, crash, and weather metrics | Pilot-ready; weather correction staged                     | Shop, carrier, ZIP, vehicle, seasonality, value, payment, and quality views are live; 411,208 KDOT rows are count-verified with a 99.93% crash ZIP match; the corrected weather definition measures 99.36% repair-weighted boundary coverage rather than event presence                                                                                 | Apply the reviewed weather migration; review insurer candidates and approve shop mappings only after identity confirmation                                                                                           |
| Operational dashboard                                               | Authenticated branch-preview QA passed; production pending | `/dashboard/collision-intelligence` includes repair, insurer, ZIP, vehicle, quality, 13-week period comparisons, complete-year seasonality, KDOT crash, weather, baseline, recent SPC signals, four-week forecasts, evidence-bound planning guidance, and a live scorecard; production build plus authenticated desktop/mobile Chromium checks pass     | Release only after the matching migrations are approved, then run a production authenticated smoke test                                                                                                              |
| ZIP-level weather and market alerts                                 | Matched-control lifecycle staged; notifications remain off | Service-only `v_collision_zip_alert_candidates`; atomic three-day SPC refresh; historical proxy shows 4.89% follow-through versus 4.39% control; acknowledgement pre-registers the nearest eligible prior-year shop/ZIP control; closure snapshots exact 1–4 week signal and control evidence; descriptive paired monitoring excludes unevaluable cases | Apply the lifecycle migration, name the organization-level notification owner, approve a minimum sample, economic lift, and false-positive tolerance, then accrue prospective cases before authorizing notifications |
| Weekly forecasts outperform a seasonal baseline                     | Two fresh candidates pass; publication gated               | PS228 and PS229 each beat the seasonal baseline across four horizons; PS229 improves MAE 20.1%–24.1% with 17.7%–18.7% WAPE and 80.4%–85.1% held-out-shop interval coverage; the existing mapped run remains correctly blocked as stale                                                                                                                  | Confirm memberships and one exact shop mapping, stage and approve its four models, score a current forecast, then accrue observed forecasts and review live error/coverage                                           |
| Clear confidence and limitations                                    | Implemented for dashboard and CSV pilot                    | Dashboard and active-shop CSV include freshness, promotion evidence, interval coverage, model scope, unknown-payment disclosure, matched weather controls, descriptive paired rates, metric contract, and evaluation reports                                                                                                                            | Add and verify the same disclosures if scheduled alerts are later authorized                                                                                                                                         |

## Live data coverage

### Repair data

- Complete privacy-safe FileMaker snapshot: 330,533 accepted facts from 330,535
  parsed rows; one missing-shop-key row and one invalid-repair-amount row were rejected
  and recorded in provenance.
- Full arrival history: 2011-01-18 through 2026-08-14; 330,514 rows have an arrival
  date and 330,404 have a completion date.
- Full payment mix: 264,625 insurance-classified, 64,760 known non-insurance, and
  1,148 unknown repairs; total recorded repair value is $1,671,343,984.99.
- 199 source shop keys are present. PS177 is explicitly mapped; 198 remain unmapped
  and cannot appear in participating-shop dashboards.
- Shop mapping, model promotion, forecasts, weather, and crash features use `shop_id`
  as the operational key. `company_id` is optional legacy attribution, so an existing
  PSG Hub shop no longer needs a synthetic company row.
- The mapped company has 3,420 FileMaker repair orders, 3,062 insurance-classified,
  358 known non-insurance, 129 distinct raw carrier labels, and $16,133,812.40 in
  repair value. The unified view contains zero legacy rows for that company.
- The mapped company's arrival history still ends 2025-12-24, so the dashboard
  correctly labels forecasting as not live even though other source shops are newer.
- The service-only insurer review table contains 1,056 normalized label candidates
  across the full snapshot. The mapped pilot has 101 normalized carrier labels and
  zero approved canonical aliases; the dashboard labels them unreviewed rather than
  silently merging names.

### Weather data

- `storm_zip_monthly`: 2016-01 through 2026-08.
- Live coverage is 677,056 reconciled NCEI events plus 25,999 provisional SPC events.
  Seven SPC batches reconcile; the 3,986-event August 1–16 batch currently lacks its
  source-ledger row. The branch migration repairs that row and makes future drift fail
  cron health, but production remains unchanged.
- 137 of 143 valid pilot customer ZIPs have loaded boundaries, covering 99.36% of
  historical repair volume. 135 ZIPs have at least one observed storm-event month.
- The live view's 17.15% average incorrectly measures monthly event presence as
  weather coverage. The staged correction uses loaded ZIP boundaries for coverage,
  treats absent event rows as zero observed events, and preserves the weighted event
  scores. Its synthetic local transaction passes at 75% boundary coverage with one
  covered zero-event ZIP and one uncovered ZIP.
- The latest preliminary SPC report is 2026-08-19.
- `weather_cache` is empty and is not a current dashboard or forecast input. Severe
  weather analysis uses governed storm-event/ZIP data; average temperature and
  precipitation analysis remains a separate future data-source decision.
- The 72-hour customer-ZIP review view currently returns six candidates, including
  one high signal. This count changes as the rolling window advances.

### Crash data

- Official KDOT import: 411,208 statewide crash facts from 2019-01-01 through
  2026-08-13; 410,910 ZIP matched and 298 explicitly unmatched.
- A read-only 2026-08-20 source probe now reports 411,206 KDOT rows for
  2019–2026 and the same latest crash date, 2026-08-13. The two-row difference
  from the governed import indicates a source revision, not newer crash
  coverage. No KDOT production refresh was run.
- `ksdot_crash_zip_monthly`: 45,048 rows across 725 ZIPs.
- Pilot customer-ZIP view: 92 months and 134,907 historical portfolio crashes.
- The existing legacy `crash_zip_annual` table contains Chicago data for 2022-2025
  and overlaps none of the pilot shop's customer ZIPs; it is not used here.
- The older partitioned `accidents` relation contains an estimated 7.7 million rows,
  but `accident_import_sources` has no provenance rows. It is not a governed collision
  dashboard input and should remain excluded until its source, license, row counts,
  and refresh contract are reconstructed or the relation is retired.
- Official 2024 NHTSA FARS, CRSS, and CISS tables are loaded. FARS is a fatal-crash
  census; CRSS/CISS are national probability samples and cannot substitute for local
  Kansas repair-demand counts.
- KDOT exposes a public ArcGIS crash service with the past ten years plus current
  submitted crashes, severity, weather, vehicles, and coordinates:
  `https://kanplan.ksdot.gov/arcgis_web_adaptor/rest/services/Transportation/Accidents/MapServer/0`.
- KDOT states that reporting is not real-time and that qualifying reports may arrive
  after investigation. Any PSG ingestion must preserve that freshness disclosure and
  KDOT attribution.

## Verification completed

- Supabase project is active and healthy on PostgreSQL 17.
- All collision views report `security_invoker=true` and are service-role-only.
- `anon` and `authenticated` have no direct select grant on repair facts or dashboard
  analysis views; an anonymous REST request to the fact table returns HTTP 401.
- The alert view is service-role-only; `authenticated` has no direct select grant.
- `replace_spc_preliminary_events` validates source, event type, coordinates, and a
  maximum four-day window before replacing data in one transaction.
- A local authenticated cron dry-run refreshed 750 rows across three convective days.
  The current 25,999 SPC rows have unique source IDs and populated event locations;
  the latest event begins 2026-08-19 16:22 UTC.
- Cron health now queries the service-only repair-feed freshness view. A mapped feed
  older than 36 hours returns `repairFeed: stale` and HTTP 500 after weather refresh
  and safe forecast scoring still run; unit coverage proves the three operations are
  not incorrectly short-circuited.
- `run_collision_weekly_forecasts` is service-role-only. Its 2026-08-17 run now
  records four separately promoted horizons with source age 237 days, status
  `stale_source`, and null prediction/interval values.
- The scorer requires an approved `collision_forecast_model_registry` row whose
  model MAE beats its registered seasonal baseline. PS177 uses `trailing4_v1`, with
  MAE 2.65 versus 3.63 and a conservative ±9 operating interval.
- Weeks 2–4 require independent entries in the service-only
  `collision_forecast_horizon_registry`. The gap-aware current-shop refresh still
  beats seasonal MAE by 19.6%–22.8% across all four horizons. Held-out-shop interval
  coverage is 81.5%, 81.6%, 78.8%, and 78.6%; horizons 3–4 need more evidence before
  any new interval policy is promoted.
- Forecasts retain origin week, target week, and horizon. This preserves forecast
  vintages for later accuracy and coverage monitoring instead of overwriting or
  mixing horizons.
- The service-only `v_collision_forecast_monitoring` view reports rolling
  13-observation MAE, WAPE, and interval coverage separately by horizon. All four
  PS177 rows currently report `awaiting_actuals` with 0 of 13 observations; no drift
  decision is made and no model status changes automatically.
- `collision_insurer_alias_reviews` and
  `v_collision_insurer_alias_candidates` are live, RLS/invoker protected, and
  service-role-only. The global alias queue and superadmin-only internal review route
  require an explicit canonical key and name, preserve concurrent decisions, and do
  not expose shop-mapping mutations. A rollback-only verification approved two
  candidate labels, confirmed they collapsed to one canonical insurer row, and left
  zero approvals after rollback.
- A rollback-only live schema test mapped PS773 to the existing Tedesco shop with no
  company row, exposed the then-current 1,116 repairs, built its weekly modeling frame,
  accepted a shop-keyed review model, and persisted only a blocked null forecast.
  The transaction was rolled back; Tedesco remains unmapped pending explicit approval.
  The refreshed source now contains 1,152 PS773 repairs through 2026-08-05. Gap-aware
  evaluation rejects it because the post-gap segment has only 62 weeks.
- The dashboard code now exposes alert-feed refresh time, a per-shop repair-feed
  freshness badge with a 36-hour threshold, a four-week operating outlook,
  horizon-specific intervals, planning checkpoints, and live monitoring reasons.
- A read-only production check of the new 13-week comparison returns 85 recent versus
  107 prior repair orders, $476,508.51 versus $606,607.49 in repair value, and 15.71
  versus 15.69 average cycle days. The source remains stale, so these are historical
  period comparisons rather than a current operating claim.
- A read-only production seasonality check identifies five complete interior source
  years (2020–2024). June leads average repair arrivals at 55.0; October leads average
  repair value at $261,387.39. These are repair-order patterns, not crash or claim
  volumes.
- A read-only Supabase advisor baseline found 40 collision/accident/weather security
  notices: 37 informational RLS-without-policy notices and three mutable-search-path
  warnings. Eleven collision/KDOT tables already deny browser roles and intentionally
  rely on service-only access rather than end-user policies.
- The other source relations are not accepted as informational yet. Twenty-seven
  legacy accident, NHTSA, storm, and ZIP relations still grant browser roles direct
  reads, writes, deletes, and `TRUNCATE`; four related sequences also retain browser
  grants. RLS does not protect `TRUNCATE`. The staged hardening migration revokes those
  grants and asserts service-role access before release.
- The three warnings belong to `collision_targeting_examples`,
  `storm_demand_examples`, and `refresh_accident_market_rollups`. The staged migration
  fixes their `search_path`, revokes execution from `public`, `anon`, and
  `authenticated`, preserves `service_role`, and contains database assertions for both
  properties. A local transaction applied the migration and rolled it back successfully.
- The pre-existing `v_collision_targeting_zip_annual` security-definer error was
  removed; the view is now invoker-security and service-role-only.
- The collision-scoped performance baseline contains 47 informational notices. The one
  actionable release finding—a missing covering index for the insurer-registry foreign
  key—is now staged in the already-pending acronym migration and rollback-tested. The
  13 no-primary-key notices belong to excluded legacy accident partitions, and 33
  unused-index notices remain observational until a sustained production workload can
  justify deletion.
- Advisor references: [RLS enabled without a policy](https://supabase.com/docs/guides/database/database-linter?lint=0008_rls_enabled_no_policy),
  [mutable function search path](https://supabase.com/docs/guides/database/database-linter?lint=0011_function_search_path_mutable),
  and [unindexed foreign key](https://supabase.com/docs/guides/database/database-linter?lint=0001_unindexed_foreign_keys).
- Source ledger counts reconcile to 330,535 parsed, 330,533 accepted, and two rejected.
  The prior source is `superseded`, has zero remaining facts, and an identical-file
  rerun was skipped without a second import.
- A read-only production execution of the forecast-readiness query returns all four
  expected pilot shop/horizon rows and correctly gates all four as `stale_source`. An
  isolated PostgreSQL fixture also verifies `published`, `model_not_approved`,
  `not_generated`, `model_mismatch`, `forecast_outdated`, and `stale_source` states.
- A read-only audience audit found the legacy approved PS177 policy has no global
  `customer` member. No forecast row is published, but the existing database check
  counted any shop membership. The staged customer-audience migration adds shared
  database triggers that prevent review, approval, or publication unless a linked
  member has the global `customer` role; PSG staff memberships no longer clear the
  gate. The internal review page now exposes any legacy approved policy with no
  customer audience and links directly to that shop's User Access screen without
  changing approval state or creating a membership. Production data remains unchanged
  pending separate migration approval.
  Cron health now fails when any mapped shop/horizon remains gated after scoring.
- Unified mapped source and weekly-demand counts both reconcile to 3,420 repair orders;
  all are FileMaker rows and no legacy pilot rows are unioned.
- Weekly cycle denominator reconciles to 3,420 observations and 14.8 days.
- Weather review acknowledgement pre-registers the nearest eligible same-shop/ZIP
  control one to five years earlier using complete repair span, loaded final NCEI
  years, ZIP-boundary coverage, and severe-threshold exclusion before signal outcomes
  are known. Evidence uses four non-overlapping seven-day windows and each period's
  prior 364 days. Closure snapshots signal and control counts plus repair-feed
  freshness in the case and immutable audit event. The database derives follow-through
  from the registered arrival-count threshold, rejects contradictory operator input,
  and exposes only closed evaluable pairs in descriptive monitoring. Notifications
  remain disabled and no production schema or data changed.
- Python self-checks, targeted ESLint, 3,331 unit tests, the production Next.js build,
  and the 60-test CI browser suite pass. The standalone `pnpm typecheck` currently
  reports named-capture-group errors in the newly inherited Riverside seed test from
  `main`; the production build's TypeScript phase and all PR checks pass, and no
  collision file is implicated.
- A deterministic zero-PII fixture exercises 460 repair orders across 120 source
  weeks through the real local login flow. Nine required dashboard-section
  assertions, desktop and mobile Chromium captures, and WCAG A/AA checks pass with
  zero serious or critical violations. Temporary local schema alignment and its
  synthetic company row were removed after capture. Browser review also fixed a
  borderline forecast-text contrast failure and a stale company-first disclosure.
- The FileMaker DDR confirms Repair Customer `FMTID:131`, `fmrest`/`fmodata`
  capability, and that the legacy export script is interactive and PII-heavy. A new
  OData extractor requests only the 15 importer fields, filters the observed 2020+
  source scope, enforces 300,000-500,000 source rows and exact `@odata.count`
  reconciliation, rejects off-host pagination, and atomically publishes a mode-0600
  file. Its two-page self-test and the importer's optional file-age gate pass. The
  importer now also rejects missing, unexpected, or duplicate CSV columns and provides
  a no-secret, no-network validation-only reconciliation pass before any database write.
- Live unauthenticated endpoint checks identify `https://psgweb.me` as the current
  FileMaker host: Data API product information returns HTTP 200 and the Advantage
  OData metadata endpoint returns the expected HTTP 401 authentication challenge.
  The `fm.psghub.me`, `fm2.psghub.me`, and `fm3.psghub.me` names are stale or
  misconfigured and are excluded from the refresh contract.
- Supabase migration `collision_repair_feed_freshness` is live. Its per-shop view is
  `security_invoker=true`, grants select only to `service_role`, and reports the newly
  loaded source as current. The mapped 3,420-row pilot still ends 2025-12-24, so its
  repair-arrival freshness gate remains closed.
- KDOT source counts match the live ArcGIS service for every imported year.
- Crash/weather feature evaluation keeps the trailing four-week model as champion;
  KDOT improves the comparable ridge model by 2.1% MAE but not enough to promote.
- Gap-aware multi-shop chronological evaluation found trailing-4 MAE 3.00 versus
  seasonal MAE 3.89 in the 44-shop current segment. Trailing-4 beat seasonal in 40
  shops. A 1.10× interval multiplier selected on 22 shops covered 81.5% of holdout
  weeks in a separate 22-shop validation group. Long internal zero runs are treated
  as unknown source coverage rather than synthetic zero demand.

## Next execution order

1. Resolve the FileMaker operations gate: the owner must decide whether the duplicate
   3:00 AM backup is intentional and either free or relocate capacity safely, classify
   the nightly script errors as expected or failed processing, prove restore recovery,
   and name the person or channel that receives refresh failures. Keep the daily
   refresh timer disabled until those controls are approved and verified.
2. After separate production approval, apply the storm source-reconciliation,
   forecast-readiness, example-function hardening, weather-coverage, governed shop
   identity, and forecast-candidate evidence migrations, then deploy the matching
   cron health checks. Because
   the shared migration ledger is divergent, use
   individually reviewed migration execution after approval rather than `db push`,
   `migration repair`, or `db pull`. Confirm every NCEI/SPC batch is reconciled, every
   mapped shop/horizon has an explainable state, weather coverage equals loaded
   boundary coverage, and browser roles cannot read the service-only views or RPCs.
   Separately approve and run the idempotent KDOT refresh when its read-only probe
   differs from the governed source ledger; reconcile the new exact source count,
   ZIP resolution, and monthly rollups before calling crash data current.
3. Use `/dashboard/collision-intelligence/review` as a superadmin to review the
   highest-volume insurer aliases and source-shop mappings. First record an
   authoritative physical address in the governed evidence form; mapping approval
   then requires an exact Hub address, written identity notes, and explicit
   confirmation, and it is committed with its audit entry in one transaction. For
   the first current forecast pilot, verify the intended member audience for South
   Lincoln, then review PS229 against its exact 1500 Center Park Road address. After
   mapping approval, rerun the evaluator, record the reproducible snapshot, stage the
   four passing horizons, and review model approval as a separate action. PS773 to
   Tedesco Auto Body remains ineligible because only 62 weeks remain after a
   multi-year coverage gap. Never infer a mapping or insurer alias from name
   similarity alone.
4. After 13 observed forecasts accrue per horizon, review the live monitoring status.
   Manual review is requested when rolling MAE loses to seasonal or 80% interval
   coverage falls below 70%; the scorecard never changes promotion automatically.
5. Authenticated desktop/mobile review of the deployed branch preview passes. Keep
   production deployment and its authenticated smoke test as separate release gates.
6. Deploy separately, then smoke-test the Vercel cron and keep notifications disabled
   while the staged owner/manager acknowledgement and demand-outcome lifecycle accrues
   prospective evidence. Name the organization-level notification owner and approve
   the business threshold before any external delivery is considered.
