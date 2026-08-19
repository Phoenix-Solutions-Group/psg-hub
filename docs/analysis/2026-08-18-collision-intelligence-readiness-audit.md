# Collision Intelligence Readiness Audit

**Audited:** 2026-08-18
**Verdict:** pilot analytics foundation is implemented; the full project is not complete

## 2026-08-19 update

- The dedicated FileMaker repair account, exact hosted-file/entity identifiers, and
  bounded 2020+ OData probe are verified. The probe reported 330,530 rows, exactly
  15 allowlisted fields, and zero direct customer or agent PII fields. The hardened
  refresh service is staged with its timer disabled; no full export/import has run.
- A read-only production baseline confirms 327,313 currently loaded repair facts,
  199 source shops, one approved mapping, four stale forecasts, and three approved
  model horizons. The pre-import reconciliation contract is recorded in the refresh
  runbook.
- Live source reconciliation found 3,986 provisional SPC events from August 1–16
  without a matching source-ledger row. This branch adds an idempotent provenance
  backfill, a service-role-only reconciliation view, and a cron health gate. They are
  tested locally but are not applied or deployed to production.
- Two enabled FileMaker backups target the same root. The midnight job is healthy;
  the 3:00 AM job fails daily with error 809. No backup configuration or files were
  changed, and the collision refresh timer remains disabled.
- The superadmin Data Review page supports explicit source-shop mapping approval
  with target selection, written identity evidence, confirmation, and an atomic audit
  entry. This branch also adds repair freshness, storm-ledger reconciliation, KDOT
  coverage, and multi-shop forecast readiness without exposing service-role access to
  the browser. Forecast readiness now covers every mapped shop across all four target
  horizons rather than sampling four rows globally. One mapping remains active; 198
  candidates remain unapproved.
- The review route is discoverable in dashboard navigation only for superadmins. The
  page and mutation endpoint retain independent server-side role checks.
- The prior feature-branch revision is deployed to a Vercel preview. Unauthenticated
  browser and HTTP checks confirm the page redirects to login and the mutation returns 401. The source-health addition is build-verified but not deployed because it depends
  on the unapplied reconciliation migration; authenticated product approval and
  production deployment remain separate gates.

## Requirement status

| Goal requirement                                                    | Status                                             | Current evidence                                                                                                                                                                                                                                                              | Remaining work                                                                                                                                           |
| ------------------------------------------------------------------- | -------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Clean, documented, privacy-safe data                                | Live preflight passed; first refresh pending       | 327,313 FileMaker facts reconcile to the current source ledger; direct PII and raw identifiers are absent; the restricted live OData probe reports 330,530 rows and exactly 15 approved fields; hardened service is staged with timer disabled                                | Approve and reconcile the first full refresh; resolve the duplicate backup schedule; apply storm provenance reconciliation; connect failures to an owner |
| Consistent repair, insurance, geography, crash, and weather metrics | Pilot-ready; governed review workflow implemented  | Shop, carrier, ZIP, vehicle, seasonality, value, payment, and quality views are live; carrier aliases and source-shop mappings require explicit superadmin approval and atomic audit evidence; 411,208 KDOT rows count-verified; 99.93% ZIP match                             | Review the highest-volume insurer candidates and approve additional shop mappings only after identity confirmation                                       |
| Operational dashboard                                               | Preview deployed; authenticated product QA pending | `/dashboard/collision-intelligence` includes repair, insurer, ZIP, vehicle, quality, 13-week period comparisons, complete-year seasonality, KDOT crash, weather, baseline, recent SPC signals, four-week forecasts, evidence-bound planning guidance, and a live scorecard; production build and unauthenticated preview checks pass | Run authenticated desktop/mobile preview QA, complete product approval, deploy, and smoke test                                                           |
| ZIP-level weather and market alerts                                 | Review queue built                                 | Service-only `v_collision_zip_alert_candidates`; atomic three-day SPC refresh; daily cron configured locally; notifications explicitly off                                                                                                                                    | Deploy/smoke-test the cron, approve owner and lifecycle, and measure false positives before authorizing notifications                                    |
| Weekly forecasts outperform a seasonal baseline                     | Multi-shop historical evidence; publication gated  | Trailing four-week beats seasonal across four horizons in the current-shop segment; independently promoted shop/horizon policies; current run correctly writes four `stale_source` rows with no prediction; 13-observation live scorecard is active                           | Restore current repair ingest, accrue observed forecasts, review live error/coverage, and approve models per mapped shop                                 |
| Clear confidence and limitations                                    | Implemented for pilot                              | Dashboard freshness, promotion evidence, interval coverage, model scope, metric contract, and evaluation reports                                                                                                                                                              | Add the same disclosures to exports and scheduled alerts                                                                                                 |

