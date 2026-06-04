# PAUL Session Handoff — psg-hub SEED Ideation

**Session:** 2026-05-28 to 2026-05-29
**Phase:** SEED ideation complete, PAUL not yet initialized
**Context:** Multi-iteration ideation pass for `psg-hub` — a unified PSG platform consolidating multiple existing PSG apps, customer-facing portal, internal operations backbone, and PSG-internal agentic market intelligence.

---

## Session Accomplishments

### Workspace mapping
- Ran `/paul:map-codebase` against `~/apps/psg/`. Produced 7 docs at `apps/psg/.paul/codebase/`:
  - `STACK.md` (83 lines), `ARCHITECTURE.md` (127), `STRUCTURE.md` (145), `CONVENTIONS.md` (65), `TESTING.md` (59), `INTEGRATIONS.md` (89), `CONCERNS.md` (133) — total 701 lines
- Manual workspace inventory of 14 subdirs at `~/apps/psg/` + cross-workspace discovery in `~/apps/`

### Scope discovery (cross-workspace investigation)
- **`~/apps/projects/bsm/`** — Body Shop Marketer, Next 16, ships with Stripe + multi-tenant Supabase + Google Ads + Sanity + Paperclip + Claude Flow + 4 AI agents. Already PAUL-managed (Phase 5 code-complete). Selected as **anchor** for psg-hub.
- **`~/apps/ads-dashboard/`** — customer-facing Google Ads reporting dashboard with story-led narrative UI, multi-tenant RLS, monthly PDF reports. Shipped May 2026. Same Supabase project as BSM/local_reach. **Absorbed** into v0.3.
- **`~/apps/projects/local_reach/`** — LocalReach AI / SEO Parser V5 (PHP + React + Cloudflare Workers, ~6GB). Customer-facing SEO content generation. **Deprecated** — BSM agents replace.
- **`~/apps/ads/`** — Python Google Ads + GTM mutation tooling with dry-run/execute safety pattern + audit logs. Active May 2026. Surfaced via v1.2 Ads Mutation Studio.
- **`apps/psg/psg-advantage-portal/`** — Next 15 internal market intelligence dashboards (27 tests, 30+ migrations, 7 dashboards, 15 API routes). Source for v0.3 market intel port.
- **`apps/psg/psg-data-lake/`** — Python ETL feeder writing to shared Supabase (30+ scripts). **Untouched**.
- **`apps/psg/psg-import/`** — RO/Estimate import preprocessor. Initially "untouched" decision; **reversed** to "absorbed in v1.1" after FleetComplete Advantage doc discovery.
- **FleetComplete 2019 Tech Design** — Advantage Program Upgrade spec (Angular + MS SQL planned, possibly never shipped). Defines PSG internal ops backbone: Companies, Repair Customers, ROs, Estimates, Surveys, Production printing, 26 reports, master data, Security Profiles. **Absorbed** as v1.1, v1.3, v1.4, v1.5.
- **Master Project Plan agentic intelligence** — competitor engine, Yext, weather correlation, multi-LLM router, NotebookLM. **Absorbed** as v1.6.
- **PSG Design System on GitHub** (`Phoenix-Solutions-Group/design-system`) — Gotham + Didact Gothic + brand tokens. Vendored as submodule in v0.1.

### Deliverables produced this session
- `apps/psg/projects/psg-hub/PLANNING.md` — iterated v1 → v6, currently **869 lines** with 49 design decisions, 25 open questions, 10 milestones, ~50 phases
- `apps/psg/apps/psg-hub/` — partially graduated (git init + README.md). **README.md is STALE** (v3 scope, predates BSM anchor swap, Advantage absorption, ads-dashboard absorption, GA4/GSC additions). Must re-synthesize before completing graduation.
- `apps/psg/.paul/codebase/` — workspace map (7 docs)
- This handoff doc

