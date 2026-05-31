# Ads Dashboard

> Client-facing Google Ads reporting dashboard for PSG-managed accounts under the MCC. Translates account performance into plain-English narrative so clients understand how PSG is helping them.

**Created:** 2026-05-20
**Type:** Application
**Stack:** Next.js 15 (App Router) + Tailwind + shadcn/ui + Tremor + Supabase + Vercel + Python sync job (GitHub Actions)
**Skill Loadout:** impeccable, brandkit, ui-ux-pro-max, PAUL, supabase, vercel:nextjs, vercel:shadcn, AEGIS
**Quality Gates:** /impeccable critique pass, RLS verified, magic-link auth E2E, Lighthouse ≥90, mobile responsive, brand-token compliance

---

## Problem Statement

PSG manages multiple Google Ads accounts under a single MCC. Current reporting is fragmented: native Google Ads UI requires tab-switching between accounts, screenshots, and verbal narrative on calls. Clients struggle to see the value PSG delivers — the data is there, but the story isn't.

**Audience:** PSG team (admin view across all clients) + clients (read-only view of own account).

**Why build vs buy:** Looker Studio, AgencyAnalytics, Whatagraph all exist but produce generic dashboards that scream "third-party reporting tool." This needs to feel like PSG — branded, narrative-led, story-driven. Clients should leave the dashboard understanding what PSG did this month and why their numbers moved.

**Dogfooding signal:** PSG team uses this internally first. If it doesn't replace our spreadsheet workflow, it's not done.

---

## Tech Stack

| Layer | Choice | Rationale |
|-------|--------|-----------|
| Frontend | Next.js 15 (App Router) + TypeScript | RSC for fast initial loads, route handlers for API, Vercel-native |
| Styling | Tailwind + shadcn/ui (token-overridden) + Tremor charts | shadcn primitives only — restyled via PSG tokens, no out-of-box look |
| Charts | Tremor + Recharts (fallback for custom viz) | Purpose-built for dashboards, headless enough to brand |
| Backend | Next.js Route Handlers + Server Actions | Single-runtime, no separate API service for MVP |
| Database | Supabase Postgres (project `gylkkzmcmbdftxieyabw`) | Existing project, RLS native, edge-pooled |
| Auth | Supabase Auth — magic link (passwordless) | Lowest friction for clients; no password reset support burden |
| Sync layer | Existing `googleads_psg/` Python wrapper | Already authenticated, MCC-aware, has audit logging |
| Sync runtime | GitHub Actions scheduled workflow | Free, lives next to source code, secrets in repo settings |
| Cache | Supabase Postgres (snapshot tables, no Redis) | One-tenant, low QPS — DB cache adequate |
| Deployment | Vercel (web) + Supabase (data) + GitHub Actions (sync) | Three-platform separation matches data flow |

### Research Needed
- Supabase RLS policy patterns for multi-tenant client isolation with role claim in JWT
- Tremor token override depth — confirm full theming via CSS vars vs forking components
- Puppeteer-on-Vercel for PDF generation (or @react-pdf/renderer as serverless-safe alt)

---

## Data Model

### Entities

| Entity | Key Fields | Relationships |
|--------|-----------|---------------|
| `client` | `id`, `customer_id`, `slug`, `display_name`, `brand_overrides` (jsonb), `status`, `created_at` | has many `snapshot`, `campaign_metric`, `note`, `user` |
| `user_profile` | `id` (FK auth.users), `role` (`psg_admin` \| `client`), `client_id` (nullable for psg), `display_name` | belongs to `client` |
| `snapshot` | `id`, `client_id`, `date`, `spend_micros`, `impressions`, `clicks`, `conversions`, `conversion_value_micros`, `cost_per_conversion_micros`, `ctr`, `synced_at` | belongs to `client` |
| `campaign_metric` | `id`, `client_id`, `campaign_id`, `campaign_name`, `date`, KPIs… | belongs to `client` |
| `note` | `id`, `client_id`, `author_user_id`, `date`, `title`, `body_md`, `category` (audit \| optimization \| milestone), `created_at` | belongs to `client` + `user_profile` |

### Notes
- Money fields stored as micros (`bigint`) — matches Google Ads API, divides by 1_000_000 in UI
- `client.brand_overrides` jsonb allows per-client logo/accent without schema churn
- `snapshot` is daily granularity; aggregations computed in SQL views (`snapshot_weekly`, `snapshot_monthly`)
- Soft deletes only on `client` (deleted_at); snapshots are immutable history
- RLS: `client_id` filter for `role=client`; full read for `role=psg_admin`; write restricted to `psg_admin` on `note`

