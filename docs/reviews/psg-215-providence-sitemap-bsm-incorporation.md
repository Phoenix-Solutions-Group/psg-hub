# PSG-215 — Repo Review & BSM Incorporation Roadmap

**Author:** Ada (Chief Developer) · **Date:** 2026-06-23 · **Issue:** PSG-215
**Repos reviewed:**
- `nmschoolcraft/providence` — "AI marketing employee for collision repair shops" (Next.js + Supabase, built)
- `Phoenix-Solutions-Group/sitemap-maker` — `/sitemap-maker <client>` Claude Code workflow (spec, "in progress / to build")

> **Access method.** Both repos are private (404 unauthenticated, no deploy-key/`gh` access). Reviewed read-only through nick's authenticated GitHub session (org owner). I extracted the full recursive file tree of `providence` (98 files, commit `6b11ad7`) and the complete `sitemap-maker` README/spec. Raw per-file source dumps were partially blocked by the browser tool's credential-data guard, so the Providence design below is reconstructed from its **file/route/module/migration structure** (which is unusually self-documenting) plus the `sitemap-maker` README. Where a child issue needs exact source, the implementing engineer should re-pull via the same authenticated session or request a read-bridge paste.

---

## 1. Executive summary

Providence is, in effect, **a parallel and more *autonomous* prototype of the same vision BSM is chasing**: an always-on AI marketing employee for collision/auto-body shops. BSM has the stronger *platform* backbone (multi-tenant RLS, Stripe billing tiers, ops console, Google Ads mutation studio, the `/ops/intel` competitive-intelligence engine, the FileMaker/RO import pipeline). Providence has the stronger *autonomy + local-presence* surface (a cron-driven orchestrator loop, Google Business Profile posting, proactive review solicitation over SMS+email, and a clean generic approval queue).

`sitemap-maker` is the missing **content-architecture engine**: it turns competitive + keyword research into a client-ready sitemap and content plan, with a collision-repair vertical module (8 personas, required-page coverage) that is directly on-target for BSM's ICP.

**Recommendation:** Do not fork or re-deploy Providence. **Harvest its proven patterns into BSM**, which already owns the customer, the billing relationship, and the data. Sequence the work as a single competitive-research → architecture → execution → reporting loop. Wave 1 below covers the three capabilities the ticket explicitly names; Wave 2 is the strategic autonomy layer that needs a CEO cost/governance decision before we commit the team.

---

## 2. What BSM already has (baseline)

| Area | Status in BSM | Location |
|------|---------------|----------|
| Competitive intelligence | **Shipped** — superadmin `/ops/intel`: budget-metered LLM research, competitor scoring/sync/consolidators, PDF/HTML report. *Manual, on-demand, Demo-shop only today.* | `src/lib/intel/**`, `src/app/ops/intel` |
| SEO audit | Skill-based (Phase 1 agent engine): `seo-auditor`, `market-researcher`, `content-writer`. *Manually invoked, not a customer-facing deliverable.* | `src/lib/agent-engine/**` |
| Review management | Code-complete, **not deployed** (Phase 5): Google+Yelp ingestion, AI review-response drafting w/ prompt-injection defense, append-only audit, role-gated approval. | BSM Phase 5 (inherited) |
| Paid search | Google Ads API v20 (read + mutation studio), per-shop OAuth, AES-256-GCM token encryption, tier/budget gates. | `apps/psg-ads-mutations/`, ads routes |
| Platform | Supabase auth + multi-tenant RLS, role enum, Stripe tiers (Essentials/Growth/Performance), customer dashboard, onboarding wizard. | BSM Phase 4 / psg-hub |
| **Sitemap / site architecture** | **None.** No `sitemap`, `site-architecture`, or content-plan capability anywhere in the tree. | — |
| **Google Business Profile (GBP) posting** | **None.** BSM does Ads + reviews, not GBP local posts. | — |
| **Autonomous scheduler/orchestrator** | **None.** BSM agents are manual/skill-invoked; there is no cron-driven "do the work and queue it for approval" loop. | — |
| **Proactive review solicitation (SMS/email)** | **None.** BSM responds to reviews; it does not request them. | — |

---

## 3. Repo A — Providence (capability map)

Reconstructed from the file tree (`src/lib`, `src/app/api`, `supabase/migrations`).