### Iterations on PLANNING.md
| Version | Trigger | Major change |
|---------|---------|--------------|
| v1 | initial SEED ideation | type=application, MVP cut, basic phase plan |
| v2 | post-walkthrough rigor | 10-section rigor sweep, RBAC, multi-tier, Stripe, design system from GitHub |
| v3 | post-design-system commit | strict-conform brand, Resend, Vercel re-link locked |
| v4 | BSM discovery + anchor swap | psg-advantage-portal → BSM as anchor; PAUL preservation; Next 16 |
| v5 | FleetComplete Advantage doc absorbed | Scope 2x: Companies/ROs/Estimates/Surveys/Production/26 Reports/SysConfig/Security Profiles; milestone-based delivery; v1.0 = customer track; v1.1+ = ops |
| v5.5 | apps/ads/ discovery | New milestone v1.2 (Ads Mutation Studio); Python worker bridge; 7 new ads tables; v1.3+ renumbered |
| v6 | ads-dashboard + local_reach + GA4/GSC | ads-dashboard absorbed (v0.3); local_reach deprecated (v0.1 archive); 11 new GA4/GSC/clients/notes/goals tables; unified marketing surface |

---

## Decisions Made

49 design decisions locked in `projects/psg-hub/PLANNING.md`. Top-level highlights:

| # | Decision | Rationale |
|---|----------|-----------|
| 3 | **BSM dashboard is the anchor** at `apps/psg/apps/psg-hub/` | Most shipped customer-facing surfaces; Next 16; already multi-tenant |
| 4 | Market intel ported from `psg-advantage-portal` into anchor (v0.3) | Anchor lacks market intel; port instead of rebuild |
| 5 | Next.js 16 across the board | BSM + ads-dashboard already on 16; upgrade ported code from 15 |
| 7 | Single GitHub repo `Phoenix-Solutions-Group/data` | Per portal/HANDOFF claim |
| 8 | BSM PAUL preserved; psg-hub milestones start at v0.1 | Honor BSM's Phases 1–5 work |
| 12 | Strict conform to PSG design system from GitHub submodule | No extensions; replaces BSM's oklch vars |
| 13 | **`psg-import` absorbed** into v1.1 (reversed earlier "untouched") | FleetComplete doc shows RO/Estimate Import is core ops module |
| 15 | MVP customer launch (v1.0) = milestones v0.1–v0.4 | Customer track ships first; FileMaker stays in production until v1.3 |
| 19 | Honored BSM tier enum `essentials` / `growth` / `performance` | No DB migration risk; Stripe metadata unchanged |
| 22 | Superadmins: Nick `nick@phoenixsolutionsgroup.net`, Tina `tina@phoenixsolutionsgroup.net`, Brian `bfinn@phoenixsolutionsgroup.net` | Auto-promote during v0.2 |
| 24 | Production domain `hub.psgweb.me` | User specified |
| 26 | Kill list approved: `invoice/`, `portal/`, `sst-psgdigital/`, `web-dev-skills/`, `dashboard-psgdigital/`, `shop-theacrb/`, `invoice-psgdigital/` | Confirmed dead/legacy |
| 29 | **Advantage Program scope absorbed** — Companies, Employees, Repair Customers, ROs, Estimates, Surveys, Production, 26 Reports, SysConfig, Security Profiles | 2019 FleetComplete tech design |
| 31 | **Milestone-based delivery**, customer + ops sequential | Single team; lowest risk |
| 32 | FileMaker Advantage retired at v1.3 cutover | Production module replaces it |
| 36 | `apps/ads/` Python tooling preserved + surfaced via web UI | Don't rewrite; Vercel Sandbox or FastAPI bridge |
| 41 | **`apps/ads-dashboard/` absorbed wholesale** in v0.3 | Already does the work; preserve story-led UI + PDF reports + timeline + goals |
| 42 | **`local_reach` deprecated** in v0.1 archive | BSM agents replace its function |
| 43 | Single shared Supabase project `gylkkzmcmbdftxieyabw` | ads-dashboard + BSM + local_reach + psg-advantage-portal already share it |
| 44 | GA4 + Search Console added as v0.3 modules | Per-shop OAuth same pattern as Google Ads |
| 46 | Workspace root stays `~/apps/psg/` | Existing repos relocate into `apps/psg/apps/*`, `apps/psg/packages/*`, `apps/psg/archive/*` |
| 49 | Goals + trend coloring `shop_goals` becomes platform feature | Drives coloring across ads + GA4 + GSC + presence |

