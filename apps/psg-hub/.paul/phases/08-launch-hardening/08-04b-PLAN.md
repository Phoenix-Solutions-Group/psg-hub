---
phase: 08-launch-hardening
plan: 04b
type: execute
wave: 1
depends_on: []
files_modified:
  - package.json
  - playwright.config.ts
  - e2e/global-setup.ts
  - e2e/auth.spec.ts
  - e2e/customer.spec.ts
  - e2e/shop-switch.spec.ts
  - .env.test.local
  - .gitignore
  - .paul/phases/08-launch-hardening/BRAND-VISUAL-v0.2.md
autonomous: false
---

<objective>
## Goal
Stand up Playwright E2E against a local Supabase target (zero PII), cover the three v0.2 happy paths (auth + one customer surface + the 07-03 shop-switch flow), run `@axe-core/playwright` WCAG AA assertions inside the same run, and capture screenshots for a visual brand pass. The live-surface half of S5 — closes Phase 8 and the v0.2-phase.

## Purpose
S5 quality gate: PROJECT success metric requires "Playwright E2E happy paths (auth + 1 customer + the shop-switch flow)" and "WCAG AA on customer routes" before the v0.2 customer surface is launch-ready. 08-04 delivered the unit-coverage + static-brand half; this delivers the rendered-surface half that unit tests + grep cannot reach (real auth cookies, multi-tenant switch, accessibility, visual conformance).

## Output
- Playwright harness: `playwright.config.ts`, `e2e/global-setup.ts` (programmatic fixtures + `storageState` per role), `test:e2e` script
- 3 E2E specs with embedded axe WCAG AA scans + screenshot capture
- A local Supabase target recipe (db reset from migrations; documented dump-only fallback)
- `BRAND-VISUAL-v0.2.md` (visual brand findings + operator verdict)
- `08-04b-SUMMARY.md`
</objective>

<context>
## Project Context
@.paul/PROJECT.md
@.paul/ROADMAP.md
@.paul/STATE.md

## Prior Work (direct input)
@.paul/phases/08-launch-hardening/08-04-SUMMARY.md
# 08-04 settled the split + the target+seed reconciliation. This plan executes the live-surface half.

## Source Files (the surfaces under test + the seed ladder to mirror)
@src/lib/supabase/server.ts
@src/lib/shop/context.ts
@src/app/api/shop/switch/route.ts
@src/app/api/onboarding/route.ts
@src/app/dashboard/layout.tsx
@supabase/config.toml
</context>

<acceptance_criteria>

## AC-1: Local target + seed + auth harness stands up
```gherkin
Given a local Supabase stack with the schema replayed (supabase db reset from the in-repo remote_schema + RBAC/RLS migrations; db dump --schema-only fallback if an extension fails) and `next start` pointed at it
When `pnpm test:e2e` runs
Then Playwright globalSetup creates the fixture users via the admin API, seeds client->shop->shop_users->app_user_roles via the service-role ladder, logs each in, and writes a storageState file per role
And no fixture or run touches the shared prod project (local-only; zero live PII)
```

## AC-2: Three happy-path E2E specs pass
```gherkin
Given the seeded local target + per-role storageState
When the suite runs
Then auth.spec (login form -> authenticated /dashboard), customer.spec (a customer surface — reviews/settings — renders scoped to the active shop), and shop-switch.spec (the multi-shop fixture switches shops and the surface rescopes) all pass
```

## AC-3: axe WCAG AA assertions pass on the customer surface
```gherkin
Given each rendered page in the specs
When @axe-core/playwright runs a WCAG 2.0/2.1 AA scan
Then there are zero serious/critical violations
Or each remaining violation is documented (rule id + why deferred) in the SUMMARY
```

## AC-4: Visual brand pass recorded + approved
```gherkin
Given desktop + mobile screenshots captured in the specs for the key customer pages (login, dashboard, reviews/settings)
When the operator reviews them against the PSG design system at the human-verify checkpoint
Then BRAND-VISUAL-v0.2.md records the findings + a pass/fix verdict
And any approved fix is small (className/token) and re-verified
```