**Autonomous "AI employee" loop — the headline capability.** A cron-driven orchestrator that produces work, queues it, and publishes on approval:
- `src/lib/agents/orchestrator.ts` (+ test), `post-queue.ts`, `types.ts`
- Cron routes: `api/cron/competitor-scrape`, `daily-reviews`, `post-generation`, `publish-approved`, `weekly-report`, `monthly-pdf`
- Agents: `competitor-monitor-agent.ts`, `gbp-post-agent.ts`, `review-response-agent.ts`

**Google Business Profile (GBP).** OAuth (`api/oauth/start|callback`), `src/lib/gbp/client.ts`, GBP post agent, `gbp_resource_names` + `publishing_status` migrations. Net-new local-presence channel BSM lacks.

**Proactive review generation.** `src/lib/email/solicitation.ts`, `src/lib/sms/client.ts`, `api/sms/webhook`, `api/unsubscribe`, `api/cron/daily-reviews`. SMS+email outreach with unsubscribe compliance.

**Generic approval queue (human-in-the-loop).** `api/approval/[id]/approve|reject`, `src/components/approval-card.tsx`, `src/lib/db/approval-queue.ts` (+ test). A reusable "agent proposes → human approves → system publishes" gate — cleaner/more general than BSM's single-step content approval.

**Reporting.** `src/lib/reports/monthly-pdf.ts`, `weekly-email.ts` + matching crons. Client-facing recurring reports, shipped.

**Shared platform (overlaps BSM — confirms our patterns, little to port).** Supabase (`supabase.ts` + 5 migrations), shop-owner auth gating (`require-shop-owner`, `get-shop-for-page`, `require-cron`), token `encryption.ts` (+ test, `bytea`), LLM `client/safe-generate/sanitize` (same prompt-injection-defense posture as BSM Phase 5), `activity-log`, `locations`, `oauth-tokens`, `shops`.

**Inferred integration stack** (from module names; confirm at build time): Resend (email — `docs/runbooks/resend-domain.md`), an SMS provider (Twilio-class), Google Business Profile API, Anthropic Claude, Supabase, Google OAuth.

---

## 4. Repo B — sitemap-maker (capability)

A guided `/sitemap-maker <client>` Claude Code command that runs the SEO sitemap relay as **one gated workflow** instead of a manual multi-Strategist hand-off. Status: **spec / "to build"** (no implementation shipped yet).

- **Chains:** Semrush MCP (keyword universe / competitor gaps) → `seo-audit` + `firecrawl-map` (baseline + URL inventory, Keep/Improve flags) → `seo-competitor-pages` (content-gap) → `seo-cluster` (SERP clustering) → `seo-sxo` (page-type validation) → `site-architecture` (hierarchy, slugs, internal links, 3-click rule) → `seo-plan` (content calendar).
- **Two human checkpoints:** (1) approve clusters + page types; (2) approve the package before client hand-off.
- **Single hierarchy source → no drift:** `page-inventory.csv` + `sitemap.mmd` (Mermaid) derive from one structure.
- **Outputs:** `page-inventory.csv`, `sitemap.mmd`, `content-calendar.md`, `summary.md`.
- **Collision-repair vertical module** (`collision-repair-content-system`): 8 personas + required-page coverage feeding clustering + architecture — **directly BSM ICP-relevant.**
- **Semrush fallback** (no seat): `seo-dataforseo`, `seo-google` (own-site GSC), `seo-backlinks`.

---

## 5. Gap analysis — "have we left anything out?"

Mapping the ticket's three named items + what the repos reveal BSM is missing:

