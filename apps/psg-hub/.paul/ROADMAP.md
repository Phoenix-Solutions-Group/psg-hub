# Roadmap: psg-hub

## Overview

Ten milestones across two tracks. Customer track ships v1.0 first (v0.1 → v0.4). Internal ops + agentic tracks ship post-v1.0 strictly sequential, single team (D62). No fixed launch date — quality-first, ship when ready (D60). BSM PAUL preserved as foundation; psg-hub starts at v0.1. FleetComplete 2019 spec drives v1.1+ scope (never shipped — greenfield, D51).

## Current Milestone

**v0.2 Customer MVP** (v0.2.0) — 🚧 In Progress
Started: 2026-06-02 · Phases: 0 of 3 complete
Focus: turn the live psg-hub shell into a secure, role-gated, multi-tenant customer surface a real shop can safely log into.
Build-first (operator 2026-06-02): EOY-2026 MRR = directional horizon, not a hard gate (quality-first D60). v0.1 Foundation ✅ COMPLETE 2026-06-02 (see Completed Milestones).

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

**v0.3 Customer Analytics** — unified Google Ads + GA4 + GSC marketing surface, story-led narrative, monthly PDF (built from the absorbed ads-dashboard canon + BSM Phase 5 Google Ads data).


## Completed Milestones

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

### v0.2 — Customer MVP (🚧 current)

| Phase | Name | Plans | Status | Completed |
|-------|------|-------|--------|-----------|
| 6 | RBAC + RLS spine | TBD | Not started | - |
| 7 | Tier gating + shop switcher | TBD | Not started | - |
| 8 | Launch hardening | TBD | Not started | - |

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

## v0.2 — Customer MVP (🚧 current)

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

**Plans:** TBD (defined during /paul:plan)

### Phase 7: Tier gating + shop switcher

**Goal:** Hard feature-gating across `essentials` / `growth` / `performance` (BSM enum, no migration) and an MSO multi-shop switcher over the multi-tenant RLS.
**Depends on:** Phase 6 (role model + RLS spine)
**Research:** Maybe (BSM `assertAdsTier` pattern → generalize to a tier-gate helper across customer features)

**Scope:**
- Tier feature-gates `essentials` / `growth` / `performance` (BSM stored tier; gating was thin — only Performance ads tier hard-gated)
- Shop switcher — MSO multi-shop context switch
- `profile_id` + idempotency conventions on any new tables (S4)

**Plans:** TBD (defined during /paul:plan)

### Phase 8: Launch hardening

**Goal:** Make the surface safe for a real shop to log in with live PII, and stand up the quality gates that have been unstarted.
**Depends on:** Phases 6-7 (the surface to harden)
**Research:** Likely (PII RLS review methodology; AEGIS scope for a first customer-facing pass; Playwright setup on Next 16)

**Scope:**
- **M2:** PII + RLS + secret-handling security gate; PII RLS review before any shop sees live data; first AEGIS pass (pulled forward from v2.0)
- **S5:** quality gates — Vitest ≥70% on new code + Playwright happy-path (auth + one customer flow); WCAG AA + brand-conformance on customer UI
- Idempotency mechanism + pre-merge checklist consolidated (S4)

**Plans:** TBD (defined during /paul:plan)

---
*Roadmap created: 2026-05-29 (populated from SEED ideation v7)*
*Last updated: 2026-06-02 — **Milestone v0.2 Customer MVP CREATED** (3 phases: 6 RBAC+RLS spine · 7 tier+switcher · 8 hardening). v0.1 Foundation ✅ COMPLETE (under Completed Milestones). Build-first; audit gates folded into phases. Next: /paul:plan Phase 6.*
