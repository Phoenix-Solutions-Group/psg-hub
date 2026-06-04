# Phase 9 — RESEARCH (consolidated)

**Date:** 2026-06-04 · 3 parallel web-research agents (2 with live verification). Informs the 3-plan split; folded into the plans below.

## 1. SEMrush HTTP API → `research/semrush-api.md`
- Auth `?key=`, `database=us`. Two bases: overview `api.semrush.com/?type=`, backlinks `api.semrush.com/analytics/v1/?type=backlinks_overview`.
- Metrics: `domain_rank` → `Or`/`Ot`/`Oc` (keywords/traffic/cost); `backlinks_overview` → `total` + **`score`** (Authority Score — NOT `ascore`); `domain_organic` → `Po` bucketed client-side.
- CSV **semicolon-separated**, human-text header → **parse by returned header, not requested order** (typo'd column codes silently fall back). Errors are plain-text, often HTTP 200, leading `ERROR` token (`ERROR 50 NOTHING FOUND` for unknown domain).
- Cost: 2 cheap calls/domain (~50 units) for 5/6 metrics; position-distribution caps via `display_limit=1000&display_sort=tr_desc`. ~10 req/sec.
- Domain = shop URL stripped to bare root. **Used in 09-03.** `metrics` shape already typed (SemrushMetrics in `src/lib/analytics/types.ts`) — matches.

## 2. Recharts on Next16/React19/TW4 → `research/recharts-integration.md`
- **Pin `recharts@3.8.1` + `react-is@19.2.4`** (clean install verified, no `--legacy-peer-deps`).
- Repo ALREADY has `--chart-1..5` brand tokens (`@theme inline`); **NO shadcn chart component** → build thin `"use client"` wrappers using `var(--chart-N)` directly.
- **DECISIVE:** Recharts 3 emits an EMPTY wrapper in node `renderToStaticMarkup` even with fixed dims → **chart content cannot be unit-tested via SSR**. Test pure helpers in node + mock `recharts` for card-chrome; real render + axe → Playwright (09-02).
- `ResponsiveContainer` needs a sized parent (`min-h`); `accessibilityLayer` default-on but axe needs `role="img"`+`aria-label`+contrast (scan in browser). **Revises 09-01 Task 3 + AC-3.**

## 3. LCP <2s gating → `research/lcp-gating.md`
- **Playwright + `PerformanceObserver`** (zero new deps). Read last buffered `largest-contentful-paint` entry after settle.
- MUST `test.use({ storageState: OWNER.statePath })` (else measures /login). CPU throttle via CDP `setCPUThrottlingRate {rate:4}` before `goto` (else localhost meaningless). Prod build only (harness already `pnpm build && start -p 3100`). Median-of-N, `workers:1`. Gate = regression ceiling, not field predictor.
- No `/dashboard/analytics` route yet — gate the new surface route once 09-02 builds it (or `/dashboard`). Drop-in `e2e/lcp.spec.ts`. **Used in 09-02.**

## Net plan deltas
- **09-01:** install `recharts@3.8.1 + react-is@19.2.4`; do NOT re-add `--chart` vars; chart wrappers use `var(--chart-N)` + `role="img"`/`aria-label`/`min-h`/`isAnimationActive={false}`; **tests = node-pure + recharts-mock chrome, NO renderToStaticMarkup chart-content** (the planned AC-3 SSR render-branch test is not achievable — corrected).
- **09-02:** chart render + axe AA + LCP gate all via Playwright; add `e2e/lcp.spec.ts` (CPU 4x, median-of-4, <2000ms) on the analytics route.
- **09-03:** SEMrush client against the verified HTTP contract (parse-by-header, ERROR sniff, 2+1 calls/domain, domain-normalize).
