# CONVENTIONS

*Last mapped: 2026-05-28*

## Workspace-Level

- **No monorepo tooling** — no `pnpm-workspace.yaml`, `turbo.json`, `nx.json`, or root `package.json`
- **No root tsconfig** — each app has its own
- **No shared linter / formatter config**
- Per-project git repos (each active subdir has its own `.git/`)

This is the single biggest convention gap for consolidation.

## Per-Project Tooling

| Project | Lint | Format | TS Strict | Test Framework | Test Count | Notes |
|---------|------|--------|-----------|----------------|-----------|-------|
| `psg-advantage-portal` | ESLint 9 + eslint-config-next 15.5.12 | none | Next defaults (strict) | Vitest 4 + jsdom + Testing Library | 27 | ⭐ Strongest |
| `psg-import` | ESLint 9 + eslint-config-next 16.2.3 | none | Next defaults (strict) | Vitest 4 + @vitest/ui | TBD | Next 16 (newer than anchor) |
| `psg-data-lake` | none detected | none detected | n/a (Python) | pytest 8 | unknown — has `.pytest_cache/` | requirements.txt |
| `api-psghub/*` | varies / none | none | n/a (PHP / mixed) | none | 0 | legacy |
| `dashboard-psgdigital` | n/a | n/a | n/a | none | 0 | PHP file only |
| `invoice-psgdigital` | n/a | n/a | n/a | none | 0 | WordPress |
| `shop-theacrb` | n/a | n/a | n/a | none | 0 | WordPress |
| `portal`, `sst-psgdigital`, `invoice`, `web-dev-skills` | n/a | n/a | n/a | none | 0 | empty/stub |

## Code Style — `psg-advantage-portal` (the convention to inherit)

- **TS/TSX:** 2-space indent (inferred from configs), Next 15 / React 19 modern patterns
- **File naming:**
  - Components: PascalCase — `Button.tsx`, `MarketCommandDashboard.tsx`
  - Routes: lowercase / kebab-case (Next App Router enforced) — `customer-geography/`, `market-map/`
  - Route handlers: `route.ts`
  - Pages: `page.tsx`
  - Tests: co-located in `tests/` mirror (not co-located with source)
- **Component pattern:** UI primitives + chart wrappers + composed `*Dashboard.tsx` per route
- **Component index export:** `psg-advantage-portal/src/components/ui/index.ts` (barrel)
- **Routing:** App Router with route groups: `(auth)`, `(dashboard)` — segregates layouts and middleware behavior
- **API routes:** REST under `src/app/api/<resource>/route.ts`
- **Dynamic segments:** `[shopName]` — bracketed, camelCase for the param name
- **State:** Zustand store(s) in `src/store/`
- **Data access:** wrapper modules in `src/lib/supabase/` and `src/lib/postgres/` (do not import from raw clients inside components)

## Test Conventions — `psg-advantage-portal`

- Tests live under `psg-advantage-portal/tests/` mirroring source structure: `auth/`, `components/`, `lib/`, `api/`, `helpers/`, `store/`
- Vitest config + jsdom for component tests
- 27 test files = meaningful but partial coverage

## Documentation Style

- Project-level: `README.md` (mostly Next.js default in `psg-advantage-portal/`; rich in `psg-import/`)
- Planning artifacts as long markdown: `psg-import/PLANNING.md` (30KB), `psg-import/PRD_*.md`, `psg-advantage-portal/Master Project Plan_*.md` (12KB)
- Design system: `psg-advantage-portal/DESIGN-SYSTEM.md` (8.9KB) — inherit
- Session handoffs: `psg-advantage-portal/docs/session-handoff-2026-04-24.md`, `portal/HANDOFF-psg-data-lake.md`
- `.impeccable.md` files in `psg-advantage-portal/` and `psg-import/.impeccable-live/` — Impeccable design skill tracking

## Convention Recommendations for `psg-hub`

1. **Inherit `psg-advantage-portal` conventions wholesale.** It's the strongest existing foundation: tested, typed, route-grouped, design-system-documented.
2. **Decision needed:** Next 15 (anchor) vs Next 16 (psg-import). Recommend aligning on whichever target matches Vercel's current LTS at consolidation time.
3. **Add Prettier (or Biome).** No formatter today across any project. Standardize before scaling.
4. **Add root workspace config** if consolidating multiple apps under one repo: pick `pnpm-workspace.yaml` + Turborepo or migrate to single Next app with internal modules.
5. **Add root `.editorconfig`.** None exists.
6. **Make tests required for new dashboard surfaces.** Pattern already established — don't regress.
