# Collision Repair Refresh Runbook

**Project:** PSG collision intelligence
**Source:** PhoenixSolutions Advantage FileMaker
**Target:** Supabase `gylkkzmcmbdftxieyabw`
**Status:** first governed repair export/import reconciled; timer remains disabled

## Source evidence

- The July 15, 2025 DDR identifies Repair Customer as stable table `FMTID:131`.
- The pre-import governed snapshot contained 327,314 source rows and 199 source-shop
  keys. Its creation dates were exactly 2020-01-02 through 2026-07-13.
- The legacy `Export - FM & Excel Data - Repair Customer` script is interactive,
  inherits the operator's found set, and exports customer names, addresses, phones,
  email, birthdates, claim numbers, and agent details. It is not the recurring PSG
  collision-intelligence feed.
- The DDR exposes `fmrest` and `fmodata` extended privileges, including on the built-in
  read-only privilege set. A dedicated least-privilege account is still required;
  the built-in read-only account grants a wider data surface than this integration needs.
- A live unauthenticated check on 2026-08-18 confirmed that `https://psgweb.me`
  serves the FileMaker Data API product endpoint and returns the expected HTTP 401
  challenge for the Advantage OData metadata endpoint. The `fm.psghub.me`,
  `fm2.psghub.me`, and `fm3.psghub.me` hosts are not valid integration endpoints.
- An authenticated check on 2026-08-19 confirmed that `psg_odata_repairs` can open
  `PhoenixSolutions_Advantage_06.1.fmp12` metadata through OData. FileMaker error 802
  was caused by omitting the hosted filename's `.fmp12` suffix. `FMTID:131` is the
  stable DDR identifier, not an OData entity URL; the live OData entity is the quoted
  `Master_Repair Customer` name.
- The final 2026-08-19 bounded live probe returned 330,535 records in the approved
  2020+ scope, exactly 15 allowlisted fields, and zero direct customer or agent PII
  fields. The first governed export/import then reconciled this count in Supabase.

## Pre-import Supabase baseline

A read-only production query captured this baseline at 2026-08-19 19:41 UTC:

- one loaded source ledger with 327,314 source rows, 327,313 accepted facts, and one
  rejected row;
- 199 distinct source-shop keys: one mapped and 198 unmapped;
- the mapped feed contains 3,420 repairs, has latest arrival 2025-12-24, and is stale;
- all four current forecasts are `stale_source`; and
- three shop/horizon model policies are approved.

Use these figures as before-state evidence only. The first governed import must capture
the same measures again and explain every change before forecast scoring runs.

## First governed run — 2026-08-19

The approved manual run completed with the refresh timer still disabled:

- FileMaker exported 330,535 rows in 34 pages to a mode-0600 runtime file. The export
  contained exactly the 15 approved fields and no direct customer or agent PII fields.
- The independent no-secret, no-network validation accepted 330,533 rows and rejected
  two: one missing shop key and one invalid repair amount. Parsed = accepted + rejected.
- The source ID is `filemaker_rc_5cba1235612af4c11a4e`; the file SHA-256 is
  `5cba1235612af4c11a4e023795ec9c0afc28eb073ca82d9a9144a1bf65b8d75c`.
- The importer loaded 330,533 facts, superseded the prior source, and removed all
  327,313 facts from that superseded snapshot only after reconciliation. No facts
  remain attached to the old source.
- The source delta is +3,221 parsed rows, +3,220 accepted facts, and +1 rejection.
  Source-shop coverage remains 199 keys: one mapped and 198 unmapped.
- The governed arrival range is now 2011-01-18 through 2026-08-14. The loaded feed is
  current, but the mapped pilot still has only 3,420 repairs and its latest arrival is
  2025-12-24. Forecast publication therefore remains correctly blocked.
- A second importer execution against the same file returned
  `skipped: identical_file_already_reconciled`, proving the rerun guard without a
  second import.

This completes the first manual import gate only. Forecast scoring, recurring timer
activation, the pending production migrations, deployment, backup changes, and alert
ownership remain separately controlled actions.

## Read-only source preflight — 2026-08-20

- The staged timer remained disabled while the bounded OData probe ran as the
  non-login `psg-refresh` account. The probe reported 330,709 rows, exactly 15
  allowlisted fields, and zero direct customer or agent PII fields.
- FileMaker therefore contains 174 rows beyond the 330,535-row governed snapshot.
  No export file was replaced, no Supabase connection was opened, and no import ran.
- A separate read-only query for the mapped source name returned all 3,420 Shelton
  Collision Repair rows and the same latest arrival, 2025-12-24. The prior governed
  snapshot confirms that this exact shop name covers both observed raw key variants,
  `PS177` and `ps177`.