</acceptance_criteria>

<tasks>

<task type="auto">
  <name>Task 1: Local Supabase target + Playwright harness (seed + storageState)</name>
  <files>package.json, playwright.config.ts, e2e/global-setup.ts, .env.test.local, .gitignore</files>
  <action>
    1. **Target:** `npx supabase start`, then `npx supabase db reset` to replay the in-repo migrations (596KB `20260602105554_remote_schema.sql` carries the base schema + extensions + policies; the RBAC/RLS/reviews/llm migrations layer on top). If `db reset` fails on an extension/FDW (postgis/vector/wrappers/supabase_vault) or grants, FALL BACK to `npx supabase db dump --schema-only` against prod -> load into the local DB. RECORD which path worked in the SUMMARY. Capture the local API URL + anon + service_role keys from `supabase status` into `.env.test.local` (gitignored — these are local demo keys, never prod).
    2. **Deps:** add `@playwright/test` + `@axe-core/playwright` (devDependencies; Playwright is the sanctioned v0.2 E2E tool per PROJECT tech stack). `npx playwright install chromium`.
    3. **Config:** `playwright.config.ts` — testDir `e2e/`, baseURL `http://localhost:3000`, `webServer` running `next start` (prod build) with the env loaded from `.env.test.local` so middleware/`@supabase/ssr` point at the LOCAL stack, `globalSetup: ./e2e/global-setup.ts`, projects use per-role `storageState`.
    4. **globalSetup (`e2e/global-setup.ts`):** using the local service-role client + admin API — create 2 customer fixtures (createUser): a 1-shop owner and a 2+-shop user; for each, seed the client->shop->shop_users(role)->app_user_roles(customer) ladder via service-role (MIRROR `src/app/api/onboarding/route.ts` — UUIDs are dynamic from createUser, so this MUST be programmatic, not a static seed.sql). Then sign each in (password grant) and persist `storageState` JSON per role under `e2e/.auth/` (gitignored).
    Avoid: any connection to the shared prod project; a static `seed.sql` for membership rows (FKs auth.users with dynamic UUIDs); committing `.env.test.local` or `e2e/.auth/`.
  </action>
  <verify>`pnpm test:e2e` boots the local stack target + webServer; globalSetup completes and writes a storageState file per role; a trivial spec loads `/login` and gets 200.</verify>
  <done>AC-1 satisfied: local target seeded, per-role storageState produced, zero prod contact.</done>
</task>

<task type="auto">
  <name>Task 2: Three happy-path specs + axe WCAG AA + screenshots</name>
  <files>e2e/auth.spec.ts, e2e/customer.spec.ts, e2e/shop-switch.spec.ts, .paul/phases/08-launch-hardening/BRAND-VISUAL-v0.2.md</files>
  <action>
    1. `auth.spec.ts` — from a clean (no storageState) context: load `/login`, submit the 1-shop fixture credentials, assert redirect to an authenticated `/dashboard` (shell + shop visible).
    2. `customer.spec.ts` — using the 1-shop storageState: load a customer surface (reviews or settings) and assert it renders scoped to the active shop (no cross-tenant data, no 500/empty-shop notice).
    3. `shop-switch.spec.ts` — using the multi-shop storageState: assert the `<ShopSwitcher>` lists the memberships, switch to the 2nd shop (drives `POST /api/shop/switch`), assert the surface rescopes (the 07-03 flow that was only manually verified before).
    4. In EACH spec, after the page settles, run `new AxeBuilder({ page }).withTags(['wcag2a','wcag2aa']).analyze()` and assert zero `serious`/`critical` violations (collect any lower ones for the SUMMARY). Capture desktop (1280) + mobile (375) screenshots of each page into `e2e/screenshots/`.
    5. Add the `BRAND-VISUAL-v0.2.md` skeleton (page list + screenshot paths + a findings table to fill at human-verify).
    Prefer accessible-role / text / label selectors. If a stable selector is genuinely unavailable, a minimal `data-testid` on the customer surface is allowed — FLAG any src touch in the SUMMARY (no logic change).
    Avoid: asserting against inherited/pre-v0.2 surfaces; flaky waits (use web-first assertions); editing app logic.
  </action>
  <verify>`pnpm test:e2e` green (3 specs); axe assertions pass (no serious/critical); screenshots present in `e2e/screenshots/`.</verify>
  <done>AC-2 + AC-3 satisfied: happy paths pass with clean WCAG AA; screenshots captured.</done>
