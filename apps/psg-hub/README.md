# psg-hub

> Unified PSG platform — customer portal + internal operational backbone + PSG-internal agentic market intelligence. Replaces fragmented tooling and the legacy FileMaker Advantage Program.

**Status:** SEED ideation v7 complete (70 decisions, 4 open questions deferred). Ready for PAUL initialization.
**Type:** Application
**Anchor:** BSM `dashboard/` (Next.js 16 + Supabase + Stripe + Google Ads + Sanity + Paperclip + Claude Flow), relocates here in v0.1
**Production domain:** `hub.psgweb.me`
**Repo:** `Phoenix-Solutions-Group/data` (single repo)
**Vercel project:** existing `psg-advantage-portal` re-linked + renamed; BSM Vercel decommissioned
**Workspace:** `apps/psg/` (monorepo root); hub at `apps/psg/apps/psg-hub/`

---

## What

`psg-hub` consolidates three product surfaces in one Next.js app, separated by RBAC + tier + security profiles + RLS:

1. **Customer-facing portal** — collision repair shops in PSG roster (~842 shops). Marketing analytics (Google Ads + GA4 + Search Console unified), AI agents, invoicing + Stripe payments, post-repair sentiment, digital presence, market intel.
2. **PSG internal operational backbone** — Companies, Employees, Repair Customers, Repair Orders, Estimates, Surveys, Production printing (PSG's core revenue mail program), 26 operational reports, System Configuration master data, Security Profiles, RO/Estimate Import (absorbs `psg-import`).
3. **PSG-internal agentic market intelligence** — competitor engine, Yext (Growth+ tier), weather correlation, multi-LLM router, NotebookLM grounding, agentic report synthesis + PDF.

**Users:**
- Customers: shop owner-operators + marketing leads. MSOs supported via shop switcher.
- Internal: PSG account managers, production team, billing ops, strategy team.
- Superadmins: Nick, Tina, Brian.
- End consumers (repair_customers): tracked as entities, no UI surface.

---

## Stack

Next.js 16 + React 19.2 + TS strict + Supabase (project `gylkkzmcmbdftxieyabw`, shared across hub + ads-dashboard archive + local_reach archive + psg-advantage-portal + BSM) + Redis + Tailwind 4 + shadcn + base-ui + Tremor + Stripe + Vitest 4 + Playwright + Vercel + Vercel Sandbox (Python workers) + BigQuery (internal) + Sanity (new project, content) + Paperclip AI + Claude Flow + multi-LLM (Anthropic / OpenAI / Gemini / Perplexity) + Firecrawl + SEMrush + GA4 Data API + Google Search Console API + SendGrid (transactional email) + Twilio (SMS) + Lob.com + in-house print queue (Production dual adapter).

**Anchor stack source:** BSM `dashboard/` (Phases 1–5 shipped) — relocates to this directory in v0.1.

---

## Milestone roadmap

```
v1.0 — Customer-Facing Launch  (pilot: Wallace, Tedesco, Tracy's)
    ├── v0.1 Foundation                 (monorepo, brand, SendGrid+Twilio, Sanity new project, Vercel rename, BSM relocation, kill list retired)
    ├── v0.2 Customer MVP               (RBAC, tier gating, shop switcher, superadmin bootstrap, launch hardening)
    ├── v0.3 Customer Analytics         (ads-dashboard plans+concepts absorbed; Google Ads + GA4 + GSC unified marketing surface; story-led narrative UI; "What PSG did" timeline; goals trend coloring; monthly PDF report; digital presence; post-repair sentiment)
    └── v0.4 Invoicing + Payments       (Invoiced.com mirror + Stripe coexistence + payment links)

v1.1 — Ops Foundation                   (Companies, Employees, Programs, Repair Customers, ROs, Estimates, Surveys, SysConfig, RO/Estimate Import via psg-import absorb, Security Profiles)
v1.2 — Ads Mutation Studio              (apps/ads/ Python mutations + GTM mutations surfaced via web UI; dry-run preview → execute → audit on Vercel Sandbox)
v1.3 — Production Module                (Lob.com + in-house print queue dual adapter; FileMaker retired as daily driver)
v1.3.5 — FM Historical Migration        (optional add-on if business requires historical continuity)
v1.4 — Operational Reports              (26 named reports across 5 batches)
v1.5 — Superadmin Matrix + Audit
v1.6 — Internal Agentic Intelligence    (multi-LLM router, NotebookLM grounding, Yext, weather correlation, competitor engine, agentic PDF reports)
v2.0 — Convergence + Hardening          (E2E, AEGIS, launch readiness, deferred Pipedrive + future integrations)
```

**Release strategy:** No fixed launch date — quality-first, ship when ready (D60). Customer track ships first as v1.0. Ops + internal tracks post-v1.0 strictly sequential, single team (D62).

---

## Architecture

- **Monorepo:** pnpm + Turborepo at `apps/psg/`
- **Single Next.js app:** customers + internal ops + internal agentic + admin separated by `roles` (`customer`, `psg_internal`, `psg_superadmin`) + `billing_tier` (`essentials` / `growth` / `performance`, honored from BSM) + `security_profiles` (function flags for ops) + RLS
- **Multi-tenancy:** every customer table RLS-clamped to `shop_id IN (SELECT shop_id FROM shop_users WHERE profile_id = auth.uid())`. BSM `profile_id` convention honored.
- **Shop switcher:** top-bar selector; URL `/dashboard/shop/[shopId]/...` for customer routes; `/ops/*` for internal; `/internal/*` for agentic; `/admin/*` for superadmin.
- **Python workers:** Vercel Sandbox for `apps/ads/` mutations (v1.2) and Paperclip agentic runs (v1.6).
- **Mail dual adapter:** `LobAdapter` (API + address verification + webhook) + `InHouseAdapter` (PDF generator → PSG facility) behind shared `MailAdapter` interface (v1.3).
- **Shared Supabase project** `gylkkzmcmbdftxieyabw` — already shared by all PSG customer-facing apps. Auth identities flow without migration.
- **Resilience:** retry + circuit breaker on every external call. No bare catches.

---

## Data model layers

1. **Inherited from BSM** (shipped) — `profiles`, `shops`, `billing_tier`, `subscriptions`, `ads_*`, content/agent tables, Sanity schemas
2. **Ported from psg-advantage-portal** (v0.3) — `body_shops` registry, `customer_geography_*`, `market_dashboard_rollups`, `shop_competitor_overlay`, `invoiced_customer_*`, `psg_sensitive_pii_*` policies
3. **New for psg-hub:**
   - RBAC: `roles`, `user_role_assignments`, `modules`, `module_access_grants`, `access_audit`, `shop_users`, `security_profiles`, `user_security_profile_assignments`
   - Marketing: `ga4_*`, `gsc_*`, `psg_activity_notes` (timeline), `shop_goals` (trend coloring)
   - Invoicing: `invoices`
   - Surveys: `survey_responses`, `sentiment_scores`
   - Ops (v1.1, Advantage): `companies`, `employees`, `company_programs`, `repair_customers`, `repair_orders`, `estimates`, `import_templates`, `vehicles`, `insurance_companies`, `insurance_agents`
   - Ads mutations (v1.2): `ads_mutations`, `ads_mutation_dry_runs`, `ads_audit_logs`, `gtm_mutations`, `client_audits`, `client_reports`, `python_worker_jobs`
   - Production (v1.3): `production_batches`, `production_documents`, `production_reprint_log`, `mail_vendor_jobs` (`lob` / `inhouse`), `email_jobs`, `sms_jobs`
   - Internal agentic (v1.6): `consolidators`, `competitor_scores`, `yext_*`, `weather_correlations`, `llm_routing_log`, `notebooklm_query_log`, `reports`

---

## Pilot cohort (v1.0)

| Shop | Customer ID | Source | Status |
|------|------------|--------|--------|
| Wallace | 6048611995 | ads-dashboard | live ads data exists, pilot Day 1 |
| Tedesco | 7763526490 | ads-dashboard | live ads data exists, pilot Day 1 |
| Tracy's Collision Center | (BSM fixture) | BSM | transitions BSM fixture → v1.0 pilot live |

Flower Hill data preserved in absorbed code, not in v1.0 pilot.

---

## Brand

Strict conform to PSG design system from `github.com/Phoenix-Solutions-Group/design-system` (git submodule at `packages/ui/psg-brand/`). No extensions. Replaces BSM's oklch vars and psg-advantage-portal's local DESIGN-SYSTEM.md.

- Colors: Midnight `#1E3A52`, Ember `#B8483E` (single focal accent per view), Slate `#4A4257`, Paper `#FAF8F5`
- Type: Gotham (headings, max weight Medium 500) + Didact Gothic (body 16px, lh 1.65)
- Voice: understated luxury; no emoji; em-dashes welcome; sentence case for body + UI labels
- Geometry: 6px corners default; square-leaning; pill only for tags/badges
- Motion: `cubic-bezier(0.22, 0.61, 0.36, 1)`, 140/220/420ms

---

## Quality gates

- Vitest coverage ≥70% lines (new code)
- Playwright E2E: auth + 1 customer happy path + 1 ops happy path
- AEGIS audit at each milestone close
- WCAG AA on customer routes
- LCP <2s on `/dashboard`
- gitleaks pass; no high CVEs
- Brand audit (strict conform) every UI milestone
- AI-vocabulary regex scan on all generated content
- PII RLS review before v1.0 customer launch
- Tier-gate verification on every protected route
- Idempotency on every webhook + import
- Resilience: retry + circuit breaker on every external call

---

## Workspace consolidation (v0.1)

**Relocates into `apps/psg/apps/*`:** BSM dashboard → `apps/psg-hub/`; `apps/ads/` → `apps/psg-ads-mutations/` (Python worker); psg-advantage-portal stays as source for v0.3 port (relocates later).

**Relocates into `apps/psg/packages/*`:** BSM siblings (`studio/`, `integrations/`, `onboarding/`, `preview/`, `shops/`); PSG design system as `packages/ui/psg-brand/` git submodule.

**Archives into `apps/psg/archive/`:** `local_reach/` (BSM agents replace function); `ads-dashboard/` PAUL plans + concepts (absorbed; scaffold code discarded since BSM Next 16 supersedes Next 15 scaffold).

**Retired (kill list):** `invoice/`, `portal/`, `sst-psgdigital/`, `web-dev-skills/`, `dashboard-psgdigital/`, `shop-theacrb/`, `invoice-psgdigital/`.

**Relocated outside repo:** `psg/` (Obsidian vault), `pipedrive/` (audit xlsx/docx).

---

## Open questions (deferred)

| # | Question | Status |
|---|----------|--------|
| 15 | FileMaker data migration scope (full history vs cutoff) | Decide only if v1.3.5 add-on triggered |
| 23 | Other unmapped `~/apps/` areas (Automation, gbrain, daily-content-brief, DEGWEB-MODERNIZATION-REVIEW.md, etc.) | Scan before locking v0.1 phase 1 |
| 24 | What is "degweb"? | Surface in unmapped scan |
| 25 | `~/apps/gbrain/` integration | Leverage for context/memory or stay independent? |

Operational questions (first-login UX, end-consumer PII retention, domain coexistence) deferred to v0.2 + v2.0 hardening.

---

## References

- `projects/psg-hub/PLANNING.md` — full ideation v7 (924 lines, 70 decisions)
- `apps/psg/.paul/codebase/` — workspace codebase map (STACK, ARCHITECTURE, STRUCTURE, CONVENTIONS, TESTING, INTEGRATIONS, CONCERNS)
- `~/apps/projects/bsm/` — anchor source; relocates here in v0.1
- `~/apps/projects/bsm/.paul/` — BSM PAUL state (preserved as foundation)
- `~/apps/projects/bsm/PLANNING.md` — original BSM planning doc
- `~/apps/ads-dashboard/.paul/{PROJECT.md, ROADMAP.md, SPECIAL-FLOWS.md, phases/01-foundation/*}` — absorbed as v0.3 source material (D70)
- `~/apps/ads/` — Python ads + GTM mutation tooling (surfaced v1.2)
- `apps/psg/psg-advantage-portal/` — market-intel source code (ported in v0.3)
- `apps/psg/psg-advantage-portal/Master Project Plan_ PSG Agentic Market Intelligence Platform.md` — absorbed as v1.6
- `apps/psg/psg-advantage-portal/supabase/migrations/` — applied to shared Supabase project in v0.3
- `apps/psg/psg-import/` — absorbed into v1.1 ops
- `apps/psg/psg-data-lake/` — Python ETL feeder, untouched
- FleetComplete 2019 `PSG Project Technical Design v1.0_Final` — absorbed as v1.1, v1.3, v1.4, v1.5 (never shipped; v1.1+ is greenfield from spec)
- `github.com/Phoenix-Solutions-Group/design-system` — brand source of truth
- `github.com/Phoenix-Solutions-Group/data` — single repo target

---

*Graduated from SEED ideation 2026-05-29 — v7 PLANNING.md, 70 decisions, Critical Qs 1–8 + Important Qs 9–22 resolved (Q15, Q20 noted), Discovery Qs 23–25 deferred.*