- The source delta does not unblock the mapped pilot's forecast. A future approved
  import would update the governed snapshot, but this shop still fails the 14-day
  repair-arrival gate.
- A second read-only probe at 21:08 CT reports 330,778 rows, 243 beyond the governed
  snapshot and 69 beyond the earlier probe. An exact Shelton Collision Repair query
  still returns 3,420 rows with latest arrival 2025-12-24. The added source rows belong
  elsewhere and do not unblock the current mapped pilot. No export or import ran.

## FileMaker operations recheck — 2026-08-20

- A read-only SSH recheck at 20:57 CT found FileMaker Server active. The collision
  refresh timer remains disabled and inactive; its service is also inactive.
- The operations secret remains mode `0600` and the runtime directory mode `0700`,
  both owned by the non-login `psg-refresh` account. No secret values were read.
- Event.log shows both `FMS` at midnight and `Backup` at 3:00 AM completed normally
  on August 20. Each retained output contains all five hosted `.fmp12` files, no
  zero-byte files, and no `_InProgress` directory. The prior daily-error-809 claim is
  not current evidence for this run.
- Both schedules still write below the same root. That root now holds 38 GB of backups
  with only 5.6 GB free on a 93%-used filesystem; the separate mounted volume still
  has about 75 GB free. A successful run does not resolve this capacity risk.