## Live data coverage

### Repair data

- Complete privacy-safe FileMaker snapshot: 327,313 accepted facts from 327,314
  parsed rows; one row with no master shop key was rejected and recorded in provenance.
- Full arrival history: 2011-01-18 through 2026-07-10; 16,009 arrivals are in 2026.
- Full payment mix: 262,127 insurance-classified, 64,050 known non-insurance, and
  1,136 unknown/other repairs; total recorded repair value is $1,652,295,954.68.
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
- The service-only insurer review table contains 1,045 normalized label candidates
  across the full snapshot. The mapped pilot has 101 normalized carrier labels and
  zero approved canonical aliases; the dashboard labels them unreviewed rather than
  silently merging names.

### Weather data

- `storm_zip_monthly`: 2016-01 through 2026-08.
- Live coverage is 677,056 reconciled NCEI events plus 25,999 provisional SPC events.
  Seven SPC batches reconcile; the 3,986-event August 1–16 batch currently lacks its
  source-ledger row. The branch migration repairs that row and makes future drift fail
  cron health, but production remains unchanged.
- 135 of 143 valid pilot customer ZIPs have some weather history.
- Weather metrics are historical-repair-weighted and include coverage percentages.
- The latest preliminary SPC report is 2026-08-19.
- `weather_cache` is empty and is not a current dashboard or forecast input. Severe
  weather analysis uses governed storm-event/ZIP data; average temperature and
  precipitation analysis remains a separate future data-source decision.
- The 72-hour customer-ZIP review view currently returns four candidates, including
  one high signal. This count changes as the rolling window advances.

### Crash data

- Official KDOT import: 411,208 statewide crash facts from 2019-01-01 through
  2026-08-13; 410,910 ZIP matched and 298 explicitly unmatched.
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
- A local authenticated cron dry-run refreshed 750 rows across three convective days;
  all 25,812 SPC rows have unique source IDs and populated event locations.
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
  `collision_forecast_horizon_registry`. Current-shop chronological backtests beat
  seasonal MAE by 27.4%–32.2% across all four horizons, with 92.3%–93.8%
  held-out-shop interval coverage for the promoted horizon/model policies.
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
  company row, exposed all 1,116 expected repairs, built its weekly modeling frame,
  accepted a shop-keyed review model, and persisted only a blocked null forecast.
  The transaction was rolled back; Tedesco remains unmapped pending explicit approval.
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
- Security advisor: the three new `rls_enabled_no_policy` notices are informational
  and intentional for service-only repair facts, source ledger, and mapping table; no
  anonymous or authenticated policy was added.
- The pre-existing `v_collision_targeting_zip_annual` security-definer error was
  removed; the view is now invoker-security and service-role-only.
- Performance advisor: covering indexes were added for both mapping foreign keys.
  Informational unused-index notices remain for newly created fact indexes before
  sustained product traffic.
- Source ledger counts reconcile to 327,314 parsed, 327,313 accepted, and one rejected.
- A read-only production execution of the forecast-readiness query returns all four
  expected pilot shop/horizon rows and correctly gates all four as `stale_source`. An
  isolated PostgreSQL fixture also verifies `published`, `model_not_approved`,
  `not_generated`, `model_mismatch`, `forecast_outdated`, and `stale_source` states.
  Cron health now fails when any mapped shop/horizon remains gated after scoring.