</task>

<task type="checkpoint:human-verify" gate="blocking">
  <what-built>Playwright E2E (auth + customer + shop-switch) against a local Supabase target, with in-run axe WCAG AA scans and desktop+mobile screenshots of the customer pages.</what-built>
  <how-to-verify>
    1. Run: `pnpm test:e2e` (boots the local stack target; first run pulls Supabase images).
    2. Confirm: all 3 specs pass; the axe step reports 0 serious/critical.
    3. Review: the screenshots in `e2e/screenshots/` (login, dashboard, reviews/settings, switched-shop) against the PSG design system — eyebrow→headline rhythm, paper surface, single ember accent, logo treatment, navy sidebar, no BSM/boilerplate identity.
    4. Confirm: `BRAND-VISUAL-v0.2.md` reflects what you see; flag any visual drift to fix.
  </how-to-verify>
  <resume-signal>Type "approved" (records the visual PASS verdict), or describe visual issues to fix.</resume-signal>
</task>

</tasks>

<boundaries>

## DO NOT CHANGE
- The shared prod Supabase project (`gylkkzmcmbdftxieyabw`) — this plan is LOCAL-stack only; ZERO prod write, no migration on prod
- App authz/runtime logic: 06-03 gate, 07-03 resolver/switcher, /api authz routes, RLS policies (E2E observes; it does not modify behavior)
- The 08-04 coverage gate (`vitest.config.ts` coverage block) + the v0.2 unit-test suite
- packages/ui/psg-brand submodule + Phase-2 token canon

## SCOPE LIMITS
- No new app features; MSO portfolio/aggregate view stays v0.3
- No prod deploy in this plan (the phase-transition commit is the only git action, at UNIFY)
- Secrets: only LOCAL supabase demo keys in gitignored `.env.test.local`; never commit prod env or `e2e/.auth/`
- App src edits limited to minimal `data-testid` hooks IF a stable selector is otherwise impossible (flagged); no logic change
</boundaries>

<verification>
Before declaring plan complete:
- [ ] Local Supabase stack up; schema replayed (db reset, or documented dump-only fallback); fixtures seeded; zero prod contact
- [ ] `pnpm test:e2e` green — 3 specs (auth, customer, shop-switch)
- [ ] axe WCAG AA: 0 serious/critical (any lower documented)
- [ ] Screenshots captured; `BRAND-VISUAL-v0.2.md` written + operator-approved
- [ ] `pnpm typecheck` clean · `pnpm lint` 0 err · `pnpm test -- --coverage` still green (08-04 gate intact) · `pnpm build` ✓
- [ ] All acceptance criteria met
</verification>

<success_criteria>
- Playwright E2E harness runs against a local, zero-PII Supabase target with per-role auth
- The three v0.2 happy paths pass, including the 07-03 switch flow (previously only manually verified)
- WCAG AA clean on the customer surface; visual brand pass recorded + approved
- ZERO prod write/contact, no prod migration; only LOCAL test infra + gitignored secrets added
- Phase 8 + the v0.2-phase transition fire at this plan's UNIFY (LAST plan)
</success_criteria>

<output>
After completion, create `.paul/phases/08-launch-hardening/08-04b-SUMMARY.md`
</output>
