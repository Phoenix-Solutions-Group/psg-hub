# Ads Dashboard

## What This Is

Client-facing Google Ads reporting dashboard for PSG-managed accounts under the MCC. A Next.js 15 web app that pulls daily metrics from Google Ads via the existing `apps/ads/googleads_psg` Python wrapper into Supabase, then surfaces each client account as a branded, narrative-led report. PSG admins see all clients; client users see only their own data via RLS.

## Core Value

Clients understand how PSG is helping them with their ads — in plain English, branded, story-led — instead of decoding native Google Ads reports.

## Current State

| Attribute | Value |
|-----------|-------|
| Type | Application |
| Version | 0.0.0 |
| Status | Initializing |
| Last Updated | 2026-05-20 |

## Requirements

### Core Features

- Branded, per-client dashboard at `/c/[slug]` with plain-English KPI cards
- PSG admin home `/` showing all-client grid with headline metrics and status
- Campaign drill-down table per client with trend cells
- "What PSG did" timeline (notes authored by PSG admins, read by clients)
- Monthly print-styled report with PDF export
- Magic-link auth via Supabase with role-aware visibility (RLS-enforced)

### Validated (Shipped)
None yet.

### Active (In Progress)
None yet.

### Planned (Next)
- Phase 1 — Foundation (Next.js scaffold, Vercel deploy, Supabase wired, magic-link auth, PSG token extraction, one dummy-data client page)
- Phase 2 — Data Pipeline (schema + RLS, Python sync to Supabase, GitHub Actions cron, real KPIs render for Wallace)
- Phase 3 — Multi-Client + RLS (Tedesco + Flower Hill onboarded, user provisioning, RLS audit)
- Phase 4 — Story Layer (plain-language KPI sentences, timeline view, admin compose-note UI)
- Phase 5 — Reports + Polish (monthly print view, PDF export, mobile pass, final critique + AEGIS audit)

### Out of Scope
- Campaign mutations from dashboard — mutations remain in `apps/ads/` write-side tooling
- Real-time data — refresh cadence is 6h sync, not live
- End-customer-level PII or lead data — aggregate metrics only
- Password-based auth — magic-link only

## Target Users

**Primary — PSG team (admin):** Operators managing 3+ Google Ads accounts under the MCC. Need consolidated cross-client view, ability to log "what we did" notes, fast visual triage of which client needs attention.

**Secondary — Client (read-only):** Auto body shop owners and operators. Non-technical. Need to understand whether PSG's work is moving the needle and have something credible to forward to leadership.

## Context

**Business Context:**
PSG manages Google Ads for multiple auto-body clients (Wallace Collision Center, Tedesco Auto Body, Flower Hill Auto Body, growing list) under a single MCC. Client retention depends on demonstrating value — current process is screenshots, spreadsheets, and verbal narrative on calls. This dashboard is the reporting layer that closes the trust loop.

**Technical Context:**
Sibling repo `apps/ads/` already contains `googleads_psg/` — authenticated, MCC-aware Python wrapper with audit logging. Reuse it as the sync producer. Supabase project `gylkkzmcmbdftxieyabw` is the existing PSG Supabase instance.

## Constraints

### Technical Constraints
- Python 3.11 required for Google Ads SDK (not 3.14 — wheel mismatch in sibling repo)
- Google Ads API rate limits — sync via cache, no per-pageview API calls
- Vercel serverless runtime limits — PDF generation runtime choice still open (Puppeteer vs `@react-pdf/renderer`)
- Supabase project already in use — schema additions must be additive and namespaced
- Multi-tenant data model requires RLS on every queryable table; default-deny

### Business Constraints
- Brand-driven UI — must match PSG brand guidelines and design system; no off-the-shelf shadcn defaults visible
- Anti-AI-slop binding constraint — every frontend phase passes `/impeccable critique` before merge
- Client-facing polish bar — dashboards forwarded to client leadership

### Compliance Constraints
- Low PII surface — aggregated ad metrics + business names; no end-customer data, no HIPAA/PCI scope
- Google Ads API terms compliance — read-only via approved OAuth app

## Key Decisions

| Decision | Rationale | Date | Status |
|----------|-----------|------|--------|
| Application type, web app | UI + multi-tenant data + deployment lifecycle | 2026-05-20 | Active |
| Next.js 15 + Tailwind + shadcn/ui + Tremor + Supabase + Vercel | Fastest path to polish, matches existing tooling | 2026-05-20 | Active |
| Python `googleads_psg/` as sync producer; Supabase as cache; Next.js consumes cache | Avoids Google Ads rate limits, reuses authenticated wrapper | 2026-05-20 | Active |
| Supabase magic-link auth in project `gylkkzmcmbdftxieyabw` | No password reset burden; existing Supabase | 2026-05-20 | Active |
| GitHub Actions cron every 6h as sync runtime | Free, in-repo secrets, simple | 2026-05-20 | Active |
| Brand tokens extracted via `/brandkit` before any UI code | Anti-slop pillar — Tailwind theme rebuilt from PSG palette/type | 2026-05-20 | Active |
| `/impeccable critique` gate before every frontend phase merge | Anti-AI-slop binding constraint | 2026-05-20 | Active |
| Read-only dashboard; mutations stay in `apps/ads/` | Scope discipline | 2026-05-20 | Active |

## Success Metrics

| Metric | Target | Current | Status |
|--------|--------|---------|--------|
| `/impeccable critique` score per frontend phase | passing | - | Not started |
| RLS cross-tenant leak audit (AEGIS) | zero leaks | - | Not started |
| Lighthouse (final) | ≥90 across categories | - | Not started |
| Accessibility | WCAG AA | - | Not started |
| AEGIS final audit criticals | zero | - | Not started |
| Brand-token compliance | zero raw hex outside tokens | - | Not started |
| Client comprehension (qualitative) | Client can explain their numbers without PSG present | - | Not started |

## Tech Stack / Tools

| Layer | Technology | Notes |
|-------|------------|-------|
| Frontend | Next.js 15 (App Router) + TypeScript | RSC + Route Handlers, Vercel-native |
| Styling | Tailwind + shadcn/ui (PSG token-overridden) | Tokens from `/brandkit` extraction |
| Charts | Tremor + Recharts | Tremor primary; Recharts fallback for custom |
| Database | Supabase Postgres | Existing project `gylkkzmcmbdftxieyabw` |
| Auth | Supabase Auth — magic link | Custom JWT claims: `role`, `client_id` |
| Sync producer | Python 3.11 + `googleads_psg/` wrapper | Reused from sibling `apps/ads/` |
| Sync runtime | GitHub Actions scheduled workflow | Cron `0 */6 * * *` |
| Hosting | Vercel | Auto-deploy from `main`, PR previews |
| Caching | Supabase Postgres snapshot tables | No Redis — single-tenant, low QPS |

## Links

| Resource | URL |
|----------|-----|
| Source planning | `projects/ads-dashboard/PLANNING.md` |
| Project brief | `apps/ads-dashboard/README.md` |
| PSG brand guidelines | https://phoenixsolutionsgroup.net/psg-brand-guidelines/ |
| PSG design system zip | `Library/CloudStorage/GoogleDrive-nick@phoenixsolutionsgroup.net/Shared drives/02. Marketing/Brand Assets/Phoenix Solutions Group Design System.zip` |
| Supabase project | `gylkkzmcmbdftxieyabw` |
| Sibling repo | `apps/ads/` |

---
*PROJECT.md — Updated when requirements or context change*
*Last updated: 2026-05-20*