---

## Gap Analysis with Decisions

### `apps/psg-hub/README.md` is STALE (v3 scope)
**Status:** CREATE
**Notes:** Must re-synthesize from v6 PLANNING.md before completing graduation. Includes: BSM anchor, Advantage absorption, ads-dashboard absorption, GA4/GSC integrations, milestone structure, 49 decisions.
**Effort:** small (single Write of synthesized doc)
**Reference:** `@projects/psg-hub/PLANNING.md`

### Graduation incomplete
**Status:** CREATE
**Notes:** `apps/psg-hub/` has `git init` + stale README but no initial commit. ACTIVE.md not updated. Graduation note not appended to original PLANNING.md.
**Effort:** small (refresh README → commit → update ACTIVE.md → append graduation stamp)
**Reference:** `@~/.claude/commands/seed/tasks/graduate.md`

### PAUL not initialized
**Status:** DEFER
**Notes:** Original `/seed:tasks:launch` flow was halted mid-graduation when user pivoted multiple times (BSM discovery, Advantage doc, ads-dashboard discovery). PAUL init should happen after graduation finalizes from v6 PLANNING.md.
**Effort:** medium (headless init with v6 brief; user approval of proposed structure)
**Reference:** `@apps/psg/projects/psg-hub/PLANNING.md`

### Unmapped PSG areas in `~/apps/`
**Status:** DEFER (Open Q23–25)
**Notes:** Not yet investigated — `Automation/`, `CFO/`, `CTO/`, `daily-content-brief/`, `gbrain/`, `governance/`, `morgan/`, `obsidian-vault/`, `open-design/`, `python-scripts/`, `DEGWEB-MODERNIZATION-REVIEW.md`. Could surface another collision like ads-dashboard did.
**Effort:** medium (scan + assess each)
**Reference:** `@apps/psg/projects/psg-hub/PLANNING.md` Open Q23

### Critical blockers for v0.1 architecture
**Status:** DEFER (need user input)
**Notes:** Critical open Qs 1–8 still need answers before v0.1 phase can be planned:
1. FleetComplete Angular system status (Q1)
2. FileMaker production status (Q2)
3. Python worker deployment model (Q3)
4. Mail vendor pick (Q4)
5. BSM Vercel project retire (Q5)
6. Sanity production dataset (Q6)
7. Paperclip runtime model (Q7)
8. BSM live customers — zero-downtime plan needed if any (Q8)
**Effort:** small (user decisions) + medium (research where needed, esp Q1, Q2)
**Reference:** `@apps/psg/projects/psg-hub/PLANNING.md` "Open Questions / Critical"

### `apps/ads-dashboard/` Phase 1 in-flight work
**Status:** INVESTIGATE
**Notes:** ads-dashboard PAUL state shows Phase 1 foundation in progress. v0.3 absorption needs to know what's still in flight to avoid losing work.
**Effort:** small (read ads-dashboard `.paul/STATE.md` + latest handoff)
**Reference:** `@~/apps/ads-dashboard/.paul/`

### BSM live customers
**Status:** CRITICAL — INVESTIGATE
**Notes:** If any production BSM customers exist, v0.1 needs zero-downtime migration plan + announcement. Tracy's Collision Center is listed as test client; need to confirm no other live shops.
**Effort:** small (confirm with Nick)
**Reference:** `@~/apps/projects/bsm/.paul/STATE.md`

---

