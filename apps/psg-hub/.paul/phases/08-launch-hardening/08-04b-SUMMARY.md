---
phase: 08-launch-hardening
plan: 04b
type: execute
status: APPLY complete (UNIFY pending)
date: 2026-06-04
autonomous: false
---

# 08-04b SUMMARY — Live-surface S5: Playwright E2E + WCAG AA + visual brand

The live-surface half of S5 (08-04 delivered the unit-coverage + static-brand
half). Stood up Playwright E2E against a LOCAL Supabase target (zero prod
contact), covered the three v0.2 happy paths, ran axe WCAG AA in-run, and
captured desktop+mobile screenshots for the visual brand pass. **LAST Phase-8
plan** — its UNIFY fires the Phase 8 + v0.2-phase transition.

## Result

`pnpm test:e2e` → **4 passed (~22s)**: setup + auth + customer + shop-switch.
axe WCAG 2.0/2.1 AA: **0 serious/critical** across all 5 captured states.

## Acceptance criteria

- **AC-1 (local target + seed + auth harness) — PASS.** `supabase db reset`
  replayed the schema cleanly (the **db reset path WORKED** — no dump-only
  fallback needed; postgis `st_*` GRANT lines are warnings, not failures; all 12
  migrations incl. the RLS remediation applied). Playwright `setup` project seeds
  2 fixtures via the service-role ladder (mirrors `/api/onboarding`), logs each in
  through the real UI, and writes a `storageState` per role. Zero prod contact
  (hard local-only guard in `global.setup.ts`).
- **AC-2 (three happy paths) — PASS.** `auth.spec` (login → authenticated
  /dashboard), `customer.spec` (settings scoped to the active shop), `shop-switch.spec`
  (multi-shop user switches A→B, surface rescopes — the 07-03 flow, previously
  only manually verified).
- **AC-3 (axe WCAG AA) — PASS.** 0 serious/critical after the one fix below; 0
  lower-impact recorded. `checkA11y` stays strict (fails on serious/critical).
- **AC-4 (visual brand pass) — PASS.** Operator approved at the human-verify
  checkpoint; `BRAND-VISUAL-v0.2.md` records the verdict. No visual fixes.

## The one real finding (fixed)

**`color-contrast` (serious):** `--muted-foreground: #949494` ("mist") on
paper/white = **3.03:1**, below the 4.5:1 AA floor — hit every customer page
(login muted copy, settings `dt` labels). Fixed by darkening the **light-mode**
token to `#707070` (~4.95:1 on #fff, ~4.72:1 on #FAFAFA) in `globals.css`.
Dark-mode `#8FA1B2` untouched. The plan's `<verification>` requires 0
serious/critical (only lower-impact may be documented), so this was fixed, not
deferred — exactly the "small (className/token)" fix AC-4 sanctions at the
checkpoint.

## Deviations

1. **Token canon touched (flagged).** `--muted-foreground` #949494→#707070 in
   `globals.css`. The boundary protects the Phase-2 token *system*; this is a
   single value darken for AA, accepted by the operator. One-line revertable.
2. **Port 3100, not 3000.** Local Obsidian squats :3000, so the webServer + axe
   target run on :3100 (config-only; app routes are relative/port-agnostic).
3. **profiles seeded explicitly.** Local stack has no auth.users→profiles
   trigger (prod provisions it via a signup trigger absent from the schema dump),
   and `clients.created_by` + `app_user_roles.profile_id` FK → `profiles(id)`.
   The fixture inserts a `profiles` row (role `viewer` per the legacy
   `profiles_role_check` = admin|reviewer|viewer; unrelated to the RBAC gate).
4. **`customer.spec` selector.** `CardTitle` renders a styled div, not a heading
   role → matched "Shop profile" by exact text.

## Boundaries held

ZERO prod write/contact, no prod migration, no app authz/runtime logic change
(06-03 gate / 07-03 resolver+switcher / API authz / RLS observed, not modified).
08-04 coverage gate intact. Only the one token value in `globals.css` changed in
app `src/`; everything else is new local test infra + gitignored secrets.

## Gates

typecheck clean · lint 0 err (1 pre-existing middleware `options` warning) ·
`pnpm test -- --coverage` exit 0 (255 tests, 88.85% lines, perFile≥70 intact) ·
`pnpm build` ✓ · `pnpm test:e2e` 4 passed, axe 0 serious/critical.

## Files

- NEW `playwright.config.ts`, `.env.test.local` (gitignored), `e2e/fixtures.ts`,
  `e2e/_helpers.ts`, `e2e/global.setup.ts`, `e2e/auth.spec.ts`,
  `e2e/customer.spec.ts`, `e2e/shop-switch.spec.ts`
- NEW `.paul/phases/08-launch-hardening/BRAND-VISUAL-v0.2.md`
- MOD `package.json` (+`test:e2e`, devDeps `@playwright/test` + `@axe-core/playwright`),
  `.gitignore` (e2e artifacts), `src/app/globals.css` (1 token value)
- GENERATED (gitignored) `e2e/.auth/*.json`, `e2e/screenshots/*.png`

**Not committed** (operator commits at/after UNIFY — this is the last Phase-8
plan, so the phase-transition commit lands here).
