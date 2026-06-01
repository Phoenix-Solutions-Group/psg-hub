# Roadmap: psg-hub

## Overview

Ten milestones across two tracks. Customer track ships v1.0 first (v0.1 → v0.4). Internal ops + agentic tracks ship post-v1.0 strictly sequential, single team (D62). No fixed launch date — quality-first, ship when ready (D60). BSM PAUL preserved as foundation; psg-hub starts at v0.1. FleetComplete 2019 spec drives v1.1+ scope (never shipped — greenfield, D51).

## Current Milestone

**v0.1 Foundation** (v0.1.0)
Status: In progress
Phases: 1 of 5 complete (Phase 1 ✅ workspace consolidated; Phase 2 next)

## Phases

**Phase Numbering:**
- Integer phases (1, 2, 3): Planned milestone work
- Decimal phases (2.1, 2.2): Urgent insertions (marked with [INSERTED])

### v0.1 — Foundation

| Phase | Name | Plans | Status | Completed |
|-------|------|-------|--------|-----------|
| 1 | Workspace consolidation + multi-repo relocation | 7/7 | ✅ Complete | 2026-05-31 |
| 2 | Design system submodule + brand token swap | 1/2 planned | 🟡 Planning | - |
| 3 | SendGrid + Twilio + Sanity + Vercel re-link | TBD | Not started | - |
| 4 | PAUL inheritance + tracking | TBD | Not started | - |
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
- [ ] 02-02: Branded `/login` slice — `<Logo>` (DS reconstruction) + restyle shared button/input/label to DS spec + rebuild login/signup in PSG vocabulary + de-BSM (incl. root tab title) — PLAN ✓ (non-autonomous: human-verify, visible-proof slice)
- [ ] 02-03: App shell + remaining primitives — `(dashboard)/layout.tsx` navy sidebar w/ reverse logo + header; onboarding heading; card/badge/table to DS spec; rest of de-BSM (ads modals + callback in-copy "BSM") — TBD (after 02-02 loop confirms direction)
- [ ] 02-04: Doc retirement — portal `DESIGN-SYSTEM.md` superseded pointer; ads-dashboard reference reconcile; README brand-source line — TBD

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

**Plans:** TBD

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
*Last updated: 2026-05-31 — Phase 1 ✅ complete (7/7 plans)*