## Open Questions

25 total in PLANNING.md. Bucketed:

### Critical (gate v0.1 / v0.2 / v1.2)
1. FleetComplete Angular system status — shipped or not?
2. FileMaker Advantage production status?
3. Python worker deployment (Vercel Sandbox vs FastAPI)?
4. Mail/print vendor pick (Lob.com vs ClickSend vs in-house)?
5. BSM Vercel project — retire in favor of renamed psg-advantage-portal project?
6. Sanity production dataset — confirm existing project + tier?
7. Paperclip runtime model — inside hub Node process or separate workers?
8. BSM live customers in production today?
9. NotebookLM IP population owner (v1.6 blocker)?

### Important (gate specific milestone)
10. Yext API account inventory (v1.6 scope)?
11. Customer launch date target (v1.0 schedule)?
12. Pilot cohort size + identity (v1.0 launch)?
13. Internal team capacity for v1.1–v1.6 — parallel possible later, or strictly sequential?
14. PDF visual design pass (v1.3 Production + v1.6 agentic reports)?
15. FileMaker data migration scope + retention requirements?
16. apps/ads/ client folder ↔ shop_id name mapping confirmation?
17. High-risk ads mutations requiring superadmin approval gate?
18. GTM mutation subset shipping in v1.2?
19. Existing `apps/ads/logs/*.json` backfill vs forward-only?
20. ads-dashboard Phase 1 PAUL state — what's in flight?
21. GA4 + GSC OAuth per-shop onboarding flow — admin-driven or self-link?
22. local_reach deprecation runway — any active dependencies before retirement?

### Discovery (gate scope completeness)
23. Other unmapped PSG areas in `~/apps/`?
24. What's "degweb" (`DEGWEB-MODERNIZATION-REVIEW.md`)?
25. `~/apps/gbrain/` integration — leverage for context/memory or stay independent?

### Operational
- Tracy's Collision Center role (fixture vs onboarded shop)
- First-login UX (tour, empty state, sample data)
- Domain coexistence (`hub.psgweb.me` + `psgweb.me` marketing + others)
- End-consumer PII retention policy

---

## Reference Files for Next Session

```
# Active planning doc
@apps/psg/projects/psg-hub/PLANNING.md          (v6, 869 lines, 49 decisions, 25 open Qs)

# Stale README (must re-synth)
@apps/psg/apps/psg-hub/README.md                (v3 scope — stale)

# Workspace codebase map
@apps/psg/.paul/codebase/STACK.md
@apps/psg/.paul/codebase/ARCHITECTURE.md
@apps/psg/.paul/codebase/STRUCTURE.md
@apps/psg/.paul/codebase/CONVENTIONS.md
@apps/psg/.paul/codebase/TESTING.md
@apps/psg/.paul/codebase/INTEGRATIONS.md
@apps/psg/.paul/codebase/CONCERNS.md

# Source repos for consolidation
@~/apps/projects/bsm/                            (anchor — moves to apps/psg-hub/ in v0.1)
@~/apps/projects/bsm/.paul/                      (PAUL state — preserve as foundation)
@~/apps/projects/bsm/PLANNING.md
@~/apps/ads-dashboard/                           (absorbed v0.3)
@~/apps/ads-dashboard/PLANNING.md
@~/apps/ads-dashboard/.paul/
@~/apps/ads/                                     (surfaced v1.2 Ads Mutation Studio)
@~/apps/ads/README.md
@~/apps/ads/SESSION_HANDOFF.md
@~/apps/projects/local_reach/                    (deprecated v0.1 archive)
@apps/psg/psg-advantage-portal/                  (source for market intel port v0.3)
@apps/psg/psg-advantage-portal/Master Project Plan_ PSG Agentic Market Intelligence Platform.md
@apps/psg/psg-advantage-portal/supabase/migrations/
@apps/psg/psg-data-lake/                         (untouched ETL feeder)
@apps/psg/psg-import/                            (absorbed v1.1)

# External specs
@~/Library/CloudStorage/GoogleDrive-nick@phoenixsolutionsgroup.net/Shared drives/[1] PSG Team Drive/Phoenix Solutions Group/Vendors/Claims Corp/PSG Project Technical Design v1.0_Final.txt
(FleetComplete 2019 Advantage Program tech design — absorbed v1.1–v1.5)

# Brand
github.com/Phoenix-Solutions-Group/design-system (submoduled in v0.1)
```

