# Ads Dashboard

> Client-facing Google Ads reporting dashboard for PSG-managed accounts under the MCC. Translates account performance into plain-English narrative so clients understand how PSG is helping them.

**Type:** Application
**Skill Loadout:** PAUL, brandkit, impeccable, ui-ux-pro-max, vercel:nextjs, vercel:shadcn, supabase, AEGIS
**Quality Gates:** `/impeccable critique` pass per frontend phase, RLS audit, Lighthouse ≥90, WCAG AA, AEGIS zero criticals, zero raw hex outside tokens

---

## Overview

PSG manages multiple Google Ads accounts under a single Manager Account (MCC). The native Google Ads UI requires constant tab-switching and produces dashboards that read like spec sheets — useful for technicians, opaque for clients. This app surfaces consolidated per-client performance as story-led narrative: what changed, what PSG did, what it means in business terms.

Two audiences:
- **PSG team** — admin view across all managed accounts, ability to add what-we-did timeline notes per client
- **Clients** — read-only view of their own account, plain-English KPI summaries, monthly PDF reports

Read-only by design. Mutations remain in the existing `apps/ads/` write-side tooling.

---

## Stack

| Layer | Choice |
|-------|--------|
| Frontend | Next.js 15 (App Router) + TypeScript |
| Styling | Tailwind + shadcn/ui (PSG token-overridden) + Tremor |
| Backend | Next.js Route Handlers + Server Actions |
| Database | Supabase Postgres (project `gylkkzmcmbdftxieyabw`) |
| Auth | Supabase Auth — magic link |
| Sync producer | Existing `apps/ads/googleads_psg/` Python wrapper |
| Sync runtime | GitHub Actions scheduled workflow (every 6h) |
| Deployment | Vercel (web) + Supabase (data) + GitHub Actions (sync) |

---

## Architecture

```
Google Ads MCC
      │ (gRPC, refresh token auth)
      ▼
Python sync (googleads_psg)  ──┐
   GitHub Actions cron, 6h    │ writes via service_role
                              ▼
                      Supabase Postgres
                      (RLS-enforced, snapshot + campaign_metric + note + client + user_profile)
                              ▲
                              │ JWT (role + client_id claims)
                              │
                       Next.js on Vercel
                              ▲
                              │
                       Magic-link login
                              │
                    ┌─────────┴─────────┐
                    PSG admin       Client user
                    (all clients)   (own client only, RLS)
```

After each sync run, GitHub Actions POSTs `/api/sync` with bearer token to invalidate Next.js caches.

---

## Data Model

| Entity | Purpose |
|--------|---------|
| `client` | Google Ads customer_id, slug, display name, brand overrides (jsonb), status |
| `user_profile` | Supabase auth user link + role (`psg_admin` \| `client`) + `client_id` FK |
| `snapshot` | Daily roll-up per client — spend, impressions, clicks, conversions, CPL, CTR |
| `campaign_metric` | Per-campaign daily metrics for drill-down |
| `note` | PSG-authored timeline entries tied to date + client |

Money stored as micros (`bigint`), divided by 1_000_000 in UI. Weekly/monthly aggregations via SQL views. Snapshots immutable; `client` soft-delete only.

RLS: row visibility filtered by `client_id` for `role=client`, full read for `role=psg_admin`, `note` write restricted to admin.

---

## API Surface

REST via Next.js Route Handlers, all behind Supabase JWT auth.

| Route | Methods | Auth | Purpose |
|-------|---------|------|---------|
| `/api/clients` | GET | any role | PSG sees all, client RLS-filtered |
| `/api/clients/[id]/overview` | GET | any role | Headline KPIs + sparklines for range |
| `/api/clients/[id]/campaigns` | GET | any role | Per-campaign table |
| `/api/clients/[id]/notes` | GET, POST | POST = psg_admin | What-PSG-did timeline |
| `/api/clients/[id]/export/[month]` | GET | any role | PDF monthly report |
| `/api/sync` | POST | bearer token | Webhook from GitHub Actions |

