# STACK

*Last mapped: 2026-05-28*

## Workspace Type

Multi-project monorepo (not formally wired — no `pnpm-workspace.yaml`, `turbo.json`, or root `package.json`). 14 sibling project directories, several active, several legacy/abandoned.

**Git remote:** `Phoenix-Solutions-Group/data` (per `portal/HANDOFF-psg-data-lake.md`).

## Primary Stack (Active Anchor: `psg-advantage-portal`)

**Frontend / Full-stack:**
- Next.js 15.5.12 (App Router, standalone output) — `psg-advantage-portal/package.json`
- React 19.1.0
- TypeScript 5 (strict via Next defaults) — `psg-advantage-portal/tsconfig.json`
- Tailwind CSS 4 — `psg-advantage-portal/postcss.config.mjs`
- shadcn-style local UI primitives — `psg-advantage-portal/src/components/ui/*`
- Recharts 3.8 — charts
- MapLibre GL 5.24 — maps
- Zustand 5 — state
- date-fns 4

**Backend / Data:**
- Supabase (SSR + JS SDK) — `psg-advantage-portal/src/lib/supabase/`
- Postgres direct (`pg` 8.20) — `psg-advantage-portal/src/lib/postgres/`
- ioredis 5 — Redis cache
- 30+ SQL migrations — `psg-advantage-portal/supabase/migrations/`

**Testing:**
- Vitest 4 + jsdom — `psg-advantage-portal/vitest.config.*`
- Testing Library (React + jest-dom)
- 27 test files in `psg-advantage-portal/tests/`

## Secondary App (`psg-import`)

- Next.js 16.2.3 (newer than anchor — note for alignment)
- React 19.2.4
- Anthropic SDK `@anthropic-ai/sdk` 0.91 — vision-based form parsing
- React-PDF + pdfjs-dist — PDF rendering
- SheetJS (`xlsx`) + PapaParse — spreadsheet ingest
- Tailwind 4 + Vitest 4 (same family as anchor)
- Already PAUL-initialized — `psg-import/.paul/`

## Data Pipeline (`psg-data-lake`)

- Python 3 (managed `.venv`) — `psg-data-lake/.venv/`
- `google-cloud-bigquery[pandas,pyarrow]>=3.40` — `psg-data-lake/requirements.txt`
- `datasets>=3.0` (HuggingFace)
- `psycopg[binary]>=3.2` — writes to Supabase Postgres
- `pytest>=8.0`
- 30+ ETL scripts at root: census, DMV, crash events, vehicle registrations, customer geography, atlas EV, storm events

## Legacy / PHP Stack

- `dashboard-psgdigital/` — PHP (`about.php`), no package manager
- `invoice-psgdigital/` — WordPress (`wp-content/`)
- `shop-theacrb/` — WordPress (`wp-content/`)
- `api-psghub/` — PHP grab-bag: `chatkit_session.php`, `info.php`, `index.html`, plus subprojects (`address-validator`, `address-validator-v2`, `ads-dash`, `discovery2`, `n8n`, `parser_v0`, `parser_v3`, `psg-insight-hub`, `timezone-converter`)

## Runtime / Tooling

- Node version: not pinned (no `.nvmrc` in active projects)
- Package manager: npm (lockfiles present in `psg-advantage-portal/`, `psg-import/`)
- Linter: ESLint 9 with `eslint-config-next` — `psg-advantage-portal/eslint.config.mjs`, `psg-import/eslint.config.mjs`
- Formatter: not detected (no `.prettierrc`, no `biome.json`)
- Docker: `psg-advantage-portal/Dockerfile`, `psg-advantage-portal/docker-compose.yml`

## Deployment

- Vercel — `psg-advantage-portal/.vercel/`, `psg-import/.vercel/`, root `.vercel/`
- Root `.vercelignore` present
- `psg-advantage-portal` runs on port 3001 (`"dev": "next dev --port 3001"` — `psg-advantage-portal/package.json`)

## Empty / Inactive

- `invoice/` — empty dir
- `portal/` — git repo, only `.gitkeep` + `HANDOFF-psg-data-lake.md`
- `sst-psgdigital/` — git repo with only `.gitignore` (despite name implying SST/AWS — no SST config)
- `web-dev-skills/` — empty `projects/` dir
- `psg/` — Obsidian vault, not a project
- `pipedrive/` — only xlsx/docx audit artifacts, no code
- `local-reach-content/` — content folder + skill markdown, not a buildable app
