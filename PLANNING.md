# psg-hub

> Unified PSG platform: customer-facing portal (analytics, AI agents, invoicing, payments) + internal operational backbone (Companies, Repair Customers, ROs, Estimates, Surveys, Production, 26 operational reports, master data) + PSG-internal agentic market intelligence. Replaces fragmented tooling and the legacy FileMaker Advantage Program.

**Created:** 2026-05-28 (last revised: 2026-05-29, v7 — Critical Qs 1–8 + Important Qs 9–22 + Discovery Qs 23–25 resolved (Q15 deferred), 71 decisions)
**Type:** Application
**Anchor:** BSM `dashboard/` (Next.js 16 + Supabase + Stripe + Google Ads + Sanity + Paperclip + Claude Flow) — `~/apps/projects/bsm/`
**Anchor location post-consolidation:** `apps/psg/apps/psg-hub/` (BSM dashboard moves here; BSM siblings become monorepo packages)
**Stack:** Next.js 16 + React 19.2 + TS strict + Supabase (Postgres + Auth + Storage, project `gylkkzmcmbdftxieyabw` — shared across hub, ads-dashboard, local_reach, psg-advantage-portal, BSM) + Redis + Tailwind 4 + shadcn + base-ui + Tremor + Stripe + Vitest 4 + Playwright + Vercel + Vercel Sandbox (Python workers) + BigQuery (internal) + Sanity (new project, content) + Paperclip AI (orchestration) + Claude Flow (agent runtime) + multi-LLM (Anthropic, OpenAI, Gemini, Perplexity) + Firecrawl (scrape) + SEMrush + GA4 Data API + Google Search Console API + SendGrid (transactional email) + Twilio (SMS) + Lob.com + in-house print queue (Production dual adapter)
**Release strategy:** Customer track ships v1.0 (milestones v0.1–v0.4). Internal ops track ships post-v1.0 sequentially (v1.1 → v1.2 → v1.3 → v1.4 → v1.5 → v1.6 → v2.0). FleetComplete 2019 Angular spec never shipped — v1.1+ is greenfield from spec. FileMaker Advantage is current PSG daily driver; psg-hub is its replacement. FM data migration / cutover is **add-on scope** (not core), surfaced as optional v1.3.5 if business requires historical continuity.
**Skill Loadout:** PAUL, phoenix-solutions-group-design, ui-ux-pro-max, impeccable, uncodixfy, humanizer, supabase, vercel:bootstrap/env/deploy, code-review, AEGIS, /paul:audit, frontend-design, brand
**Quality Gates:** Vitest coverage ≥70% lines (new code); Playwright E2E on auth + 1 customer dashboard happy path + 1 ops happy path; AEGIS audit per milestone; WCAG AA on customer routes; LCP <2s; PII RLS review before customer launch; brand-conformance audit on every UI milestone; AI-vocabulary regex scan on generated content; tier-gate verification on every protected route; idempotency on every webhook + import
**Production domain:** `hub.psgweb.me`
**Vercel project:** existing `psg-advantage-portal` Vercel project re-linked + renamed to `psg-hub` (env vars + analytics history preserved)
**Repo:** single GitHub repo `Phoenix-Solutions-Group/data`
**Git history:** fresh import for the renamed `psg-hub` (no anchor history preservation)
**PAUL state:** preserve BSM's existing PAUL setup (Phases 1–5 complete in BSM) as foundation; psg-hub milestones continue at v0.1.

---

## Problem Statement

PSG today runs across fragmented systems and tooling:

