# INTEGRATIONS

*Last mapped: 2026-05-28*

## Shared Backbone

**Supabase** — single Postgres instance shared by `psg-advantage-portal`, `psg-import`, and `psg-data-lake`.

Per `portal/HANDOFF-psg-data-lake.md`: "Both share one Supabase database. Data-lake writes tables, portal reads them."

Env vars (`psg-advantage-portal/.env.example`):
- `NEXT_PUBLIC_SUPABASE_URL`
- `NEXT_PUBLIC_SUPABASE_ANON_KEY`
- `SUPABASE_SERVICE_ROLE_KEY`
- `REDIS_URL`

## `psg-advantage-portal` Integrations

- **Supabase Auth** — login, reset-password, update-password flows + middleware-gated dashboard routes
- **Supabase Storage / DB** — `psg-advantage-portal/src/lib/supabase/`
- **Postgres direct** — `pg` 8.20, `psg-advantage-portal/src/lib/postgres/` (read-heavy queries that bypass PostgREST)
- **Redis** — `ioredis` 5, cache layer via `REDIS_URL`
- **MapLibre GL** — geographic visualizations (market map, customer geography)
- **Recharts** — dashboard charts
- **Brand assets** — local `public/brand/` (fonts + logos)

## `psg-import` Integrations

- **Anthropic API** (`@anthropic-ai/sdk` 0.91) — vision-based ACRB handwritten form parsing (Claude Haiku 4.5 per `psg-import/.paul/PROJECT.md`)
- **Smarty Streets API** — address validation (per `PROJECT.md`)
- **Google Places API** — commercial address company name population
- **Invoiced API** — referenced in settings (per `PROJECT.md`)
- **NHTSA toggle** — vehicle data
- **FileMaker** — output target (Import Flush tab-delimited format); future v3 plan adds FileMaker API
- **PapaParse** + **SheetJS** — file parsing (not external services but core deps)

## `psg-data-lake` Integrations

- **Google BigQuery** — `google-cloud-bigquery[pandas,pyarrow]`
- **HuggingFace `datasets`** — `datasets>=3.0`
- **Census API** — `census_income.py`, `census_vehicles.py`
- **DMV data** (state-level) — `dmv_registrations.py`, `ca_dmv_registrations.py`, `county_vehicle_registrations.py`, `fhwa_registrations.py`
- **FARS** (Fatality Analysis Reporting System) — `fars_crashes.py`
- **Atlas EV Hub** — `atlas_ev_hub.py`
- **Storm event data** — `storm_events.py`, `storm_sources.py`
- **Supabase Postgres write** — `psg-data-lake/supabase_migration.py`, `psycopg`

## `api-psghub/ads-dash` Reference Material (not live integration — content)

- **Google Ads** workspace under `api-psghub/ads-dash/Google Ads/`:
  - `century_ads_adgroups.csv`, `century_ads_adgroups_v4.csv`
  - `century_rsa_ads_v3.csv`
  - `century_adgroup_keywords_broad.csv`
  - `century_marketing_data_dictionary.md`
  - `century_marketing_synthetic_data.json`
  - Mockup HTML: `century_marketing_dashboard.html`, `index.html`, `campaigns.html`, `adgroups.html`, `intelligence.html`, `localseo.html`

This is a **prototype**, not a live Google Ads API connection. For `psg-hub`, the live integration must be built.

## Required But Not Yet Built (gaps for `psg-hub`)

User's intent calls for a unified customer-facing hub covering:

| Surface | Source today | Status for hub |
|---------|--------------|----------------|
| **Google Ads metrics** | static CSVs in `api-psghub/ads-dash/Google Ads/` | ⚠ Need real Google Ads API integration |
| **Google Analytics** | not detected | ❌ Not built |
| **SEMrush** | not detected | ❌ Not built |
| **Digital presence snapshot** | partial in `psg-advantage-portal/marketing-intelligence/` | 🟡 Needs scope clarification |
| **Shop sentiment / reviews** | partial in `psg-advantage-portal/(dashboard)/shops/[shopName]/comments/` | 🟡 Existing data model unclear |
| **Invoice viewing** | Invoiced API in `psg-import` settings; no UI | ❌ Need surface in hub |
| **Payment** | not detected | ❌ Likely Stripe or Invoiced.com payment links |
| **Post-repair follow-up** | survey responses in `psg-data-lake/Export/advatange-survey-responses*.xlsx` | 🟡 Data exists, no surface |
| **Pipedrive** | xlsx audits in `pipedrive/` only | ❌ Need real Pipedrive API integration |

## Auth / Identity

Only **Supabase Auth** detected as a real auth system (in `psg-advantage-portal`). No NextAuth, Clerk, Auth0, or custom JWT systems observed in other active projects. This is good news — fewer consolidation risks.

## Webhooks / Cron / Background Jobs

- **Not detected** in active code. No `/api/cron/`, no `vercel.json` cron entries inspected, no Supabase Edge Functions enumerated.
- `psg-data-lake` ETL scripts are run manually or by external scheduler today.

## Cross-App Dependencies (red flag for monorepo migration)

- No formal cross-imports detected between active apps (each has its own `src/`)
- `psg-advantage-portal` and `psg-data-lake` couple through **shared Supabase schema**, not code — this is healthy
- `psg-import` couples through **shared Supabase + `refresh-invoiced-customers` script** — script may write to the same DB
