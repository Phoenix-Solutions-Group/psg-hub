# Roadmap: Ads Dashboard

## Overview

Build a client-facing Google Ads reporting dashboard in five phases — foundation and brand tokens first, then data pipeline, then multi-tenant RLS, then the narrative/story layer, then reports and final polish. Each phase ships something independently testable. Anti-AI-slop is a binding constraint: `/impeccable critique` gates every frontend phase merge.

## Current Milestone

**v0.1 Initial Release** (v0.1.0)
Status: In progress
Phases: 0 of 5 complete

## Phases

**Phase Numbering:**
- Integer phases (1, 2, 3): Planned milestone work
- Decimal phases (2.1, 2.2): Urgent insertions (marked with [INSERTED])

| Phase | Name | Plans | Status | Completed |
|-------|------|-------|--------|-----------|
| 1 | Foundation | 4 | Planning | - |
| 2 | Data Pipeline | TBD | Not started | - |
| 3 | Multi-Client + RLS | TBD | Not started | - |
| 4 | Story Layer | TBD | Not started | - |
| 5 | Reports + Polish | TBD | Not started | - |

## Phase Details

### Phase 1: Foundation

**Goal:** Next.js 15 app scaffolded and deployed to Vercel; Supabase wired; magic-link auth working end-to-end; PSG design tokens extracted via `/brandkit`; Tailwind theme built from tokens; one hardcoded client page renders dummy data with PSG visual identity.
**Depends on:** Nothing (first phase)
**Research:** Likely
**Research topics:** PSG token extraction depth from design system zip; Tremor token override surface area; shadcn/ui CSS-var theming patterns under Tailwind v4 vs v3

**Scope:**
- Next.js 15 App Router scaffold with TypeScript
- Vercel deploy from `main` with PR previews
- Supabase client wired (`@supabase/ssr`) using project `gylkkzmcmbdftxieyabw`
- `/brandkit` extraction of PSG tokens → `tokens/psg.json`
- Tailwind theme + `globals.css` rebuilt from tokens
- shadcn/ui primitives installed and PSG-themed
- Magic-link auth flow at `/login` working end-to-end
- One dummy `/c/wallace` page rendering placeholder KPIs with PSG identity
- `/impeccable shape` brief locked before any frontend code
- `/impeccable critique` gate cleared before merge

**Plans:**
- [ ] 01-01: Scaffold Next.js 15 + Vercel link + CI workflow
- [ ] 01-02: `/brandkit` token extraction + Tailwind theme rebuild + shadcn token-override
- [ ] 01-03: Supabase client wired + magic-link auth + role/client_id JWT claims hook
- [ ] 01-04: Demo `/c/wallace` page with dummy data + `/impeccable critique` exit gate

### Phase 2: Data Pipeline

**Goal:** Real Wallace data flowing end-to-end — Python sync writes to Supabase, GitHub Actions runs every 6h, `/c/wallace` renders live KPIs from cache.
**Depends on:** Phase 1 (auth + scaffold)
**Research:** Likely
**Research topics:** Supabase service-role write patterns from Python; GitHub Actions secrets layout for Google Ads creds; cache invalidation pattern for Next.js after sync

**Scope:**
- Supabase migrations: `client`, `user_profile`, `snapshot`, `campaign_metric`, `note` tables
- Default-deny RLS policies on every table
- Python sync script reading Wallace via `googleads_psg/` and writing to Supabase
- GitHub Actions workflow: cron `0 */6 * * *`, secrets configured
- `/api/sync` webhook with bearer-token auth for cache invalidation
- `/c/wallace` server component reading from Supabase, rendering real KPIs + last-synced timestamp

**Plans:** TBD

### Phase 3: Multi-Client + RLS

**Goal:** Tedesco and Flower Hill onboarded; user provisioning flow live; RLS audited end-to-end; PSG admin home `/` lists all clients.
**Depends on:** Phase 2 (data pipeline)
**Research:** Unlikely (RLS patterns established in Phase 2)

**Scope:**
- Onboarding Tedesco + Flower Hill into `client` table and sync
- User provisioning flow: PSG admin invites client → magic-link with role + client_id JWT claims
- AEGIS RLS audit against cross-tenant access
- PSG admin home `/` with all-client grid (logos, headline metric, status traffic-light)

**Plans:** TBD

### Phase 4: Story Layer

**Goal:** Dashboard reads like a story, not a report. Plain-language KPI sentences, timeline view, admin compose-note UI, trend coloring tied to per-client goals.
**Depends on:** Phase 3 (multi-tenant data live)
**Research:** Likely
**Research topics:** Plain-language KPI sentence templates per metric type; per-client goal table schema; trend coloring thresholds

**Scope:**
- KPI cards with sentence + delta + sparkline
- `note` compose UI for PSG admins; timeline render for clients
- `goal` table + admin UI for setting per-client targets (CPL, CTR, etc.)
- Trend coloring logic tied to goal thresholds
- `/impeccable craft` cycle per narrative component
- `/impeccable critique` pass before merge

**Plans:** TBD

### Phase 5: Reports + Polish

**Goal:** Production-ready, brand-faithful, client-shareable. Monthly print view, PDF export, mobile pass, final critique, final AEGIS audit.
**Depends on:** Phase 4 (story layer complete)
**Research:** Likely
**Research topics:** PDF generation runtime on Vercel — Puppeteer vs `@react-pdf/renderer`

**Scope:**
- `/c/[slug]/report/[month]` print-styled monthly summary
- `/api/clients/[id]/export/[month]` PDF generation endpoint
- Mobile responsive pass below 768px
- Final `/impeccable critique` across all views
- AEGIS full security + RLS audit
- Lighthouse ≥90 across all categories

**Plans:** TBD

---
*Roadmap created: 2026-05-20*
*Last updated: 2026-05-20*