- **Customer-facing:** shops live in separate logins for marketing analytics, ad reporting, invoices, payments, surveys, review monitoring, and content/SEO automation. PSG fields constant "where's my X" support tickets.
- **Internal ops:** PSG operates a legacy FileMaker-powered Advantage Program for shop/customer/RO/estimate management, surveys, production printing (PSG's core revenue mail program), 26 operational reports, and master data (products, items, vehicles, insurance companies, insurance agents). A 2019 FleetComplete technical design (`PSG Project Technical Design v1.0_Final`) specced an Angular + MS SQL cloud rewrite that either never shipped or shipped incomplete.
- **Bespoke tools:** `psg-import` handles RO/Estimate import as a standalone Next.js utility. `psg-data-lake` runs Python ETL. `psg-advantage-portal` ships market intelligence dashboards. BSM ships customer-facing AI agents + content + reputation + billing. Each is partial.

`psg-hub` is the **one app** that consolidates:

1. Everything customer-facing a shop needs (analytics, agents, invoicing, payments, presence, sentiment)
2. PSG's full internal operational backbone (Companies, Employees, Repair Customers, ROs, Estimates, Surveys, Production printing, 26 operational reports, master data, security profiles, RO/Estimate Import)
3. PSG-internal agentic market intelligence (competitor engine, Yext, weather correlation, multi-LLM synthesis, NotebookLM-grounded reports, PDF generation) per the Master Project Plan

**Primary user (customer):** owner-operators and marketing leads at collision repair shops in the PSG roster (~842 shops). MSOs supported via shop switcher. Paid subscription via existing BSM tier model (`essentials` / `growth` / `performance`).

**Primary user (internal):** PSG account managers, production team, billing ops, strategy — replaces FileMaker Advantage as their daily driver post-v1.2.

**Tertiary user (superadmin):** Nick, Tina, Brian — manage user roles, shop assignments, tier, module access, security profiles, audit log.

**End consumers (the shop's customers):** receive PSG-printed mail (thank-you, warranty), fill paper or web surveys. Do NOT log in. Tracked as entities but no UI surface for them.

**Why build vs buy:** no off-the-shelf product covers PSG's specific stack of collision-repair shop management + AI agent automation + 26 operational reports + Production printing + market intelligence in one branded surface. The 2019 FleetComplete attempt validates the in-house build path.

---

## Tech Stack

| Layer | Choice | Source today | Notes |
|-------|--------|--------------|-------|
| Frontend | Next.js 16.2 App Router + React 19.2 + TS strict | BSM dashboard | psg-advantage-portal code upgraded 15 → 16 during v0.3 |
| UI | Tailwind 4 + shadcn + base-ui | BSM dashboard | PSG brand tokens already wired (oklch vars → replaced with brand submodule tokens in v0.1) |
| Styling | PSG design system (Gotham + Didact Gothic + `colors_and_type.css`) | submoduled `Phoenix-Solutions-Group/design-system` | Strict conform |
| Auth | Supabase Auth (`@supabase/ssr`) | BSM + psg-advantage-portal | Already shipped in both |
| DB | Supabase Postgres | shared across BSM, psg-advantage-portal, psg-data-lake, psg-import | Single schema target |
| Direct DB | `pg` connection pool | psg-advantage-portal | Inherited for heavy reads, reports |
| Cache | Redis via `ioredis` | psg-advantage-portal | Rate limit + sync caching |
| Billing | Stripe (PSG MOR, single account) — subscriptions **and** invoices/payments, **Stripe-native** (Invoiced.com dropped; operator decision 2026-06-18, [PSG-56](/PSG/issues/PSG-56)) | BSM (shipped) | Customer portal shipped; Stripe Invoices surfaced in v0.4 |
| Tier gating | Postgres `billing_tier` enum (`essentials`, `growth`, `performance`) + `TierGateCard` UI | BSM | Honored as-is, no migration |
| Content store | Sanity Studio (agent output + mail-merge templates) | BSM `studio/` | Schema extended in v1.2 for Production templates |
| Email (transactional + auth + customer) | **SendGrid** with PSG-branded sender on `psgweb.me` | existing PSG account | Replaces Supabase default and prior Resend pick (Q4 resolved) |
| SMS (transactional) | **Twilio** with PSG number | existing PSG account | Survey reminders, production status, auth fallback |
| Mail/print vendor (Production module) | **Lob.com adapter + in-house print queue adapter (dual)** | new (v1.3) | Q4 resolved — both shipped; vendor selected per template or shop |
| Internal data warehouse | BigQuery + Supabase mirror | psg-data-lake (Python) | Cache-first DAL per Master Plan |
| Agent orchestration | Paperclip AI | BSM (shipped) | Per-agent budgets, governance, approvals, audit |
| Agent runtime | Claude Flow | BSM (shipped) | Spawning, memory, hooks |
| Agent skills | Claude Code Skills | BSM (shipped) | 4 agents (scraper, SEO auditor, market researcher, content writer) |
| Web scraping | Firecrawl MCP | BSM | Site monitoring + design extraction |
| Google Ads (read-side, customer-facing) | `google-ads-api ^23.0.0` (BSM) + Python sync via apps/ads/googleads_psg every 6h via GitHub Actions cron (ads-dashboard pattern) | BSM (shipped) + ads-dashboard (shipped) | Per-shop OAuth |
| **GA4 Data API** | per-shop OAuth | new (v0.3) | sessions, users, conversions, traffic, top pages |
| **Google Search Console API** | per-shop OAuth | new (v0.3) | impressions, clicks, CTR, position, top queries/pages, indexing, sitemaps, CWV |
| SEO data | SEMrush API | BSM (shipped) | Already wired |
| Multi-LLM router (internal) | Anthropic + OpenAI + Gemini + Perplexity | new (v1.5) | extract / sentiment / search / write |
| NotebookLM grounding (internal) | `teng-lin/notebooklm-py` | new (v1.5) | Resilience fallback to plain Claude |
| Resilience | retry + circuit breaker pattern | Master Plan + BSM patterns | no bare catch |
| Test (unit/component) | Vitest 4 + jsdom + Testing Library | BSM + psg-advantage-portal | both shipped Vitest |
| Test (E2E) | Playwright | new in v0.2 (customer track) + v1.1 (ops track) | auth + 1 customer + 1 ops happy path |
| Monorepo | pnpm workspaces + Turborepo | new at root (v0.1) | apps/, packages/ |
| Deployment | Vercel (existing project re-linked + renamed) | psg-advantage-portal's Vercel | env vars + analytics history preserved |
| PDF (internal agentic reports) | Playwright + print.css | new (v1.5) | print-ready PDF synthesis |
| PDF (Production mail-merge) | Playwright or `@react-pdf/renderer` | new (v1.3) | print-ready mail communications |
| **Google Ads + GTM mutation tooling** | Python 3.11/3.12 (`apps/ads/`, `googleads_psg/`, `gtm_psg/`) — read via `google-ads-mcp`, write via apps/ads | **shipped at `~/apps/ads/`** | dry-run/execute safety pattern; JSON audit logs; per-client `ops/` + `audits/` + `reports/` |
| **Python worker bridge for ads mutations + Paperclip** | **Vercel Sandbox** (Q3 resolved) | new (v1.2 for ads, v1.6 for Paperclip) | Next.js routes call Vercel Sandbox; preserves dry-run preview → execute UX; same runtime for Paperclip agentic jobs |

### Research Needed

- Migration plan for FileMaker → psg-hub data (ROs, Estimates, Surveys, Production history) — only if v1.3.5 add-on triggered
- Yext API rate limits + incremental sync
- NotebookLM API stability (Master Plan flagged — resilience fallback mandatory)
- SendGrid + Twilio domain setup (SPF, DKIM, DMARC, return-path on `psgweb.me`; sender authentication)
- ~~Invoiced.com API capability for invoice mirroring~~ — **DROPPED (2026-06-18).** Invoicing is Stripe-native; research done (`apps/psg-hub/.paul/research/phase-15-billing-foundation-stripe-spine.md`). Open item: Stripe Invoices API + payment-links surface (Phase 17) + Basil field relocations (`current_period_end`, `invoice.parent.subscription_details`, `invoice.payments`)
- Sanity new project provisioning (Q6 resolved — provision in v0.1) + preview-mode integration with market-intel pages
- Lob.com account setup + address verification quota + webhook config (v1.3)
- In-house print queue design (PDF generator → print partner handoff or local printer pool)

---

## Data Model

Three-layer model:

1. **Inherited from BSM** (already shipped — do not rebuild)
2. **Ported from psg-advantage-portal** (existing market-intel schema, applied to BSM Supabase in v0.3)
3. **New for psg-hub** (RBAC, customer modules, Advantage backbone, Master Plan agentic)

### Layer 1: Inherited from BSM (shipped)

- `profiles` (Supabase Auth-linked) — convention: `profile_id` everywhere
- `shops` — incl. agent config, scheduling, budget, **billing_tier** (`essentials` / `growth` / `performance`)
- `subscriptions` (Stripe-linked)
- `ads_accounts`, `ads_campaigns`, `ads_metrics`
- `content_items`, `content_briefs`, `content_drafts`
- `audit_reports`, `sentiment_reports`
- `agent_configs`
- Sanity content models in `studio/schemaTypes/`

### Layer 2: Ported from psg-advantage-portal (v0.3)

- `body_shops` registry (~842 shops)
- `customer_geography_*` tables + ZIP rollups
- `market_dashboard_rollups`, `market_viewport_intelligence`
- `shop_competitor_overlay`, `shop_list_directory_matches`
- ~~`invoiced_customer_*` shop matching tables~~ — **not needed** under Stripe-native (no Invoiced customer→shop reconciliation). Shop↔Stripe linkage is `shops.stripe_customer_id` (set by the checkout webhook). Drop from the v0.4 data model.
- `psg_sensitive_pii_*` migrations + redaction policies (load-bearing; carry forward)

### Layer 3: New for psg-hub

#### Customer-facing modules (v0.1–v0.4)

| Entity | Key Fields | Purpose |
|--------|-----------|---------|
| `clients` | id, slug (e.g., `wallace`, `tedesco`, `flower-hill`), shop_id, mcc_customer_id (Google Ads), display_name | absorbed from ads-dashboard — per-MCC-client routing |
| `ga4_accounts` | shop_id, ga4_property_id, refresh_token (encrypted), linked_at, last_sync_at, last_sync_status | new (v0.3) |
| `ga4_daily_metrics` | shop_id, date, sessions, users, new_users, pageviews, avg_session_duration_s, bounce_rate, conversion_events_jsonb, traffic_sources_jsonb | new (v0.3) |
| `ga4_top_pages` | shop_id, date, page_path, pageviews, avg_time_on_page_s | new (v0.3) |
| `gsc_accounts` | shop_id, gsc_site_url, refresh_token (encrypted), linked_at, last_sync_at, last_sync_status | new (v0.3) |
| `gsc_daily_metrics` | shop_id, date, impressions, clicks, ctr, avg_position | new (v0.3) |
| `gsc_top_queries` | shop_id, date, query, impressions, clicks, ctr, avg_position | new (v0.3) |
| `gsc_top_pages` | shop_id, date, page_url, impressions, clicks, ctr, avg_position | new (v0.3) |
| `gsc_indexing_status` | shop_id, captured_at, indexed_count, not_indexed_count, errors_jsonb, sitemap_status_jsonb, core_web_vitals_jsonb | new (v0.3) |
| `psg_activity_notes` | id, shop_id, author_profile_id, body_md, occurred_at, kind (`change` / `note` / `milestone`), created_at | "What PSG did" timeline absorbed from ads-dashboard (v0.3) |
| `shop_goals` | shop_id, kind (`cpl_target`, `ctr_target`, `position_target`, etc.), value_numeric, period (`monthly` / `quarterly`), set_at | trend coloring tied to goals (absorbed from ads-dashboard) |
| `shop_users` | profile_id, shop_id, created_at | M:N (MSO support) |
| `roles` | id, slug (`customer` / `psg_internal` / `psg_superadmin`) | seed |
| `user_role_assignments` | profile_id, shop_id (nullable), role_id | composite key |
| `modules` | id, slug, display_name, audience, min_tier_slug, default_visibility | seed registry |
| `module_access_grants` | role_id (nullable), shop_id (nullable), profile_id (nullable), module_id, allow|deny, granted_by, granted_at | overrides; precedence profile > shop > role > tier default |
| `access_audit` | actor_profile_id, target_profile_id/shop_id, action, payload_jsonb, ts | append-only |
| `invoices` | stripe_invoice_id (PK), shop_id, stripe_subscription_id (nullable), status, amount_due, amount_paid, currency, number, hosted_invoice_url, period_start/end | **Stripe-native** invoice mirror (v0.4); upsert by `stripe_invoice_id` from the Stripe webhook |
| `payments` | stripe_payment_intent_id (PK), shop_id, stripe_invoice_id (nullable), status, amount, currency, created_at | **Stripe-native** payment record (v0.4); cleartext financial record (no PAN — Stripe-hosted) |
| `stripe_webhook_events` | event_id (PK), type, api_version, created, payload, received_at, processed_at | inbound webhook idempotency/audit ledger (service-role-only; **already shipped on `origin/main` @ `3a9c113`**, Phase 15-01) |
| `survey_responses` | id, shop_id, repair_customer_id, submitted_at, scores_jsonb, raw_payload (redacted) | promoted from xlsx (v0.3) |
| `sentiment_scores` | shop_id, period_start, period_end, nps, csat, themes_json | derived (v0.3) |

#### Ops backbone (v1.1, from Advantage tech design)

| Entity | Key Fields | Purpose |
|--------|-----------|---------|
| `companies` | id (system-generated unique Shop ID), name, address, phone, contact, status | extends `shops` registry; primary internal ops entity |
| `employees` | id, company_id, name, role, email, phone | shop staff |
| `repair_customers` | id, company_id, first_name, last_name, address, phone, email | end consumers (no login) |
| `repair_orders` | id, repair_customer_id, company_id, ro_number, vehicle_id, insurance_company_id, insurance_agent_id, total_loss_flag, dates_json, payload_jsonb | per-incident |
| `estimates` | id, repair_customer_id, company_id, estimate_number, payload_jsonb | estimate records |
| `import_templates` | id, company_id, kind (`ro` / `estimate`), field_mapping_jsonb, created_at | per-company import mapping (absorbs psg-import logic) |

#### Master data / SysConfig (v1.1, from Advantage)

| Entity | Key Fields |
|--------|-----------|
| `products` | id, name, description, items_jsonb, total_cost_cents, selling_price_cents |
| `items` | id, name, description, requirements_jsonb, cost_cents |
| `vehicles` | id, make, model |
| `insurance_companies` | id, name |
| `insurance_agents` | id, insurance_company_ids[], name, address, email, phone, mobile, fax, contacts_jsonb |
| `company_programs` | id, company_id, product_id, quantity, unit_price_cents, customizations_jsonb (logo, header, footer, greeting) | shop ↔ product enrollment with overrides |

#### Production module (v1.2, PSG core revenue)

| Entity | Key Fields |
|--------|-----------|
| `production_batches` | id, name (unique), created_by_profile_id, created_at, product_ids[], company_ids[] (nullable for all-companies), status (`pending` / `printed`) |
| `production_documents` | id, batch_id, print_id (unique), company_id, product_id, repair_customer_id, status (`unprinted` / `printed`), printed_by_profile_id, printed_at, payload_jsonb |
| `production_reprint_log` | document_id, reprinted_by_profile_id, reprinted_at | audit |
| `mail_vendor_jobs` | document_id, vendor (`lob` / `inhouse`), external_job_id, status, ts | dual-adapter (Q4 resolved) |
| `sms_jobs` | id, recipient_phone, body, twilio_sid, status, error, ts | Twilio outbound log |
| `email_jobs` | id, recipient_email, template_id, sendgrid_message_id, status, error, ts | SendGrid outbound log |

#### Ads Mutation Studio (v1.2, from `apps/ads/`)

| Entity | Key Fields |
|--------|-----------|
| `ads_mutations` | id, shop_id, customer_id (Google Ads), mutation_kind, params_jsonb, status (`drafted` / `dry_run_complete` / `executed` / `failed`), created_by_profile_id, executed_at, audit_log_path | tracks every mutation initiated from hub |
| `ads_mutation_dry_runs` | mutation_id, before_state_jsonb, projected_after_state_jsonb, generated_at | preview state |
| `ads_audit_logs` | mutation_id, before_state_jsonb, after_state_jsonb, ts, executor_profile_id, file_ref | mirrors `apps/ads/logs/` JSON |
| `gtm_mutations` | id, shop_id, gtm_container_id, mutation_kind, params_jsonb, status, created_by_profile_id, executed_at | mirrors GTM mutation pattern |
| `client_audits` | id, shop_id, kind, generated_at, payload_path | mirrors `apps/ads/audits/{client}/` |
| `client_reports` | id, shop_id, kind, generated_at, pdf_path, asset_paths_jsonb | mirrors `apps/ads/reports/{client}/` |
| `python_worker_jobs` | id, kind, params_jsonb, status, started_at, finished_at, stdout_path, stderr_path, exit_code | observability for Python worker calls |

#### Internal-only (v1.6, Master Plan)

| Entity | Key Fields |
|--------|-----------|
| `consolidators` | slug, display_name, member_brands_json | seed: Caliber, Gerber (incl. Joe Hudson), Crash Champions |
| `competitor_scores` | shop_id, target_shop_id, distance_m, consolidator_slug, rating, count, has_website, rank, computed_at | |
| `yext_accounts` | shop_id, yext_account_id, api_key_ref, last_sync_at, last_sync_status | PSG clients only |
| `yext_listings_cache`, `yext_reviews_cache` | shop_id, payload_jsonb, cached_at, ttl_at | 30-day cache |
| `weather_correlations` | zip_code, period_start, period_end, precipitation_mm, accident_count, correlation_score, cached_at | Meteostat × accident_stats |
| `llm_routing_log` | request_id, task_type, provider, model, prompt_hash, tokens_in, tokens_out, latency_ms, status, ts | observability |
| `notebooklm_query_log` | request_id, notebook_id, query, ts, status, fallback_used | observability + fallback tracking |
| `reports` (agentic) | id, shop_id, title, generated_by_profile_id, status, html_url, pdf_url, sections_jsonb, created_at | RLS: psg_internal+ only |

#### Security profiles (v1.1, from Advantage)

| Entity | Key Fields |
|--------|-----------|
| `security_profiles` | id, name, is_builtin, functions_jsonb (e.g., `manage_companies`, `manage_users`, `manage_reports`, `manage_production`) | extends RBAC with fine-grained function flags for ops users |
| `user_security_profile_assignments` | profile_id, security_profile_id | per-user assignment |

### Notes

- BSM convention `profile_id` (not `user_id`) — honor across all new tables
- All customer-facing tables RLS-clamped to `shop_id IN authorized shops`
- Ops-backbone tables have RLS gated by `roles + security_profiles.functions_jsonb` for psg_internal users; psg_superadmin bypasses
- PII tables follow existing `psg_sensitive_pii_*` patterns
- OAuth refresh tokens encrypted at rest (pgsodium)
- Internal Master Plan tables RLS: psg_internal+ only

---

## API Surface

### Inherited from BSM (shipped — extend as needed)

- `/api/me`, `/api/ads/google/*`, `/api/billing/{checkout,portal}`, `/api/webhooks/stripe`, `/api/content/[id]/{approve,reject,publish}`

### Ported from psg-advantage-portal (v0.3)

- `/api/shops/[shopId]/{overview,competitors,trend,market-map,customer-geography}`, `/api/markets/dashboard`, `/api/network/{summary,trend,alerts}`, `/api/flower-hill`

### Customer-facing additions (v0.2–v0.4)

- `/api/shops/[shopId]/{invoices,invoices/[id]}` — v0.4 (read from the Stripe-native `invoices` mirror; "pay" is a Stripe hosted-invoice / payment-link redirect, not an in-app charge route)
- `/api/shops/[shopId]/{surveys,sentiment}` — v0.3
- `/api/shops/[shopId]/{ga4,gsc}/{summary,daily,top-queries,top-pages,indexing,cwv}` — v0.3 (new GA4 + GSC)
- `/api/shops/[shopId]/marketing/{summary,ads,ga4,gsc,combined}` — v0.3 (unified marketing surface)
- `/api/shops/[shopId]/activity-notes` — v0.3 (absorbed from ads-dashboard "What PSG did" timeline)
- `/api/shops/[shopId]/goals` — v0.3 (absorbed from ads-dashboard goals for trend coloring)
- `/api/shops/[shopId]/report/[month]` — v0.3 (monthly print-styled report, absorbed from ads-dashboard)
- `/api/shops/[shopId]/report/[month]/export` — v0.3 (PDF export)
- `/api/integrations/ga4/oauth/{init,callback}` — v0.3
- `/api/integrations/gsc/oauth/{init,callback}` — v0.3
- ~~`/api/webhooks/invoiced` — v0.4~~ — **DROPPED.** Single billing webhook is `/api/webhooks/stripe` (BSM-shipped; hardened in Phase 15-01, extended for `invoice.*` + `payment_intent.*` in v0.4)
- `/api/webhooks/sendgrid` — v0.1 (bounce/spam/delivery events)
- `/api/webhooks/twilio` — v0.1 (SMS delivery + inbound)
- `/api/webhooks/lob` — v1.3 (Lob mail status)

### Ops backbone (v1.1, from Advantage)

- `/api/companies` (list / create), `/api/companies/[id]` (get/update/delete), `/api/companies/[id]/employees`, `/api/companies/[id]/programs`, `/api/companies/[id]/import-ros`
- `/api/repair-customers`, `/api/repair-customers/[id]`
- `/api/repair-orders`, `/api/repair-orders/[id]`, `/api/repair-orders/import`
- `/api/estimates`, `/api/estimates/[id]`, `/api/estimates/import`
- `/api/surveys`, `/api/surveys/[id]` (entry + view)
- `/api/sys-config/{products,items,vehicles,insurance-companies,insurance-agents}` (CRUD each)
- `/api/import-templates`, `/api/import-templates/[id]`

### Ads Mutation Studio (v1.2, from `apps/ads/`)

- `/api/ops/ads/mutations` (list/create), `/api/ops/ads/mutations/[id]` (get)
- `/api/ops/ads/mutations/[id]/dry-run` (POST — invoke Python worker with `--dry-run`)
- `/api/ops/ads/mutations/[id]/execute` (POST — invoke Python worker with `--execute`; writes audit)
- `/api/ops/ads/audit-logs` (list/filter), `/api/ops/ads/audit-logs/[id]` (download)
- `/api/ops/ads/clients/[shopId]/{audits,reports}` — per-client artifact browse
- `/api/ops/gtm/mutations` (list/create), `/api/ops/gtm/mutations/[id]/{dry-run,execute}`
- `/api/internal/python-worker/jobs` (observability)

### Production (v1.3)

- `/api/production/batches` (list/create), `/api/production/batches/[id]` (get/print/delete)
- `/api/production/documents/[id]` (get / reprint / delete)
- `/api/production/generate` (POST — kick off batch generation with product_ids + company_ids)
- `/api/production/historical` (search/filter historical)
- `/api/webhooks/mail-vendor` (signature verified)

### Reports (v1.4)

- `/api/reports/[reportSlug]` — 26 endpoints for the named operational reports, parameterized by date range + filters
  - `processing-recap`, `invoicing-recap`, `reprint-recap`, `pay-type-analysis`, `vehicle-analysis-make`, `vehicle-analysis-model`, `referral-directory`, `recap-trailing`, `agent-capture`, `agent-sales`, `claims-review`, `audit`, `name-recap-by-shop`, `referral-comparison`, `monthly-csi-display`, `performance-dashboard`, `market-dashboard`, `estimator-csi`, `body-tech-performance`, `painter-performance`, `survey-alert-recap`, `rental-car-analysis`, `perfect-score`, `mis-fire`, `hot-spot`, `unresolved-issue`, `referral-noted`

### Admin (v1.5)

- `/api/admin/{users,roles,modules,module-access,tier,security-profiles,audit}` — psg_superadmin

### Internal-only agentic (v1.6)

- `/api/internal/shops/[shopId]/{competitors,yext,weather-correlation}`
- `/api/internal/reports` (agentic synthesis), `.../[id]`, `.../generate`
- `/api/internal/llm-router`

### Cron (declared in `vercel.ts`)

- `/api/cron/{ads-sync,ga4-sync,gsc-sync,presence-snapshot,survey-ingest,yext-sync,competitor-recompute,weather-refresh,sentiment-aggregate,production-batch-status,mail-vendor-poll}`
- **Note:** `ads-sync` keeps the existing ads-dashboard 6h cadence via Python `apps/ads/googleads_psg/` writer; GitHub Actions can migrate to Vercel Cron in v0.3 or stay on Actions

---

## Deployment Strategy

### Local Development

| Service | Image/Runtime | Port | Source |
|---------|--------------|------|--------|
| psg-hub | Node 24 (`next dev`) | 3001 | inherits BSM dashboard scripts |
| Sanity Studio | Node 24 (`sanity dev`) | 3333 | BSM `studio/` |
| Supabase | hosted (shared dev project) | n/a | existing |
| Redis | Docker (`redis:7`) | 6379 | existing |
| Paperclip | per `paperclip.config.json` | varies | existing BSM |
| Lob.com sandbox | Lob test mode | n/a | v1.3 |
| SendGrid + Twilio | shared dev account | n/a | v0.1 |

Workspace root: `apps/psg/`. Hub at `apps/psg/apps/psg-hub/`. `pnpm dev --filter=psg-hub` from root.

### Staging / Production

- **Vercel project:** existing `psg-advantage-portal` project re-linked to `apps/psg/apps/psg-hub/`, renamed `psg-hub`. BSM's existing Vercel project decommissioned.
- **Production URL:** `hub.psgweb.me`
- **Preview:** automatic per PR
- **Env:** `vercel env` per environment; BSM existing env vars migrate into renamed project
- **Cron:** declared in `vercel.ts`
- **Runtime:** Fluid Compute on Node 24
- **Email:** SendGrid (transactional + auth + customer); verified domain `psgweb.me` + SPF/DKIM/DMARC + sender authentication (Q4 resolved)
- **SMS:** Twilio (transactional reminders, survey + production status, optional auth fallback); PSG number verified (Q4 resolved)
- **Sanity:** **new Sanity project** provisioned in v0.1 — single production dataset (Q6 resolved)
- **Paperclip:** runs on **Vercel Sandbox** alongside ads Python worker (Q7 resolved — matches Q3 runtime)
- **Python worker (`apps/ads/` mutations + Paperclip):** **Vercel Sandbox** (Q3 resolved). Invoked from psg-hub Node routes for dry-run + execute. JSON audit log persisted to Supabase Storage + mirrored to `ads_audit_logs`.
- **Mail vendor:** **Lob.com adapter + in-house print queue adapter** ship in v1.3 (dual; vendor selected per template or shop)
- **`psg-import` deployment:** stays a separate Vercel project until v1.1, then absorbed
- **`psg-data-lake` deployment:** Python ETL stays as-is

---

## Security Considerations

- **Auth/Authz model:**
  - Supabase Auth + custom JWT claims (`shop_ids[]`, `role`, `tier_per_shop`, `security_profile_id`)
  - Three roles: `customer`, `psg_internal`, `psg_superadmin`
  - Billing tier gating on customer modules (Essentials / Growth / Performance)
  - Security profiles fine-grain ops permissions (extends RBAC for psg_internal)
  - Module-level access via `module_access_grants` — superadmin-editable
  - Two-layer enforcement: middleware + Postgres RLS
- **Multi-tenancy:** every customer table RLS-clamped to `shop_id IN authorized shops`
- **Ops access:** RLS for ops tables gated by `security_profiles.functions_jsonb` for psg_internal
- **Input validation:** Zod schemas on every route handler
- **OWASP:** IDOR (RLS + tier + security profile check), Broken Access Control (defense in depth), Sensitive Data Exposure (PII redaction), SSRF (allowlisted adapters)
- **Secrets:** `vercel env` only. OAuth refresh tokens + insurance/mail vendor keys encrypted (pgsodium). Strip `.env.local` from git history at consolidation.
- **Rate limit:** Redis token bucket per shop_id (customer) and per profile_id (admin/ops)
- **Webhooks:** Stripe (subscriptions + invoices + payments) + mail vendor — signature-verified, idempotent via `stripe_webhook_events.event_id` (ON CONFLICT DO NOTHING; reprocess-safe on mid-processing failure). Invoiced webhook dropped.
- **Audit log:** `access_audit` append-only; production reprints logged separately
- **PII compliance:** carry forward `psg_sensitive_pii_*` migrations; PII review before customer launch; end-consumer PII (repair_customers) treated as high-sensitivity
- **Vercel BotID:** on auth + payment endpoints
- **Agent budgets + governance:** Paperclip enforces per-agent budgets, approval gates, audit trails (already shipped in BSM)
- **Resilience patterns:** retry + circuit breaker on every external call; no bare `catch (e)` swallows; 30s Playwright timeouts with fallback

---

## UI/UX Needs

### Design System

**Source of truth:** `github.com/Phoenix-Solutions-Group/design-system`. Vendored as git submodule under `apps/psg/packages/ui/psg-brand/`. **Strict conform** — no extensions.

- Colors: Midnight `#1E3A52`, Ember `#B8483E`, Slate `#4A4257`, Paper `#FAF8F5`
- Type: Gotham (headings, max weight Medium 500) + Didact Gothic (body 16px, lh 1.65)
- Voice: understated luxury, no emoji, em-dashes welcome, sentence case for body/UI labels
- Geometry: 6px corners default, square-leaning, pill only for tags/badges
- Motion: `cubic-bezier(0.22, 0.61, 0.36, 1)`, 140/220/420ms

BSM's existing oklch tokens get replaced with brand submodule tokens in v0.1. Anchor's local `DESIGN-SYSTEM.md` retired.

### Key Views by Audience

**Customer-facing** (`/dashboard/*`)
- `/dashboard` — post-login routing
- `/dashboard/content` (BSM-shipped) — review/approve/publish
- `/dashboard/ads` (BSM-shipped, tier=performance) — Google Ads
- `/dashboard/reputation` (BSM-shipped)
- `/dashboard/billing` (BSM-shipped)
- `/dashboard/shop/[shopId]/{overview,marketing,presence,sentiment,invoices,market-map,customer-geography,competitors}` — v0.2–v0.4
- Shop switcher (top bar)

**Internal ops** (`/ops/*`) — psg_internal + security profile
- `/ops/companies` (list, search, export, sort, paginate)
- `/ops/companies/[id]` (details, employees, programs, import RO link)
- `/ops/companies/[id]/employees`
- `/ops/companies/[id]/programs`
- `/ops/companies/[id]/import` (RO/Estimate import wizard with template-aware field mapping)
- `/ops/repair-customers`, `/ops/repair-customers/[id]` (with Add New RO, Add Additional Document, Preview, Cancel actions)
- `/ops/repair-orders`, `/ops/repair-orders/[id]` (list, import, add new, filter, sort, search)
- `/ops/estimates`, `/ops/estimates/[id]`
- `/ops/surveys`, `/ops/surveys/[id]` (entry + view)
- `/ops/production` (Outlook-inspired layout — batch list left, document list right)
- `/ops/production/historical` (basic + advanced search)
- `/ops/production/new` (batch creation wizard)
- `/ops/reports` (index of 26 reports)
- `/ops/reports/[reportSlug]` — parameterized
- `/ops/sys-config/{products,items,vehicles,insurance-companies,insurance-agents}` (CRUD)
- `/ops/data-import/{ros,estimates}` (alternate entry points)

**Ads Mutation Studio** (`/ops/ads/*`, `/ops/gtm/*`) — psg_internal + security profile (v1.2)
- `/ops/ads/clients` — per-client landing (flower-hill, wallace, tedesco, koffman-auto-works, etc., mapped to shop_id)
- `/ops/ads/clients/[shopId]` — client detail with mutations, audits, reports tabs
- `/ops/ads/mutations` — list all mutations across clients with filter
- `/ops/ads/mutations/new` — pick mutation kind, choose client (customer_id required), enter params
- `/ops/ads/mutations/[id]/preview` — dry-run JSON diff view (before vs projected after); confirm → execute
- `/ops/ads/mutations/[id]/audit` — execution audit log + diff
- `/ops/ads/audit-browser` — searchable audit log archive
- `/ops/ads/clients/[shopId]/reports` — per-client PDF reports
- `/ops/gtm/mutations` — same pattern as Ads but for GTM
- `/ops/python-worker/jobs` — observability for Python worker calls

**Internal agentic** (`/internal/*`) — psg_internal + (v1.6)
- `/internal/{market-command,marketing-intelligence,flower-hill}` — ported from advantage-portal
- `/internal/shops/[shopId]/{competitors,intelligence}` — v1.5
- `/internal/reports`, `/internal/reports/[id]`, `/internal/reports/new` — agentic synthesis + PDF

**Admin** (`/admin/*`) — psg_superadmin
- `/admin/users`, `/admin/shops`, `/admin/modules`, `/admin/security-profiles`, `/admin/tier`, `/admin/audit`

### Real-Time Requirements

- Not real-time for MVP; polling + cron + webhooks sufficient
- Production batch status: webhook from mail vendor + polling fallback
- Report generation: async job + polling (v1.5)

### Responsive Needs

- Customer routes: responsive desktop + tablet + mobile
- Ops routes: desktop-first; tablet OK; mobile not optimized (PSG ops team uses desktops)
- Internal agentic routes: desktop-first
- Admin routes: desktop-first

### Shop switcher

Top-bar selector for users with multiple authorized shops. URL pattern `/dashboard/shop/[shopId]/...`. Search box when >10 shops. v0.2.

---

## Integration Points

| Integration | Type | Purpose | Status | Milestone |
|------------|------|---------|--------|-----------|
| Supabase | DB + Auth + Storage | core | shipped | already live |
| Postgres direct (`pg`) | DB | heavy reads + reports | shipped in advantage-portal | port in v0.3 |
| Redis | cache + rate limit | perf | shipped in advantage-portal | port in v0.1 |
| PSG design system | git submodule | brand | new | v0.1 |
| Stripe (PSG MOR — single account) | API + webhook | billing — subscriptions **+ invoices/payments** | **shipped in BSM** | v0.4 extends the webhook to `invoice.*` + `payment_intent.*` and surfaces Stripe Invoices/payment-links (Stripe-native; Invoiced.com dropped) |
| Google Ads API v17+ (read-side) | API + per-shop OAuth | ads metrics | **shipped in BSM** | extend in v0.2 |
| **Google Ads API (write/mutations)** | Python SDK via `apps/ads/googleads_psg/` | conversion actions, neg keywords, bidding, ad group restructures, sitelinks, callouts, etc. | **shipped at `~/apps/ads/`** | surface in v1.2 (Ads Mutation Studio) |
| **Google Tag Manager API (mutations)** | Python SDK via `apps/ads/gtm_psg/` | GTM container mutations | **shipped at `~/apps/ads/`** | surface in v1.2 |
| **google-ads-mcp** (read-side MCP) | MCP server | AI/agent ads queries | exists per `apps/ads/README.md` | leverage in v1.6 multi-LLM router |
| SEMrush | API | SEO data | **shipped in BSM** | extend in v0.3 |
| Firecrawl MCP | API | scrape + design extract | **shipped in BSM** | leverage in v0.3 |
| Sanity | content store | agent output + mail-merge templates | **new project provisioned in v0.1** (Q6 resolved); studio code from BSM | provision v0.1; extend schema v0.3 and v1.3 |
| Paperclip AI | orchestration | budgets/governance/approvals | **shipped in BSM** | extend in v1.5 for LLM router |
| Claude Flow | agent runtime | spawning/memory/hooks | **shipped in BSM** | extend in v1.5 |
| Anthropic SDK | API | agent writing + internal synthesis | **shipped in BSM** | extend in v1.5 |
| SendGrid | transactional email | branded auth + customer emails + receipts | existing PSG account | v0.1 (Q4 resolved — replaces prior Resend pick) |
| Twilio | SMS | survey reminders + production status + auth fallback | existing PSG account | v0.1 |
| Google Business Profile | API + per-shop OAuth | rank + reviews | new | v0.3 |
| ~~Invoiced~~ | ~~API + webhook~~ | ~~invoice mirror~~ | **DROPPED 2026-06-18** | invoicing is Stripe-native (see Stripe row) |
| Survey data (xlsx) | data promotion | post-repair follow-up | new | v0.3 |
| **Vercel Sandbox (Python worker)** | runtime | invoke apps/ads + apps/gtm mutations from hub; Paperclip agentic runs | new | v1.2 (ads), v1.6 (Paperclip) — Q3 + Q7 resolved |
| **GA4 Data API** | API + per-shop OAuth | sessions, users, conversions, traffic | new | v0.3 |
| **Google Search Console API** | API + per-shop OAuth | impressions, clicks, queries, indexing, CWV | new | v0.3 |
| **ads-dashboard (absorbed)** | code | story-led narrative UI, "What PSG did" timeline, monthly PDF, goals trend coloring | shipped at `~/apps/ads-dashboard/` | folded into v0.3 |
| **local_reach (deprecated)** | code | PHP+React SEO content gen; replaced by BSM agents | shipped at `~/apps/projects/local_reach/` | archived in v0.1; deprecated through BSM agent migration |
| **Lob.com** | API + webhook | Production mail (primary outbound) | new | v1.3 (Q4 resolved) |
| **In-house print queue** | local adapter | Production mail (printed in PSG facility) | new | v1.3 (Q4 resolved) |
| **BigQuery** | DB | internal warehouse | partial via psg-data-lake | v1.6 |
| **Yext** | API | listings + reviews for PSG clients | new | v1.6 |
| **Meteostat** | API | weather correlation | new | v1.6 |
| **OpenAI** | API | extraction (internal) | new | v1.6 |
| **Gemini** | API | sentiment (internal) | new | v1.6 |
| **Perplexity** | API | search (internal) | new | v1.6 |
| **NotebookLM** | unofficial API | PSG IP grounding | new | v1.6 |
| **Playwright** | runtime | print-to-PDF (agentic reports + Production docs) | new | v1.3 + v1.6 |
| Pipedrive | API | (deferred) | none | v2.0+ |
| Google Analytics 4 | API | (deferred) | none | v2.0+ |

**Failure handling:** each integration table has `last_sync_at` + `last_sync_status`. UI shows stale banners. Cron retries exponential backoff. NotebookLM falls back to plain Claude on session expiry. Mail vendor failures requeue with circuit breaker.

---

## Release Strategy

```
v1.0 — Customer-Facing Launch  (paid customers can log in)
    ├── v0.1 Foundation
    ├── v0.2 Customer MVP
    ├── v0.3 Customer Analytics
    └── v0.4 Invoicing + Payments

v1.1 — Ops Foundation          (PSG account managers start using internally)
v1.2 — Ads Mutation Studio     (surfaces apps/ads/ + apps/gtm mutations in hub UI)
v1.3 — Production Module       (retires FileMaker for daily mail production)
v1.4 — Operational Reports     (26 named reports live)
v1.5 — Superadmin Matrix       (full admin control + security profiles)
v1.6 — Internal Agentic Intel  (Master Plan modules live)

v2.0 — Convergence + Hardening (final E2E, AEGIS, PII audit, Pipedrive, GA4)
```

Customer track and internal-ops track run **sequentially** (single delivery team). FileMaker stays in production until v1.2 cutover.

---

## Milestone Breakdown

> BSM PAUL preserved as foundation. BSM Phases 1–5 already complete (Agent engine, Internal ops, Content preview/approval, Customer-facing MVP shell, Reputation + Ads). psg-hub starts at v0.1.

---

### Milestone v0.1 — Foundation
**Goal:** Working monorepo with BSM as anchor; brand tokens live; kill list retired; **all in-scope PSG repos relocated under `apps/psg/`**; foundation for both customer and ops tracks.

**Phases:**
1. **Workspace consolidation + multi-repo relocation** — pnpm + Turbo + root configs; **move into `apps/psg/apps/*`:** BSM dashboard (→ `apps/psg-hub/`), ads-dashboard (→ `apps/psg-hub/` later in v0.3), `apps/ads/` (→ `apps/psg-ads-mutations/` Python worker), psg-advantage-portal (source for v0.3 port, not relocated yet); **move into `apps/psg/packages/*`:** BSM siblings (`studio/`, `integrations/`, `onboarding/`, `preview/`, `shops/`); **move into `apps/psg/archive/`:** local_reach (deprecation target, BSM agents replace); retire kill list (`invoice/`, `portal/`, `sst-psgdigital/`, `web-dev-skills/`, `dashboard-psgdigital/`, `shop-theacrb/`, `invoice-psgdigital/`); relocate non-code (`psg/` Obsidian, `pipedrive/` audit files) outside repo
2. **Design system submodule + brand token swap** — vendor PSG design system as `packages/ui/psg-brand/`; replace BSM's oklch vars with brand tokens; retire psg-advantage-portal's local DESIGN-SYSTEM.md; reconcile ads-dashboard's existing PSG-token-overridden shadcn with submodule
3. **SendGrid + Twilio + Sanity + Vercel re-link** — SendGrid transactional email (auth + customer + receipts); Twilio SMS (reminders + auth fallback); SPF/DKIM/DMARC + sender auth on `psgweb.me`; provision new Sanity project + single production dataset (Q6); rename Vercel project from psg-advantage-portal to psg-hub; **decommission BSM Vercel project** (Q5); preserve env vars + analytics history; ads-dashboard Vercel kept for read-only access until v0.3 absorption complete
4. **PAUL inheritance + tracking** — preserve BSM PAUL state; preserve ads-dashboard PAUL state (Phase 1 foundation); initialize new psg-hub PAUL on top; update ACTIVE.md and tracking
5. **local_reach client output archive** — copy active client outputs (`tracys-research-v3/`, `new-tracys-report-v2/`, etc.) to `apps/psg/archive/local_reach-outputs/` for migration reference during BSM agent runs

**Testable:** `pnpm install` from root; `turbo run build --filter=psg-hub` succeeds; BSM tests pass; ads-dashboard build still works in isolation pre-v0.3 absorption; design system CSS loads; Vercel preview renders `hub.psgweb.me` staging; magic-link arrives from PSG-branded sender
**Ships to:** foundation only (no users)

---

### Milestone v0.2 — Customer MVP
**Goal:** Existing BSM customer surfaces gated by role + tier; shop switcher; first pilot shops log in.

**Phases:**
1. **RBAC tables + tier gating + module registry** — `roles`, `user_role_assignments`, `modules`, `module_access_grants`, `access_audit`, `shop_users`; Supabase auth hook for custom claims; middleware updated
2. **Shop switcher + URL pattern** — top-bar selector; URL `/dashboard/shop/[shopId]/...`
3. **Superadmin bootstrap** — seed Nick (`nick@phoenixsolutionsgroup.net`), Tina (`tina@phoenixsolutionsgroup.net`), Brian (`bfinn@phoenixsolutionsgroup.net`); migrate existing BSM users to `customer` role
4. **Customer launch hardening** — Playwright E2E on auth + content + ads happy path; A11y (WCAG AA); LCP <2s on `/dashboard`; AEGIS audit; PII review; gitleaks

**Testable:** test users in each role/tier see correct module set; RLS denies cross-shop reads; MSO user switches between shops cleanly; pilot can onboard
**Ships to:** first pilot cohort (N shops TBD)

---

### Milestone v0.3 — Customer Analytics (absorbs ads-dashboard, adds GA4 + GSC)
**Goal:** Single unified marketing surface per shop: Google Ads + GA4 + Search Console + presence + sentiment + market intel + monthly PDF reports + "What PSG did" timeline. Absorbs `apps/ads-dashboard/` codebase wholesale. Story-led narrative UI preserved.

**Phases:**
1. **ads-dashboard plans + concepts absorption** (D70 — reframed from prior wholesale-code absorption) — copy `~/apps/ads-dashboard/.paul/{PROJECT.md,ROADMAP.md,SPECIAL-FLOWS.md,phases/01-foundation/*}` into psg-hub PAUL as v0.3 source-material reference; **build fresh in hub** (BSM-anchored Next 16 already supersedes ads-dashboard's Next 15 scaffold) at `/dashboard/shop/[shopId]/marketing`: route group, story-led narrative copy (no UI exists yet — design in PAUL plan), "What PSG did" timeline (`psg_activity_notes` schema), goals-based trend coloring (`shop_goals` schema), monthly print-styled report (`/dashboard/shop/[shopId]/report/[month]` + `/export` endpoint); seed pilot client identities (Wallace 6048611995, Tedesco 7763526490, Tracy's per D61); preserve Flower Hill data definitions for later; **archive `~/apps/ads-dashboard/` repo + Vercel project**; close out ads-dashboard GitHub repo with redirect/README pointing to psg-hub
2. **Market intel port from psg-advantage-portal** — `(dashboard)/{shops,customer-geography,flower-hill,market-map,marketing-intelligence,market-command}/` pages; `api/{shops,markets,network,customer-geography,market-map,flower-hill}/` routes; `lib/{supabase,postgres}/` helpers; **upgrade Next 15 → Next 16**
3. **Migration apply** — apply all 30+ `psg-advantage-portal/supabase/migrations/` to shared Supabase project `gylkkzmcmbdftxieyabw`; resolve conflicts with BSM + ads-dashboard schemas; preserve PII patterns; reconcile auth identities (ads-dashboard + BSM + local_reach + psg-advantage-portal users already share project)
4. **GA4 integration** — per-shop OAuth; `ga4_accounts`, `ga4_daily_metrics`, `ga4_top_pages`; nightly sync cron `/api/cron/ga4-sync`; sessions/users/conversions/traffic-sources/top-pages UI; integrate into shop marketing summary
5. **Search Console integration** — per-shop OAuth; `gsc_accounts`, `gsc_daily_metrics`, `gsc_top_queries`, `gsc_top_pages`, `gsc_indexing_status`; nightly sync cron `/api/cron/gsc-sync`; impressions/clicks/CTR/position UI + top queries + top pages + indexing/sitemap status + Core Web Vitals tile
6. **Unified marketing summary** — combined Ads + GA4 + GSC at `/dashboard/shop/[shopId]/marketing`; cross-source KPI summary; story-led narrative generator extended to read all three sources; goals-based trend coloring across all metrics
7. **Digital presence** — GBP OAuth per shop; SEMrush light pull; `digital_presence_snapshots` + weekly cron; rank/reviews/citations UI
8. **Post-repair sentiment** — `psg-data-lake` script promotes `Export/advatange-survey-responses*.xlsx` → `survey_responses`; aggregation cron for `sentiment_scores`; customer-scoped survey list + NPS/CSAT trend UI

**Testable:** **Pilot cohort (Wallace + Tedesco + Tracy's)** see unified Ads + GA4 + GSC dashboard at `/dashboard/shop/[shopId]/marketing` with narrative copy; monthly PDF report exports cleanly; brand audit clean; presence + sentiment surfaces show live data; ads-dashboard standalone Vercel decommissioned. Flower Hill data preserved in absorbed code (not in pilot).
**Ships to:** **v1.0 pilot cohort (Wallace + Tedesco + Tracy's)** — D61

---

### Milestone v0.4 — Invoicing + Payments  *(Stripe-native — reworked 2026-06-18, [PSG-56](/PSG/issues/PSG-56))*
**Goal:** A collision-repair shop sees and pays everything it owes PSG — one-off invoices **and** the recurring platform subscription — all **Stripe-native**, then the v1.0 launch-readiness gates close. Invoiced.com is dropped (operator decision 2026-06-18): Stripe is already wired here, so Stripe-native invoicing is cheaper and removes a whole external integration + reconciliation surface.

**Money-before-M3 invariant:** billing *builds* in Phases 15-17; live charge acceptance *activates* only at the Phase-18 launch gate (after M3 reproducible deploy). No real customer money before reproducible deploy.

**Phases** (mapped to the PAUL Phase 15-18 plan map on `apps/psg-hub/.paul/`):
1. **Phase 15 — Billing foundation + Stripe spine** — harden the inherited Stripe webhook: inbound `stripe_webhook_events` idempotency table, S3 `.insert()`→`.upsert()` fix, Basil `current_period_end` fix, resilience-wrapped outbound calls, vestigial `shops.subscription_tier` reconcile. **15-01 webhook spine SHIPPED on `origin/main` @ `3a9c113`** (build-local, zero prod contact). Plus the Stripe-native `invoices` + `payments` data model + PII-at-rest (reuse AES-256-GCM util; 7-yr IRS retention, redact-don't-delete).
2. **Phase 16 — Subscription self-serve** — *harden + reconcile + prod-validate* the BSM-shipped Stripe Checkout + Billing Portal (NOT greenfield, NOT "done"); wire to `src/lib/tier/gate.ts`.
3. **Phase 17 — Stripe-native invoices + payment links** — surface/mirror **Stripe Invoices** (no Invoiced.com); extend the webhook for `invoice.{created,finalized,paid,payment_failed}` + `payment_intent.{succeeded,payment_failed}`; invoice list + detail UI + Stripe hosted-invoice / payment-link CTA.
4. **Phase 18 — Launch readiness (v1.0)** — M3 reproducible deploy, S6 Gotham/Typekit license, S2 pilot onboarding; flip live charge acceptance on.

**Testable:** Stripe webhook is idempotent (redelivery = zero net rows; mid-processing failure reprocesses); a shop sees its Stripe invoices + subscription and can pay via Stripe-hosted flows; subscription tier-gate reflects the live Stripe state; no PAN ever touches the DB; BSM subscription flow unbroken.
**Ships to:** **v1.0 customer launch** — public-facing

> **Reconciliation note (PSG-56):** the earlier Invoiced.com invoicing vertical built on the ops track (`src/lib/invoiced/`, `/api/webhooks/invoiced`, `/dashboard/invoices`, `/api/shops/[shopId]/invoices/[id]/pay`, migration `20260618120000_invoices_and_payment_events.sql`) is **superseded** by this Stripe-native direction and the pushed Phase 15 spine. It must be reworked, not extended. The two git histories (local ops track ↔ `origin/main` billing track) have **diverged** and conflict on `webhooks/stripe/route.ts`, the billing migrations, and `.paul/` tracking — reconciliation is gated on the push-credential blocker [PSG-25](/PSG/issues/PSG-25). See child issues spun from PSG-56.

---

### Milestone v1.1 — Ops Foundation
**Goal:** PSG account managers can run shop / RO / Estimate / Survey management in-hub. FileMaker still authoritative; this is parallel + dual-entry until v1.2.

**Phases:**
1. **Companies + Employees + Programs** — `companies`, `employees`, `company_programs`, `products`, `items`; list/detail/CRUD; per-company product enrollment with overrides (logo, header, footer)
2. **Repair Customers + ROs** — `repair_customers`, `repair_orders`; list/detail/add-new/filter/sort/search; preview + cancel + add-additional-document workflows
3. **Estimates** — `estimates`; list/detail
4. **Surveys (entry + view)** — extend existing survey schema for data entry; survey list + detail
5. **System Configuration master data** — `vehicles`, `insurance_companies`, `insurance_agents`; CRUD for each
6. **RO / Estimate Import (absorb psg-import)** — `import_templates`; per-company field mapping; file upload (xlsb/xlsx/csv/txt); validation against template; absorb psg-import's address validation + smart-resolution logic; retire `psg-import/` as separate app
7. **Security Profiles** — `security_profiles`, `user_security_profile_assignments`; built-in Administrator profile; function flags (manage_companies, manage_users, manage_reports, manage_production, etc.); merge into RBAC middleware
8. **Ops navigation + tests** — `/ops/*` route group; Playwright E2E on 1 ops happy path (create company → add employees → import RO)

**Testable:** PSG account manager creates company, employees, programs; imports ROs from xlsx; enters survey data; security profile gates ops functions correctly
**Ships to:** PSG ops team (parallel run with FileMaker)

---

### Milestone v1.2 — Ads Mutation Studio
**Goal:** PSG strategy team executes Google Ads + GTM mutations from psg-hub UI with dry-run preview, audit trail, per-client artifact browse. Surfaces existing `apps/ads/` work (which is shipped + actively used as of May 2026) without throwing it away.

**Phases:**
1. **Python worker bridge on Vercel Sandbox** (Q3 resolved) — wire Next.js route → Vercel Sandbox invocation; `python_worker_jobs` observability table; stdout/stderr persistence to Supabase Storage; timeout + circuit breaker per Master Plan resilience pattern
2. **Mutation registry + dry-run preview** — surface every mutation kind in `apps/ads/googleads_psg/mutations/` + `apps/ads/gtm_psg/mutations/` as catalog; mutation creation form (pick kind, customer_id required CLI-arg-equivalent, params); call Python `--dry-run`; render before-state + projected after-state JSON diff; `ads_mutations` + `ads_mutation_dry_runs` + `gtm_mutations` tables
3. **Execute + audit trail** — confirmation gate; Python `--execute`; mirror `apps/ads/logs/*.json` to Supabase Storage + `ads_audit_logs`; surface in `/ops/ads/audit-browser` searchable archive
4. **Per-client artifacts** — sync `apps/ads/audits/{client}/` + `apps/ads/reports/{client}/` into `client_audits` + `client_reports`; client-folder ↔ shop_id mapping (flower-hill, wallace, tedesco, koffman-auto-works ↔ shop entries); browse + download UI
5. **Safety + governance** — enforce customer-ID-required check in middleware (matches `apps/ads/` CLI rule); rate-limit executes per profile_id; superadmin approval gate for high-risk mutations (e.g., bidding strategy swap); audit log writes for every preview AND execute

**Testable:** PSG strategy user logs into `/ops/ads/`, picks Wallace, drafts "expand Q2 keywords" mutation, sees dry-run diff, confirms execute → JSON audit log appears with before/after state; mutation audit browser shows full archive across clients; per-client PDF reports render
**Ships to:** PSG strategy team (Nick, account managers) — replaces CLI workflow with web UI while preserving audit safety

---

### Milestone v1.3 — Production Module (PSG core revenue)
**Goal:** PSG's mail production (thank-you, warranty, envelopes) runs in-hub via dual adapter (Lob.com + in-house print queue). FileMaker Advantage retired as daily driver; historical data migration is optional v1.3.5 add-on.

**Phases:**
1. **Mail dual adapter** (Q4 resolved) — ship both `LobAdapter` (Lob.com API + address verification + webhook) and `InHouseAdapter` (PDF generator → print partner / facility printer handoff); shared `MailAdapter` interface; per-template + per-shop vendor selection logic; `mail_vendor_jobs` enum (`lob` / `inhouse`)
2. **Production batches** — `production_batches`, `production_documents`; batch creation wizard (pick products → pick companies (optional, blank = all) → generate); Outlook-inspired layout (batch list left, document list right)
3. **Mail-merge templates in Sanity** — extend Sanity schema for mail-merge templates per product; per-shop customization (logo, header, footer, greeting); preview before print
4. **Print queue + status + reprint** — print action (single doc or whole batch); move to historical on print; reprint with audit; `production_reprint_log`
5. **Historical Production** — basic + advanced search (by batch name, print ID, company, product, repair customer); filters; sort; reprint from history
6. **FileMaker cutover (daily driver only)** — point PSG production team to psg-hub for all new production; FileMaker stays read-only for historical access; full data migration deferred to optional v1.3.5

**Testable:** end-to-end: company has program → repair customer assigned → batch generated → printed → moved to historical → reprintable. Vendor webhook updates status correctly. FileMaker can be retired.
**Ships to:** PSG production team — replaces FileMaker for daily ops

---

### Milestone v1.4 — Operational Reports
**Goal:** All 26 named operational reports live in-hub with date-range + filter UI + export.

**Phases:**
1. **Report framework** — `/ops/reports` index; parameterized report runner; date-range picker; filter UI primitives; export (CSV/Excel/PDF)
2. **Volume + Invoicing reports (5)** — Processing Recap; Monthly Processing Invoicing Recap; Re-Print Recap; Recap (trailing 2 mo + current); Audit
3. **Survey + CSI reports (8)** — Performance Dashboard; Market Dashboard; Monthly CSI Display; Estimator CSI; Body Tech Performance; Painter Performance; Survey Alert Recap; Rental Car Analysis
4. **Customer + Insurance reports (8)** — Pay Type Analysis; Vehicle Analysis (Make); Vehicle Analysis (Model); Referral Directory by Category; Agent Capture; Agent Sales; Claims Review; Name Recap by Shop
5. **Individual survey response reports (5)** — Perfect Score; Mis-Fire; Hot Spot; Unresolved Issue; Referral Noted; plus Referral Comparison

**Testable:** each report renders with sample data, parameterized correctly, exports cleanly; performance acceptable on 12-month range
**Ships to:** PSG ops + management reporting

---

### Milestone v1.5 — Superadmin Matrix + Audit
**Goal:** Nick / Tina / Brian manage all access end-to-end including security profiles.

**Phases:**
1. **Admin users + roles + shops UI** — assign/revoke role per user × shop; tier mgmt
2. **Modules + security profiles + access matrix** — toggle module visibility; security profile mgmt; module_access_grants editor
3. **Audit log** — append-only writes from every admin action; `access_audit` UI; PII review checklist

**Testable:** superadmin grants access → user immediately sees/loses module; tier change flips visible modules; security profile flips ops permissions; audit entries recorded with full payload
**Ships to:** superadmins (Nick / Tina / Brian)

---

### Milestone v1.6 — Internal Agentic Intelligence
**Goal:** Master Project Plan agentic platform live: multi-LLM, NotebookLM, Yext, BigQuery DAL, weather, competitor engine, PDF reports.

**Phases:**
1. **Multi-LLM router + NotebookLM grounding** — `llm_router`; `llm_routing_log`; NotebookLM client + session expiry + Claude fallback; `notebooklm_query_log`; integrate with Paperclip
2. **Yext + intake branching** — `yext_accounts`, `yext_*_cache`; intake branching (PSG clients → Yext; prospects → public scan via Firecrawl + Google Places); 30-day cache TTL
3. **BigQuery DAL + weather correlation** — parameterized BQ client; cache-first; Meteostat client; `weather_correlations`; `/internal/shops/[shopId]/weather-correlation`
4. **Competitor engine** — `consolidators` seed (Caliber, Gerber + Joe Hudson, Crash Champions); `competitor_scores`; proximity + consolidator-aware scoring; nightly cron; `/internal/shops/[shopId]/competitors`
5. **Agentic report synthesis + PDF** — pipeline (NotebookLM Context → Claude Draft → Humanizer → Claude Anti-AI Pass); enforce 4-part structure per section; `reports` table; `print.css`; Playwright → PDF with 30s timeout + circuit breaker fallback; `/internal/reports/*` UI

**Testable:** test extraction routes to OpenAI; NotebookLM query returns grounded text; fallback fires on session expiry; Joe Hudson forced into top-5 competitors; regex scan clean for AI vocabulary; PDF print-ready
**Ships to:** PSG strategy team / internal market intel

---

### Milestone v2.0 — Convergence + Hardening
**Goal:** Full E2E coverage; AEGIS final audit; PII sign-off; Pipedrive + GA4 integrations; public launch posture.

**Phases:**
1. **Convergence E2E + AEGIS** — Playwright suite across customer + ops + internal happy paths; AEGIS audit; PII final review; gitleaks; perf pass on all pages
2. **Pipedrive + GA4** — deferred integrations; per-shop OAuth on GA4; Pipedrive deal/CRM mirror
3. **Launch readiness** — domain coexistence (`hub.psgweb.me` + `psgweb.me` marketing site + others); onboarding flow; first-login UX (tour, empty-state guidance, sample data); pilot graduation to full rollout

**Testable:** all gates pass; new shop can be fully onboarded from cold start
**Ships to:** full PSG customer + internal rollout

---

## Skill Loadout & Quality Gates

### Skills Used During Build

| Skill | When It Fires | Purpose |
|-------|--------------|---------|
| PAUL | every phase | structured loop |
| `phoenix-solutions-group-design` | every UI milestone | brand conformance |
| ui-ux-pro-max | UI-heavy phases | dashboard density + chart patterns + Outlook-inspired Production layout |
| frontend-design | UI work | component primitives |
| impeccable | end of each UI milestone | polish |
| uncodixfy | UI generation | block generic AI UI patterns |
| supabase | every data-model phase | schema + RLS + Edge functions |
| vercel:bootstrap, vercel:env, vercel:deploy | v0.1 + each deploy | infra |
| code-review | every PR | gate before merge |
| AEGIS | end of each milestone | architectural audit |
| `/paul:audit` | complex phases (v1.2 Ads Studio, v1.3 Production, v1.4 Reports, v1.6 Agentic) | deep audit |
| humanizer | v1.6 + all customer copy | scrub AI vocabulary |
| brand | content/copy phases | voice + tone |

### Quality Gates

| Gate | Threshold | When |
|------|-----------|------|
| Vitest coverage | ≥70% lines (new code) | every phase |
| Playwright E2E | auth + 1 customer dashboard | v0.2 |
| Playwright E2E | 1 ops happy path (company → RO → import) | v1.1 |
| Playwright E2E | 1 ads-mutation happy path (draft → dry-run → execute → audit) | v1.2 |
| Playwright E2E | 1 production happy path (batch → print → reprint) | v1.3 |
| Playwright E2E | convergence suite | v2.0 |
| Accessibility | WCAG AA on customer routes | v0.2 |
| Performance | LCP <2s on `/dashboard`, `/dashboard/shop/[shopId]/*` | v0.2 |
| Performance | LCP <3s on `/ops/*` and `/ops/reports/*` | v1.1 + v1.4 |
| Security scan | gitleaks pass; no high CVEs | every phase |
| AEGIS audit | pass | end of each milestone |
| Brand audit | strict conform | every UI milestone |
| PII review | manual sign-off | v0.2, v1.1, v1.3, v2.0 |
| Ads mutation safety | every execute writes audit log; customer_id required; dry-run preview mandatory | v1.2 |
| GTM mutation safety | same as ads (dry-run + audit) | v1.2 |
| Resilience checks | no bare catches; retries + circuit breakers | every external-call phase |
| AI vocabulary scan | regex clean | v1.5 |
| Tier-gate verification | every protected route enforces tier | v0.2, v0.4, v1.4 |
| Webhook idempotency | every webhook handler has idempotency key | v0.4, v1.3 |
| Import validation | every import has template-match validation | v1.1 |
| Production audit trail | every print + reprint + cancel writes to audit | v1.3 |

---

## Design Decisions

1. Monorepo with pnpm + Turborepo at `apps/psg/`
2. Single Next.js app for customers + internal ops + internal agentic + admin — RBAC + tier + security profiles + RLS handle divides
3. **BSM dashboard is the anchor** — relocates from `~/apps/projects/bsm/dashboard/` to `apps/psg/apps/psg-hub/`
4. Market intel ported from `psg-advantage-portal/` into the BSM-based anchor (v0.3)
5. Next.js 16 across the board (upgrade ported psg-advantage-portal code from 15 → 16 during v0.3)
6. Fresh git import for `apps/psg-hub/` — no anchor history preservation
7. Single GitHub repo `Phoenix-Solutions-Group/data`
8. BSM PAUL preserved as foundation; psg-hub starts at milestone v0.1
9. Three roles: `customer`, `psg_internal`, `psg_superadmin` — extended by `security_profiles` for fine-grain ops permissions
10. Multi-tenancy by `shop_id` with BSM `profile_id` convention
11. Customer-flavored variants via shared components + RLS-filtered data
12. Strict conform to PSG design system from GitHub repo — submodule, no extensions
13. **`psg-import` absorbed into v1.1 ops** (overrides earlier "untouched" plan — RO/Estimate import becomes first-class ops module)
14. `psg-data-lake` stays as Python ETL feeder
15. **MVP customer launch (v1.0) = milestones v0.1–v0.4** — foundation + customer MVP + analytics + invoicing
16. No real-time for MVP — polling + cron + webhooks
17. Vercel Fluid Compute on Node 24
18. ~~Resend for PSG-branded magic-link emails on `psgweb.me`~~ → **superseded by Decision 50: SendGrid + Twilio**
19. Honored BSM tier enum `essentials` / `growth` / `performance` — no rename
20. PSG as merchant of record — single Stripe account (already shipped in BSM)
21. Top-bar shop switcher + URL `/dashboard/shop/[shopId]/...`
22. Auto-promote Nick, Tina, Brian to `psg_superadmin` during v0.2; existing BSM users get `customer` role
23. Re-link existing `psg-advantage-portal` Vercel project, rename to `psg-hub`
24. Production domain: `hub.psgweb.me`
25. Master Plan agentic intelligence as internal-only milestone v1.5
26. Kill list approved: retire `invoice/`, `portal/`, `sst-psgdigital/`, `web-dev-skills/`, `dashboard-psgdigital/`, `shop-theacrb/`, `invoice-psgdigital/`. Relocate `psg/` + `pipedrive/` outside repo.
27. Resilience patterns mandatory — retry + circuit breaker; no bare catches
28. BSM siblings become `apps/psg/packages/*` workspace packages
29. **Advantage Program scope absorbed** — Companies, Employees, Repair Customers, ROs, Estimates, Surveys, Production, 26 Reports, System Configuration, Security Profiles all become internal-ops modules in v1.1, v1.3, v1.4, v1.5
30. **End consumers (repair_customers) tracked as entities but no UI surface** for them
31. **Milestone-based delivery** — v0.1 → v0.4 = customer launch; v1.1 → v1.6 = internal ops + ads studio + production + reports + admin + agentic; v2.0 = convergence. Customer + ops tracks ship sequentially.
32. **FileMaker Advantage retired as daily driver at v1.3** — psg-hub Production module replaces it for all new production. FileMaker stays read-only for historical access. Full data migration deferred to optional v1.3.5 add-on (Q2 resolved).
33. ~~Mail/print vendor TBD~~ → **superseded by Decision 53: Lob.com + in-house print queue (dual adapter)**
34. **26 reports built in 5 batches** (~5 reports per phase) in milestone v1.4
35. Security profiles function flags: `manage_companies`, `manage_repair_customers`, `manage_surveys`, `manage_production`, `manage_reports`, `manage_sys_config`, `manage_users` (incl. sub-flags `manage_security_profiles`, `manage_users`), `manage_data_imports`, **`manage_ads_mutations`**, **`manage_gtm_mutations`** — built-in `Administrator` profile grants all
36. **`apps/ads/` Python mutation tooling preserved and surfaced via web UI** (not rewritten) — Vercel Sandbox or FastAPI worker bridge invoked from Next.js routes; dry-run → execute → audit pattern matches Python CLI safety rules
37. **GTM mutations follow same pattern as Ads mutations** — same dry-run + audit + customer-id-required safety rules
38. **`google-ads-mcp` read-side MCP server** referenced by v1.6 multi-LLM router for AI/agent ads queries
39. **Per-client artifact folders in `apps/ads/{audits,reports,ops}/{client}/`** mapped to `shop_id` via name match (flower-hill, wallace, tedesco, koffman-auto-works → registry entries)
40. **Customer-id-required check enforced in psg-hub middleware** — matches `apps/ads/` CLI safety rule #2: "No defaults. Prevents wrong-account pushes."
41. ~~ads-dashboard absorbed wholesale in v0.3~~ → **superseded by Decision 70: reframe to plans/concepts absorption** (Q20 investigation found ads-dashboard is Phase 1 of 5 with only scaffold landed; story-led UI, timeline, goals, monthly PDF are unstarted plans, not shipped code)
42. **local_reach deprecated in v0.1** — archived to `apps/psg/archive/local_reach/`; BSM agents replace its function; active client outputs preserved in `apps/psg/archive/local_reach-outputs/` for reference during BSM agent runs
43. **Single shared Supabase project `gylkkzmcmbdftxieyabw`** — already shared by ads-dashboard, local_reach, BSM, psg-advantage-portal. Hub uses same project. Auth identities flow across all current apps without migration.
44. **GA4 + Search Console added as v0.3 modules** — per-shop OAuth (same pattern as Google Ads); nightly sync; integrated into unified marketing surface alongside Ads
45. **Unified marketing surface at `/dashboard/shop/[shopId]/marketing`** — combines Ads + GA4 + GSC into one customer view; narrative copy generator reads all three sources; goals-based trend coloring across all metrics
46. **Workspace root stays `~/apps/psg/`** (not promoted to `~/apps/`) — consolidation target; existing repos relocate into `apps/psg/apps/*`, `apps/psg/packages/*`, `apps/psg/archive/*`
47. **MCC client slug convention preserved from ads-dashboard** — `wallace`, `tedesco`, `flower-hill`, `koffman-auto-works` ↔ shop_id mapping; `clients` table stores both slug and shop_id; URLs use slugs but data layer uses shop_id
48. **"What PSG did" timeline `psg_activity_notes` becomes platform feature** — surfaces across customer modules (ads, presence, sentiment) so PSG admins can author narrative-led notes once and they appear in every relevant report
49. **Goals + trend coloring `shop_goals` becomes platform feature** — CPL target / CTR target / position target / sessions target etc. drive coloring across all customer metrics (ads + GA4 + GSC + presence)
50. **SendGrid (transactional email) + Twilio (SMS)** — both run on existing PSG accounts. SendGrid replaces Resend (Q4). Twilio adds SMS for survey reminders, production status, optional auth fallback. SendGrid+Twilio setup is part of v0.1 phase 3.
51. **FleetComplete 2019 Angular Advantage never shipped** (Q1 resolved) — v1.1+ is greenfield from the 2019 tech design spec. No migration path from a non-existent system.
52. **Python worker runtime = Vercel Sandbox** (Q3 + Q7 resolved) — same runtime for `apps/ads/` mutations (v1.2) and Paperclip agentic jobs (v1.6). Consistent infra, no separate FastAPI service.
53. **Production mail = Lob.com + in-house print queue (dual adapter)** (Q4 resolved) — both ship in v1.3. Shared `MailAdapter` interface. Vendor selected per template or per shop. Lob.com handles outbound mail with address verification; in-house adapter generates PDFs + hands off to PSG facility/print partner.
54. **Retire BSM Vercel project; rename psg-advantage-portal → psg-hub** (Q5 resolved) — preserves analytics + env var history on portal project. BSM Vercel decommissioned in v0.1 phase 3.
55. **Provision new Sanity project for psg-hub** (Q6 resolved) — no existing hosted Sanity project to inherit. Create new project with single production dataset in v0.1 phase 3. Studio code (`packages/studio`) from BSM imports against new project.
56. **Paperclip runs on Vercel Sandbox** (Q7 resolved) — matches Decision 52. Not inside Next.js Node process (function timeout too short for long agentic runs); not separate FastAPI service (avoid extra infra).
57. **Zero live BSM customers** (Q8 resolved) — Tracy's is fixture only. v0.1 can be hard cutover. No zero-downtime migration plan required for BSM-anchored work.
58. **NotebookLM IP curated by Nick pre-v1.6** (Q9 resolved) — Nick populates PSG playbooks, case studies, collision-repair IP into NotebookLM notebooks before v1.6 kickoff. v1.6 schedule gated on Nick's availability for curation.
59. **Yext = all Growth+ tier shops** (Q10 resolved) — Yext is bundled with Growth+ tier. v1.6 surfaces Yext for all paying shops at those tiers; `yext_enabled` flag derived from `billing_tier IN ('growth', 'performance')`.
60. **No fixed v1.0 launch date** (Q11 resolved) — quality-first; ship when ready. Plan milestone-by-milestone with quality gates and brand audit at each milestone close.
61. **v1.0 pilot cohort = Wallace + Tedesco + Tracy's Collision Center** (Q12 resolved) — three pilot shops. Wallace + Tedesco have live ads-dashboard data; Tracy's is BSM fixture transitioning to live pilot. Flower Hill data preserved in absorbed code but not in v1.0 pilot.
62. **Sequential post-v1.0 delivery** (Q13 resolved) — v1.1 → v1.2 → v1.3 → v1.4 → v1.5 → v1.6 → v2.0 strictly one after another. Single team. No parallel workstreams.
63. **Nick owns PDF visual design pass** (Q14 resolved) — Nick designs Production mail-merge templates (v1.3) and agentic report cover/layout (v1.6) using PSG design system. Print-quality + brand-aligned.
64. **apps/ads/ folder slugs match shop slugs** (Q16 resolved) — `flower-hill`, `wallace`, `tedesco`, `koffman-auto-works` already align with ads-dashboard `clients` table. Direct slug join, no translation table.
65. **High-risk ads mutations = bidding strategy + budget changes** (Q17 resolved) — superadmin approval gate on bid strategy swaps + daily budget deltas >20%. Mutation registry tags these `is_high_risk=true`. All other mutations require profile_id check only.
66. **All GTM mutations surface in v1.2** (Q18 resolved) — entire `apps/ads/gtm_psg/mutations/` catalog ships alongside Google Ads mutations in v1.2. Single sprint covers both.
67. **apps/ads/logs = forward-only from v1.2** (Q19 resolved) — existing JSON logs stay on disk for historical reference. `ads_audit_logs` table starts fresh at v1.2 launch. No backfill ETL.
68. **GA4 + GSC OAuth = admin-driven** (Q21 resolved) — PSG account managers link GA4 + GSC on behalf of shops during onboarding (matches Google Ads pattern). Self-link not surfaced in v0.3.
69. **local_reach archived immediately in v0.1** (Q22 resolved) — no live dependencies. BSM agents replace function. Archive active client outputs to `apps/psg/archive/local_reach-outputs/` for reference. Hard retire.
70. **ads-dashboard absorption reframed: plans + concepts, not code** (Q20 resolved) — ads-dashboard PAUL state shows only 01-01 (Next.js scaffold + Vercel + CI) APPLY done; 01-02 (brand tokens), 01-03 (Supabase auth), 01-04 (demo `/c/wallace` page), Phases 2–5 (data pipeline, multi-tenant RLS, story layer, reports + PDF) all unstarted. BSM dashboard (the psg-hub anchor) already supersedes 01-01–01-03 patterns. **v0.3 absorbs: ROADMAP + 4 Phase-1 plans + Phase 2–5 design intent + story-led narrative concept + per-client goals concept + monthly PDF concept + client identities (Wallace 6048611995, Tedesco 7763526490, Flower Hill)**. ads-dashboard scaffold code + Vercel project + GitHub repo (`Phoenix-Solutions-Group/ads-dashboard`) archived. v0.3 phase 1 is rewritten accordingly.
71. **Q23–Q25 resolved by unmapped-`~/apps/`-scan** — `gbrain/` + `open-design/` are 3rd party tools, leave alone; `CTO/` + `morgan/` are empty/stub, delete; `Automation/` + `governance/` + `python-scripts/` are PSG reference docs/old scripts, relocate outside repo as archive; `CFO/` + `daily-content-brief/` + `obsidian-vault/` are out of psg-hub scope (active PSG ops/content/personal workspaces), relocate outside repo; `DEGWEB-MODERNIZATION-REVIEW.md` is a separate PSG-managed WordPress site (degweb.org), audit doc only — relocate outside repo. No psg-hub scope collisions found. gbrain integration via existing global MCP registration only.

---

## Open Questions

### Critical (block v0.1, v1.1, or v1.2)

**Q1–Q8 RESOLVED 2026-05-29 (see Decisions 50–57).** Summary:

| # | Question | Answer | Decision |
|---|----------|--------|----------|
| 1 | FleetComplete Angular shipped? | No — never shipped | D51 — v1.1+ greenfield from 2019 spec |
| 2 | FileMaker Advantage status? | Current daily driver; psg-hub is replacement | D32 (revised) — retired as daily driver at v1.3; historical migration is optional v1.3.5 add-on |
| 3 | Python worker deployment? | Vercel Sandbox | D52 |
| 4 | Mail/print vendor? | Lob.com + in-house print queue (dual). Plus SendGrid + Twilio replace Resend. | D53 + D50 |
| 5 | BSM Vercel project retire? | Yes — rename psg-advantage-portal → psg-hub | D54 |
| 6 | Sanity production dataset? | Provision new Sanity project in v0.1 | D55 |
| 7 | Paperclip runtime? | Vercel Sandbox (matches Q3) | D56 |
| 8 | BSM live customers? | Zero (Tracy's is fixture). Hard cutover OK | D57 |

**Still open:**

9. **NotebookLM IP population** — Master Plan blocker for v1.6; who owns, when?

### Important (block specific milestone)

**Q9–Q22 RESOLVED 2026-05-29 (see Decisions 58–69), except Q15 + Q20.**

| # | Question | Status | Decision |
|---|----------|--------|----------|
| 9 | NotebookLM IP owner? | Resolved | D58 — Nick pre-v1.6 |
| 10 | Yext account inventory? | Resolved | D59 — all Growth+ shops |
| 11 | v1.0 launch date? | Resolved | D60 — no target, quality-first |
| 12 | Pilot cohort? | Resolved | D61 — Wallace + Tedesco + Tracy's |
| 13 | Team capacity v1.1+? | Resolved | D62 — strictly sequential |
| 14 | PDF design owner? | Resolved | D63 — Nick designs v1.3 + v1.6 |
| 15 | FM data migration scope? | **Open** — defer to v1.3.5 add-on planning if triggered |
| 16 | apps/ads/ slug mapping? | Resolved | D64 — direct slug join |
| 17 | High-risk mutations? | Resolved | D65 — bid + budget gated |
| 18 | GTM mutation subset? | Resolved | D66 — all in v1.2 |
| 19 | apps/ads/logs backfill? | Resolved | D67 — forward-only |
| 20 | ads-dashboard in-flight PAUL? | Resolved | D70 — Phase 1 of 5, only scaffold landed; reframe absorption to plans + concepts, not code |
| 21 | GA4 + GSC OAuth model? | Resolved | D68 — admin-driven |
| 22 | local_reach runway? | Resolved | D69 — immediate archive |

**Still open:**

15. **FileMaker data migration scope** — full history vs cutoff date? Audit retention requirements? Decide only if v1.3.5 optional add-on triggered.

### Discovery (Q23–25) — RESOLVED 2026-05-29

Scan of `~/apps/` unmapped areas before locking v0.1 phase plans:

| Area | Verdict | Action in v0.1 Phase 1 |
|------|---------|------------------------|
| `Automation/` | Archive (PDF reference docs) | Relocate outside repo |
| `CFO/` | Out of psg-hub scope (active financial workspace) | Relocate outside repo |
| `CTO/` | Delete (empty) | Delete |
| `daily-content-brief/` | Out of psg-hub scope (PSG content workspace) | Relocate outside repo |
| `gbrain/` | External tool (gbrain CLI, MCP registered globally) | Leave alone |
| `governance/` | Archive (PSG website content process + tech stack docs) | Relocate outside repo |
| `morgan/` | Delete (empty stubs) | Delete |
| `obsidian-vault/` | Out of psg-hub scope (Nick's Obsidian vault) | Relocate outside repo |
| `open-design/` | External tool (3rd party design framework) | Leave alone |
| `python-scripts/` | Archive (old utility scripts) | Relocate outside repo |
| `DEGWEB-MODERNIZATION-REVIEW.md` | Out of psg-hub scope (DEGWeb separate WordPress site at degweb.org) | Relocate outside repo |

No psg-hub scope collisions found. Q24 (degweb): degweb.org is a separate PSG-managed WordPress site with its own 16-year-old codebase — audit doc only, not absorbed. Q25 (gbrain): leave independent; gbrain MCP already registered globally and available cross-project.
23. **Other unmapped PSG areas** — `~/apps/{Automation,CFO,CTO,daily-content-brief,gbrain,governance,morgan,obsidian-vault,open-design,python-scripts}` — any of these in-scope for psg-hub or untouched?
24. **degweb-modernization** — what is "degweb"? Review doc at `~/apps/DEGWEB-MODERNIZATION-REVIEW.md` suggests a related modernization effort — overlap with psg-hub?
25. **gbrain integration** — `~/apps/gbrain/` is the gbrain MCP system; does psg-hub leverage it for context/memory or stay independent?

### Operational
20. **Tracy's Collision Center** — only test shop today; keep as fixture or onboard real shops during pilot?
21. **First-login UX** — tour, empty-state guidance, sample data?
22. **Domain coexistence** — `hub.psgweb.me` for hub, `psgweb.me` for marketing site, anything else?
23. **End-consumer PII retention** — `repair_customers` PII retention policy? Hard delete vs anonymize after N days?

---

## Next Actions

- [x] Resolve Critical Qs 1–8 (2026-05-29 — see Decisions 50–57)
- [x] Resolve Important Qs 9–22 (2026-05-29 — see Decisions 58–69; Q15 + Q20 remain open)
- [x] Read `~/apps/ads-dashboard/.paul/STATE.md` (Q20 resolved 2026-05-29 → D70 reframe)
- [ ] Re-synthesize `apps/psg-hub/README.md` from v7 PLANNING.md (current README is v3-stale)
- [ ] Finalize graduation: initial commit on `apps/psg-hub/`; append graduation stamp to this PLANNING.md
- [ ] Initialize PAUL headless against v7 PLANNING.md
- [ ] First PAUL milestone = v0.1 Foundation; `/paul:discuss` then `/paul:plan` for Phase 1 (Workspace consolidation + multi-repo relocation)
- [ ] Confirm shared Supabase project access (`gylkkzmcmbdftxieyabw`) + plan psg-advantage-portal Vercel rename
- [x] Investigate unmapped `~/apps/` areas (Q23–Q25 resolved 2026-05-29 → D71; no collisions, all relocate outside repo as part of v0.1 phase 1 kill-list/archive plan)
- [ ] Provision SendGrid + Twilio domain auth on `psgweb.me` (SPF/DKIM/DMARC + sender authentication) for v0.1
- [ ] Create new Sanity project (D55) + import BSM studio code
- [ ] Lob.com account setup + sandbox key for v1.3 prep
- [ ] Confirm Tracy's onboarding path from BSM fixture → v1.0 pilot live (D61)
- [ ] Decide: `/seed graduate psg-hub` (move PLANNING.md to `apps/`) OR `/seed launch psg-hub` (graduate + initialize PAUL headless from this PLANNING.md)
- [ ] Verify NotebookLM owner for PSG IP population (gates v1.5)

---

## References

- `apps/psg/.paul/codebase/STACK.md`, `ARCHITECTURE.md`, `STRUCTURE.md`, `CONVENTIONS.md`, `TESTING.md`, `INTEGRATIONS.md`, `CONCERNS.md` — workspace codebase map
- `~/apps/projects/bsm/` — anchor source; relocates to `apps/psg/apps/psg-hub/` in v0.1
- `~/apps/projects/bsm/.paul/PROJECT.md` + `ROADMAP.md` + `STATE.md` — BSM PAUL state (preserved)
- `~/apps/projects/bsm/PLANNING.md` — original BSM planning doc
- `apps/psg/psg-advantage-portal/` — market-intel source code (ported in v0.3)
- `apps/psg/psg-advantage-portal/Master Project Plan_ PSG Agentic Market Intelligence Platform.md` — absorbed as v1.6
- `apps/psg/psg-advantage-portal/supabase/migrations/` — carry forward, apply to BSM Supabase
- `apps/psg/psg-import/.paul/PROJECT.md` — sibling app, **absorbed into v1.1** (changed from prior decision)
- `apps/psg/psg-import/PLANNING.md` — RO/Estimate Import logic to fold into ops Data Import module
- `apps/psg/psg-data-lake/` — ETL feeder, untouched
- `apps/psg/api-psghub/ads-dash/` — Google Ads UI reference patterns
- `apps/psg/api-psghub/psg-insight-hub/` — possible legacy fragment of Advantage Program; investigate
- **`~/apps/ads-dashboard/`** — customer-facing Google Ads reporting (Next.js 16, multi-tenant Supabase RLS, shipped May 2026); **absorbed in v0.3**
  - `~/apps/ads-dashboard/PLANNING.md`, `README.md`, `SECURITY.md` — design + security spec
  - `~/apps/ads-dashboard/.paul/PROJECT.md` — PAUL state (Phase 1 foundation)
  - Real clients today: Wallace Collision Center (6048611995), Tedesco Auto Body (7763526490), Flower Hill Auto Body
- **`~/apps/projects/local_reach/`** — LocalReach AI / SEO Parser V5 (PHP + React + Cloudflare Workers, ~6GB, active client work); **deprecated in v0.1, BSM agents replace**
  - `tracys-research-v3/`, `new-tracys-report-v2/` — active client outputs (archived for migration)
  - Same Supabase `gylkkzmcmbdftxieyabw` (auth consolidated 2026-03-24)
- **`~/apps/ads/`** — PSG Google Ads + GTM mutation tooling (Python, active May 2026); surfaces via v1.2 Ads Mutation Studio
  - `~/apps/ads/googleads_psg/mutations/` — mutation library
  - `~/apps/ads/gtm_psg/mutations/` — GTM mutations
  - `~/apps/ads/ops/{flower-hill,wallace,tedesco,koffman-auto-works}/` — per-client mutation scripts
  - `~/apps/ads/audits/` — per-client audit reports + `PSG-AGGREGATE-REPORT.md`
  - `~/apps/ads/reports/{client}/` — per-client PDF outputs with brand assets
  - `~/apps/ads/logs/` — JSON audit log archive (gitignored)
  - `~/apps/ads/SESSION_HANDOFF.md` — latest session state
  - `google-ads-mcp` (read-side MCP server, referenced in apps/ads README)
- **`~/Library/CloudStorage/GoogleDrive-nick@phoenixsolutionsgroup.net/Shared drives/[1] PSG Team Drive/Phoenix Solutions Group/Vendors/Claims Corp/PSG Project Technical Design v1.0_Final.txt`** — FleetComplete 2019 Advantage Program tech design (absorbed as v1.1–v1.4 scope)
- `github.com/Phoenix-Solutions-Group/design-system` — brand source of truth
- `github.com/Phoenix-Solutions-Group/data` — single repo
- **Other PSG areas in `~/apps/` to investigate (Open Q23):** `Automation/`, `CFO/`, `CTO/`, `daily-content-brief/`, `gbrain/`, `governance/`, `morgan/`, `obsidian-vault/`, `open-design/`, `python-scripts/`, `DEGWEB-MODERNIZATION-REVIEW.md`

---

## Graduation Stamp

**Graduated:** 2026-05-29
**Graduated to:** `apps/psg/apps/psg-hub/`
**Graduation method:** SEED → apps/ relocation; README synthesized from v7 PLANNING.md; PAUL initialization headless against this brief.
**SEED ideation final state:** v7 — 70 decisions (D1–D70), Critical Qs 1–8 + Important Qs 9–22 resolved (Q15 deferred to v1.3.5 add-on planning if triggered, Q20 resolved by ads-dashboard PAUL inspection), Discovery Qs 23–25 deferred to v0.1 phase 1 unmapped-`~/apps/`-scan.
**Post-graduation:** This PLANNING.md is the canonical SEED artifact. Further changes happen via PAUL phase plans, not direct edits here.

---

*Last updated: 2026-05-29*
