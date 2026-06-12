# Roadmap: psg-hub

## Overview

Ten milestones across two tracks. Customer track ships v1.0 first (v0.1 → v0.4). Internal ops + agentic tracks ship post-v1.0 strictly sequential, single team (D62). No fixed launch date — quality-first, ship when ready (D60). BSM PAUL preserved as foundation; psg-hub starts at v0.1. FleetComplete 2019 spec drives v1.1+ scope (never shipped — greenfield, D51).

## Current Milestone

**v0.3 Customer Analytics** (v0.3.0)
Status: 🚧 In Progress
Phases: 3 of 4 complete

Turn the empty analytics surface into a unified, story-led **SEMrush + Google Ads + GA4 + GSC** marketing view, output as the automated **PSG monthly client report** (multi-LLM narrative + branded PDF). Built from the absorbed ads-dashboard canon.

**Re-planned 2026-06-04 (grounding overturned the premise):** the ROADMAP assumed "BSM Phase 5 Google Ads data already exists, no OAuth." Verified FALSE on prod — the `google_ads_*` tables do not exist, no source has stored data, and every source needs ingest groundwork. So phases are re-ordered by ascending OAuth/ingest friction: foundation + the lowest-friction source first to prove the surface end-to-end, heavier sources next, report last. Grew 3 → 4 phases.

| Phase | Name | Plans | Status | Completed |
|-------|------|-------|--------|-----------|
| 9 | Analytics foundation + SEMrush | 3/3 ✅ | ✅ Complete + LIVE on prod (real numbers, 4 url-shops; activated 2026-06-09) | 2026-06-05 |
| 10 | Google Ads | 10-01 ✅ · 10-02 ✅ · 10-03 ✅ (gate batch executed live) · 10-04 ✅ (MCC account-selection) | ✅ Complete + LIVE on prod (Wallace pilot real paid numbers) | 2026-06-09 |
| 11 | GA4 + GSC | 4/4 ✅ (11-01 foundation · 11-02 GA4 · 11-03 GSC · 11-04 gate batch executed live) | ✅ Complete + LIVE on prod (Wallace pilot real GA4 + GSC numbers on the live surface; activated 2026-06-10) | 2026-06-10 |
| 12 | PSG report — narrative + PDF | 12-01 data layer ✅ · 12-02 narrative + eval gate ✅ · 12-03 print+render+delivery ✅ · 12-04 cron+base-activation ✅ LOOP CLOSED 2026-06-11 (activation-verified end-to-end); 12-05 GA4-dimensional + real-perf (CrUX/PageSpeed/GTMetrix) RESEARCHED 2026-06-11 → split into a 3-plan arc: 12-05a GA4 dims ✅ LOOP CLOSED 2026-06-12 · 12-05b perf sources ✅ LOOP CLOSED 2026-06-12 · 12-05c cron+gate | 🚧 In progress (6/7 closed; 12-05c remains; 12-05c closes the phase + milestone) | - |

v0.2 Customer MVP (v0.2.0) ✅ COMPLETE 2026-06-04 (3/3 phases; see Completed Milestones).

<!-- audit-added 2026-06-02: from AUDIT-2026-06-02-trajectory.md (whole-project trajectory audit) -->
### v0.2 Readiness Gates (from trajectory audit 2026-06-02)

Entry criteria for v0.2, folded into the phase split. Full rationale: `.paul/AUDIT-2026-06-02-trajectory.md`.

