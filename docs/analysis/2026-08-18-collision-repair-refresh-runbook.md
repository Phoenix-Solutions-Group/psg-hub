# Collision Repair Refresh Runbook

**Project:** PSG collision intelligence
**Source:** PhoenixSolutions Advantage FileMaker
**Target:** Supabase `gylkkzmcmbdftxieyabw`
**Status:** dedicated account created; FileMaker OData file access and schedule not configured

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
- An authenticated check on 2026-08-19 confirmed that `psg_odata_repairs` can discover
  the Advantage OData database, but opening its service root or metadata returns
  FileMaker error 802. No repair export or Supabase import occurred.

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

Claris documents OData enablement, account authentication, limited-field `$select`,
and pagination here:

- <https://help.claris.com/en/server-help/content/config-webpub-fm-odata-api.html>
- <https://help.claris.com/en/odata-guide/content/creating-authenticated-connection.html>
- <https://help.claris.com/en/odata-guide/content/query-option-select.html>
- <https://help.claris.com/en/odata-guide/content/request-records-from-table.html>

## Refresh command

Store the four `FILEMAKER_ODATA_*` variables and the existing Supabase service-role
variables in an operations-only environment file with mode `0600`.

```bash
python3 /opt/psg/psg-hub/apps/psg-hub/scripts/export-filemaker-collision-odata.py \
  --env-file /opt/psg/secrets/collision-refresh.env \
  --output-file /opt/psg/runtime/filemaker-collision.csv
```

The exporter:

- requests only the governed fields with OData `$select`;
- filters `RC_CreationDate` from 2020-01-01 forward to reproduce the observed source
  scope rather than loading the entire 1.19-million-row table;
- requires the reported source count to remain between 300,000 and 500,000 rows;
- follows pagination only within the configured HTTPS OData service;
- verifies received rows equal `@odata.count`; and
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

## Schedule and monitoring

- Run once daily after the FileMaker backup window; assign a named operational owner.
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
2. The export reports 15 fields, zero direct customer/agent PII fields, and an in-range
   row count equal to `@odata.count`.
3. The importer source ledger reconciles parsed = accepted + rejected.
4. The prior snapshot becomes superseded only after final reconciliation.
5. Mapped-shop dashboard counts and freshness match the new source ledger.
6. Weekly scoring publishes only for mapped shops with approved models and repair
   arrivals no more than 14 days old.
