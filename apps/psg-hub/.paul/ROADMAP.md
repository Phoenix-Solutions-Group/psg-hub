# Roadmap: psg-hub

## Overview

Ten milestones across two tracks. Customer track ships v1.0 first (v0.1 → v0.4). Internal ops + agentic tracks ship post-v1.0 strictly sequential, single team (D62). No fixed launch date — quality-first, ship when ready (D60). BSM PAUL preserved as foundation; psg-hub starts at v0.1. FleetComplete 2019 spec drives v1.1+ scope (never shipped — greenfield, D51).

## Current Milestone

**v0.1 Foundation** (v0.1.0)
Status: In progress
Phases: 3 of 5 complete (Phase 1 ✅ workspace; Phase 2 ✅ design system embodied; **Phase 3 ✅ COMPLETE 2026-06-01** — SendGrid + Twilio + Sanity + Vercel, 5/5 plans loop-closed; webhooks live-verified end-to-end; psg-hub LIVE at https://hub.psgweb.me; D54 decommission confirmed. Phase 4 (PAUL inheritance + tracking) next. **Gated before Phase-3→main merge: grant Vercel GitHub-app access to private `design-system` submodule.**)

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
| 4 | PAUL inheritance + tracking | TBD | Not started (next) | - |
| 5 | local_reach client output archive | TBD | Not started | - |

### Future milestones (defined in PLANNING.md, plans TBD at milestone kickoff)

| Milestone | Goal | Track |
|-----------|------|-------|
| v0.2 — Customer MVP | RBAC + tier gating + shop switcher + superadmin bootstrap + customer launch hardening | Customer |
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

**Plans:** TBD

### Phase 5: local_reach client output archive

**Goal:** Active local_reach client outputs preserved for reference during BSM agent migration (D69).
**Depends on:** Phase 1 (archive directory exists)
**Research:** Unlikely

**Scope:**
- Copy `tracys-research-v3/`, `new-tracys-report-v2/`, other active client outputs from `~/apps/projects/local_reach/` to `apps/psg/archive/local_reach-outputs/`
- Hard retire local_reach codebase

**Plans:** TBD

---
*Roadmap created: 2026-05-29 (populated from SEED ideation v7)*
*Last updated: 2026-06-01 — Phase 3 ✅ COMPLETE (5/5 plans loop-closed): SendGrid + Twilio webhooks live-verified, Sanity `vcw0bsnu`, psg-hub LIVE at hub.psgweb.me, D54 decommission confirmed. Transitioned to Phase 4. Gated: grant Vercel GitHub-app access to private `design-system` submodule before Phase-3→main merge.*