| # | Capability (ticket) | In BSM today? | Gap → action |
|---|---------------------|---------------|--------------|
| 1 | **Site-map maker** | No | Build the content-architecture engine (Wave 1A). |
| 2 | **Competitive intelligence** | Partial — `/ops/intel`, but manual + Demo-only | Make it continuous + per-shop (Wave 1B: Providence's competitor-monitor + scrape cron feeding existing scoring). |
| 3 | **Shop audit (Providence)** | Partial — `seo-auditor` skill, not a deliverable | Formalize into an onboarding shop-audit deliverable (Wave 1C). |

**Additional gaps these repos surface (not in BSM's first iteration):**
- **G-a. Autonomous orchestration.** BSM has no "always-on employee" loop. This is the single biggest delta and the essence of the "AI marketing employee" promise.
- **G-b. Google Business Profile posting.** Highest-leverage *local* SEO channel for collision shops; entirely absent.
- **G-c. Proactive review solicitation (SMS/email).** BSM only *responds* to reviews; growth comes from *requesting* them.
- **G-d. Generic approval queue.** A reusable agent→approve→publish gate; BSM's approval is content-specific and single-step.

G-a–G-d carry real cost/governance weight (new OAuth app, SMS spend, autonomous-publishing governance) → **Wave 2, CEO decision** (see §7).

---

## 6. Incorporation strategy — one unified loop

BSM's competitive-research story should read as a single pipeline, with each repo supplying a stage:

```
[AUDIT]            [INTEL]                     [ARCHITECT]            [EXECUTE]                 [REPORT]
shop SEO audit  →  continuous competitor   →   sitemap + content  →  autonomous agents      →  weekly/monthly
(seo-auditor,      monitoring (Providence       plan (sitemap-       draft GBP posts/content/   client reports
 firecrawl-map)    competitor-monitor →         maker, collision     review replies → approval  (Providence
                   /ops/intel scoring)          vertical)            queue → publish            reports)
   ↑ Wave 1C          ↑ Wave 1B                    ↑ Wave 1A             ↑ Wave 2 (G-a/b/c/d)
```

**Architectural principle:** BSM is the system of record (customers, billing, RLS, ops). We **port patterns and modules into BSM's conventions** (Next.js 16 app router, Supabase RLS with `profile_id`, the existing intel engine, append-only audit, AES-256-GCM token encryption) rather than running Providence as a second app. No secrets leave their stores; new integrations get per-shop OAuth + encrypted tokens like the Ads path.

---

## 7. Roadmap

### Wave 1 — the three named capabilities (delegated now; explicitly requested in the ticket)

| Child | Title | Owner | Depends on | Acceptance (summary) |
|-------|-------|-------|------------|----------------------|
| 1A | Sitemap & content-architecture engine | Nora | — | A BSM-native flow produces `page-inventory.csv` + Mermaid sitemap + content calendar from a shop brief; collision-repair vertical (8 personas) wired; two approval checkpoints; CSV/tree single-source (no drift). QA by Tess. |
| 1B | Continuous competitor monitoring → `/ops/intel` | Ravi | — | Providence's competitor-monitor + scrape cadence drives BSM's existing `intel` scoring/consolidators on a schedule, per-shop (not Demo-only), budget-gated; results land in the intel report. QA by Tess. |
| 1C | Shop SEO audit deliverable | Nora | 1A (shares architecture/firecrawl plumbing) | `seo-auditor` formalized into a baseline audit + URL inventory (Keep/Improve) attached to onboarding and re-runnable; customer-visible. QA by Tess. |

Every Wave 1 change goes through Tess QA before it is called done; UX-facing surfaces (sitemap deliverable, audit report, intel surfacing) get a designer review.

### Wave 2 — autonomy layer (CEO decision required before build)

Surfaced to Steve via a `suggest_tasks` interaction on PSG-215. Each carries cost/governance the board should weigh:

- **G-a. Autonomous orchestrator loop** — always-on agent that produces + queues work. *Governance:* nothing publishes without the approval queue; budget caps per shop.
- **G-b. Google Business Profile posting** — new Google OAuth app + per-shop consent. (Note: a GBP client secret was already chat-pasted — see PSG-45 secret rotation — so partial groundwork exists.)
- **G-c. Proactive review solicitation (SMS + email)** — new SMS vendor + spend; TCPA/CAN-SPAM + unsubscribe compliance.
- **G-d. Generic approval queue** — reusable agent→approve→publish gate; prerequisite that makes G-a/b/c safe. **Recommended first** of the four.

---

## 8. Risks & notes

- **Don't double-build review-response.** BSM Phase 5 already has AI review-response drafting + injection defense; Providence's is the same pattern. Reuse BSM's; only the *solicitation* (outbound) and *autonomous scheduling* are net-new.
- **Phase 5 is code-complete but undeployed.** Wave 2 autonomy should ride on a deployed reputation surface; sequence accordingly.
- **Intel is currently Demo-shop-only.** Wave 1B must prove per-shop tenant isolation (RLS) before any continuous cron runs across real customers.
- **sitemap-maker is a spec, not code.** Wave 1A is a genuine build against a design doc, not a port — scope it as such.
- **Cost/governance items (Wave 2) are board-gated**, consistent with how Ads spend, secrets, and infra toggles are handled in this company.

---

*Prepared for PSG-215. Wave 1 child issues are filed and delegated; Wave 2 is pending CEO prioritization via the suggest_tasks interaction on this issue.*
