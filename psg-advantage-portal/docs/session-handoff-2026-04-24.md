# PSG Advantage Portal Handoff - 2026-04-24

## Current State

The local app is running from:

```bash
cd /Users/schoolcraft_mbpro/apps/psg/psg-advantage-portal
npm run dev
```

Local URL:

```text
http://localhost:3001
```

Build and tests passed after the latest changes:

```bash
npm run build
npm test
```

Test result: 15 files, 64 tests passed.

## Authentication

A temporary local-only demo auth bypass was added.

On `/login`, click:

```text
Continue with demo access
```

This sets a local cookie:

```text
psg_demo_auth=1
```

The bypass only works outside production. It bypasses login but does not force demo dashboard data anymore. The dashboard still queries BigQuery when credentials are available.

Clicking `Sign out` clears the demo cookie.

## BigQuery

The service account JSON is present at:

```text
/Users/schoolcraft_mbpro/apps/psg/bigQuery-n8n-workspace-apis-456b10536e37.json
```

Do not commit this file.

BigQuery authentication was verified with:

```sql
SELECT 1 AS ok
```

Visible datasets:

```text
psg_advantage_data
psg_geo_data
```

Dataset locations:

```text
psg_advantage_data: us-central1
psg_geo_data: US
```

`src/lib/bigquery.ts` now supports a per-query `location` option. Use `location: 'US'` for `psg_geo_data` queries.

## Shops Work

The Shops page now incorporates:

```text
n8n-workspace-apis.psg_geo_data.us_body_shops
```

Relevant files:

```text
src/app/(dashboard)/shops/page.tsx
src/components/ui/ShopTable.tsx
src/components/ui/TrendBadge.tsx
src/types/index.ts
```

`us_body_shops` columns observed:

```text
place_id
name
address
phone
website
rating
category
subtypes
latitude
longitude
```

The Shops page now fetches geo shops from `psg_geo_data.us_body_shops` in BigQuery location `US`, and separately fetches survey performance from `psg_advantage_data.survey_responses`.

The merge is currently name-normalized:

```text
geo shop name -> normalized string
survey shop_name -> normalized string
```

If there is no survey match, the shop still appears with geo details and zero survey metrics.

Known limitation: this is a best-effort name match. A more durable mapping table between `place_id` and survey `shop_name` would be better.

## Marketing Intelligence

Marketing Intelligence route:

```text
/marketing-intelligence
```

It now supports filtering by city and state:

```text
/marketing-intelligence?city=Miami&state=FL
```

Relevant files:

```text
src/app/(dashboard)/marketing-intelligence/page.tsx
src/components/charts/MarketingIntelligenceDashboard.tsx
src/lib/marketingIntelligenceData.ts
scripts/build_marketing_intelligence_data.py
```

The page now attempts live BigQuery aggregates from:

```text
n8n-workspace-apis.psg_geo_data.accidents
```

with optional filters:

```sql
LOWER(city) = LOWER(@city)
UPPER(state) = UPPER(@state)
```

If BigQuery fails, it falls back to static aggregate data generated from the Hugging Face repo:

```text
nateraw/us-accidents
```

The generated file is:

```text
src/lib/marketingIntelligenceData.ts
```

The generated aggregate currently represents the Hugging Face `default/train` parquet split:

```text
2,845,342 rows
```

To regenerate it:

```bash
cd /Users/schoolcraft_mbpro/apps/psg/psg-advantage-portal
/tmp/psg-data-lake-venv/bin/python scripts/build_marketing_intelligence_data.py
```

The script caches parquet shards in:

```text
/tmp/psg-us-accidents
```

## Data Lake Change

The data-lake loader was updated to support Hugging Face streaming by default:

```text
/Users/schoolcraft_mbpro/apps/psg/psg-data-lake/load_accidents.py
/Users/schoolcraft_mbpro/apps/psg/psg-data-lake/config.py
/Users/schoolcraft_mbpro/apps/psg/psg-data-lake/requirements.txt
```

Default source:

```text
nateraw/us-accidents
```

To use the old CSV:

```bash
ACCIDENTS_SOURCE=csv python3 load_accidents.py
```

## Important Local Caveats

The root `/Users/schoolcraft_mbpro/apps` git worktree is very dirty and has many unrelated untracked/deleted paths. Do not revert broad changes.

The app may show stale Next dev-server manifest errors after large edits or after running `npm run build` while `npm run dev` is active. Restarting `npm run dev` has cleared this consistently.

Redis is not currently healthy locally. `/api/health` reports:

```json
{
  "bigquery": "ok",
  "redis": "error"
}
```

The cache helper degrades when Redis is unavailable, so BigQuery still works.

## Suggested Next Steps

1. Replace the name-normalized shop merge with a stable mapping from `us_body_shops.place_id` to survey `shop_name`.
2. Add city/state selectors populated from BigQuery distinct values, not free-text inputs.
3. Add a shop proximity layer to Marketing Intelligence using `us_body_shops.latitude` and `longitude`.
4. Consider making `BIGQUERY_KEY_FILE` default to the known local key path in `.env.local` only, while keeping secrets out of git.
5. Add tests around the Marketing Intelligence filter query construction and shop geo merge behavior.
