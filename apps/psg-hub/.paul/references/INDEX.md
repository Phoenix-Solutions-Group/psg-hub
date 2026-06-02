# psg-hub PAUL — Inheritance INDEX

This directory holds two **inherited PAUL snapshots**, preserved read-only when their projects folded into psg-hub during v0.1:

- `bsm/` — Body Shop Marketing dashboard (the psg-hub anchor, BSM Phases 1-5). Preserved via the Phase 1 relocation.
- `ads-dashboard/` — the customer-analytics scaffold, absorbed 2026-05-29 in Phase 1 / plan 01-03 (D70), brand-reconciled in Phase 2 / 02-04.

The snapshots are **historical and immutable**. This `INDEX.md` is the only living file under `references/`: it maps each inherited body of work to the future psg-hub milestone that consumes it, so the archives stay navigable design-intent canon instead of dead weight. Built in Phase 4 / plan 04-01 (2026-06-01).

> **Read the caveats.** Several inherited docs predate reconciliation. Where an inherited ROADMAP/PROJECT contradicts what actually shipped, the per-phase "Caveats" below win, and the live psg-hub `.paul/STATE.md` / `ROADMAP.md` / `PROJECT.md` win over both.

---

## A. BSM (the anchor) — `.paul/references/bsm/`

BSM is the shipped foundation psg-hub is built on. Entry docs: [`bsm/PROJECT.md`](bsm/PROJECT.md), [`bsm/ROADMAP.md`](bsm/ROADMAP.md), [`bsm/STATE.md`](bsm/STATE.md), [`bsm/SPECIAL-FLOWS.md`](bsm/SPECIAL-FLOWS.md), [`bsm/DASHBOARD-README.md`](bsm/DASHBOARD-README.md). BSM planned 7 phases; **Phases 1-5 shipped** (history is partial by design).

| Phase | Path | What shipped (1 line) | Consumed by |
|-------|------|-----------------------|-------------|
| 1 — Agent Engine | [`bsm/phases/01-agent-engine`](bsm/phases/01-agent-engine) | Four-agent collision-repair marketing engine as Claude Code skills (SEO auditor, market researcher, content writer + pre-existing scraper) + Paperclip config + shop-profile schema + 8-step onboarding pipeline; validated end-to-end on Tracy's Collision Center; manual skill invocation ("Phase 0" mode), live creds deferred. | **v1.6** (primary: agent skills, peer model, Paperclip org) · **v0.3** (SEO/market briefs seed story narrative) · **v1.1** (shape ref only: shop-profile schema + onboarding concepts; v1.1 is greenfield) |
| 2 — Internal Operations | [`bsm/phases/02-internal-operations`](bsm/phases/02-internal-operations) | Local Paperclip server (embedded Postgres, heartbeat, loopback auth) + 4 budgeted agents + Sanity BSM project (`436nqu7v`) + 4-type content schema (shop/contentItem/auditReport/researchBrief) + content review workflow; validated on Tracy's. | **v1.6** (primary: agent runtime) · **v1.1** (shape ref only: Sanity shop schema + survey data) · **v1.5** (audit trails, approval gates) · **v0.2** (multi-shop + review role) |
| 3 — Content Preview | [`bsm/phases/03-content-preview`](bsm/phases/03-content-preview) | Per-client styled HTML content-preview pipeline (markdown to shop-branded HTML, XSS-escaped, Approve/Request-Changes banners) + Sanity status field + 5th agent `bsm-site-designer` (crawl + multi-page template extract). | **v0.2** (portal approval UI + PSG-vs-client roles) · **v1.6** (site-designer agent + 5-agent swarm) · **v0.3** (client-branded report templating → monthly PDF) |
| 4 — Customer-Facing MVP | [`bsm/phases/04-customer-facing-mvp`](bsm/phases/04-customer-facing-mvp) | Next.js 15 customer dashboard: Supabase auth + multi-tenant RLS (5 tables, 7 policies, helper fn, profile trigger) + role enum (owner/manager/viewer) + content/approval views + 5 agent-status cards + Stripe billing (Essentials $199 / Growth $499) + 3-step onboarding wizard. | **v0.2** (strongest: auth/RLS/role-enum/tier field) · **v0.4** (Stripe Checkout/Portal/webhook + subscriptions) · **v1.5** (role enum + `agent_runs` audit shape) · **v0.3** (authenticated dashboard host shell) |
| 5 — Reputation + Ads | [`bsm/phases/05-reputation-ads`](bsm/phases/05-reputation-ads) | Code-complete (tests pass, runtime-unverified) reputation + paid-search: review ingestion (Google + Yelp) + `/reviews`; AI review-response drafting (Claude Haiku 4.5 + prompt-injection defense + append-only audit + role-gated approval); Google Ads API v20 backend (per-shop OAuth, AES-256-GCM encrypted refresh tokens, tier/budget gates, 7 routes); Performance-tier Stripe + `/ads` + campaigns UI. | **v0.3** (Google Ads data source → unified analytics; *loose:* review/sentiment data → Customer-Analytics sentiment/presence) · **v0.4** (Performance-tier Stripe path) · **v0.2** (tier-gate + RBAC precedent) · **v1.5** (append-only audit pattern) · **v1.6** (AI-drafting-with-governance pattern) |