---

## API Surface

### Auth Strategy
Supabase Auth with magic-link OTP. JWT contains custom claim `role` and `client_id` (via Supabase auth hook on token issue). Every route handler verifies JWT via `@supabase/ssr` server client and derives identity from claims, not body.

### Route Groups

| Group | Methods | Auth | Purpose |
|-------|---------|------|---------|
| `/api/clients` | GET | required | PSG: list all; client: own only (RLS-filtered) |
| `/api/clients/[id]/overview` | GET | required | Headline KPIs + sparklines for date range |
| `/api/clients/[id]/campaigns` | GET | required | Drill-down campaign table |
| `/api/clients/[id]/notes` | GET, POST | required (POST psg_admin only) | What-PSG-did timeline |
| `/api/clients/[id]/export/[month]` | GET | required | PDF monthly report download |
| `/api/sync` | POST | bearer token (sync secret) | Webhook called by GH Actions after sync run |

### Internal vs External
- **Public endpoints:** none — all behind auth
- **Internal/admin endpoints:** `POST /api/clients/[id]/notes`, sync webhook
- **MCP integration points:** none in web app; Python sync uses Google Ads gRPC API directly

---

## Deployment Strategy

### Local Development

| Service | Image/Runtime | Port | Purpose |
|---------|--------------|------|---------|
| Next.js dev | Node 20 | 3000 | Web app |
| Supabase CLI (optional) | local stack | 54321 | Mirror prod schema for offline dev |
| Python sync | venv 3.11 | n/a | Run on-demand against test customer_id |

`.env.local` mirrors Vercel env. Seed script populates 1 fake client + 30 days of synthetic snapshots for UI work without API calls.

### Staging / Production
- **Web (Vercel):** auto-deploy from `main` to production; PR previews enabled. Env vars: `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY`, `SYNC_WEBHOOK_SECRET`.
- **Database (Supabase):** project `gylkkzmcmbdftxieyabw`. Migrations via Supabase CLI in repo. RLS verified before merging schema changes.
- **Sync (GitHub Actions):** cron `0 */6 * * *` (every 6h). Secrets: Google Ads refresh token, dev token, client ID/secret, Supabase service role, sync webhook secret. On completion, POST `/api/sync` to bust caches.

---

## Security Considerations

- **Auth/Authz model:** Supabase Auth magic-link; role + client_id baked into JWT custom claims via Supabase auth hook. Every server-side query uses `createServerClient` so RLS applies.
- **Row-level security:** policies on `client`, `snapshot`, `campaign_metric`, `note`, `user_profile`. Default deny. Tested before each merge.
- **Sync webhook:** bearer token in `Authorization` header, constant-time compare, IP-allowlist GitHub Actions ranges optional later.
- **OWASP concerns for THIS app:**
  - A01 Broken Access Control → RLS + JWT claim verification (highest risk, multi-tenant)
  - A02 Cryptographic Failures → Supabase handles at rest; HTTPS only via Vercel
  - A07 Auth → magic-link only, no password attack surface
- **Secrets management:** Vercel env (production + preview), GitHub Actions secrets, `.env.local` for dev. Never committed. `.env.example` checked in with placeholder names.
- **Rate limiting:** Vercel platform default for MVP. Add `@vercel/edge` rate-limit middleware if abuse observed.
- **PII:** low — aggregated metrics + client business names + ad spend. No end-customer data. No HIPAA/PCI scope.

---

## UI/UX Needs

### Design System
**Token-first, brand-driven.** No off-the-shelf shadcn defaults visible in shipped UI.

1. Run `/brandkit` against PSG design system zip + `https://phoenixsolutionsgroup.net/psg-brand-guidelines/` → produce `tokens/psg.json` (colors, type scale, spacing, radii, shadows, motion).
2. Generate Tailwind `theme.extend` from tokens. `globals.css` defines CSS vars. shadcn components inherit via `bg-background`, `text-foreground` etc. — vars are PSG, not Slate.
3. `/ui-ux-pro-max` advises component patterns + accessibility per view.
4. `/impeccable` shape→craft→critique cycle runs at every frontend phase.

**Anti-slop pillars (binding):**
1. Zero generic "AI dashboard" aesthetic — no card-grid-default, no gradient blobs, no decorative iconography
2. Brand tokens before components — Tailwind theme rebuilt from PSG palette/type
3. Story leads, number supports — KPI cards open with sentence, metric is evidence
4. Editorial rhythm — asymmetric layout where it serves, intentional whitespace, varied component density
5. Print-quality typography — type scale from brand, real hierarchy, no Inter-everywhere
6. Motion with restraint — transitions only when they communicate state change
7. Every state designed up-front — empty, loading, error, first-visit, no-data-yet
8. `/impeccable critique` gate before every frontend phase merge