---

## UI/UX

Token-first, brand-driven. shadcn/ui primitives only — restyled via PSG tokens, no off-the-shelf look.

### Brand pipeline
1. `/brandkit` extracts tokens from PSG design system zip + brand guidelines URL → `tokens/psg.json`
2. Tailwind theme `extend` generated from tokens; `globals.css` defines CSS vars
3. shadcn components inherit (`bg-background`, `text-foreground`) — vars are PSG, not Slate
4. `/ui-ux-pro-max` advises component patterns + accessibility
5. `/impeccable` shape → craft → critique cycle gates every frontend phase

### Anti-slop pillars (binding)
1. Zero generic "AI dashboard" aesthetic — no card-grid default, no gradient blobs, no decorative iconography
2. Brand tokens before components — Tailwind theme rebuilt from PSG palette/type
3. Story leads, number supports — KPI cards open with sentence; metric is evidence
4. Editorial rhythm — intentional asymmetry, varied density, real whitespace
5. Print-quality typography — type scale from brand, real hierarchy, no Inter-everywhere
6. Motion with restraint — transitions communicate state change, nothing decorative
7. Every state designed up-front — empty, loading, error, first-visit, no-data-yet
8. `/impeccable critique` gate before every frontend phase merge

### Key views

| Route | Purpose |
|-------|---------|
| `/` | PSG admin home — all-client grid with logos, headline metric, traffic-light status |
| `/c/[slug]` | Single client dashboard — narrative summary, KPIs, sparklines, recent notes |
| `/c/[slug]/campaigns` | Campaign drill-down table with trend cells |
| `/c/[slug]/timeline` | What-PSG-did notes in reverse-chronological narrative |
| `/c/[slug]/report/[month]` | Print-styled monthly summary, exportable to PDF |
| `/login` | Magic-link request, branded |

Desktop-first design, mobile-functional below 768px (stacked, simplified charts). Print stylesheet for monthly report.

---

## Deploy

### Local
- Node 20 + Next.js dev server (`pnpm dev`)
- Python 3.11 venv for sync (shares wrapper with `apps/ads/`)
- Optional Supabase CLI local stack for offline schema work
- Seed script populates 1 fake client + 30 days synthetic snapshots

### Production
- **Vercel** auto-deploys from `main`, PR previews enabled
- **Supabase** project `gylkkzmcmbdftxieyabw` — migrations via CLI, RLS verified before merge
- **GitHub Actions** cron `0 */6 * * *`, POSTs `/api/sync` on completion
- Secrets: Google Ads refresh token / dev token / client ID & secret, Supabase service role, `SYNC_WEBHOOK_SECRET` — Vercel env + GH Actions secrets, never committed

---

## Security

- Supabase Auth magic-link, role + client_id in JWT custom claims via auth hook
- RLS policies default-deny on every table, tested per merge
- Sync webhook: bearer token, constant-time compare, GitHub Actions IP allowlist optional
- OWASP focus for this app: A01 broken access control (multi-tenant) — mitigated via RLS + JWT verification
- PII low — aggregated metrics + business names; no end-customer data
- Rate limiting via Vercel platform default; upgrade only on observed abuse

---

## Implementation Phases

### Phase 1 — Foundation
Next.js scaffold, Vercel deploy, Supabase wired, magic-link auth working. `/brandkit` produces `tokens/psg.json`. Tailwind theme from tokens. One hardcoded client page renders dummy data with PSG visual identity. **Gate:** `/impeccable critique` pass.

### Phase 2 — Data Pipeline
Schema migrations + RLS policies. Python sync writes Wallace snapshots to Supabase. GitHub Actions runs sync every 6h. `/c/wallace` renders real KPIs. **Gate:** sync logs healthy, row counts match, UI shows last-synced timestamp.

