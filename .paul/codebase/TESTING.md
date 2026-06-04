# TESTING

*Last mapped: 2026-05-28*

## Active Test Infrastructure

### `psg-advantage-portal` — ⭐ Strongest

- **Framework:** Vitest 4 + jsdom + Testing Library (React + jest-dom)
- **Config:** `psg-advantage-portal/vitest.config.*` (declared via `vitest` in `package.json` devDeps)
- **Layout:** `psg-advantage-portal/tests/` mirroring source — separate from `src/`
- **Coverage:** 27 test files across:
  - `tests/auth/`
  - `tests/components/`
  - `tests/lib/`
  - `tests/api/`
  - `tests/helpers/`
  - `tests/store/`
- **Runner:** `npm test` → `vitest run` — `psg-advantage-portal/package.json`
- **Custom verification script:** `psg-advantage-portal/scripts/verify-customer-geography-parity.mjs` (runs invariant check against live data)

### `psg-import`

- **Framework:** Vitest 4 + @vitest/ui in devDeps
- **Test count:** not confirmed (vitest config installed but file count not enumerated)
- **Status:** PAUL-managed, so test discipline likely exists per phase handoffs

### `psg-data-lake`

- **Framework:** pytest >=8.0 in `psg-data-lake/requirements.txt`
- **Evidence:** `psg-data-lake/.pytest_cache/` exists
- **Validation runner:** `psg-data-lake/run_validation.py`
- **Test files:** not explicitly enumerated — likely sparse

## No Test Coverage

- `api-psghub/*` (PHP) — none
- `dashboard-psgdigital/` (PHP) — none
- `invoice-psgdigital/`, `shop-theacrb/` (WordPress) — none
- All empty / stub dirs — n/a

## E2E / Integration

- **Not detected.** No Playwright, Cypress, or Puppeteer configured in any active project.
- For a customer-facing hub, E2E coverage of auth + at least one dashboard happy path is recommended before launch.

## Test Patterns Worth Inheriting (from `psg-advantage-portal`)

- Mirror-source layout in `tests/` (clean separation, easy to ignore in build)
- jsdom-based component tests — fast, no real browser
- Separate `tests/helpers/` for shared fixtures
- Data-parity scripts (`scripts/verify-customer-geography-parity.mjs`) — useful pattern for any data-derived dashboard

## Gaps for `psg-hub` Plan

1. **No E2E framework** — add Playwright if customer-facing flows are critical (auth, payment view, invoice download)
2. **No coverage thresholds detected** — Vitest supports `--coverage` but no enforced gates
3. **No load / perf testing** — for a dashboard pulling from Supabase + Redis + Postgres, this matters at scale
4. **No contract tests** — API routes interact with Supabase schema; schema drift is a real risk given 30+ migrations already