### Key Views / Pages

| View | Route | Purpose | Complexity |
|------|-------|---------|------------|
| PSG home | `/` | All-client grid; logos, headline metric, status traffic-light | medium |
| Client dashboard | `/c/[slug]` | Single client landing — narrative summary, KPIs, sparklines, recent notes | high |
| Campaign drill-down | `/c/[slug]/campaigns` | Per-campaign table with trend cells | medium |
| Timeline | `/c/[slug]/timeline` | What-PSG-did notes in reverse-chronological narrative | low |
| Monthly report | `/c/[slug]/report/[month]` | Print-styled single-page summary, exportable to PDF | medium |
| Auth | `/login` | Magic-link request, branded | low |

### Real-Time Requirements
None. Data refreshes via 6h sync. UI shows last-synced timestamp; manual "refresh" button triggers a fresh fetch from cache, not from Google Ads.

### Responsive Needs
Desktop-first design, mobile-functional. Clients check phones — stacked layout, simplified charts, no horizontal scroll below 768px. Print stylesheet for monthly report.

---

## Integration Points

| Integration | Type | Purpose | Auth |
|------------|------|---------|------|
| Google Ads API | gRPC (Python SDK) | Pull metrics, campaign data | OAuth refresh token + dev token |
| Supabase | REST + Realtime | DB, auth, storage (PDF cache) | anon key + service role |
| Vercel | Platform | Web hosting, env, cron-trigger optional | n/a |
| GitHub Actions | CI | Sync runtime | repo secrets |
| Resend (later) | API | Email monthly reports | API key (deferred to phase 6+) |
| Slack (later) | webhook | Notify PSG on client login | webhook URL (deferred) |

---

## Phase Breakdown

### Phase 1: Foundation
- **Build:** Next.js 15 app scaffolded, Vercel deploy live, Supabase wired, magic-link auth working end-to-end. `/brandkit` extracts PSG tokens → `tokens/psg.json`. Tailwind theme built from tokens. One hardcoded client page renders dummy data with PSG visual identity.
- **Testable:** Sign in via magic link, land on `/c/wallace`, see branded layout with placeholder KPIs.
- **Outcome:** Visual foundation locked. Anti-slop verified by `/impeccable critique` before merge.

### Phase 2: Data Pipeline
- **Build:** Supabase schema migrations (client, snapshot, campaign_metric, user_profile, note tables) + RLS policies. Python sync script reads Wallace customer, writes daily snapshots to Supabase via service-role. GitHub Actions workflow runs sync every 6h, calls `/api/sync` webhook after. `/c/wallace` renders real KPIs.
- **Testable:** GH Actions log shows successful sync. Supabase row counts match expected. UI shows real numbers with last-synced timestamp.
- **Outcome:** Live data flowing. PSG can dogfood with Wallace account.

### Phase 3: Multi-Client + RLS
- **Build:** Onboard Tedesco and Flower Hill. User provisioning flow (PSG admin invites client → magic link). RLS verified — client logged in as Tedesco cannot read Wallace rows. PSG admin home `/` lists all clients.
- **Testable:** AEGIS RLS audit passes. Cross-tenant access attempts blocked. Three real client dashboards live.
- **Outcome:** Multi-tenant safe. Ready for external client access.

### Phase 4: Story Layer
- **Build:** Plain-language KPI cards with delta sentences ("Up 23% vs last month — added 3 new conversion goals on May 4"). Timeline view rendering notes. PSG admin compose-note UI. Trend coloring tied to per-client goals table. `/impeccable craft` cycle for each new component.
- **Testable:** Notes appear on timeline immediately. Sentences regenerate with date ranges. Critique passes for narrative components.
- **Outcome:** Dashboard reads like a story, not a report.

### Phase 5: Reports + Polish
- **Build:** Monthly report view at `/c/[slug]/report/[month]` with print stylesheet. PDF export via `/api/.../export/[month]`. Mobile responsive pass. Final `/impeccable critique` against all views. AEGIS full audit.
- **Testable:** PDF download produces brand-correct, paginated report. Mobile Lighthouse ≥90. Zero AEGIS criticals.
- **Outcome:** Production-ready, client-shareable, brand-faithful.

---

## Skill Loadout & Quality Gates

### Skills Used During Build