---

## Prioritized Next Actions

| Priority | Action | Effort |
|----------|--------|--------|
| 1 | Answer critical open Qs 1–8 (FleetComplete status, FileMaker status, Python worker, mail vendor, BSM Vercel retire, Sanity dataset, Paperclip runtime, BSM live customers) | small (decisions) + medium (research Q1, Q2) |
| 2 | Investigate unmapped `~/apps/` areas (Q23) — at least quick scan of `Automation/`, `gbrain/`, `daily-content-brief/`, `DEGWEB-MODERNIZATION-REVIEW.md` | medium |
| 3 | Read `~/apps/ads-dashboard/.paul/STATE.md` + latest handoff to determine in-flight work (Q20) | small |
| 4 | Re-synthesize `apps/psg-hub/README.md` from v6 PLANNING.md | small |
| 5 | Finalize graduation: initial commit on `apps/psg-hub/`; append graduation stamp to `projects/psg-hub/PLANNING.md`; update tracking | small |
| 6 | Initialize PAUL headless against v6 PLANNING.md; propose milestone/phase structure for user approval | medium |
| 7 | First PAUL milestone = v0.1 Foundation; run `/paul:discuss` then `/paul:plan` for Phase 1 (Workspace consolidation + multi-repo relocation) | medium |
| 8 | Confirm shared Supabase project access (`gylkkzmcmbdftxieyabw`) and Vercel project rename plan | small |

---

## State Summary

**Current state:**
- Workspace mapped (7 codebase docs)
- SEED ideation complete through v6 PLANNING.md (869 lines, 49 decisions, 25 open Qs, 10 milestones)
- Partial graduation: `apps/psg-hub/` exists with `git init` + stale README
- No initial commit; no PAUL init; no tracking update

**Next:** Either (a) resolve critical open Qs 1–8 + complete remaining workspace scan, or (b) re-synthesize README + finalize graduation + headless PAUL init from v6 brief

**Resume:** `/paul:resume` → read this handoff → user decides path (continue scope discovery vs lock in current scope and graduate)

---

## Caveats / Risks

1. **Scope crept significantly** across iterations. Started as "psg customer dashboard"; now spans BSM agents + market intel + Google Ads + GA4 + GSC + Search Console + Invoiced + Stripe + Production printing + 26 operational reports + multi-LLM agentic intelligence + Yext + NotebookLM + Ads Mutation Studio. Single PLANNING.md may be hitting cognitive ceiling at 869 lines / 49 decisions / 25 open Qs.
2. **Three anchor changes** during the session (initial blank → psg-advantage-portal → BSM dashboard). Each swap rewrote significant plan sections. Worth confirming BSM is truly the right anchor before locking.
3. **ads-dashboard has active Phase 1 work** — absorption in v0.3 must not lose in-flight progress.
4. **local_reach is large** (~6GB) with active client work (`tracys-research-v3/`, `new-tracys-report-v2/`). Deprecation runway needs confirmation that BSM agents can replace functionality before retirement.
5. **`apps/psg/` workspace is one of several PSG roots in `~/apps/`** — the real consolidation root might be `~/apps/` itself. Decision #46 keeps workspace at `~/apps/psg/` but this is reversible.
6. **Shared Supabase project `gylkkzmcmbdftxieyabw`** — all customer-facing apps already share it. Auth identities flow. Any schema migration must be coordinated across apps still on it.

---

*Handoff created: 2026-05-29*
