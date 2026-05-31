# psg-hub

## What This Is

Unified PSG platform consolidating three product surfaces in one Next.js app, separated by RBAC + tier + security profiles + RLS: (1) customer-facing portal for collision repair shops in the PSG roster (~842 shops) — marketing analytics, AI agents, invoicing, payments, post-repair sentiment, market intel; (2) PSG internal operational backbone — Companies, Employees, Repair Customers, ROs, Estimates, Surveys, Production printing (PSG's core revenue mail program), 26 operational reports, master data, Security Profiles, RO/Estimate Import; (3) PSG-internal agentic market intelligence — competitor engine, Yext (Growth+ tier), weather correlation, multi-LLM router, NotebookLM grounding, agentic report synthesis + PDF.

## Core Value

Consolidates fragmented PSG tooling (BSM customer dashboard, ads-dashboard plans, psg-advantage-portal market intel, psg-import, apps/ads/ mutation tooling, FleetComplete 2019 spec, FileMaker Advantage daily driver) into one branded `hub.psgweb.me` surface that customers, internal staff, and superadmins all use — replacing logins and tooling sprawl with role-gated unified access.

## Current State

| Attribute | Value |
|-----------|-------|
| Type | Application |
| Version | 0.0.0 |
| Status | Initializing (post-SEED v7 graduation) |
| Last Updated | 2026-05-29 |

**Production URLs:**
- `hub.psgweb.me` — production (target, not deployed yet)
- Vercel: existing `psg-advantage-portal` project re-linked + renamed in v0.1

## Requirements

### Core Features

- Customer portal: marketing analytics (Google Ads + GA4 + Search Console unified), AI agents, invoicing + Stripe, post-repair sentiment, digital presence, market intel
- Internal ops backbone: Companies, Employees, Repair Customers, ROs, Estimates, Surveys, Production (Lob + in-house dual adapter), 26 reports, SysConfig master data, Security Profiles, RO/Estimate Import
- Ads Mutation Studio: surface `apps/ads/` Python + GTM mutations via web UI with dry-run preview → execute → audit on Vercel Sandbox
- Internal agentic intelligence: multi-LLM router, NotebookLM grounding, Yext, weather correlation, competitor engine, agentic PDF reports
- Superadmin matrix: role + tier + module + security profile management with audit log

### Validated (Shipped)
None yet (BSM Phases 1–5 relocate as foundation in v0.1).

### Active (In Progress)
None yet — initializing.

### Planned (Next)
- v0.1 Foundation (workspace consolidation, brand tokens, SendGrid + Twilio, Sanity new project, Vercel rename, BSM relocation, kill list retired)
- v0.2 Customer MVP (RBAC, tier gating, shop switcher, superadmin bootstrap, launch hardening)
- v0.3 Customer Analytics (ads-dashboard plans + concepts absorbed, unified marketing surface, monthly PDF)
- v0.4 Invoicing + Payments (Invoiced.com + Stripe coexistence)
- v1.1 Ops Foundation
- v1.2 Ads Mutation Studio
- v1.3 Production Module (Lob + in-house)
- v1.3.5 FM Historical Migration (optional add-on)
- v1.4 Operational Reports (26)
- v1.5 Superadmin Matrix + Audit
- v1.6 Internal Agentic Intelligence
- v2.0 Convergence + Hardening

### Out of Scope
- Pipedrive integration (deferred to v2.0+)
- Real-time updates for MVP (polling + cron + webhooks only)
- End-consumer (repair_customers) UI surface
- ads-dashboard scaffold code (BSM Next 16 supersedes; D70)
- local_reach PHP/React/Cloudflare Worker code (BSM agents replace; D69)
- FleetComplete 2019 Angular migration (never shipped; D51)

## Target Users

**Primary (customer):** owner-operators and marketing leads at collision repair shops in the PSG roster (~842 shops). MSOs supported via shop switcher. Paid subscription via existing BSM tier model (`essentials` / `growth` / `performance`).

**Secondary (PSG internal):** account managers, production team, billing ops, strategy. Replace FileMaker Advantage as their daily driver at v1.3 cutover.

**Tertiary (superadmin):** Nick, Tina, Brian. Manage user roles, shop assignments, tier, module access, security profiles, audit log.

**End consumers (the shop's customers):** receive PSG-printed mail (thank-you, warranty), fill paper or web surveys. Do NOT log in. Tracked as entities, no UI surface.

## Context

**Business Context:**
PSG today runs across fragmented tooling — customers live in separate logins for analytics, ads, invoices, payments, surveys, reputation, content/SEO. Internal staff run FileMaker Advantage for daily ops, production printing, and reports. Multiple half-built attempts exist (BSM dashboard, ads-dashboard, psg-advantage-portal, psg-import, local_reach). Pilot cohort: Wallace (6048611995), Tedesco (7763526490), Tracy's Collision Center.

**Technical Context:**
Anchor = BSM `dashboard/` (Next.js 16, BSM Phases 1–5 shipped). Shared Supabase project `gylkkzmcmbdftxieyabw` already used by ads-dashboard, local_reach, BSM, psg-advantage-portal — auth identities flow without migration. Single GitHub repo `Phoenix-Solutions-Group/data`. Single Vercel project (renamed from `psg-advantage-portal`). FleetComplete 2019 Angular tech design absorbed as v1.1+ spec (never shipped).

## Constraints

### Technical Constraints
- Next.js 16 + React 19.2 + TS strict only (BSM + ads-dashboard already on 16; upgrade ported psg-advantage-portal from 15 → 16 in v0.3)
- Vercel Fluid Compute on Node 24
- Vercel Sandbox for all Python workers (ads mutations + Paperclip agentic)
- Strict conform to PSG design system (no extensions)
- Resilience patterns mandatory: retry + circuit breaker on every external call, no bare catches
- BSM `profile_id` convention honored across all new tables
- Customer-id-required check enforced in middleware (matches `apps/ads/` CLI rule)
- Idempotency on every webhook + import
- RLS: customer tables clamped by `shop_id IN authorized shops`; ops tables gated by `roles + security_profiles.functions_jsonb`

### Business Constraints
- No fixed v1.0 launch date — quality-first (D60)
- Strictly sequential post-v1.0 delivery, single team (D62)
- BSM Stripe enum honored: `essentials` / `growth` / `performance` (no migration)
- Three roles only: `customer`, `psg_internal`, `psg_superadmin`
- NotebookLM IP curation gates v1.6 (D58 — Nick owns)
- PDF visual design pass owned by Nick at v1.3 + v1.6 (D63)
- Zero live BSM customers today; hard cutover OK in v0.1 (D57)

### Compliance Constraints
- PII (`psg_sensitive_pii_*`) patterns + pgsodium encryption at rest for OAuth refresh tokens
- gitleaks scan every milestone; no high CVEs
- PII RLS review required before v1.0 customer launch

## Key Decisions

70 decisions logged in `projects/psg-hub/PLANNING.md` (v7, SEED ideation). Highlights:

| Decision | Rationale | Date | Status |
|----------|-----------|------|--------|
| D3 — BSM dashboard is the anchor | Most shipped customer surfaces; Next 16; already multi-tenant | 2026-05-28 | Active |
| D29 — Advantage Program scope absorbed (Companies, ROs, Estimates, Surveys, Production, 26 Reports, SysConfig, Security Profiles) | 2019 FleetComplete tech design | 2026-05-28 | Active |
| D31 — Milestone-based delivery, customer + ops sequential | Single team, lowest risk | 2026-05-28 | Active |
| D50 — SendGrid + Twilio replace Resend | Existing PSG accounts; transactional email + SMS | 2026-05-29 | Active |
| D51 — FleetComplete Angular never shipped → v1.1+ greenfield from spec | Q1 resolved | 2026-05-29 | Active |
| D52 — Python worker runtime = Vercel Sandbox | Q3 + Q7 resolved; consistent infra | 2026-05-29 | Active |
| D53 — Production mail = Lob + in-house dual adapter | Q4 resolved | 2026-05-29 | Active |
| D54 — Retire BSM Vercel, rename psg-advantage-portal → psg-hub | Q5 resolved; preserve analytics history | 2026-05-29 | Active |
| D55 — Provision new Sanity project | Q6 resolved; no existing project | 2026-05-29 | Active |
| D57 — Zero live BSM customers, hard cutover OK | Q8 resolved | 2026-05-29 | Active |
| D60 — No fixed launch date, quality-first | Q11 resolved | 2026-05-29 | Active |
| D61 — Pilot cohort: Wallace + Tedesco + Tracy's | Q12 resolved | 2026-05-29 | Active |
| D62 — Strictly sequential post-v1.0 | Q13 resolved | 2026-05-29 | Active |
| D69 — local_reach archived immediately in v0.1 | Q22 resolved; BSM agents replace | 2026-05-29 | Active |
| D70 — ads-dashboard absorption reframed to plans + concepts (not code) | Q20 resolved; ads-dashboard scaffold only, BSM Next 16 supersedes | 2026-05-29 | Active |

## Success Metrics

| Metric | Target | Current | Status |
|--------|--------|---------|--------|
| Vitest coverage (new code) | ≥70% lines | - | Not started |
| Playwright E2E happy paths | auth + 1 customer + 1 ops | 0 | Not started |
| AEGIS audit per milestone | Pass | - | Not started |
| WCAG AA on customer routes | Pass | - | Not started |
| LCP on /dashboard | <2s | - | Not started |
| Brand conformance audit per UI milestone | Pass | - | Not started |
| v1.0 pilot cohort onboarded | Wallace + Tedesco + Tracy's | 0 of 3 | Not started |
| FileMaker Advantage retired as daily driver | v1.3 cutover | active | Not started |

## Tech Stack / Tools

| Layer | Technology | Notes |
|-------|------------|-------|
| Frontend | Next.js 16.2 App Router + React 19.2 + TS strict | BSM + ads-dashboard on 16; portal upgrades 15 → 16 in v0.3 |
| UI | Tailwind 4 + shadcn + base-ui + Tremor | PSG brand tokens replace BSM oklch vars |
| Styling | PSG design system (Gotham + Didact Gothic) | submodule at `packages/ui/psg-brand/`, strict conform |
| Auth | Supabase Auth (`@supabase/ssr`) | shared project `gylkkzmcmbdftxieyabw` |
| DB | Supabase Postgres | shared across hub + portal + BSM + ads-dashboard archive + local_reach archive |
| Direct DB | `pg` connection pool | heavy reads + reports |
| Cache | Redis (`ioredis`) | rate limit + sync caching |
| Billing | Stripe (PSG MOR, single account) | shipped in BSM |
| Email | SendGrid | transactional + auth + customer + receipts (D50) |
| SMS | Twilio | reminders + auth fallback (D50) |
| Mail (Production) | Lob.com + in-house print queue dual adapter | v1.3 (D53) |
| Content | Sanity (new project) | provisioned v0.1 (D55) |
| Internal warehouse | BigQuery + Supabase mirror | cache-first DAL |
| Agent orchestration | Paperclip AI | runs on Vercel Sandbox (D56) |
| Agent runtime | Claude Flow | shipped in BSM |
| Web scrape | Firecrawl MCP | shipped in BSM |
| Google Ads (read) | `google-ads-api ^23.0.0` | per-shop OAuth, admin-driven (D68) |
| Google Ads (write) | Python `apps/ads/googleads_psg/` via Vercel Sandbox | v1.2 (D52) |
| GTM mutations | Python `apps/ads/gtm_psg/` via Vercel Sandbox | full catalog in v1.2 (D66) |
| GA4 | Google Analytics Data API | per-shop OAuth admin-driven (D68), v0.3 |
| Search Console | Google Search Console API | per-shop OAuth admin-driven (D68), v0.3 |
| SEO data | SEMrush | shipped in BSM |
| Multi-LLM | Anthropic + OpenAI + Gemini + Perplexity | v1.6 |
| Grounding | NotebookLM (`teng-lin/notebooklm-py`) with Claude fallback | v1.6, IP curated by Nick (D58) |
| Test (unit) | Vitest 4 + jsdom + Testing Library | shipped patterns |
| Test (E2E) | Playwright | new v0.2 (customer) + v1.1 (ops) |
| Monorepo | pnpm workspaces + Turborepo | v0.1 root |
| Deploy | Vercel (renamed `psg-advantage-portal` → `psg-hub`) | env vars + analytics history preserved (D54) |
| Python runtime | Vercel Sandbox | ads mutations + Paperclip (D52, D56) |
| PDF | Playwright + print.css | mail-merge (v1.3) + agentic reports (v1.6), designed by Nick (D63) |

## Links

| Resource | URL |
|----------|-----|
| Repository | github.com/Phoenix-Solutions-Group/data |
| Production | hub.psgweb.me (target) |
| Brand source | github.com/Phoenix-Solutions-Group/design-system |
| SEED ideation | `../../projects/psg-hub/PLANNING.md` (v7, 70 decisions) |
| Workspace map | `../../.paul/codebase/` (STACK, ARCHITECTURE, STRUCTURE, CONVENTIONS, TESTING, INTEGRATIONS, CONCERNS) |
| Anchor (BSM) | `~/apps/projects/bsm/` |
| ads-dashboard PAUL (absorbed plans) | `~/apps/ads-dashboard/.paul/` |
| `apps/ads/` (surfaced v1.2) | `~/apps/ads/` |
| Master Project Plan (v1.6 source) | `apps/psg/psg-advantage-portal/Master Project Plan_ PSG Agentic Market Intelligence Platform.md` |
| FleetComplete 2019 spec (v1.1+ source) | `~/Library/CloudStorage/.../PSG Project Technical Design v1.0_Final.txt` |

---
*PROJECT.md — Populated from SEED ideation v7 (projects/psg-hub/PLANNING.md, 70 decisions)*
*Last updated: 2026-05-29*