### Caveats for downstream planners (grounded in the inherited SUMMARYs/AUDITs)

- **Phase 5 is code-complete, NOT deployed.** "Phase 5 COMPLETE" in `05-05-SUMMARY` means code + 136 passing tests, runtime-unverified: blocked on ~15 env vars, Supabase project link, migration application, Stripe price IDs, and a Google dev-token Standard tier + MCC. Treat as a reference implementation, not a live system.
- **BSM ROADMAP/PROJECT are stale vs what shipped.** Phase 5 header still says "Plans: TBD / Not started" and leaves 05-04/05 unchecked though all 5 shipped; Phase 4 ROADMAP lists 6 plans but 3 consolidated plans shipped; Phase 1 ROADMAP names test client "Phil Long" but every artifact used Tracy's Collision Center. Trust the SUMMARYs over the inherited ROADMAP.
- **Doc coverage is uneven.** Phases 2 and 3 are mostly SUMMARY-only (thin, no frontmatter, few/no PLAN/AUDIT/CONTEXT); Phase 1 has SUMMARYs for 01-02/01-03 with no matching PLAN; only Phase 5 has AUDITs (and 05-01 has none). Planned-vs-actual is not fully reconstructable for Phases 1-3.
- **RBAC scope.** BSM RBAC is a membership role enum (owner/manager/viewer), not a superadmin matrix; tiers are stored (`subscriptions.tier`) but hard feature-gating between content tiers (Essentials/Growth) was thin, though Phase 5 did hard-gate the Performance ads tier via `assertAdsTier`; approval is single-step, not the dual/triple agent→PSG→client chain (the SUMMARY titles' "dual approval" wording refers to an unshipped goal, ROADMAP 04-04). psg-hub v0.2/v1.5 build the fuller model.
- **Known carried bugs/risks** (from Phase 5): Stripe webhook uses INSERT not UPSERT for subscriptions (duplicate rows on re-subscribe, inherited from Phase 4); pre-existing Google Ads campaigns in a linked account remain mutable by BSM; refresh-token-compromise window unmitigated; Facebook + Carwise review adapters deferred; no review-sync cron (manual only).
- **Reputation has no clean named consumer.** The review-monitoring half of Phase 5 maps only loosely; only the AI-drafting governance pattern maps cleanly (→ v1.6). A standalone reputation customer surface is not in the current v0.2-v1.6 milestone set.

---

## B. ads-dashboard (absorbed, D70) — `.paul/references/ads-dashboard/`

Absorbed as **design-intent canon for v0.3 Customer Analytics**. The scaffold code itself was NOT absorbed (BSM Next 16 + the workspace monorepo supersede the Next 15 scaffold); only the PAUL plans + concepts carry forward. Authoritative record: [`ads-dashboard/ABSORPTION-NOTES.md`](ads-dashboard/ABSORPTION-NOTES.md). Other docs: [`PROJECT.md`](ads-dashboard/PROJECT.md), [`ROADMAP.md`](ads-dashboard/ROADMAP.md) (5 phases: Foundation, Data Pipeline, Multi-Client + RLS, Story Layer, Reports + Polish), [`ORIGINAL-PLANNING.md`](ads-dashboard/ORIGINAL-PLANNING.md), [`ORIGINAL-README.md`](ads-dashboard/ORIGINAL-README.md), [`ORIGINAL-SECURITY.md`](ads-dashboard/ORIGINAL-SECURITY.md), [`SPECIAL-FLOWS.md`](ads-dashboard/SPECIAL-FLOWS.md).

**Absorbed foundation plans** ([`ads-dashboard/phases/01-foundation/`](ads-dashboard/phases/01-foundation)) — wave chain 01-01 → (01-02, 01-03) → 01-04:

| Plan | What it specs | Informs |
|------|---------------|---------|
| [01-01](ads-dashboard/phases/01-foundation/01-01-PLAN.md) (+ [AUDIT](ads-dashboard/phases/01-foundation/01-01-AUDIT.md)) | Next.js 15 scaffold + Vercel + CI; security headers, pnpm pin, robots noindex, CODEOWNERS/SECURITY/Dependabot | Reference only (superseded by BSM Next 16). The audit-hardening patterns are worth reusing in psg-hub plans. |
| [01-02](ads-dashboard/phases/01-foundation/01-02-PLAN.md) | `/brandkit` PSG token extraction + Tailwind v4 `@theme` rebuild + shadcn token-override + brand-proof page (impeccable gate) | Informed v0.1 Phase 2 brand work. **Superseded as source of truth by the psg-brand submodule** (see caveat); methodology + anti-slop discipline carry forward. |
| [01-03](ads-dashboard/phases/01-foundation/01-03-PLAN.md) | Supabase magic-link auth + `@supabase/ssr` + `user_profile` RLS/trigger + custom-access-token hook injecting role + `client_id` JWT claims | Shape reference only (BSM already shipped auth). The role/`client_id` JWT-claims + default-deny RLS shape inform v0.3 multi-tenant access control. |
| [01-04](ads-dashboard/phases/01-foundation/01-04-PLAN.md) | Demo `/c/wallace` dashboard, narrative-first KPI cards, editorial (non-grid) layout, last-synced, impeccable shape+critique exit gate | **The v0.3 design canon.** Narrative-first KPI anatomy + editorial layout + story-led contract = how v0.3 builds the customer-analytics surface. |

**v0.3 design intents** (from ABSORPTION-NOTES): story-led narrative UI (plain-English KPI sentences, e.g. "Up 23% vs last month, added 3 new conversion goals on May 4"); "What PSG did" timeline backed by a `psg_activity_notes` table (renamed from the ads-dashboard `note` table); goals-based trend coloring via a `shop_goals` table (from the `goal` table); monthly print-styled report at `/dashboard/shop/[shopId]/report/[month]` + PDF export; pilot ads clients Wallace (6048611995) + Tedesco (7763526490) (D61's full v1.0 cohort also includes Tracy's, a BSM fixture with no ads ID).

> **Brand-reconcile caveat (Phase 2 / 02-04).** ads-dashboard shipped a PSG-token-overridden shadcn setup. It is reconciled to a single source of truth: the **PSG design system submodule at `packages/ui/psg-brand/`** (`colors_and_type.css` canonical). When v0.3 builds the customer-analytics surface from these absorbed plans, take brand tokens/components from the **submodule, not the archived ads-dashboard styling. The submodule wins on any divergence.**

---

## C. Inherited work → consuming milestone (reverse map)

What each future psg-hub milestone draws on from inherited PAUL bodies of work. Milestone structure lives in [`../ROADMAP.md`](../ROADMAP.md) / [`../PROJECT.md`](../PROJECT.md); this is the inheritance lens only.

| Milestone | Track | Draws on inherited work |
|-----------|-------|-------------------------|
| **v0.2** Customer MVP | Customer | BSM Phase 4: Supabase auth + multi-tenant RLS + role enum + tier field; BSM `profile_id` convention honored on new tables. |
| **v0.3** Customer Analytics | Customer | **ads-dashboard** absorbed plans (design canon) + BSM Phase 5 Google Ads data + BSM Phase 1 SEO/market briefs. Brand caveat applies (submodule wins). |
| **v0.4** Invoicing + Payments | Customer | BSM Phase 4/5 Stripe billing (Checkout/Portal/webhook, subscriptions, `getStripe()` pattern); adds new Invoiced.com mirror. v1.0 launch. |
| **v1.1** Ops Foundation | Ops | Greenfield from the FleetComplete 2019 spec + psg-import. Inherits cross-cutting BSM conventions (shared Supabase identities, `profile_id`); BSM shop-profile / Sanity-shop schema + survey data serve as shape references only, not direct inheritance (consistent with Section A Phases 1-2). |
| **v1.2** Ads Mutation Studio | Ops | `apps/psg-ads-mutations/` Python worker (relocated Phase 1) + BSM-shipped Google Ads read side. Not BSM/ads-dashboard PAUL. |
| **v1.3** Production Module | Ops | None inherited. Greenfield Lob.com + in-house print dual adapter (D53). FileMaker retired as daily driver here. |
| **v1.3.5** FM Historical Migration | Ops | None inherited (optional FileMaker historical add-on). |
| **v1.4** Operational Reports | Ops | None inherited. 26 reports from the FleetComplete spec, over the v1.1 ops model. |
| **v1.5** Superadmin Matrix + Audit | Ops | Light: extends BSM role model + tier enum; reuses BSM Phase 5 append-only audit pattern (`llm_call_log`, `ads_api_call_log`, `review_response_versions`). |
| **v1.6** Internal Agentic Intelligence | Internal | BSM Phases 1-3 agent engine + Paperclip orchestration + market-intel stack (Claude Flow, Firecrawl, SEMrush); adds multi-LLM router, NotebookLM, Yext from the Master Project Plan. |
| **v2.0** Convergence + Hardening | Convergence | The full inherited foundation: BSM Vitest patterns + Playwright E2E (new), AEGIS, PII RLS review over inherited shared-Supabase RLS, perf, launch readiness. |

---

## D. Tracking model (the ACTIVE.md supersession)

psg-hub tracks PAUL work with **`.paul/STATE.md` as the canonical live tracker**. There is **no `ACTIVE.md`** in the current PAUL framework, and none is created.

- **`ACTIVE.md` is superseded by `STATE.md`.** The Phase 4 ROADMAP wording "ACTIVE.md updated" refers to an older PAUL convention. Its role (live position, status, session continuity) is fully absorbed by `STATE.md`, which holds the Loop Position (PLAN → APPLY → UNIFY), Current Position (milestone/phase/plan), per-plan APPLY logs, decisions, deferred issues, and continuity. No `ACTIVE.md` file exists or should be created.
- **`ROADMAP.md` / `PROJECT.md`** hold milestone + phase structure and decisions; `STATE.md` holds live status.
- **BASE satellite** (`.base/data/projects.json`, project `PRJ-002` "psg-hub", `is_paul_project: true`) is a **cross-project status mirror only**, not a source of truth. It mirrors `milestone: v0.1 Foundation`, `phase: PAUL inheritance + tracking`, status in_progress, `completed_phases: 3`. It refreshes from the canonical PAUL state via the BASE sync; on any divergence, `STATE.md` is authoritative.

---

## E. Restoration / originals

- **ads-dashboard** originals (full `.git` + `.paul/` tree) live at `apps/psg/archive/ads-dashboard/`; the GitHub repo `Phoenix-Solutions-Group/ads-dashboard` is read-only, not deleted.
- **BSM** original was the relocated anchor itself (now `apps/psg-hub/`); pre-relocation history is bundled at `apps/psg/archive/_repo-bundles/` (gitignored).

---
*INDEX.md — created Phase 4 / 04-01 (2026-06-01). Snapshots under `bsm/` and `ads-dashboard/` are immutable; update only this file.*