- The same overnight log contains 92 FileMaker scripting-error entries across 15
  schedules. The exact current pattern is 55 code-3 errors on server-incompatible
  `Adjust Window`/`Open File` steps, 22 code-13 errors on common `Close Window`
  cleanup steps, and 15 code-101 errors on `Go to Record/Request/Page`. Claris defines
  these as command unavailable, file or object in use, and record missing. Server-side
  scripts skip unsupported steps and continue, which explains the code-3 noise; it
  does not prove that the code-101 business paths processed the intended records.
  Every schedule reports completed, but no custom script-error log or processed-row
  result proves the nightly business outcome.
  [Claris error codes](https://help.claris.com/en/pro-help/content/error-codes.html) ·
  [server-side script behavior](https://help.claris.com/en/pro-help/content/running-scripts-on-server.html)
- No backup schedule, database, timer, secret, or file was changed. A restore drill
  and a named refresh-failure recipient are still unproven.

## One-time FileMaker configuration

The FileMaker administrator must:

1. Confirm `https://psgweb.me` remains the intended production host. Its OData
   listener and HTTPS certificate are currently reachable.
2. Use the dedicated `psg_odata_repairs` account for PSG collision refresh. Do not
   reuse a full-access, administrator, or general read-only account.
3. Give that account read-only access to Repair Customer `FMTID:131` and only these
   fields:
   - `RC_CreationDate`
   - `RC_MatchField_Master`
   - `RC_Shop`
   - `RC_PayType`
   - `RC_SerialNum`
   - `RC_InsuranceCompany`
   - `RC_Date_In`
   - `RC_Date_Out`
   - `RC_Repair_Dlz`
   - `RC_Vehicle_Yr`
   - `RC_Vehicle_Make`
   - `RC_Vehicle_Model`
   - `RC_RONumber`
   - `RC_Cust_State`
   - `RC_Cust_Zip`

4. Disable create, edit, delete, schema, script, and unrelated table access for the
   integration account. Enable only `fmodata` for the account's custom privilege set.
5. Provide the HTTPS origin, hosted database name, account, and password through the
   operations secret store. Never place credentials in this repository or a command line.
   Use the exact hosted filename `PhoenixSolutions_Advantage_06.1.fmp12`; the exporter
   also appends `.fmp12` when the configured value omits it.

Claris documents OData enablement, account authentication, limited-field `$select`,
and pagination here:

- <https://help.claris.com/en/server-help/content/config-webpub-fm-odata-api.html>
- <https://help.claris.com/en/odata-guide/content/creating-authenticated-connection.html>
- <https://help.claris.com/en/odata-guide/content/query-option-select.html>
- <https://help.claris.com/en/odata-guide/content/request-records-from-table.html>

## Refresh command

Store the four `FILEMAKER_ODATA_*` variables and the existing Supabase service-role
variables in an operations-only environment file with mode `0600`.

Run the bounded preflight first. It requests one record, verifies the exact 15-field
allowlist, and checks the filtered source count without writing an export:

```bash
python3 /opt/psg/psg-hub/apps/psg-hub/scripts/export-filemaker-collision-odata.py \
  --env-file /opt/psg/secrets/collision-refresh.env \
  --probe
```

```bash
python3 /opt/psg/psg-hub/apps/psg-hub/scripts/export-filemaker-collision-odata.py \
  --env-file /opt/psg/secrets/collision-refresh.env \
  --output-file /opt/psg/runtime/filemaker-collision.csv
```

Validate the completed file before opening any Supabase connection:

```bash
python3 /opt/psg/psg-hub/apps/psg-hub/scripts/import-filemaker-collision-facts.py \
  --input-file /opt/psg/runtime/filemaker-collision.csv \
  --max-file-age-hours 2 \
  --validate-only
```

The validation pass requires the exact 15-field privacy allowlist, rejects missing,
unexpected, or duplicate columns, and reports only the file hash, aggregate row
reconciliation, shop count, rejection reasons, and arrival-date range. It reads no
Supabase secret and performs no network request or database write.

The exporter:

- requests only the governed fields with OData `$select`;
- allows up to 15 minutes for FileMaker's initial filtered count and does not retry a
  timed-out request while the server may still be executing it;
- filters `RC_CreationDate` from 2020-01-01 forward to reproduce the observed source
  scope rather than loading the entire 1.19-million-row table;
- requires the reported source count to remain between 300,000 and 500,000 rows;
- follows pagination only within the configured HTTPS OData service;
- verifies received rows equal the OData count annotation (`@count` or
  `@odata.count`); and
- replaces the output atomically with mode `0600` only after all checks pass.

Then run the existing idempotent importer:

```bash
python3 /opt/psg/psg-hub/apps/psg-hub/scripts/import-filemaker-collision-facts.py \
  --env-file /opt/psg/secrets/collision-refresh.env \
  --input-file /opt/psg/runtime/filemaker-collision.csv \
  --project-id gylkkzmcmbdftxieyabw \
  --max-file-age-hours 2
```

The import remains hidden while loading, reconciles parsed/accepted/rejected counts,
atomically supersedes the previous loaded snapshot, and skips an identical file.

## Production database release gate

A linked read-only check found that the shared Supabase migration ledger cannot use a
normal `db push`. Five already-applied collision migrations have different timestamps
locally and remotely. Their recorded SQL is byte-identical; the first differs only by
the local file's final newline.

| Local version  | Remote version | Migration name                    |
| -------------- | -------------- | --------------------------------- |
| 20260818212107 | 20260818212317 | `collision_repair_feed_freshness` |
| 20260818220330 | 20260818220842 | `collision_multiweek_forecasts`   |
| 20260818220953 | 20260818221002 | `index_collision_horizon_company` |
| 20260818221806 | 20260818221905 | `collision_forecast_monitoring`   |
| 20260818222352 | 20260818222601 | `collision_insurer_alias_review`  |

Do not run broad `db push`, `migration repair`, or `db pull` during this release. A
future scoped history repair requires its own approval and coordination with the other
applications sharing this project.

The first governed FileMaker import is reconciled. The live migration ledger was
rechecked read-only at 21:52 CT on 2026-08-20. Its newest collision entry is
`collision_insurer_registry`; 13 local collision-scoped migration names are absent.
Under a separate production approval, apply these files in timestamp order through
the migration runner:

1. `20260819195103_collision_storm_source_reconciliation.sql`
2. `20260819201319_collision_forecast_readiness.sql`
3. `20260819210842_harden_collision_example_functions.sql`
4. `20260820153240_collision_shop_insurance_market.sql`
5. `20260820155441_collision_insurer_acronym_matching.sql`
6. `20260820170404_stage_collision_forecast_model_review.sql`
7. `20260820203311_review_collision_forecast_models.sql`
8. `20260820215207_fix_collision_weather_coverage.sql`
9. `20260820224500_collision_payment_classification.sql`
10. `20260820235000_collision_forecast_customer_audience.sql`
11. `20260820235900_collision_weather_alert_review_cases.sql`
12. `20260821012506_collision_forecast_candidate_evaluations.sql`
13. `20260821013156_collision_shop_identity_evidence.sql`

The release manifest at
`apps/psg-hub/supabase/releases/collision-intelligence-20260820.json` locks this exact
order, the target project, each migration name, and each reviewed file's SHA-256.
Before applying anything, save the read-only migration ledger query from
`docs/runbooks/supabase-migration-apply.md` to a temporary file and run:

```bash
node scripts/check-release-manifest.mjs \
  --project-ref gylkkzmcmbdftxieyabw \
  --applied-file /tmp/applied.txt
```

The checker must report `0/13 applied` before the first migration. It accepts a
timestamp-ordered applied prefix so an interrupted release can resume at the named
next migration, but it fails on a skipped migration, a changed reviewed file, or a
different project target. Re-run it after the final migration; it must report
`13/13 applied` before postflight.

The current production preconditions were rechecked read-only on 2026-08-20: 3,986
provisional events still lack a matching source-ledger row for
`noaa_spc_preliminary-20260801-20260817`; the readiness/reconciliation views,
body-shop appetite table, forecast-review RPCs, weather-review lifecycle, customer
audience guard, and two governed evidence tables are absent; the weather view still
uses event-presence coverage; all three legacy collision/accident RPCs retain mutable
search paths and browser-role execution; and 27 legacy accident, NHTSA, storm, and ZIP
source relations plus four sequences retain browser-role grants. RLS blocks ordinary
rows but does not protect `TRUNCATE`. None of the 13 migration names appears in the live
ledger.

Postflight must prove:

1. the provisional batch has one source-ledger row reporting 3,986 rows and the storm
   reconciliation view reports it reconciled;
2. forecast readiness returns four rows per mapped shop, one for each horizon, with an
   explainable readiness state;
3. every governed view uses `security_invoker=true`, denies `anon` and `authenticated`,
   and allows only `service_role` reads;
4. all 27 legacy source relations deny browser reads, writes, deletes, and `TRUNCATE`,
   and all four collision-source sequences deny browser usage, reads, and updates;
5. `collision_targeting_examples`, `storm_demand_examples`, and
   `refresh_accident_market_rollups` have `search_path=pg_catalog, public`, deny
   execution to `public`, `anon`, and `authenticated`, and allow `service_role`;
6. weather coverage equals repair volume in ZIPs with loaded boundaries while missing
   ZIP-month event rows contribute zero exposure; and
7. candidate-evaluation and shop-identity tables remain service-role-only, their
   mutation RPCs deny browser roles, and shop mapping rejects missing or mismatched
   governed address evidence; and
8. shop-insurance appetite evidence remains service-role-only, acronym matching treats
   spaced carrier initials consistently, expands full-name group initials without
   auto-approving an alias, and the registry foreign key has a valid covering index;
9. forecast staging and review RPCs require a confirmed mapping, four evaluated
   horizons, a PSG superadmin reviewer, written notes, and a real customer audience;
10. payment classification preserves insurance, non-insurance, and unknown as separate
    governed categories in `v_collision_repair_orders`;
11. weather cases can be acknowledged and closed only through service-role RPCs,
    retain their pre-registered control, and do not enable notifications; and
12. the Supabase security advisor no longer reports the three collision/accident
    function search-path warnings. Remaining service-only RLS/no-policy notices are
    accepted only when the privilege checks above pass.

Run the committed read-only verifier before and after the release:

```bash
psql "$SUPABASE_DB_URL" -X -v ON_ERROR_STOP=1 \
  -f apps/psg-hub/supabase/tests/collision_release_postflight.sql
```

The single result must report `ready = true` and an empty `failures` array. The
2026-08-20 pre-release execution against `gylkkzmcmbdftxieyabw` now runs 81 checks and
fails 74, including every missing migration name, governed relation, trigger,
service-only function, legacy browser grant, source sequence, the missing insurer
foreign-key index, the insurer-evidence contract, the expanded insurer-acronym check,
both direct customer-role function contracts, and the unreconciled SPC source batch. KDOT source/import counts, completed
ZIP resolution, and both blocked-forecast invariants already pass. This is the expected
before-state, not a release failure.

The payment-classification migration is the only notable row rewrite in the batch. A
read-only 2026-08-20 preflight found 3,074 Hub repair orders with a null payment type;
3,060 match the migration's exact governed aliases and would be updated. FileMaker
repair facts are not rewritten by this migration.

The first three release files were previously applied together in a local transaction
and rolled back. The expanded hardening file separately passed and rolled back with all
three functions fixed, browser privileges removed from representative accident/storm
relations, and all four source sequences service-only. The insurer acronym migration's
covering index, `U S A A` normalization, expanded parent-group match, and non-mutation
guarantee passed in an isolated transaction and rolled back. The weather correction
passed a separate synthetic local transaction. The local database ledger itself remains
intentionally unrepaired.

## Schedule and monitoring

Run the read-only pre-enable checker on the FileMaker host before requesting timer
activation. It exits nonzero and names every unmet automatic or human gate; it does
not read secret values or change backups, services, schedules, or databases.

```bash
sudo python3 /opt/psg/psg-hub/apps/psg-hub/scripts/check-filemaker-refresh-readiness.py \
  --evidence-file /opt/psg/ops/collision-refresh-evidence.json
```

The evidence file is an operator-owned JSON object. Record decisions, not credentials:

```json
{
  "backup_schedule_decision": "approved change or retained-schedule rationale",
  "script_error_decision": "reviewed error remediation and outcome evidence",
  "restore_drill_result": "pass",
  "restore_drill_at": "2026-08-20T15:00:00-05:00",
  "failure_owner": "named team or person"
}
```

The capacity check passes only when the filesystem is at most 85% used and has at
least 20 GiB free. The restore drill must be passing and no more than 90 days old.
Thresholds are command-line calibration knobs; changing them requires an operations
rationale. A `READY` result is evidence for a separate activation decision, not
authorization to enable the timer.

A no-install SSH execution at 23:12 CT on August 20 returned `NOT READY`. The disabled
timer, least-privilege permissions, both current five-file backups, and absence of an
in-progress backup passed. It reported 5.5 GiB free, the same 55 code-3, 22 code-13,
and 15 code-101 errors, and missing schedule disposition, restore evidence, and failure
owner. No server state changed.

At 3:00 AM on August 21, FileMaker deleted its `_InProgress` folder and aborted the
secondary `Backup` schedule because the destination lacked free space. The midnight
`FMS` schedule had completed with five files after deleting its August 18 retention
folder. The readiness checker now rejects a recent older backup when Event.log records
an aborted `FMS` or `Backup` run, so backup age cannot mask the failed schedule. The
refresh timer remains disabled; no backup or server configuration was changed.

- The server's midnight backup and 12:30–1:40 AM FileMaker script window were verified
  on 2026-08-19. The staged systemd timer runs at 4:30 AM America/Chicago with up to
  ten minutes of jitter.
- Two enabled FileMaker backup schedules currently target the same backup root. `FMS`
  runs at midnight and `Backup` at 3:00 AM. Both August 20 runs completed and each
  output contains all five hosted databases; backup existence is proven, but a restore
  drill is not.
- The backup root now contains 38 GB with only 5.6 GB free on a 93%-used filesystem.
  The current risk is shared-root capacity, not a proven failure of the latest 3:00 AM
  run.
- A separate persistent ext4 volume at `/mnt/HC_Volume_105029819` has about 75 GB free.
  No backup configuration or files were changed. The FileMaker owner must either confirm
  the 3:00 AM schedule is redundant and disable it, or move it to a FileMaker-owned
  folder on that volume and prove a backup and restore. Do not delete the healthy
  midnight backups to make room.
- Install `apps/psg-hub/ops/systemd/psg-collision-refresh.{service,timer}` under
  `/etc/systemd/system/`. Keep the timer disabled until the first manual service run
  passes every acceptance check, the shared-root capacity risk and nightly scripting
  errors are dispositioned, a restore drill passes, and a named operational owner
  receives failures.
- Before enabling that timer, the FileMaker owner must remove or server-guard the
  unsupported UI wrapper steps and add explicit no-record handling plus processed-row
  logging to the 15 affected schedules. A green “completed” state without a recorded
  business outcome is not sufficient refresh evidence.
- The service runs as the non-login `psg-refresh` account, reads only the mode-0600
  operations secret, writes only `/opt/psg/runtime`, lowers CPU and I/O priority, and
  applies systemd filesystem and privilege hardening.
- Alert on exporter failure, row-count bounds, importer failure, or a loaded source older
  than 36 hours.
- The dashboard cron already logs and returns HTTP 500 with `repairFeed: stale` when
  the governed freshness view finds a mapped source older than 36 hours. Connect the
  deployed cron failure to the named owner; local configuration alone is not an alert.
- Keep forecast publication's existing 14-day repair-arrival freshness gate. File age
  proves the feed ran; latest repair arrival proves the source contains current demand.
- The deployed dashboard/forecast cron remains a separate approval and smoke-test gate.
- Keep weather-market notifications disabled until their owner and lifecycle are approved.

## Acceptance check

Do not call the feed live until one scheduled run proves all of the following:

1. OData responds through `https://psgweb.me` using the dedicated restricted account.
2. The export reports 330,535 rows or a documented source delta, 15 fields, zero direct
   customer/agent PII fields, and a row count equal to the OData count annotation.
3. The importer source ledger reconciles parsed = accepted + rejected.
4. Facts for the new source equal its accepted count; the prior source becomes
   `superseded` and its facts are removed only after final reconciliation.
5. Mapping counts remain explainable, and mapped-shop dashboard counts, source ID,
   file age, and latest arrival date match the new source ledger.
6. Weekly scoring publishes only for mapped shops with approved models and repair
   arrivals no more than 14 days old.