### Phase 3 — Multi-Client + RLS
Onboard Tedesco, Flower Hill. User provisioning flow (admin invite → magic link). RLS validated end-to-end. PSG admin home lists all clients. **Gate:** AEGIS RLS audit clean, cross-tenant access blocked.

### Phase 4 — Story Layer
Plain-language KPI cards with delta sentences. Timeline view + admin compose-note UI. Trend coloring tied to per-client goals. `/impeccable craft` per component. **Gate:** narrative components pass critique.

### Phase 5 — Reports + Polish
Monthly report view + PDF export. Mobile responsive pass. Final critique across all views. AEGIS full audit. **Gate:** Lighthouse ≥90, zero AEGIS criticals, brand-token compliance verified.

---

## Design Decisions

1. **Project type:** Application (web app) — client-facing UI, multi-tenant data, deployment lifecycle
2. **Audience:** PSG team + clients, multi-tenant from day 1
3. **Read-only:** Insight + narrative only; mutations stay in `apps/ads/` write tooling
4. **Stack:** Next.js 15 + Tailwind + shadcn/ui + Tremor + Supabase + Vercel — fast to ship, polish ceiling high, matches existing tooling
5. **Data pipeline:** Existing Python `googleads_psg/` as sync producer; Supabase as cache; Next.js consumes cache. Avoids Google Ads rate limits and reuses authenticated wrapper.
6. **Auth:** Supabase magic-link in project `gylkkzmcmbdftxieyabw` — no password support burden
7. **Sync runtime:** GitHub Actions scheduled workflow (every 6h) — free, in-repo, simple secrets
8. **Branding:** PSG brand guidelines + design system zip extracted via brandkit into token file; Tailwind theme built from tokens; no off-the-shelf shadcn defaults
9. **Anti-AI-slop pillars binding:** every frontend phase passes `/impeccable critique` before merge
10. **PDF reports:** monthly print-styled view with PDF export — clients forward to leadership

---

## Skill Loadout

| Skill | When | Purpose |
|-------|------|---------|
| PAUL | always | Milestone/phase manager, plan/apply/verify cycle |
| brandkit | Phase 1 | Extract PSG tokens from design system zip + guidelines URL |
| impeccable (shape/craft/critique) | every frontend phase | Design discipline, anti-slop enforcement |
| ui-ux-pro-max | frontend phases | Component patterns, accessibility, color systems |
| vercel:nextjs | Phase 1 + ongoing | Next.js 15 App Router patterns |
| vercel:shadcn | Phase 1+ | shadcn/ui scaffolding |
| supabase | Phase 2 + RLS work | Supabase patterns, RLS policies, auth hooks |
| AEGIS | end of Phase 3 + final | Security audit, RLS validation, OWASP review |

---

## Open Questions

1. PDF generation runtime — Puppeteer-on-Vercel vs `@react-pdf/renderer`? Resolve before Phase 5.
2. Per-client goals (target CPL etc.) — `goal` table in Phase 4, or admin UI later? Affects trend coloring.
3. Vanity slugs — `dashboard.psg.com/wallace` vs `app.psg.com/c/wallace`? Affects Vercel domain config.
4. Email digest (Resend) — weekly summary, monthly recap, or both? Defer post-MVP.
5. Client onboarding — PSG invites, or self-register with invite code?

---

## References

- Source planning: `projects/ads-dashboard/PLANNING.md`
- PSG brand guidelines: https://phoenixsolutionsgroup.net/psg-brand-guidelines/
- PSG design system zip: `Library/CloudStorage/GoogleDrive-nick@phoenixsolutionsgroup.net/Shared drives/02. Marketing/Brand Assets/Phoenix Solutions Group Design System.zip`
- Supabase project: `gylkkzmcmbdftxieyabw`
- MCC accounts: Wallace Collision Center (6048611995), Tedesco Auto Body (7763526490), Flower Hill Auto Body (see `apps/ads/ops/flower-hill/google-ads/src/data.py`)
- Write-side sibling repo: `apps/ads/` (`googleads_psg/` Python wrapper, ops scripts)
