# Collision Repair Refresh Runbook

**Project:** PSG collision intelligence
**Source:** PhoenixSolutions Advantage FileMaker
**Target:** Supabase `gylkkzmcmbdftxieyabw`
**Status:** bounded repair probe passed; first governed export/import and timer activation remain

## Source evidence

- The July 15, 2025 DDR identifies Repair Customer as stable table `FMTID:131`.
- The current governed snapshot contains 327,314 source rows and 199 source-shop
  keys. Its creation dates are exactly 2020-01-02 through 2026-07-13.
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
- The 2026-08-19 bounded live probe returned 330,530 records in the approved 2020+
  scope, exactly 15 allowlisted fields, and zero direct customer or agent PII fields.
  No new governed repair export or Supabase import has occurred yet.

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

| Local version  | Remote version | Migration name                      |
| -------------- | -------------- | ----------------------------------- |
| 20260818212107 | 20260818212317 | `collision_repair_feed_freshness`   |
| 20260818220330 | 20260818220842 | `collision_multiweek_forecasts`     |
| 20260818220953 | 20260818221002 | `index_collision_horizon_company`   |
| 20260818221806 | 20260818221905 | `collision_forecast_monitoring`     |
| 20260818222352 | 20260818222601 | `collision_insurer_alias_review`    |

Do not run broad `db push`, `migration repair`, or `db pull` during this release. A
future scoped history repair requires its own approval and coordination with the other
applications sharing this project.

After the first governed FileMaker import is reconciled, apply these reviewed files in
order through the migration runner:

1. `20260819195103_collision_storm_source_reconciliation.sql`
2. `20260819201319_collision_forecast_readiness.sql`
3. `20260819210842_harden_collision_example_functions.sql`

The current production preconditions are: 3,986 provisional events and no matching
source-ledger row for `noaa_spc_preliminary-20260801-20260817`; neither new view exists;
and both legacy example RPCs have mutable search paths and browser-role execution.

Postflight must prove:

1. the provisional batch has one source-ledger row reporting 3,986 rows and the storm
   reconciliation view reports it reconciled;
2. forecast readiness returns four rows per mapped shop, one for each horizon, with an
   explainable readiness state;
3. both views use `security_invoker=true`, deny `anon` and `authenticated`, and allow
   only `service_role` reads;
4. both example RPCs have `search_path=pg_catalog, public`, deny execution to `public`,
   `anon`, and `authenticated`, and allow `service_role`; and
5. the Supabase security advisor no longer reports the two collision example-function
   search-path warnings.

The three-file release was applied together in a local transaction and rolled back.
Both views passed their grant checks and the readiness view returned the four expected
pilot horizons. The local database ledger itself remains intentionally unrepaired.

## Schedule and monitoring

- The server's midnight backup and 12:30–1:40 AM FileMaker script window were verified
  on 2026-08-19. The staged systemd timer runs at 4:30 AM America/Chicago with up to
  ten minutes of jitter.
- Two enabled FileMaker backup schedules currently target the same backup root. `FMS`
  runs at midnight, retains up to seven backups, and is healthy. `Backup` runs at 3:00
  AM, retains three, and has failed daily with FileMaker error 809 (`Disk full`). The
  root filesystem currently has about 23 GB free; the healthy backup root contains two
  snapshots totaling about 19 GB.
- A read-only 2026-08-19 16:16 CT recheck confirmed the latest midnight snapshot is
  9.4 GB and contains all five hosted database files. The Advantage and Survey backup
  entries both report `Normal`. The 3:00 AM schedule still aborts for insufficient
  destination space. Backup existence is proven; a restore drill is not.
- A separate persistent ext4 volume at `/mnt/HC_Volume_105029819` has about 75 GB free.
  No backup configuration or files were changed. The FileMaker owner must either confirm
  the 3:00 AM schedule is redundant and disable it, or move it to a FileMaker-owned
  folder on that volume and prove a backup and restore. Do not delete the healthy
  midnight backups to make room.
- Install `apps/psg-hub/ops/systemd/psg-collision-refresh.{service,timer}` under
  `/etc/systemd/system/`. Keep the timer disabled until the first manual service run
  passes every acceptance check, the backup conflict is resolved, and a named
  operational owner receives failures.
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
2. The export reports 330,530 rows or a documented source delta, 15 fields, zero direct
   customer/agent PII fields, and a row count equal to the OData count annotation.
3. The importer source ledger reconciles parsed = accepted + rejected.
4. Facts for the new source equal its accepted count; the prior source becomes
   `superseded` and its facts are removed only after final reconciliation.
5. Mapping counts remain explainable, and mapped-shop dashboard counts, source ID,
   file age, and latest arrival date match the new source ledger.
6. Weekly scoring publishes only for mapped shops with approved models and repair
   arrivals no more than 14 days old.