**Decided (operator 2026-06-02):**
- **M1 — Revenue checkpoint — build-first.** EOY-2026 MRR = directional horizon, not a hard gate; roadmap NOT re-sequenced around a deadline (quality-first D60 stands; audit's revenue-checkpoint rec declined by choice).
- **M4 — Land v0.1 — push DONE** (origin has `chore/phase-3-integrations`@`3a641d9` + tag `v0.1.0`). Land-on-`main` DEFERRED (stay CLI `vercel --prod`, option C).

**In v0.2 scope (mapped to phases):**
- **M2 / S1 — Compliance forward** → Phase 8 (PII + RLS + secret-handling gate, PII RLS review before any live-data shop, first AEGIS pass) + Phase 6 (RLS spine on a migration-safety/isolation protocol).
- **S3 — Inherited defect** Stripe INSERT→UPSERT → track for the v0.4 billing path (refresh-token + review-sync cron mostly v0.3).
- **S4 — Idempotency mechanism + checklist** as new tables/imports land → Phases 6-8.
- **S5 — Quality gates** Vitest ≥70% + Playwright happy-path → Phase 8.

**Deferred past v0.2:**
- **M3 — Reproducible deploy** (GH Actions prebuilt / vendor brand assets) → before v0.4 first-dollar; CLI `vercel --prod` until then.
- **S6 — Gotham (Typekit) license** → before broad customer launch (v0.4). **S2 — Pilot onboarding** → v0.4.
<!-- end audit-added -->

## Next Milestone

**v0.4 Invoicing + Payments** — Invoiced.com mirror + Stripe coexistence + payment links — **v1.0 customer launch**. Picks up the v0.3-deferred Stripe INSERT→UPSERT (S3) + PII-at-rest retention.


## Completed Milestones

<details>
<summary>v0.2 Customer MVP — 2026-06-04 (3 phases, 14 plans)</summary>

| Phase | Name | Plans | Completed |
|-------|------|-------|-----------|
| 6 | RBAC + RLS spine | 5/5 | 2026-06-03 |
| 7 | Tier gating + shop switcher | 3/3 | 2026-06-03 |
| 8 | Launch hardening | 6/6 | 2026-06-04 |

Gates (all PASS): Vitest 88.85% (perFile≥70) · Playwright E2E (auth+customer+switch) · WCAG AA 0 serious/critical · AEGIS first pass no-blocker · gitleaks clean · brand static+visual · blanket-allow RLS breach closed on prod. Secure role-gated multi-tenant customer surface LIVE on hub.psgweb.me. Archive: `.paul/milestones/v0.2.0-ROADMAP.md`. Phase commit `b1f875d` (not merged/pushed — prod promotion operator-gated). Tag namespaced (peer sitemap-maker holds `v0.2.0` in this shared monorepo). Full phase detail retained in the Phases section below.

</details>

<details>
<summary>v0.1 Foundation — 2026-06-02 (5 phases, 18 plans)</summary>

| Phase | Name | Plans | Completed |
|-------|------|-------|-----------|
| 1 | Workspace consolidation + multi-repo relocation | 7/7 | 2026-05-31 |
| 2 | Design system — submodule + brand embodiment | 4/4 | 2026-06-01 |
| 3 | SendGrid + Twilio + Sanity + Vercel deploy | 5/5 | 2026-06-01 |
| 4 | PAUL inheritance + tracking | 1/1 | 2026-06-01 |
| 5 | local_reach client output archive | 1/1 | 2026-06-02 |

Gates: gitleaks ✅ clean (1 vetted FP) · AEGIS → v2.0 · v0.1→main merge operator-gated. Archive: `.paul/milestones/v0.1.0-ROADMAP.md`. Full phase detail retained in the Phases section below.

</details>

## Phases

**Phase Numbering:**
- Integer phases (1, 2, 3): Planned milestone work
- Decimal phases (2.1, 2.2): Urgent insertions (marked with [INSERTED])

### v0.1 — Foundation

| Phase | Name | Plans | Status | Completed |
|-------|------|-------|--------|-----------|
| 1 | Workspace consolidation + multi-repo relocation | 7/7 | ✅ Complete | 2026-05-31 |
| 2 | Design system — submodule + brand embodiment (logo, components, shell) | 4/4 | ✅ Complete | 2026-06-01 |
| 3 | SendGrid + Twilio + Sanity + Vercel deploy | 5/5 | ✅ Complete | 2026-06-01 |
| 4 | PAUL inheritance + tracking | 1/1 | ✅ Complete | 2026-06-01 |
| 5 | local_reach client output archive | 1/1 | ✅ Complete | 2026-06-02 |

### v0.2 — Customer MVP (✅ COMPLETE 2026-06-04 — all 3 phases; ready for /paul:complete-milestone)

| Phase | Name | Plans | Status | Completed |
|-------|------|-------|--------|-----------|
| 6 | RBAC + RLS spine | 5/5 | ✅ Complete | 2026-06-03 |
| 7 | Tier gating + shop switcher | 3/3 | ✅ Complete | 2026-06-03 |
| 8 | Launch hardening | 6/6 | ✅ Complete (08-01 carry-in; 08-02 RLS; 08-02b gitleaks+S4; 08-03 AEGIS; 08-04 coverage+brand; 08-04b E2E+WCAG AA+visual brand) | 2026-06-04 |

### Future milestones (defined in PLANNING.md, plans TBD at milestone kickoff)

| Milestone | Goal | Track |
|-----------|------|-------|
| v0.3 — Customer Analytics | ads-dashboard plans/concepts absorbed; unified Ads + GA4 + GSC marketing surface; story-led narrative; monthly PDF; presence; sentiment | Customer |
| v0.4 — Invoicing + Payments | Invoiced.com mirror + Stripe coexistence + payment links — **v1.0 customer launch** | Customer |
| v1.1 — Ops Foundation | Companies, Employees, Repair Customers, ROs, Estimates, Surveys, SysConfig, RO/Estimate Import (psg-import absorb), Security Profiles | Ops |
| v1.2 — Ads Mutation Studio | apps/ads/ + GTM mutations via web UI; dry-run → execute → audit on Vercel Sandbox | Ops |
| v1.3 — Production Module | Lob.com + in-house print queue dual adapter; FileMaker retired as daily driver | Ops |
| v1.3.5 — FM Historical Migration | Optional add-on if business requires historical continuity | Ops |
| v1.4 — Operational Reports | 26 named reports across 5 batches | Ops |
| v1.5 — Superadmin Matrix + Audit | Admin users/roles/shops UI; modules + security profiles + access matrix; audit log | Ops |
| v1.6 — Internal Agentic Intelligence | Multi-LLM router; NotebookLM grounding; Yext (Growth+); weather correlation; competitor engine; agentic PDF reports | Internal |
| v2.0 — Convergence + Hardening | E2E across customer + ops + internal; AEGIS final; PII review; perf pass; launch readiness | Convergence |

## Phase Details

### Phase 1: Workspace consolidation + multi-repo relocation

**Goal:** pnpm + Turborepo + root configs land at `apps/psg/`. BSM dashboard relocated to `apps/psg-hub/`. `apps/ads/` relocated to `apps/psg-ads-mutations/`. BSM siblings (`studio/`, `integrations/`, `onboarding/`, `preview/`, `shops/`) moved to `apps/psg/packages/`. local_reach + ads-dashboard archived. Kill list retired. Non-code (`psg/` Obsidian, `pipedrive/`) relocated outside repo.
**Depends on:** Nothing (first phase)
**Research:** Unlikely (paths + git moves)

**Scope:**
- pnpm + Turborepo root configs at `apps/psg/`
- BSM dashboard → `apps/psg/apps/psg-hub/` (this directory)
- ads-dashboard PAUL plans + concepts → absorbed reference (D70)
- ads-dashboard repo + Vercel archived
- `apps/ads/` → `apps/psg/apps/psg-ads-mutations/` (Python worker)
- psg-advantage-portal stays in place as v0.3 port source (relocated later)
- BSM siblings → `apps/psg/packages/*`
- local_reach → `apps/psg/archive/local_reach/`
- Kill list retired: `invoice/`, `portal/`, `sst-psgdigital/`, `web-dev-skills/`, `dashboard-psgdigital/`, `shop-theacrb/`, `invoice-psgdigital/`
- Non-code relocated outside repo: `psg/`, `pipedrive/`

**Plans (7-plan split, 2 waves):**

*Wave 1 (parallel-eligible, no deps):*
- [x] 01-01: Monorepo scaffold (workspace-root configs at `apps/psg/`) — LOOP CLOSED
- [x] 01-02: Kill list retirement + non-code relocation outside repo (D71) — LOOP CLOSED
- [x] 01-03: ads-dashboard PAUL plans + concepts absorbed (D70); repo + Vercel archived — LOOP CLOSED
- [x] 01-04: local_reach archive (D69) → `apps/psg/archive/local_reach/` — LOOP CLOSED

*Wave 2 (sequential after 01-01):*
- [x] 01-05: BSM dashboard → `apps/psg/apps/psg-hub/` (anchor; build green, IDOR secured) — LOOP CLOSED
- [x] 01-06: BSM siblings → `apps/psg/packages/*` — only `studio` was a real package (`@psg/studio`); 4 stubs deferred — LOOP CLOSED
- [x] 01-07: `apps/ads/` → `apps/psg/apps/psg-ads-mutations/` (Python worker; `.env` preserved, `.git` bundled) — LOOP CLOSED

### Phase 2: Design system submodule + brand token swap

**Goal:** PSG design system vendored as `packages/ui/psg-brand/` git submodule. BSM's oklch vars replaced with brand tokens. psg-advantage-portal's local DESIGN-SYSTEM.md retired. ads-dashboard's PSG-token-overridden shadcn reconciled with submodule.
**Depends on:** Phase 1 (monorepo in place)
**Research:** Unlikely (tokens already extracted by ads-dashboard `/brandkit` work; PSG design system stable)

**Scope:**
- `packages/ui/psg-brand/` git submodule from `github.com/Phoenix-Solutions-Group/design-system` (SINGLE source of brand truth, operator-confirmed)
- Tailwind 4 theme rebuilt from PSG tokens (`colors_and_type.css`): midnight navy `#1E3A52` + phoenix ember `#B8483E` + dark-ash + paper neutrals; Gotham + Didact Gothic fonts; restrained radius (6px)
- shadcn primitives PSG-themed (every shadcn var re-valued)
- Retire BSM oklch teal vars + psg-advantage-portal local DESIGN-SYSTEM.md

**Intent (expanded 2026-06-01):** Phase 2 is NOT just a token swap — psg-hub must visibly EMBODY the PSG design system: logo, brand-styled components (per `preview/components-*.html`), PSG layout vocabulary (eyebrow→headline, paper, single ember accent), and zero BSM/boilerplate identity. (Original "token swap" framing under-scoped vs operator intent; caught at 02-01 human-verify.)

**Plans (expanded split, 2 waves):**
- [x] 02-01: Vendor submodule + Gotham/Didact fonts + BSM teal → PSG tokens + delete orphan tokens.css — **DONE 2026-06-01** (foundation; build+typecheck green; committed `4792b1e`)
- [x] 02-02: Branded `/login` slice — `<Logo>` + DS-spec button/label + login/signup in PSG vocabulary + de-BSM + tab title — **DONE 2026-06-01** (operator-approved screenshot; committed `82d90c6`)
- [x] 02-03: App shell + routing fix + remaining primitives — navy sidebar + reverse logo + header; **fixed `/dashboard` 404 by renaming route group `(dashboard)`→ segment `dashboard`** (resolved `/`-collision); onboarding + ads in-copy de-BSM; card/badge/table DS spec — **DONE 2026-06-01** (approved; committed `8f041c6`)
- [x] 02-04: Doc retirement — portal `DESIGN-SYSTEM.md` superseded banner; ads-dashboard ABSORPTION-NOTES reconcile; README verified — **DONE 2026-06-01**

**Plan-time decisions:** source of truth = design-system repo (= local `psg-design-system-repo`, same commit `1689896`); `colors_and_type.css` canonical over SKILL.md (paper #FAFAFA, headings Bold 700, per operator); logos = DS reconstruction placeholder (operator-approved, swap official later); product name = "Phoenix Solutions Group"; raw-asset consumption (not npm-wrapped); submodule gitlink intentional; repo PRIVATE → Vercel deploy key at Phase 3.

### Phase 3: SendGrid + Twilio + Sanity + Vercel re-link

**Goal:** Transactional email (SendGrid) + SMS (Twilio) wired with PSG-branded sender on `psgweb.me`. New Sanity project provisioned with single production dataset (D55). Vercel project renamed `psg-advantage-portal` → `psg-hub`; BSM Vercel decommissioned (D54). Env vars + analytics history preserved.
**Depends on:** Phase 1 (psg-hub directory final)
**Research:** Likely (SPF/DKIM/DMARC + SendGrid + Twilio domain auth setup; Vercel project rename mechanics; Sanity provisioning)
**Research topics:** SendGrid sender authentication on `psgweb.me`; Twilio number + SMS messaging service config; Vercel project rename without breaking env vars; Sanity new project tier selection

**Scope:**
- SendGrid transactional email integration; verified domain `psgweb.me` (SPF/DKIM/DMARC + sender authentication)
- Twilio SMS integration; PSG number verified; messaging service setup
- `/api/webhooks/sendgrid` (bounce/spam/delivery events)
- `/api/webhooks/twilio` (SMS delivery + inbound)
- New Sanity project provisioned; single production dataset; studio code imported from BSM `packages/studio`
- Vercel project: re-link `psg-advantage-portal` → `apps/psg/apps/psg-hub/`, rename to `psg-hub`, preserve env vars + analytics
- BSM Vercel project decommissioned
- ads-dashboard Vercel kept for read-only access until v0.3 absorption complete

**Plans (5-plan subsystem split, 2 waves — re-split 4→5 2026-06-01):**

*Wave 1 (independent, no deps):*
- [x] 03-01: SendGrid — shared `src/lib/resilience.ts` (retry + circuit breaker) + mail adapter + idempotent signature-verified event webhook + `email_events` table; operator domain auth (SPF/DKIM on psgweb.me) + live-send checkpoint — **✅ LOOP CLOSED 2026-06-01** (163 tests green; live send 202 + inbox; webhook event-row deferred → 03-05)
- [x] 03-02: Twilio — SMS adapter (reuses resilience util) + idempotent dual-path webhook + `sms_events` table; operator number + secrets checkpoint — **✅ LOOP CLOSED 2026-06-01** (182 tests green; live send queued + phone receipt; 3 verified divergences from SendGrid mirror handled — error.status not .code, HMAC-over-parsed-params, composite UNIQUE(message_sid,status); webhook live sig-verify deferred → 03-05)
- [x] 03-03: Sanity — provision new project + single prod dataset (D55) under PSG org; decouple `@psg/studio` from BSM `436nqu7v` (env-driven config) + publish env contract — **✅ LOOP CLOSED 2026-06-01** (project `vcw0bsnu`, private prod dataset, schema deployed 4 types, studio bound; 182 tests green; AC-1/2/3 met)

*Wave 2 (after 03-01/02/03 — consumes their env):*
- [x] 03-04: Vercel deploy — **PIVOTED re-link→NEW project** (operator checkpoint:decision: `data` = broken non-customer portal, re-link would arm routeless-main clobber). Created `psg-hub` (`prj_CBrI1FRqqgPzCbAwin6LbSknY48U`), root `apps/psg-hub`, framework Next.js (vercel.json), 13 prod env keys via CLI, `hub.psgweb.me` + Cloudflare DNS → first prod deploy — **✅ LOOP CLOSED 2026-06-01** (all 3 ACs; psg-hub LIVE at https://hub.psgweb.me, branded + Let's Encrypt cert; webhook routes live; `data` untouched → retire in 03-05)
- [x] 03-05: Close deferred webhook loops + decommission — wired `SUPABASE_SERVICE_ROLE_KEY` to prod + redeploy → SendGrid Event Webhook + Twilio messaging webhook live-verified against `hub.psgweb.me` → real `email_events` row (closes 03-01) + `sms_events` row (closes 03-02) + D54 decommission confirmed by verified state (data project 404; no BSM/ads-dashboard project) — **✅ LOOP CLOSED 2026-06-01** (all 4 ACs; KEEP psg-hub↔data git connect; merge-blocker = grant Vercel GitHub-app access to private `design-system` submodule before main-merge)

### Phase 4: PAUL inheritance + tracking

**Goal:** BSM PAUL state preserved as foundation. ads-dashboard PAUL plans + concepts copied into psg-hub PAUL reference. ACTIVE.md and tracking updated to reflect psg-hub as current project.
**Depends on:** Phase 1 (BSM relocated)
**Research:** Unlikely

**Scope:**
- BSM `.paul/` state preserved (BSM Phases 1–5 history)
- `~/apps/ads-dashboard/.paul/{PROJECT.md, ROADMAP.md, SPECIAL-FLOWS.md, phases/01-foundation/*}` copied into psg-hub PAUL as v0.3 source-material reference (D70)
- ACTIVE.md updated
- Tracking system records psg-hub as in-progress

**Reframe (2026-06-01, at plan time):** The "preserve + copy PAUL" deliverables were front-loaded into Phase 1 — `references/bsm/` (Phases 1-5, real PLAN/SUMMARY/AUDIT) and `references/ads-dashboard/` (absorbed 01-03, brand-reconciled 02-04) already exist; BASE tracking already records psg-hub in_progress at this phase; and `ACTIVE.md` is a phantom (the current PAUL framework uses STATE.md, never ACTIVE.md). Operator chose to add a usability layer rather than close lean: Phase 4 turns the two archived snapshots into navigable design-intent canon and reconciles the loose ends.

**Plans (1, autonomous):**
- [x] 04-01: Inheritance INDEX + tracking reconcile — added `.paul/references/INDEX.md` mapping inherited BSM/ads-dashboard history → consuming milestones (v0.2..v2.0) with resolving paths + brand-reconcile caveat (psg-brand submodule wins); verified both trees populated (verify-by-building, 7 deep-readers); recorded ACTIVE.md superseded-by-STATE.md (no file created); verified BASE satellite at Phase 4 / in_progress. Did NOT re-copy PAUL. 3-lens adversarial verify (1 MEDIUM + 3 LOW fixed). — **✅ LOOP CLOSED 2026-06-01**

### Phase 5: local_reach client output archive

**Goal:** Active local_reach client outputs preserved for reference during BSM agent migration (D69).
**Depends on:** Phase 1 (archive directory exists)
**Research:** Unlikely

**Scope:**
- Copy `tracys-research-v3/`, `new-tracys-report-v2/`, other active client outputs from `~/apps/projects/local_reach/` to `apps/psg/archive/local_reach-outputs/`
- Hard retire local_reach codebase

**Reframe (2026-06-02, at plan time):** Like Phase 4, this scope was front-loaded into Phase 1 / 01-04 — `archive/local_reach-outputs/` already holds `tracys-research-v3` + `new-tracys-report-v2` + sidecar `tracys/` with a MANIFEST, and the codebase is archived + retired (source gone). `archive/` is gitignored, so the outputs are preserved on-disk only. Operator chose lean close (on-disk preservation matches the v0.3 BSM-migration reference intent; `archive/` also holds a 3.1GB db, so the tree stays gitignored).

**Plans (1, quick-fix):**
- [x] 05-01: Verify local_reach output preservation + retirement, then close — confirmed outputs faithful to MANIFEST (5/5/1 files), source `~/apps/projects/local_reach/` gone, codebase archived + gitignored. No new artifact, no force-add. — **✅ LOOP CLOSED 2026-06-02 (closes milestone v0.1)**

---

## v0.2 — Customer MVP (✅ COMPLETE 2026-06-04)

### Phase 6: RBAC + RLS spine

**Goal:** The 3-role psg model (`customer` / `psg_internal` / `psg_superadmin`) with default-deny RLS, enforced in middleware, plus a seeded first superadmin. Foundation — every other v0.2 feature gates on it.
**Depends on:** v0.1 (live psg-hub shell + shared Supabase + BSM Phase 4 auth/RLS base to extend)
**Research:** Likely (reconcile BSM `owner/manager/viewer` membership enum → the psg 3-role model; Supabase RLS + custom-access-token role/`shop_id` claims; migration-safety on the shared project)

**Scope:**
- 3-role model `customer` / `psg_internal` / `psg_superadmin` (reconcile/extend BSM Phase 4 role enum; honor `profile_id` convention on new tables)
- RLS clamps: customer tables by `shop_id IN authorized shops`; ops tables gated by `roles + security_profiles.functions_jsonb`; default-deny
- Middleware customer-id-required check (matches `apps/ads/` CLI rule)
- Superadmin bootstrap — seed Nick / Tina / Brian
- **S1 gate:** land on a documented migration-safety + RLS-review protocol (or staging/prod isolation) before customer tables hit the shared Supabase

**Status: ✅ COMPLETE 2026-06-03 (5/5 plans loop-closed).** Grounding overturned the ROADMAP premise: there was no BSM Phase-4 RLS base deployed here and no role enum — the spine was DEFINED, not extended. Shipped: S1 migration-safety + RLS-review protocol (06-01); RBAC tables `app_user_roles`(3-role CHECK)/`security_profiles`/`superadmin_emails` + `private.*` no-hook resolvers, all default-deny, superadmins Nick/Tina/Brian (06-02); server-side customer-id gate in the dashboard layout + `shop-access.ts` (06-03); reviews surface reconciled to live `review_items`/`review_responses` (06-04); membership model unified on `shop_users(user_id)` phase-wide + `llm_call_log` table + ads/agents/ingest guarded (06-05). All LIVE on shared prod; advisor diffs clean; 188 tests. Carry-forward → Phase 7: service-role onboarding bootstrap (first-owner INSERT is RLS-blocked under user-session) + onboarding shops-column reconcile. Carry-forward → Phase 8: mobile nav, dashboard-home `agent_runs` guard, the 26 anon-open RLS policies (deferred from 06-01).

**Plans (5, loop-closed):** 06-01 S1 protocol + migrations-as-code · 06-02 RBAC+RLS DB spine · 06-03 spine enforcement (gate) · 06-04 reviews reconcile · 06-05 spine close (membership repoint + llm_call_log + guards).

### Phase 7: Tier gating + shop switcher

**Goal:** Hard feature-gating across `essentials` / `growth` / `performance` (BSM enum, no migration) and an MSO multi-shop switcher over the multi-tenant RLS.
**Depends on:** Phase 6 (role model + RLS spine)
**Research:** Maybe (BSM `assertAdsTier` pattern → generalize to a tier-gate helper across customer features)

**Scope:**
- Tier feature-gates `essentials` / `growth` / `performance` (BSM stored tier; gating was thin — only Performance ads tier hard-gated)
- Shop switcher — MSO multi-shop context switch
- `profile_id` + idempotency conventions on any new tables (S4)
- **Phase-6 carry-in (prerequisite):** service-role onboarding bootstrap — the spine made `shop_users` first-owner INSERT impossible from the browser, so the system is un-onboardable without it; the switcher needs shops to exist.

**Plans (3-plan split, 2026-06-03):**
- [x] 07-01: Onboarding bootstrap — service-role `POST /api/onboarding` (client→shop(real cols)→first-owner `shop_users`→customer `app_user_roles`; compensating cleanup) + rewire wizard + gate routes no-shop users to self-serve onboarding. **✅ LOOP CLOSED 2026-06-03** (194 tests; operator onboarded Tracy's Body Shop live; 2 deviations: self-serve gate routing + clients-first ladder)
- [x] 07-02: Tier-gate helper — generalized `assertAdsTier` → shared ranked `src/lib/tier/gate.ts` (`TIER_RANK`/`tierMeets`/`getShopTier`/`shopHasTier`/`assertShopTier`); both ads consumers delegate behavior-preserving; `SHOP_ADS_TIER_OVERRIDE` reader centralized. **✅ LOOP CLOSED 2026-06-03** (211 tests; zero deviations; code-only ZERO prod write)
- [x] 07-03: Shop switcher — active-shop cookie context (`src/lib/shop/context.ts`, membership-revalidating resolver — cookie SELECTS among authorized shops, never authorizes) + membership-validated `POST /api/shop/switch` + `<ShopSwitcher>` in shell (0/1/2+) + settings/reviews/content scoped to active shop. **✅ LOOP CLOSED 2026-06-03** (221 tests; LIVE hub.psgweb.me dpl psg-o44ue3bia; 1 spec fix at human-verify = Reviews in-page filter scoped; ads `?shop_id=` alignment DEFERRED → Phase 8)

### Phase 8: Launch hardening

**Goal:** Make the surface safe for a real shop to log in with live PII, and stand up the quality gates that have been unstarted.
**Depends on:** Phases 6-7 (the surface to harden)
**Research:** Likely (PII RLS review methodology; AEGIS scope for a first customer-facing pass; Playwright setup on Next 16)

**Scope:**
- **M2:** PII + RLS + secret-handling security gate; PII RLS review before any shop sees live data; first AEGIS pass (pulled forward from v2.0)
- **S5:** quality gates — Vitest ≥70% on new code + Playwright happy-path (auth + one customer flow + the shop-switch flow); WCAG AA + brand-conformance on customer UI
- Idempotency mechanism + pre-merge checklist consolidated (S4)
- **Phase-7 carry-in:** ads shop-context alignment (point the ads page no-param default at `getActiveShopContext`, explicit `?shop_id=` member wins); mobile nav (sidebar `lg:flex`-only — switcher is desktop-shell only); `/dashboard` home `agent_runs` phantom guard.
- **Phase-7 carry-in — MSO portfolio / aggregate view:** ~~one-shop-at-a-time switcher; no rolled-up cross-shop surface~~ — **DEFERRED to v0.3 Customer Analytics** (operator 2026-06-03): it is a feature, not hardening, and the unified marketing surface lives in v0.3. Big-MSO switcher search/typeahead goes with it.

**Plan map (5 plans after the 08-02 split, 2026-06-03 /paul:plan):**
- [x] 08-01: Phase-7 carry-in surface fixes — ads shop-context alignment (route no-param default through `getActiveShopContext`; explicit `?shop_id=` member wins) + mobile nav (NAV + `<ShopSwitcher>` below `lg`) + dashboard-home `agent_runs` phantom card removal + real active-shop counts. Code-only, ZERO prod write. **✅ LOOP CLOSED + LIVE 2026-06-03 (dpl psg-qpczv9f0z); 229 tests; git↔Vercel wired as scope-add.**
- [x] 08-02: **Blanket-allow RLS remediation (RLS ONLY).** ✅ LOOP CLOSED 2026-06-04 — migration `20260603194623_close_blanket_allow_rls.sql` LIVE on prod: 24 blanket Allow-all (anon+auth) policies dropped on 12 multi-tenant tables; shops survivors retightened to authenticated; profiles self-row + psg_superadmin read (option A); clients + 9 siblings default-deny (deny-all-9). Advisor diff clean (rls_policy_always_true 26→2, 0 new ERROR/WARN); cross-tenant breach closed = M2 PII gate. All 5 ACs PASS, 0 deviations. **Grounded reframe of D3:** the deferred policies are blanket `Allow all` for BOTH `anon` AND `authenticated` on 12 core multi-tenant tables (profiles/shops/clients/reviews/campaigns/configs/activity_log/discovery_briefs/elements/pages/research_artifacts/skills) — the `authenticated` half is a cross-tenant breach (any logged-in user reads/writes every shop's rows) = the literal Phase-8 entry condition. Per-table verdict: `shops` drop blanket + retighten scoped survivors to authenticated; `clients` drop → default-deny (service-role only); `profiles` drop + self-row policy; the 9 sibling/agentic tables psg-hub never reads → Task-1 decision (default-deny vs defer per anon-consumer evidence). One idempotent migration under the 06-01 `PROTOCOL-migration-safety.md` + `CHECKLIST-rls-review.md` (migrations-as-code, re-captured advisor baseline+diff). autonomous=false (1 decision + 1 human-verify).
- [x] 08-02b: **gitleaks v0.2 milestone scan + S4 idempotency mechanism/checklist consolidation** (light, no DB migration). ✅ LOOP CLOSED 2026-06-04 — committed-history gate CLEAN (`gitleaks git` exit 0, 0 real secrets in VCS); 61 worktree findings dispositioned (13 vetted FP allowlisted in NEW repo-root `.gitleaksignore`, stale `psg-hub/.gitleaksignore` removed; 48 verified-gitignored real creds/build artifacts; 0 unresolved). `CHECKLIST-idempotency.md` authored (sig-verify → DB UNIQUE → upsert ignoreDuplicates; SendGrid/Twilio examples; pre-merge checklist; Stripe INSERT-not-UPSERT (S3) → v0.4 carry). All 3 ACs PASS; 229 tests, build ✓, no migration, ZERO src change. 1 deviation (ignore-file moved subdir→git root). Split out of 08-02 by operator 2026-06-03 — the RLS work is a high-blast-radius shared-prod migration; the scan + doc-consolidation are near-zero-risk and warrant single-concern isolation.
- [x] 08-03: First AEGIS pass — ✅ LOOP CLOSED 2026-06-04. `aegis:init` + targeted Core audit (customer surface, domains 02/03/04/05). Tools clean (Trivy/Grype 0, Gitleaks clean, Semgrep 1 advisory); 4 domain specialists + adversarial verification → **no launch-blocking finding** (08-01/02/02b hardening held; 2 top claims refuted: cross-tenant content write has a membership gate, webhook "crash" is handled). Remediated in-scope hygiene (client error-message sanitization, webhook log hygiene, GCM authTagLength, content `.eq(shop_id)`); DEFERRED Stripe/billing cluster → v0.4, PII-at-rest retention → v0.4, audit-log → v1.5. All 4 ACs PASS; 229 tests, build ✓, no migration. Committed `eda3772` → merged main `c663710` → pushed origin → deployed dpl_413Gq3 hub.psgweb.me. Report: `.aegis/report/AEGIS-REPORT.md`. Full 14-domain sweep stays at the v2.0 final AEGIS.
- [x] 08-04: Quality gates (S5) — **autonomous half.** ✅ LOOP CLOSED 2026-06-04 — Vitest v8 coverage gate in `vitest.config.ts` (13-module v0.2 new-code include set, `perFile` lines:70 → exit 0 at 88.85% aggregate, every file ≥70%; enforcement proven) + static brand-conformance audit (`BRAND-CONFORMANCE-v0.2.md`, customer surface CLEAN). +26 tests (229→255); `mobile-nav.tsx` documented-excluded (DOM-only → 08-04b). All 3 ACs PASS; ZERO prod write, no migration, no new runtime dep.
- [x] 08-04b: Quality gates (S5) — **live-surface half.** ✅ LOOP CLOSED 2026-06-04 — Playwright E2E vs a **local Supabase target** (zero PII): `db reset` replayed the in-repo schema + RBAC/RLS migrations cleanly (no dump fallback needed); programmatic `globalSetup` seeds 2 fixtures via the service-role ladder + `storageState` per role (real UI login). 3 happy paths pass (auth → /dashboard; settings scoped to active shop; the 07-03 shop-switch rescope). In-run `@axe-core/playwright` WCAG AA = **0 serious/critical** (one real `color-contrast` fail caught + FIXED: `--muted-foreground` #949494→#707070, light-mode only). Desktop+mobile screenshots → `BRAND-VISUAL-v0.2.md`, operator PASS at human-verify. Gates: typecheck clean · lint 0 err · coverage gate 88.85% (perFile≥70) intact · build ✓. Deviations: token-canon touch (AA, accepted), port 3100 (Obsidian squats 3000), explicit profiles seed (no local auth→profiles trigger). **LAST plan — UNIFY fired the Phase 8 + v0.2-milestone transition.**

This pass authored **08-02** + **08-04** + **08-04b** in full; all six Phase-8 plans closed. **Phase 8 ✅ COMPLETE 2026-06-04 — closes milestone v0.2 (all 3 phases). Next: /paul:complete-milestone.**

---

## v0.3 — Customer Analytics (🚧 In Progress — created 2026-06-04; re-planned 2026-06-04)

**Milestone goal:** Fill the empty analytics surface of the customer portal with a unified SEMrush + Google Ads + GA4 + GSC marketing view, output as the automated PSG monthly client report (multi-LLM narrative + branded PDF). The main thing a shop owner logs in to see.

**Data sources (4):** SEMrush (account-level MCP/API, no per-shop OAuth) · Google Ads (OAuth + sync code already built; tables un-provisioned) · GA4 (Analytics Data API, new per-shop OAuth) · GSC (Search Console API, new per-shop OAuth).

**Carried in from v0.2:** MSO cross-shop aggregate view · switcher search/typeahead · LCP <2s perf gate.

**Cut from v0.3 (→ v0.3.5 or later):** digital presence / listings (GBP) · post-repair sentiment. Keeps v0.3 = marketing analytics only.

### ⚠️ Re-plan rationale (2026-06-04 — grounding overturned the ROADMAP premise)

The original 3-phase plan assumed "BSM Phase 5 Google Ads data already exists, no OAuth — surface it first (fastest)." **Verified FALSE against prod `gylkkzmcmbdftxieyabw`:** the `google_ads_accounts` / `google_ads_campaigns` / `ads_api_call_log` tables **do not exist**, no source holds stored data, the ads page is a "coming soon" guard card, and no chart library is installed. The Google Ads OAuth + campaign-CRUD + GAQL-metrics code IS built but reads un-provisioned tables and pulls live per-shop (needs OAuth + a migration + a sync). Every source needs real ingest groundwork. Phases re-ordered by ascending OAuth/ingest friction; grew 3 → 4. (Same pattern as Phase 6.)

### Phase 9: Analytics foundation + SEMrush — ✅ COMPLETE 2026-06-05 (3/3 plans)

Focus: build the reusable analytics surface ONCE, proven with the lowest-friction source. Chart library (Tremor/Recharts canon — pick + brand-conform at plan time); analytics storage data model (per-shop, per-source, time-series snapshots — migration); dashboard shell with MSO cross-shop aggregate + switcher search/typeahead + LCP<2s perf gate; SEMrush ingest (account-level, **no per-shop OAuth, no Google creds**) surfaced as the organic-SEO panel. Lowest-friction real surface; buildable + locally testable without operator secrets (prod SEMrush key + any migration land at the gate batch).

**Shipped:**
- [x] 09-01: analytics data model (EXTEND pre-existing `analytics_snapshots`: source/period/synced_at + idempotency key, LOCAL-applied) + recharts@3.8.1 brand chart primitives — ✅ LOOP CLOSED 2026-06-04
- [x] 09-02: `/dashboard/analytics` shell (per-shop + MSO aggregate + empty/loading/error + Last synced, tier-ungated) + switcher typeahead ≥8 + LCP gate (/dashboard HARD<2000ms=80ms; analytics 4000ms ceiling=84ms) + real chart render + axe AA + aggregation proof (982=491+491) — ✅ LOOP CLOSED 2026-06-05
- [x] 09-03: SEMrush ingest — contract-correct client (fail-loud header guard, key redaction, retry+breaker) + daily idempotent sync + `analytics_sync_runs` ledger migration + CRON_SECRET-gated cron (daily 06:00 UTC) — ✅ LOOP CLOSED 2026-06-05

**⚠️ OPERATOR GATE BATCH (pending — the single Phase-9 pause; nothing outward-facing happens without it):** whole-phase diff review · prod migrations ×2 under PROTOCOL (20260604000000 incl. location_id amendment + 20260605000000 sync ledger; advisor baseline+diff each) · prod secrets ×2 (`SEMRUSH_API_KEY` + `CRON_SECRET`) · `.vercel` link resolution → deploy · **first-live-run verify = real numbers on /dashboard/analytics for the 4 url-bearing shops, NOT cron-200** · visual/brand verify · commit/push psg-hub.git.

### Phase 10: Google Ads

Focus: provision the missing `google_ads_*` tables (migration); wire the already-built OAuth-link + metrics-sync code; surface paid metrics (spend, clicks, conversions, CPL) into the Phase-9 shell. Needs operator: Google OAuth app credentials + a pilot-shop link.

**Grounding (2026-06-08, /paul:plan):** the Google Ads OAuth/client/campaigns lib + 7 API routes + the full `/dashboard/ads` UI are ALREADY BUILT, but read 4 tables absent from prod AND every migration AND the remote_schema dump: `google_ads_accounts`, `google_ads_campaigns`, `google_ads_oauth_states`, `ads_api_call_log`. **Encryption decision (operator):** refresh tokens use the built app-key AES-256-GCM (`encrypted_refresh_token bytea` + `key_version`), NOT pgsodium — recorded deviation from the PROJECT constraint; Phase 11 inherits the choice. **Scope boundary:** Phase 10 = read/link/ingest/display only; campaign MUTATION (createCampaign/updateCampaign) stays out (v1.2 Ads Mutation Studio; D52/D66 route Google Ads writes through Python on Vercel Sandbox).

**3-plan map (Phase-9 build-local → operator-gate pattern):**
- [ ] 10-01: provision the 4 tables + per-table RLS (membership SELECT on accounts/campaigns; default-deny on oauth_states/ads_api_call_log) LOCAL-applied + real-client schema proof of the blind-built code + flip `/dashboard/ads` to the real unlinked accounts/link surface. autonomous, ZERO prod. **PLAN created 2026-06-08, awaiting approval.**
- [x] 10-02: `google_ads` → `analytics_snapshots` daily ingest (`syncGoogleAdsSnapshots` mirroring SEMrush; account-level date-windowed GAQL, NOT the per-campaign LAST_30_DAYS path; only shops with a `status='linked'` account) + `GoogleAdsMetrics` type + `analytics_sync_runs` ledger + CRON_SECRET cron + paid panel on `/dashboard/analytics`. **✅ LOOP CLOSED 2026-06-08** (standard/autonomous; NO migration — source CHECKs already admit google_ads; ZERO prod contact). `FROM customer` + `segments.date BETWEEN 'd' AND 'd'` (refuted `=`), micros→spend, cpl-in-code, CircuitBreaker+withRetry; `mapGoogleAdsError`→GoogleAdsFailure branch (real-tested); date=**yesterday + 7d trailing re-sync** (deviation from date=today — RESEARCH #2); MSO aggregate excludes CPL; own unlinked panel state. Gates: tsc clean · vitest 350/350 (+28) · build ✓ · playwright 19/19. AC-5 first-live-run verification deferred to 10-03. 10-02-SUMMARY.md.
- [ ] 10-03 / operator gate batch: **PLAN created 2026-06-08, awaiting approval.** Authors `10-03-GATE-BATCH.md` — ONE ordered prod-activation runbook for the COMBINED Phase-9 + Phase-10 gate batch (one branch/one deploy ships both; nothing from either phase is activated yet). Stage 0 lead-time blockers (dev-token ≥ Explorer ~2 biz-day review · OAuth consent → In Production else 7-day adwords-token revoke) → Stage A Phase-9 SEMrush (2 migrations under PROTOCOL + `SEMRUSH_API_KEY`/`CRON_SECRET` + `vercel --prod` from repo root + first-live-run = real numbers on /dashboard/analytics for the 4 url-shops, NOT cron-200) → Stage B Phase-10 Google Ads (google_ads_tables migration + 6 Google secrets [`GOOGLE_OAUTH_CLIENT_ID/SECRET`, `GOOGLE_ADS_DEVELOPER_TOKEN`, `GOOGLE_ADS_OAUTH_REDIRECT_URI`, `ADS_STATE_SECRET`, `ADS_ENCRYPTION_KEY`; login_customer_id is per-account in DB] + pilot OAuth link + first-live-run = real paid metrics, single-row/non-zero/account-tz) → Stage C merge/push. Plan authors the runbook + a local commit; the operator executes (checkpoint:human-action). Loop closes on REAL NUMBERS for both sources; if Google lead-time blocks Ads, Phase 9 closes live + Google Ads = activation-pending (honest, not a defect).

### Phase 11: GA4 + GSC — ✅ COMPLETE + LIVE 2026-06-10 (4/4 plans)

Focus: new per-shop admin-driven Google OAuth for the Analytics Data API (GA4) + Search Console API (GSC) — distinct scopes; ingest + surface (traffic, sessions, key events; clicks, impressions, position). Refresh tokens encrypted at rest with the inherited AES-256-GCM app-key (ADS_ENCRYPTION_KEY), NOT pgsodium — recorded Phase-10 deviation Phase 11 inherits (RESEARCH reconciliation). Heaviest groundwork. **RESEARCH.md ✅ (ultracode wf_b732175b-025).** **✅ LIVE on prod 2026-06-10: Wallace Collision pilot links one Google account → real GA4 + GSC numbers on `/dashboard/analytics`.**

**3-plan map (foundation → per-source ingest, mirrors the Phase-9/10 build-local → operator-gate pattern):**
- [x] 11-01: shared Google OAuth foundation — one combined-scope consent (`analytics.readonly` + `webmasters.readonly`) → one refresh token → enumerate GA4 properties + GSC sites → pick one of each → two `google_oauth_accounts` rows share one encrypted token. 2 NEW tables (LOCAL), parameterized state machine, 3 link routes, link button. **✅ LOOP CLOSED 2026-06-09** (6/6 ACs; tsc/vitest 421/build/playwright 24; ZERO prod contact). 11-01-SUMMARY.md.
- [x] 11-02: GA4 daily ingest — linked `ga4` account → decrypt → `BetaAnalyticsDataClient` (gax authClient) → ONE trailing-window `runReport` per property (dimensions=[date], `keyEvents` as conversions, GA4_RESYNC_DAYS=3) → `Map<date,Ga4Metrics>` → one `analytics_snapshots` row/day (source='ga4') + ledger + CRON_SECRET cron (30 6) + additive "Website traffic" panel; shared `getLinkedAccount`/`markAccountError` (GSC 11-03 reuses). **✅ LOOP CLOSED 2026-06-09** (standard/autonomous; NO migration — CHECK admits ga4; NO new dep — 11-01 installed; ZERO prod contact). GA4 contract traps encoded (keyEvents-not-conversions · YYYYMMDD→ISO · string-coerce · header-indexed · sampling/quota logged); deterministic 1-row-per-shop (multi-property deferred, mirrors the ads snapshot-key decision); cron creds = OAuth id/secret+redirect (NO dev token) + runtime=nodejs. Gates: tsc 0 · vitest 444/444 (+23) · build ✓ · playwright 27/27. LIVE runReport + authClient smoke = Phase-11 gate batch (⭐ Wallace GA4 access now available). 11-02-SUMMARY.md.
- [x] 11-03: GSC ingest — `searchanalytics.query` (clicks/impressions/ctr/position; PT dates, GSC_RESYNC_DAYS=7 for the longer lag) → `Map<date,GscMetrics>` → `analytics_snapshots` source='gsc' + cron (45 6) + additive "Search performance" panel (aggregate drops BOTH ctr+position), reusing the 11-02 orchestrator/cron/account-read pattern. **✅ LOOP CLOSED 2026-06-09** (standard/autonomous; NO migration — CHECK admits gsc; NO new dep — 11-01 installed googleapis; ZERO prod contact). FRESH parser (NOT a ga4-metrics clone): GSC rows `{keys:[YYYY-MM-DD], …}` — no metricHeaders, keys[0] already ISO (no reformat), numeric values. googleapis `auth` (NOT gax authClient); type='web' + dataState='final'. REUSE getLinkedAccount/markAccountError + CLONE windowBounds/dedupeByShop (accounts.ts + ga4-sync untouched). Gates: tsc 0 · vitest 463/463 (+19) · build ✓ · playwright 30/30 (+3). 11-03-SUMMARY.md.
- [x] 11-04 / operator gate batch: **✅ EXECUTED LIVE 2026-06-10 — Phase 11 LIVE on REAL NUMBERS (full, not partial).** Stage A both 11-01 migrations applied to `gylkkzmcmbdftxieyabw` under PROTOCOL (clean advisor diffs: google_oauth_accounts RLS+1 SELECT +0/-0; google_oauth_pending_states +1 rls_enabled_no_policy INFO). Stage B `GOOGLE_ANALYTICS_OAUTH_REDIRECT_URI` set. Stage C cf4591f pushed + `vercel --prod` (ƒ ga4-sync + ƒ gsc-sync live). Stage D operator linked Wallace Collision via combined consent → 2 google_oauth_accounts rows (ga4 properties/313002669 + gsc sc-domain:wallacecollisionrepair.com, shared token); both crons ran (ga4:3 / gsc:6 / failed:0). **Real numbers on the live surface:** GA4 sessions 23 / users 18 / engagement 0.913 (Jun 9); GSC clicks 4 / impressions 372 / avg position 13.4 (Jun 8, ~2-day lag). RESEARCH live-checks PASS (#1 gax authClient, #4 RAW siteUrl returns rows, #3 GSC lag). Caught + fixed the latent gsc-metrics double-encode AND a semrush-only header/empty-state surface defect (df4266d — header now max synced_at across all sources). DEVIATION: CRON_SECRET rotated (sensitive/un-pullable). Deferred: OAuth re-link error root cause unconfirmed; connect-button UX wart; GA4 key_events=0 (real read). 11-04-SUMMARY.md. **Remaining: Stage E merge `feature/11-ga4-gsc` → main (operator-gated).**

### Phase 12: PSG report — narrative + PDF

Focus: multi-LLM auto-written analysis layer (with eval/quality gate); branded monthly PDF spec'd to match PSG's existing hand-built client report. Template canon = `/Users/schoolcraft_mbpro/dev/psg/clients/tracys` (the recurring monthly template is `tracys-ai-visibility-report.html` + `assets/design-system/`). Email + download. CORE v0.3 output. Depends on all four sources being live (they are).

**RESEARCH.md ✅** (ultracode `wf_8f01e69a-625`, 12 agents, committed `f917f2b`). Two adversarial findings drive the plan: (1) PDF on Vercel Fluid Compute REFUTED (libnss3.so launch break) -> render Chromium on a controlled host (Hetzner) over HTTP; (2) the canon's headline is built on Peec AI + Local Falcon, neither ingested -> Option A: ship the live-data base (SEMrush + GA4 + GSC + Ads in the canon design language) now, queue Peec AI + Local Falcon as a follow-on.

**4-plan shape (operator defaults locked 2026-06-10):**
- [x] 12-01 data pipeline + ReportData (monthly FLOW/STOCK/DERIVED rollup, MoM, graceful degradation; pure + fully testable, ZERO prod contact). **✅ LOOP CLOSED 2026-06-10** (analytics/rollup.ts + report/{types,report-data}.ts; 4/4 ACs; vitest 482/482 +19; no migration/dep; a487b33 on feature/12-psg-report). 12-01-SUMMARY.md.
- [x] 12-02 multi-LLM narrative (AI SDK v6 generateText + Output.object, single writer + deterministic numeric verifier) + eval gate (schema -> numeric groundedness -> brand lint -> judge; never auto-email an unverified report). **✅ LOOP CLOSED 2026-06-10** (adds ai v6 + zod; autonomous, 3 tasks; 5500507; live Gateway smoke deferred to 12-04). 12-02-SUMMARY.md.
- [x] 12-03 branded print route + Chromium render (Hetzner worker) + private Supabase storage + membership-gated download + link-email. **✅ LOOP CLOSED 2026-06-11** (COMPLEX, autonomous, 3 tasks; build-local + deps-injected, migration authored-not-applied, app adds NO dep — puppeteer only in the in-repo worker). render.ts (root-relative /fonts @font-face — next/font can't self-serve in a raw-string route handler, SPEC deviation) + token-gated /reports/[slug]/print + render-client.ts + storage.ts + workers/report-renderer/ + 20260610000000_monthly_reports.sql (authored) + download route + email.ts. Gates: tsc 0 · eslint 0 errors · vitest 523 (+30, incl. an added print-route 401 test). 12-03-SUMMARY.md. 12-04 gate batch: worker DEPLOY + bucket + migration apply + REPORT_RENDER_URL/RENDER_TOKEN/REPORT_EMAIL_TEMPLATE_ID + live smoke.
- [~] 12-04 monthly cron (`0 0 1 * *`, CRON_SECRET) + end-to-end orchestration + operator activation runbook (closes Phase 12 + milestone v0.3). **PLAN created 2026-06-11, awaiting approval** (autonomous=false, 3 tasks: pure deps-injected `report/monthly.ts` runMonthlyReports [generate→eval→store→render→store→record→email, idempotent, fault-contained] + CRON_SECRET cron route + vercel.json monthly entry + `12-04-GATE-BATCH.md` operator activation [apply 20260610000000 migration · private bucket+RLS · Hetzner worker deploy · REPORT_RENDER_URL/RENDER_TOKEN/REPORT_EMAIL_TEMPLATE_ID/AI_GATEWAY_API_KEY + SendGrid template · live smoke · merge→main]; build-local Tasks 1-2 ZERO prod, app adds NO dep; the 12-03 monthly_reports migration is applied here).
- [ ] 12-05 GA4-dimensional + real-performance expansion (ADDED 2026-06-11, operator decision after reviewing the live "Wallace Collision GA4 Monthly Analytics Report" Looker Studio deliverable). Adds, beyond the 12-01..12-04 date-totals base: GA4 secondary-dimension ingest + report sections — Top Traffic Drivers (by channel/source), Top Landing Pages (by landingPage), Device Breakdown (deviceCategory), New vs Returning (newVsReturning) — plus the two missing GA4 metrics bounce rate + avg session duration; AND real website-performance metrics from PROPER sources (Google CrUX / PageSpeed Insights + the GTMetrix API — operator has access), REPLACING the existing report's dubious GA4 "Performance Status" block (GA4 has no page-load/server-response metrics; "server response 14:49" is a mis-mapped duration — not ingested). **Requires RESEARCH first (hard gate — CrUX + PageSpeed + GTMetrix are new external APIs; GA4 dimensional ingest is a new data-model shape; prefer ultracode Workflow).** Activates on the SAME 12-04 infra (no new worker — incremental ingest + new secrets + redeploy). **CLOSES Phase 12 + milestone v0.3.**
  - **RESEARCH ✅ 2026-06-11** (ultracode wf, 10 agents → `12-05-RESEARCH.md`; 3 adversarial claims confirmed-with-nuance). Conclusion-shapers: **CrUX field data is absent** for low-traffic single-location collision shops (proven against the Wallace origin) → website-performance is **PSI-Lighthouse lab + GTMetrix**, CrUX = render-if-present enrichment; a **Google Cloud API key is a hard prereq for the entire perf section** (keyless PSI quota = 0). **GTMetrix is async** (POST→poll) with a **per-day credit cap** (Micro 10 / Growth 100 / Team 300 / Enterprise 500; 842-shop fleet exceeds Enterprise — flagged; Wallace pilot fits 5 trial credits). **GA4: one monthly `runReport` per dimension** (~4-5/shop/mo), never combined, never daily; **`bounce_rate = 1 − engagement_rate`** is derived (only `averageSessionDuration` needs a new fetch). **Architecture B** (operator-confirmed): monthly ingest into `analytics_snapshots` (`period='monthly'`, nested jsonb), new DB sources `ga4_dimensions`+`performance` via CHECK migration but **not** added to the `AnalyticsSource` union.
  - Split into a **3-plan arc** (operator-confirmed 2026-06-11):
    - [ ] **12-05a** GA4 dimensional ingest + 4 render sections (build-local, no new secret, reuses the in-place GA4 OAuth) — **PLAN created 2026-06-11, awaiting approval** (`12-05a-PLAN.md`; autonomous, 3 tasks / 4 ACs).
    - [x] **12-05b** Performance sources PSI/CrUX/GTMetrix — **✅ LOOP CLOSED 2026-06-12** (`12-05b-SUMMARY.md`; 4/4 ACs; tsc 0 / eslint 0 / vitest 573 / build green; ZERO prod contact; no new dep). psi.ts (one mobile runPagespeed → lab + CrUX field folded in, field=null successful-empty, breaker-untripped) + gtmetrix.ts (async POST→poll→/reports/{id}, max-poll ceiling + 429 + state=error) + perf-sync.ts (PSI configured-guard no-op, shops.url eligibility, ONE monthly 'performance' row/shop, optional-GTMetrix isolation so a GTMetrix failure keeps the PSI floor, gtmetrixShopLimit/Ids scope hook) + migration 20260612000000 (widens BOTH source CHECKs for 'performance', authored-not-applied) + ReportData.performance reader (rollup-bypassing) + "Website performance" render block replacing the bogus GA4 "server response 14:49". Advisor done-check caught + fixed the floor/enrichment defect. AnalyticsSource union UNTOUCHED. Carry-forward to 12-05c: live keyed PSI+GTMetrix parser smoke · GTMetrix wall-clock scoping + tier credits · both-migration auto-name verify · cron-order before 0 0 1 * *.
    - [ ] **12-05c** Cron wiring + combined operator gate batch — **PLAN created 2026-06-12, awaiting approval** (`12-05c-PLAN.md`; COMPLEX, autonomous=false, depends_on 12-05a+12-05b, 3 tasks / 4 ACs). T1 (build-local): `getMonthlySnapshot` + wire `readMonthlyDimensions`/`readMonthlyPerformance` into the PRINT route only (the GAP — both `assembleReportData` consumers dropped the optional readers, so 12-05a/b rows never reached the PDF; narrative cron binding stays untouched/eval-safe since `buildPlaceholders` reads only `linkedSources`). T2 (build-local): two CRON_SECRET cron routes (`ga4-dims-sync`, `perf-sync`) injecting `month=priorMonth(now)` + vercel.json 5→7 crons ordered BEFORE the report (`0 0 1`→`0 5 1`); GTMetrix pilot-scoped via `GTMETRIX_SHOP_IDS` (Fluid-ceiling safe). T3 (operator gate): apply the 12-05a/b migrations under PROTOCOL, set `PAGESPEED_API_KEY`(Stage-0 lead-time)+`GTMETRIX_API_KEY`, live-smoke the build-blind parsers vs Wallace → a real PDF with the new sections, merge `feature/12-psg-report`→main. Fallback = honest activation-pending (base report live since 12-04). **Closes Phase 12 + milestone v0.3.**
Follow-on milestone (post-v0.3): Peec AI (AI share-of-voice) + Local Falcon (local maps/SoLV) ingestion to complete the full canon report.

---
*Roadmap created: 2026-05-29 (populated from SEED ideation v7)*
*Last updated: 2026-06-04 — **milestone v0.3 RE-PLANNED** after grounding overturned the "Google Ads data exists" premise (no source has stored data; google_ads_* tables absent on prod). 4 phases by ascending ingest friction: 9 Analytics foundation + SEMrush · 10 Google Ads · 11 GA4 + GSC · 12 PSG report. Next: /paul:plan Phase 9.*
