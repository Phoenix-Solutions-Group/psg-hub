# psg-hub

## What This Is

Unified PSG platform consolidating three product surfaces in one Next.js app, separated by RBAC + tier + security profiles + RLS: (1) customer-facing portal for collision repair shops in the PSG roster (~842 shops) — marketing analytics, AI agents, invoicing, payments, post-repair sentiment, market intel; (2) PSG internal operational backbone — Companies, Employees, Repair Customers, ROs, Estimates, Surveys, Production printing (PSG's core revenue mail program), 26 operational reports, master data, Security Profiles, RO/Estimate Import; (3) PSG-internal agentic market intelligence — competitor engine, Yext (Growth+ tier), weather correlation, multi-LLM router, NotebookLM grounding, agentic report synthesis + PDF.

## Core Value

Consolidates fragmented PSG tooling (BSM customer dashboard, ads-dashboard plans, psg-advantage-portal market intel, psg-import, apps/ads/ mutation tooling, FleetComplete 2019 spec, FileMaker Advantage daily driver) into one branded `hub.psgweb.me` surface that customers, internal staff, and superadmins all use — replacing logins and tooling sprawl with role-gated unified access.

## Current State

| Attribute | Value |
|-----------|-------|
| Type | Application |
| Version | 0.2.0 |
| Status | **v0.3 Customer Analytics — 🚧 IN PROGRESS (created 2026-06-04; 0/3 phases). Next: `/paul:plan` Phase 9.** v0.2 Customer MVP ✅ COMPLETE 2026-06-04 (LIVE on hub.psgweb.me; archived to MILESTONES.md). v0.1 Foundation ✅ COMPLETE 2026-06-02. |
| Last Updated | 2026-06-04 |

**Production URLs:**
- `hub.psgweb.me` — production **LIVE** (Vercel project `psg-hub`, Let's Encrypt cert, branded)
- Vercel: NEW `psg-hub` project (`prj_CBrI1FRqqgPzCbAwin6LbSknY48U`, team psg-digital), git-connected to `Phoenix-Solutions-Group/data`@main — supersedes D54's "rename psg-advantage-portal" mechanism (old `data` portal project deleted)

## Requirements

### Core Features

- Customer portal: marketing analytics (Google Ads + GA4 + Search Console unified), AI agents, invoicing + Stripe, post-repair sentiment, digital presence, market intel
- Internal ops backbone: Companies, Employees, Repair Customers, ROs, Estimates, Surveys, Production (Lob + in-house dual adapter), 26 reports, SysConfig master data, Security Profiles, RO/Estimate Import
- Ads Mutation Studio: surface `apps/ads/` Python + GTM mutations via web UI with dry-run preview → execute → audit on Vercel Sandbox
- Internal agentic intelligence: multi-LLM router, NotebookLM grounding, Yext, weather correlation, competitor engine, agentic PDF reports
- Superadmin matrix: role + tier + module + security profile management with audit log

### Validated (Shipped)
- ✓ Workspace consolidation — Phase 1 (2026-05-31): single pnpm+Turbo monorepo at `apps/psg/`; BSM dashboard → `apps/psg-hub/` anchor (build green, IDOR secured); BSM `studio` → `packages/studio` (`@psg/studio`); `apps/ads/` → `apps/psg-ads-mutations/` Python worker; ads-dashboard + local_reach archived; kill list retired; git collapsed to single repo (`Phoenix-Solutions-Group/data`).
- ✓ Design system embodiment — Phase 2 (2026-06-01): PSG design system vendored as `packages/ui/psg-brand/` submodule (pinned `1689896`); Gotham + Didact Gothic via `next/font/local`; BSM "Clarity Teal" oklch vars → PSG tokens (midnight `#1E3A52`, ember `#B8483E`, paper `#FAFAFA`, 6px) across every shadcn var; `<Logo>` + DS-spec button/label/card/badge/table; branded `/login` + `/signup` + navy app shell; **fixed `/dashboard` 404** (route group→segment); de-BSM app-wide; legacy DS docs superseded. typecheck + 136 tests green; login + dashboard screenshots operator-approved.
- ✓ Integrations + deploy — Phase 3 (2026-06-01): SendGrid transactional email + Twilio SMS, each via a shared `src/lib/resilience.ts` (retry + circuit breaker) adapter and an idempotent, signature-verified webhook (`/api/webhooks/{sendgrid,twilio}` → `email_events` / `sms_events` on shared Supabase). Both **live-verified end-to-end** (real signed rows: SendGrid `event=open` matching the test send; Twilio inbound `status=received`). Sanity content backend provisioned (`vcw0bsnu`, private prod dataset, schema 4 types; `@psg/studio` env-decoupled from BSM). **psg-hub deployed LIVE at https://hub.psgweb.me** (NEW Vercel project, 14 prod env keys incl. `SUPABASE_SERVICE_ROLE_KEY`). D54 decommission confirmed (old `data` portal project deleted; no BSM/ads-dashboard project remains).
- ✓ PAUL inheritance + tracking — Phase 4 (2026-06-01): BSM PAUL (Phases 1-5) and ads-dashboard PAUL were already preserved under `apps/psg-hub/.paul/references/` (front-loaded in Phase 1 / 01-03 + the BSM relocation). Phase 4 made them navigable via a new `references/INDEX.md` mapping every inherited body of work to its consuming milestone (v0.2..v2.0), with the brand-reconcile caveat (psg-brand submodule wins). Tracking reconciled (BASE satellite verified at Phase 4 / in_progress). `ACTIVE.md` documented as superseded by `STATE.md` (no file created). 3-lens adversarial verification (1 MEDIUM + 3 LOW findings applied).
- ✓ local_reach client output archive — Phase 5 (2026-06-02): verified the local_reach active client outputs (`tracys-research-v3`, `new-tracys-report-v2`, sidecar `tracys/`) preserved on-disk at gitignored `archive/local_reach-outputs/` faithful to its MANIFEST, and the codebase retired (source gone, archived). Lean close (on-disk-only preservation = reference material for v0.3 BSM-agent migration; not version-controlled). Scope was front-loaded into Phase 1 / 01-04; Phase 5 audited + closed. **Closes milestone v0.1 (all 5 phases loop-closed).**
- ✓ Tier gating + shop switcher — Phase 7 (2026-06-03, v0.2 phase 2 of 3): **07-01** self-serve onboarding — service-role `POST /api/onboarding` bootstraps client→shop→first-owner `shop_users`→customer role (compensating cleanup), gate routes no-shop users to the wizard (closes the Phase-6 first-owner chicken-and-egg; operator onboarded Tracy's Body Shop live). **07-02** tier-gate helper — extracted a ranked `essentials<growth<performance` gate into shared `src/lib/tier/gate.ts` (`TIER_RANK`/`tierMeets`/`getShopTier`/`shopHasTier`/`assertShopTier`); migrated both ads consumers behavior-preserving (`assertAdsTier` delegate byte-identical, 5 call sites untouched); centralized the `SHOP_ADS_TIER_OVERRIDE` reader. **07-03** shop switcher — active-shop cookie context `src/lib/shop/context.ts` (membership-revalidating `resolveActiveShop` — cookie SELECTS among authorized shops, never authorizes; RLS backstop) + membership-validated `POST /api/shop/switch` + `<ShopSwitcher>` in the shell (0/1/2+) + settings/reviews/content scoped to the active shop. All LIVE on hub.psgweb.me (dpl psg-o44ue3bia); 221 tests. Ads `?shop_id=` alignment deferred → Phase 8. Carry-forward → Phase 8: ads context alignment, switch-flow E2E, mobile nav, the 26 anon-open policies, home `agent_runs` guard.
- ✓ Launch hardening — Phase 8 (2026-06-04, v0.2 phase 3 of 3, **closes v0.2**): **08-01** Phase-7 carry-in surface fixes (ads no-param→`getActiveShopContext`; `MobileNav` NAV + `<ShopSwitcher>` below `lg`; home drops phantom `agent_runs` card + 3 live active-shop counts; git↔Vercel wired as scope-add — repo `Phoenix-Solutions-Group/psg-internal`, rootDir `psg-hub/apps/psg-hub`, prod-on-main auto-deploy OFF). **08-02** blanket-allow RLS remediation LIVE on prod — migration `20260603194623_close_blanket_allow_rls.sql` dropped 24 blanket Allow-all (anon+auth) policies on 12 multi-tenant tables; `authenticated`-half cross-tenant breach closed (M2 PII gate); advisor diff clean (rls_policy_always_true 26→2). **08-02b** gitleaks v0.2 milestone scan CLEAN (committed-history `gitleaks git` exit 0; 13 vetted FP allowlisted in repo-root `.gitleaksignore`) + `CHECKLIST-idempotency.md` (S4). **08-03** first AEGIS pass (customer surface) — tools clean, 4 domain specialists + adversarial verification → NO launch-blocker; in-scope hygiene remediated; Stripe/billing→v0.4, PII retention→v0.4, audit-log→v1.5 deferred; COMMITTED + MERGED main + LIVE. **08-04** coverage gate + static brand — Vitest v8 gate scoped to the 13 v0.2 new-code modules, perFile lines:70, exit 0 at 88.85% (255 tests); static brand audit CLEAN → `BRAND-CONFORMANCE-v0.2.md`. **08-04b** Playwright E2E + WCAG AA + visual brand — local-Supabase target (zero PII), 3 happy paths (auth + customer + the 07-03 switch flow) pass, in-run axe WCAG AA 0 serious/critical (one real `--muted-foreground` contrast fail caught + fixed #949494→#707070), desktop+mobile screenshots → `BRAND-VISUAL-v0.2.md` (operator PASS). All on main + LIVE; ZERO prod write in 08-04/08-04b.
- ✓ RBAC + RLS spine — Phase 6 (2026-06-03, v0.2 phase 1 of 3): defined the 3-role psg model (`customer`/`psg_internal`/`psg_superadmin`) on shared prod `gylkkzmcmbdftxieyabw`. Grounding overturned the ROADMAP premise (no BSM Phase-4 RLS base, no role enum → DEFINE not extend). Shipped: S1 migration-safety + RLS-review protocol (06-01); RBAC tables `app_user_roles`(3-role CHECK)/`security_profiles`/`superadmin_emails` + `private.current_user_role()`/`current_user_has_fn()` no-hook resolvers + 3 hardened helpers, all RLS default-deny, superadmins Nick/Tina/Brian, Claire excluded (06-02); server-side customer-id gate in `dashboard/layout.tsx` + `shop-access.ts` service-role read + `<NoShopNotice/>` (06-03); reviews surface reconciled to live `review_items`/`review_responses` (EXTEND, advisor 0-new) (06-04); membership model unified on `shop_users(user_id, role)` across all 13 authz sites + `llm_call_log` table (unblocks reviews draft) + ads/agents/ingest guarded to no-phantom-read states (06-05). All LIVE on prod (advisor diffs clean — only intended default-deny INFOs); 188 tests; deployed hub.psgweb.me. Deferred: onboarding first-owner bootstrap (RLS-blocked under user-session → Phase 7 service-role route), 26 anon-open policies + mobile nav + home `agent_runs` guard → Phase 8.

### Active (In Progress)
**v0.3 Customer Analytics 🚧 (created + re-planned 2026-06-04, 0/4 phases).** Unified SEMrush + Google Ads + GA4 + GSC marketing surface, output as the automated PSG monthly client report (multi-LLM narrative + branded PDF). **Re-planned 2026-06-04:** grounding overturned the "BSM Phase 5 Google Ads data exists, no OAuth" premise — verified FALSE on prod (`google_ads_*` tables absent; no source has stored data; ads page is a coming-soon guard; no chart lib). Re-ordered by ascending OAuth/ingest friction, 3→4 phases: **9** Analytics foundation + SEMrush (chart lib + analytics data model/migration + dashboard shell + MSO cross-shop aggregate + switcher typeahead + LCP<2s gate, proven with SEMrush — account-level, no per-shop OAuth) · **10** Google Ads (provision tables + wire the already-built OAuth/sync code + paid panel) · **11** GA4 + GSC (new per-shop Google OAuth D68, pgsodium-encrypted refresh tokens + ingest + panels) · **12** PSG report (narrative + monthly PDF spec'd to the hand-built client deliverable, template canon = `archive/local_reach-outputs/`). Cut from v0.3 → v0.3.5+: digital presence/listings + post-repair sentiment. **Next: `/paul:plan` Phase 9.** ── v0.2 Customer MVP ✅ COMPLETE 2026-06-04, promoted + LIVE on hub.psgweb.me (merged main `fc6e1cc`, dpl_Wyi5, tag `psg-hub-v0.2.0`); archived to MILESTONES.md + `milestones/v0.2.0-ROADMAP.md`.

Carried into later milestones: MSO portfolio/aggregate view + switcher typeahead → v0.3 · LCP <2s perf gate → v0.3 · Stripe INSERT→UPSERT + PII-at-rest retention → v0.4 · audit log → v1.5 · full 14-domain AEGIS → v2.0.

**v0.2 Customer MVP ✅ COMPLETE (2026-06-04)** — 3 phases / 14 plans; secure role-gated multi-tenant customer surface LIVE on hub.psgweb.me. All quality gates PASS (Vitest 88.85%, Playwright E2E, WCAG AA, AEGIS no-blocker, gitleaks clean, brand static+visual).

**v0.1 Foundation ✅ COMPLETE (2026-06-02)** — all 5 phases loop-closed; gitleaks milestone scan clean (1 vetted false positive allowlisted in `.gitleaksignore`); AEGIS scoped to v2.0; milestone archived + tagged `v0.1.0` (local). The v0.1→main merge / submodule-grant action is moot under CLI `vercel --prod` (option C; deploys work today, fonts vendored).

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
| Phase 1 — Workspace git collapsed to single monorepo (`apps/psg/.git` = `data` repo); nested repos bundled to `archive/_repo-bundles/` then dropped | 01-01/05/07; avoids embedded gitlinks | 2026-05-31 | Shipped |
| Phase 1 (01-06) — only BSM `studio` was a real package; 4 stubs deferred (no fabricated package.json) | reality vs plan at checkpoint | 2026-05-31 | Shipped |
| Phase 1 (01-07) — `apps/ads` `.env` preserved (not deleted); non-Python content moved with the worker tree | irreversible-credential + operator Option A | 2026-05-31 | Shipped |
| Phase 2 — `colors_and_type.css` canonical over SKILL.md (paper `#FAFAFA`, headings Bold 700) | DS self-contradicts; operator confirmed | 2026-06-01 | Shipped |
| Phase 2 — Logos = DS reconstruction placeholder; raw-asset consumption (not npm-wrapped); product name "Phoenix Solutions Group" | official vector not on hand; `next/font/local` needs literal paths | 2026-06-01 | Shipped |
| Phase 2 — route group `(dashboard)` → segment `dashboard` to fix `/`-collision 404 | dashboard was unreachable | 2026-06-01 | Shipped |
| Phase 3 — shared `src/lib/resilience.ts` (retry + circuit breaker) for all external calls; webhooks idempotent via DB UNIQUE + signature-verified (ECDSA SendGrid / HMAC Twilio) | resilience + idempotency constraints; proven across 2 providers | 2026-06-01 | Shipped |
| Phase 3 (03-04) — NEW Vercel `psg-hub` project instead of re-linking `data` (supersedes D54 *mechanism*, intent intact) | `data` was a broken non-customer portal; re-link would arm a routeless-main clobber | 2026-06-01 | Shipped |
| Phase 3 (03-05) — D54 decommission satisfied by verified state (old `data` project 404; no BSM/ads-dashboard project); KEEP psg-hub↔`Phoenix-Solutions-Group/data`@main git connection | targets already retired out-of-band; operator confirmed the active git-connected stack | 2026-06-01 | Shipped |
| Phase 3 (03-05) — MERGE-BLOCKER: grant Vercel GitHub-app access to private `design-system` submodule before Phase-3→main merge | git/main builds fail on submodule fonts (proven dpl_2Mbq7…); CLI deploys work | 2026-06-01 | Open (gated) |
| Phase 4 (04-01) — PAUL inheritance closed via a navigable `references/INDEX.md`; the inheritance itself was front-loaded into Phase 1, so Phase 4 added a usability layer rather than re-copying; `ACTIVE.md` superseded by `STATE.md` (no file created) | inheritance deliverables already shipped; operator chose "add usability layer"; current PAUL framework has no ACTIVE.md | 2026-06-01 | Shipped |
| Phase 5 (05-01) — local_reach client outputs preserved on-disk only (gitignored `archive/local_reach-outputs/`), codebase retired; verify-and-close, no version-controlling | scope front-loaded into Phase 1 / 01-04; operator chose lean close; outputs are v0.3 BSM-migration reference material, and `archive/` holds a 3.1GB db so the tree stays gitignored | 2026-06-02 | Shipped (closes v0.1) |
| Phase 6 — RBAC spine DEFINED not extended; path-A shared-mutate (no-hook security-definer resolvers in `private.*`), 26 anon-open policies deferred to Phase 8 | grounding found no BSM Phase-4 RLS base + no role enum deployed; project-global token hook would break login + Claire's tokens | 2026-06-02 | Shipped |
| Phase 6 — migrations-as-code is the only DDL path on shared prod; advisor baseline+diff gate per migration; read-only MCP otherwise | shared prod holds 314,828 PII rows / 142 shops; 06-01 PROTOCOL/CHECKLIST | 2026-06-02 | Shipped |
| Phase 6 (06-02) — superadmins = Nick + Tina + Brian; Claire excluded (legacy `profiles.role='admin'` left untouched) | operator at review checkpoint | 2026-06-02 | Shipped |
| Phase 6 (06-04) — reviews EXTEND live `review_responses` (+11 governance cols) vs strip/rebuild; reads/writes via PostgREST aliasing | live schema diverged hard from shipped app; 0 rows = zero data risk | 2026-06-02 | Shipped |
| Phase 6 (06-05) — membership unified on `shop_users(user_id)` mechanical-repoint (user-session reads work via `user_shop_ids()` SELECT policy); deferred surfaces guarded not deleted; only `llm_call_log` stood up | spine-completion scope; ads→v0.3, agents→v1.6, ingest→its milestone; onboarding first-owner INSERT RLS-blocked → Phase 7 service-role route | 2026-06-03 | Shipped |
| Phase 7 (07-01) — self-serve onboarding via service-role `POST /api/onboarding` (client→shop→first-owner→customer role, compensating cleanup); gate routes no-shop users to the wizard | first-owner `shop_users` INSERT is RLS-blocked under user-session (chicken-and-egg); shops.client_id NOT NULL → clients-first ladder | 2026-06-03 | Shipped |
| Phase 7 (07-02) — tier gating DEFINED as a shared ranked helper (`src/lib/tier/gate.ts`); `assertAdsTier` reduced to a delegate (byte-identical error); override reader centralized | one mechanism for v0.3 analytics + later features to reuse; behavior-preserving; `.maybeSingle()` kept (S3 duplicate-row hardening = v0.4 billing) | 2026-06-03 | Shipped |
| Phase 7 (07-03) — shop switcher = a `psg_active_shop` cookie that SELECTS among authorized shops, never authorizes (resolver re-validates vs membership every read; RLS + `.eq(shop_id)` backstop); switch via API route (no server actions); switcher scopes pages only, authz routes keep explicit shop_id | MSO support (PROJECT target users); security crux = stale/forged cookie must not leak; ads alignment deferred (its owner-first + redirect + tier gate too big for the phase close) | 2026-06-03 | Shipped |
| Phase 8 (08-01) — git↔Vercel WIRED to `Phoenix-Solutions-Group/psg-internal` (rootDir `psg-hub/apps/psg-hub`); prod-on-main auto-deploy kept OFF (`vercel.json` git.deploymentEnabled.main=false); CLI `vercel --prod` remains the deploy path; **NO submodule in psg-internal → the old design-system submodule merge-blocker (D03-05) is MOOT** | the stale "data@main + submodule" picture was wrong; previews are env-less (sensitive prod env) | 2026-06-03 | Shipped |
| Phase 8 (08-02) — close blanket-allow RLS via one idempotent migration: drop 24 anon+auth Allow-all on 12 tables; `shops` retighten to authenticated, `clients`+9 siblings default-deny, `profiles` self-row + superadmin read | the `authenticated` half = cross-tenant breach (M2 PII gate); reframes the 06-01 "26 anon-open" deferral | 2026-06-04 | Shipped |
| Phase 8 (08-03) — first AEGIS pass scoped to the customer surface; NO launch-blocker (2 top claims refuted by adversarial verification); Stripe/billing→v0.4, PII-at-rest retention→v0.4, audit-log→v1.5 | launch-readiness gate; surfaces not yet built shouldn't gate v0.2 | 2026-06-04 | Shipped |
| Phase 8 (08-04) — Vitest coverage gate denominator = the 13 v0.2 new-code modules (perFile lines:70), NOT whole-src; mobile-nav.tsx excluded (DOM-only → E2E) | whole-src threshold would dilute the gate against inherited/v0.3-gated code | 2026-06-04 | Shipped |
| Phase 8 (08-04b) — Playwright E2E runs against a LOCAL Supabase target (db reset from in-repo migrations; programmatic service-role seed + storageState per role), ZERO prod contact; `--muted-foreground` darkened #949494→#707070 to clear a serious WCAG AA contrast fail (small token-value touch of the Phase-2 canon, operator-accepted) | sensitive prod env makes hosted previews env-less; the AA floor (4.5:1) is a hard S5 gate, not deferrable | 2026-06-04 | Shipped |

## Success Metrics

| Metric | Target | Current | Status |
|--------|--------|---------|--------|
| Vitest coverage (new code) | ≥70% lines | **88.85%** (perFile≥70, 255 tests; Phase 8 / 08-04) | ✅ Pass |
| Playwright E2E happy paths | auth + 1 customer + 1 ops | **auth + customer + shop-switch ✅** (Phase 8 / 08-04b); ops → v1.1 | ✅ Pass (customer scope) |
| AEGIS audit per milestone | Pass | v0.2: ✅ first pass, NO launch-blocker (Phase 8 / 08-03) | ✅ Pass |
| gitleaks scan per milestone | No real secrets | v0.2: ✅ clean (Phase 8 / 08-02b); v0.1: ✅ clean | ✅ Pass |
| WCAG AA on customer routes | Pass | v0.2: ✅ 0 serious/critical, axe in-run (Phase 8 / 08-04b) | ✅ Pass |
| LCP on /dashboard | <2s | not measured (deferred — no perf gate in v0.2 scope) | Deferred → v0.3 |
| Brand conformance audit per UI milestone | Pass | v0.2: ✅ static (08-04) + visual (08-04b) PASS | ✅ Pass |
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
| Anchor (BSM) — relocated Phase 1 | `apps/psg/apps/psg-hub/` (was `~/apps/projects/bsm/dashboard/`); Sanity studio → `apps/psg/packages/studio` (`@psg/studio`); 4 non-package stubs + docs residue remain at `~/apps/projects/bsm/` (deferred) |
| ads-dashboard PAUL (absorbed plans) | `apps/psg/apps/psg-hub/.paul/references/ads-dashboard/` (absorbed); source archived |
| Ads Python worker (surfaced v1.2) — relocated Phase 1 | `apps/psg/apps/psg-ads-mutations/` (was `~/apps/ads/`); history bundle at `archive/_repo-bundles/ads-pre-drop-20260531.bundle` |
| Master Project Plan (v1.6 source) | `apps/psg/psg-advantage-portal/Master Project Plan_ PSG Agentic Market Intelligence Platform.md` |
| FleetComplete 2019 spec (v1.1+ source) | `~/Library/CloudStorage/.../PSG Project Technical Design v1.0_Final.txt` |

---
*PROJECT.md — Populated from SEED ideation v7 (projects/psg-hub/PLANNING.md, 70 decisions)*
*Last updated: 2026-06-04 — milestone **v0.2 Customer MVP ✅ COMPLETE** (3 phases / 14 plans; version bumped 0.1.0→0.2.0; archived to MILESTONES.md + milestones/v0.2.0-ROADMAP.md). LIVE on hub.psgweb.me. Next: /paul:discuss-milestone → v0.3 Customer Analytics.*
