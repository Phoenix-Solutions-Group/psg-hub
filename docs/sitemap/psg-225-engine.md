# PSG-225 — Sitemap & content-architecture engine (Wave 1A)

BSM-native build against the `sitemap-maker` spec (see `docs/reviews/psg-215-providence-sitemap-bsm-incorporation.md` §4). Turns a shop brief into a client-ready sitemap + content plan through a two-checkpoint gated workflow.

## Module map (`apps/psg-hub/src/lib/sitemap/`)

| File | Responsibility |
|------|----------------|
| `types.ts` | Zod contracts: `ShopBrief`, `SitemapKeyword`, `SerpCluster`, **`PageNode`** (the single hierarchy source), `ContentCalendar`, `CheckpointApproval`, `SitemapPackage`. Reuses `KEYWORD_INTENTS` from `agent-engine` (no duplicate enum). Pure. |
| `collision-vertical.ts` | The 8 auto-body personas + the required-page coverage set (`COLLISION_REQUIRED_PAGES`). Inert for the `general` flow. |
| `keyword-provider.ts` | Stage-1 seam `KeywordProvider` + a zero-cost `deterministicKeywordProvider` fallback (so a run produces artifacts with no Semrush seat). |
| `clustering.ts` | SERP clustering (deterministic topic-stem grouping + opportunity priority) and page-type validation (`seo-sxo`). Optional injected `ClusterRefiner` LLM seam. |
| `architecture.ts` | **The no-drift core.** `buildArchitecture` assembles the `PageNode` tree; `flattenHierarchy` is the ONE canonical walk; `toPageInventoryRows` and `toMermaid` both consume it. `validateArchitecture` enforces the 3-click rule, unique slugs, internal-link integrity, and collision coverage. |
| `calendar.ts` | `buildContentCalendar` — month-by-month plan derived from the same tree. |
| `artifacts.ts` | Renders the four deliverables from one `SitemapPackage`. |
| `pipeline.ts` | `runSitemapPipeline` — chains all stages with two human checkpoints as an injected `onCheckpoint` handler. |

## The load-bearing guarantee (no drift, by construction)

`page-inventory.csv` and `sitemap.mmd` are **two serializations of one structure** — the `PageNode` tree rooted at home. There is no second source to drift from: both call `flattenHierarchy(root)` once and walk the identical ordered node list. Tests assert `csvRows === mermaidDeclarations === flatten.length` and `edges === nodes − 1` (a tree) on multiple fixtures and end-to-end.

## Two human checkpoints

1. **`clusters_page_types`** — approve the SERP clusters + their validated page types before any architecture is built.
2. **`package_handoff`** — approve the finished package before client hand-off.

`onCheckpoint` is bound by the route to the approval queue / an issue-thread interaction. `changes_requested` at either gate stops the run and returns the partial for revision (no silent override). Both approvals are recorded in `SitemapPackage.checkpoints` (audit trail) and surfaced in `summary.md`.

## Collision-repair vertical

`vertical: "collision_repair"` seeds the architecture with `COLLISION_REQUIRED_PAGES` (so a thin brief still yields a complete, ICP-correct spine) and validates the finished tree against required coverage (gaps surface in `validation.coverageGaps`). Leftover clusters whose keywords overlap a required page **fold into** that page (keywords + personas merged) instead of spawning near-duplicate pages, keeping the deliverable tight. The `general` flow runs without any of this.

## Reuse (no duplication)

- `KEYWORD_INTENTS` imported from `agent-engine` (shared search-intent vocabulary).
- Seams are designed to wire to existing BSM engines at the route layer:
  - `AuditProvider` → `agent-engine` seo-auditor + firecrawl-map (baseline + URL inventory).
  - `ContentGapProvider` → the `intel` engine's competitor content-gap.
  - `ClusterRefiner` → the `intel` multi-LLM router (budget-/G5-gated), optional.
  - `KeywordProvider` → Semrush MCP (`keyword_research`/`organic_research`), with `seo-dataforseo`/`seo-google` GSC/`seo-backlinks` as the no-seat fallback.

## Status & live-wiring follow-up

This lands **additive + pure** (no route wired yet, zero prod surface), the same posture other BSM modules used before their cutover ticket. Verified end-to-end via the deterministic provider on a real shop brief (Courtesy Body Works): 31 pages, CSV/Mermaid in sync, both checkpoints fired, collision coverage complete, validation OK.

**Follow-up (separate ticket):** a superadmin `/ops/sitemap` route + Vercel-Sandbox worker that (a) wires the live `KeywordProvider` to Semrush MCP with the fallback chain, (b) binds `onCheckpoint` to the approval queue, (c) persists `SitemapPackage` to `research_artifacts` (service-role, default-deny RLS, shop-scoped via `data->>shop_id`), and (d) renders the client-facing deliverable (designer review of visual quality). Tracked as Wave 1A follow-up; the engine API is stable.