- Unified mapped source and weekly-demand counts both reconcile to 3,420 repair orders;
  all are FileMaker rows and no legacy pilot rows are unioned.
- Weekly cycle denominator reconciles to 3,420 observations and 14.8 days.
- Unit test, TypeScript, targeted ESLint, Python self-check, and production Next.js
  build pass.
- A deterministic zero-PII fixture exercises the populated dashboard through the
  real local login flow. Desktop and mobile Chromium assertions, WCAG
  serious/critical checks, and screenshots pass. Browser review also fixed a
  borderline forecast-text contrast failure and a stale company-first disclosure.
- The FileMaker DDR confirms Repair Customer `FMTID:131`, `fmrest`/`fmodata`
  capability, and that the legacy export script is interactive and PII-heavy. A new
  OData extractor requests only the 15 importer fields, filters the observed 2020+
  source scope, enforces 300,000-500,000 source rows and exact `@odata.count`
  reconciliation, rejects off-host pagination, and atomically publishes a mode-0600
  file. Its two-page self-test and the importer's new optional file-age gate pass.
- Live unauthenticated endpoint checks identify `https://psgweb.me` as the current
  FileMaker host: Data API product information returns HTTP 200 and the Advantage
  OData metadata endpoint returns the expected HTTP 401 authentication challenge.
  The `fm.psghub.me`, `fm2.psghub.me`, and `fm3.psghub.me` names are stale or
  misconfigured and are excluded from the refresh contract.
- Supabase migration `collision_repair_feed_freshness` is live. Its per-shop view is
  `security_invoker=true`, grants select only to `service_role`, and correctly marks
  the 3,420-row pilot snapshot stale at roughly 861 hours old.
- KDOT source counts match the live ArcGIS service for every imported year.
- Crash/weather feature evaluation keeps the trailing four-week model as champion;
  KDOT improves the comparable ridge model by 2.1% MAE but not enough to promote.
- Multi-shop chronological evaluation found trailing-4 MAE 2.99 versus seasonal MAE
  4.41 in the 30-shop current segment. Trailing-4 beat seasonal in all 30 shops. A
  1.55× interval multiplier selected on 14 shops covered 92.3% of holdout weeks in a
  separate 16-shop validation group.

## Next execution order

1. After explicit production approval, run the first full FileMaker export/import and
   reconcile it against the captured Supabase baseline. Keep the daily timer disabled
   until the duplicate 3:00 AM backup is disabled or moved, a backup/restore is proven,
   and a named owner receives failures. The runbook is
   `docs/analysis/2026-08-18-collision-repair-refresh-runbook.md`.
2. Apply the storm source-reconciliation and forecast-readiness migrations, then deploy
   the matching cron health checks. Confirm every NCEI/SPC batch is reconciled, every
   mapped shop/horizon has an explainable state, and browser roles cannot read either
   service-only view.
3. Use `/dashboard/collision-intelligence/review` as a superadmin to review the
   highest-volume insurer aliases and source-shop mappings. Mapping approval requires
   target selection, written identity evidence, and explicit confirmation, and it is
   committed with its audit entry in one transaction. The first candidate is PS773 to
   Tedesco Auto Body, but its model remains blocked because the calibration interval is
   zero. Never infer a mapping or insurer alias from name similarity alone.
4. After 13 observed forecasts accrue per horizon, review the live monitoring status.
   Manual review is requested when rolling MAE loses to seasonal or 80% interval
   coverage falls below 70%; the scorecard never changes promotion automatically.
5. Complete product/navigation review using the verified desktop and mobile captures.
6. Deploy separately, then smoke-test the Vercel cron and keep notifications disabled
   until an owner, acknowledgement lifecycle, and false-positive review are approved.