| Skill | When It Fires | Purpose |
|-------|--------------|---------|
| PAUL | Always — milestone/phase manager | Structured build, plan/apply/verify cycle |
| brandkit | Phase 1 — design tokens | Extract PSG tokens from design system zip + guidelines URL |
| impeccable (shape/craft/critique) | Every frontend phase entry + exit | Design discipline, anti-slop enforcement |
| ui-ux-pro-max | Frontend phases | Component patterns, accessibility, color systems |
| vercel:nextjs | Phase 1 + ongoing | Next.js 15 App Router best practices |
| vercel:shadcn | Phase 1 + as components added | shadcn/ui scaffolding |
| supabase | Phase 2 + RLS work | Supabase patterns, RLS policies, auth hooks |
| AEGIS | End of Phase 3 + final | Security audit, RLS validation, OWASP review |
| gsd-ui-phase (optional) | Pre-frontend phases | UI design contract before frontend phases |

### Quality Gates

| Gate | Threshold | When |
|------|-----------|------|
| `/impeccable critique` | passing score | Each frontend phase exit |
| RLS audit | zero cross-tenant leaks | Phase 3 + final |
| Test coverage (data layer) | ≥70% | Phase 2 + final |
| Lighthouse | ≥90 across the board | Final phase |
| Accessibility | WCAG AA | Each frontend phase |
| AEGIS audit | zero criticals | Final phase |
| Brand-token compliance | zero raw hex codes outside tokens | Each frontend phase |

---

## Design Decisions

1. **Project type:** Application (web app), not MCP-native — Section confirmed by user
2. **Audience:** PSG team + clients (multi-tenant from day 1)
3. **Read-only:** No campaign mutation from dashboard; insight + narrative only
4. **Stack:** Next.js 15 + Tailwind + shadcn/ui + Tremor + Supabase + Vercel — fast to ship, polish ceiling high, matches existing tooling
5. **Data pipeline:** Existing Python `googleads_psg/` as sync producer; Supabase as cache; Next.js consumes cache. Avoids Google Ads rate limits and reuses authenticated wrapper.
6. **Auth:** Supabase magic-link in project `gylkkzmcmbdftxieyabw` — no password support burden
7. **Sync runtime:** GitHub Actions scheduled workflow (every 6h) — free, in-repo, simple secrets
8. **Branding:** PSG brand guidelines + design system zip — extracted via brandkit into token file; Tailwind theme built from tokens; no off-the-shelf shadcn defaults
9. **Anti-AI-slop pillars binding:** every frontend phase passes `/impeccable critique` before merge
10. **PDF reports:** monthly print-styled view with PDF export — clients forward to bosses

---

## Open Questions

1. PDF generation runtime — Puppeteer-on-Vercel vs `@react-pdf/renderer`? Decide before Phase 5.
2. Per-client goals (target CPL etc.) — capture in `goal` table from Phase 4, or admin UI later? Affects trend coloring logic.
3. Vanity slugs — `dashboard.psg.com/wallace` or `app.psg.com/c/wallace`? Subdomain + path decision affects Vercel domain config.
4. Email digest cadence (Resend integration) — weekly summary, monthly recap, or both? Defer to post-MVP.
5. Client onboarding — does PSG invite or does client self-register with an invite code?

---

## Next Actions

- [ ] `/seed launch ads-dashboard` — graduate to `apps/ads-dashboard/` + PAUL init
- [ ] Run `/brandkit` against PSG design system zip + guidelines URL (Phase 1 prep)
- [ ] PAUL Milestone 1 = Phase 1 (Foundation); begin with `/paul:discuss`
- [ ] Resolve PDF runtime question before Phase 5 planning

---

## References

- PSG brand guidelines: https://phoenixsolutionsgroup.net/psg-brand-guidelines/
- PSG design system: `Library/CloudStorage/GoogleDrive-nick@phoenixsolutionsgroup.net/Shared drives/02. Marketing/Brand Assets/Phoenix Solutions Group Design System.zip`
- Supabase project: `gylkkzmcmbdftxieyabw`
- Existing repo: `apps/ads/` (`googleads_psg/` Python wrapper, ops scripts per client)
- MCC client list: Wallace Collision Center (6048611995), Tedesco Auto Body (7763526490), Flower Hill Auto Body (see `apps/ads/ops/flower-hill/google-ads/src/data.py`)

---

*Last updated: 2026-05-20*

---

**Graduated:** 2026-05-20
**Location:** `apps/ads-dashboard/`
**README:** `apps/ads-dashboard/README.md`
