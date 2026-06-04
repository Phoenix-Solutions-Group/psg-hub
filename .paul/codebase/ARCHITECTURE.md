# ARCHITECTURE

*Last mapped: 2026-05-28*

## Pattern Overview

**Loosely-coupled multi-app workspace**, not a formal monorepo. Two active Next.js apps + a Python ETL pipeline + several legacy PHP/WordPress sites + stub directories.

Shared backbone is a **single Supabase Postgres instance**: `psg-data-lake/` writes tables, `psg-advantage-portal/` reads them. `psg-import/` writes to the same Supabase via its own scripts.

## Active Anchor — `psg-advantage-portal`

**Pattern:** Next.js 15 App Router with route groups for auth/dashboard isolation.

**Layers:**
- UI layer — `psg-advantage-portal/src/components/` (primitives in `ui/`, charts in `charts/`, auth in `auth/`)
- Pages — `psg-advantage-portal/src/app/(dashboard)/*/page.tsx`, `(auth)/*`
- API routes — `psg-advantage-portal/src/app/api/*/route.ts`
- Data access — `psg-advantage-portal/src/lib/supabase/`, `psg-advantage-portal/src/lib/postgres/`
- State — `psg-advantage-portal/src/store/` (Zustand)
- Types — `psg-advantage-portal/src/types/`

**Entry points:**
- Web — `psg-advantage-portal/src/app/(dashboard)/page.tsx`
- Auth callback — `psg-advantage-portal/src/app/auth/callback/route.ts`
- Standalone runner — `psg-advantage-portal/scripts/start-standalone.mjs`
- Middleware — `psg-advantage-portal/middleware.ts`

**Existing dashboard surfaces** (each has a `(dashboard)/<route>/page.tsx`):
- `/` (dashboard home)
- `/shops` + `/shops/[shopName]` — shop list + detail
- `/customer-geography` — ZIP-level demand intelligence
- `/flower-hill` — single-shop view
- `/market-map` — geographic market view
- `/marketing-intelligence` — marketing analytics
- `/market-command` — market dashboard

**Existing API surfaces** (`psg-advantage-portal/src/app/api/`):
- `health/`
- `shops/` + `shops/[shopName]/{comments,competitors,trend}/`
- `markets/dashboard/`
- `network/{summary,trend,alerts}/`
- `customer-geography/{pins,shops,zip-income}/`
- `market-map/{intelligence,search,competitors}/`
- `flower-hill/`

## Secondary App — `psg-import`

**Pattern:** Next.js 16 single-purpose tool. Browser-side data preprocessor.

**Purpose:** Ingest raw shop data exports (XLSB/XLSX/CSV/TXT) → 8-stage pipeline → FileMaker-ready output.

**Entry points:** `psg-import/src/app/*`, scripts in `psg-import/scripts/`.

**Already PAUL-managed:** `psg-import/.paul/PROJECT.md` defines v2.5 shipped, v3.0 next.

## Data Pipeline — `psg-data-lake`

**Pattern:** Flat Python script collection. Each `.py` file is an independent ETL job.

**Entry points** (each runnable standalone):
- `psg-data-lake/customer_geography.py` — 38KB, central piece
- `psg-data-lake/crash_events.py`, `crash_sources.py`
- `psg-data-lake/census_income.py`, `census_vehicles.py`
- `psg-data-lake/dmv_registrations.py`, `ca_dmv_registrations.py`, `county_vehicle_registrations.py`, `fhwa_registrations.py`
- `psg-data-lake/atlas_ev_hub.py`
- `psg-data-lake/storm_events.py`, `storm_sources.py`
- `psg-data-lake/vehicle_estimation.py`, `vehicle_sources.py`
- `psg-data-lake/fars_crashes.py`
- `psg-data-lake/setup_dataset.py`, `create_views.py`, `create_density_table.py`
- `psg-data-lake/supabase_migration.py`
- `psg-data-lake/Export/` — vendor xlsx exports (Advantage repair responses, survey responses, vehicles)

**Shared config:** `psg-data-lake/config.py`.

## Legacy / Grab-bag — `api-psghub/`

PHP-era artifact. Subprojects of mixed quality:
- `api-psghub/ads-dash/` — Google Ads dashboard prototype (HTML/CSS/JS) with Century Collision mockups, RSA ads CSVs, synthetic data, data dictionary. **Relevant to psg-hub** as reference for Google Ads UI patterns.
- `api-psghub/psg-insight-hub/` — PHP insight hub (api/, pages/, templates/, includes/, index.php). Possibly the conceptual predecessor of psg-hub.
- `api-psghub/address-validator/`, `address-validator-v2/` — likely already absorbed into `psg-import` workflow
- `api-psghub/discovery2/`, `parser_v0/`, `parser_v3/` — old parsing experiments
- `api-psghub/n8n/` — n8n workflow exports
- `api-psghub/timezone-converter/`

## Data Flow (current)

```
Raw shop exports                  Public data (BigQuery, gov APIs)
       |                                       |
       v                                       v
   psg-import (Next.js)                psg-data-lake (Python)
       |                                       |
       +-----> Supabase Postgres <-------------+
                       |
                       v
            psg-advantage-portal (Next.js)
                       |
                       v
            (internal users today — not customer-facing)
```

## Target Data Flow (after consolidation)

```
Raw shop exports         Public data         Google Ads API     Stripe/Invoiced     Pipedrive
     |                        |                    |                   |               |
     v                        v                    v                   v               v
psg-import (tool)      psg-data-lake          [new]              [new]              [new]
     \______________________ | _____________________ | _________________ | ____________ /
                             v
                    Supabase Postgres (single)
                             |
                             v
                   psg-hub (Next.js, customer-facing)
                             |
                             v
                     PSG Customers + Internal Staff
```

## Key Abstractions Worth Inheriting (from `psg-advantage-portal`)

- Supabase SSR client pattern — `psg-advantage-portal/src/lib/supabase/`
- Auth middleware — `psg-advantage-portal/middleware.ts`
- API route conventions (REST under `src/app/api/`)
- Dashboard component pattern: page → Dashboard component → Panel + Metric + chart primitives
- Test setup with Vitest + jsdom + Testing Library
