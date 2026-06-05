---
phase: 09-analytics-foundation-semrush
plan: 02
subsystem: ui
tags: [analytics, recharts, playwright, axe, lcp, mso, typeahead, supabase]

requires:
  - phase: 09-01
    provides: analytics_snapshots extend migration (local), snapshot helpers, Recharts brand chart primitives
provides:
  - /dashboard/analytics route (per-shop + MSO all-shops aggregate, empty/loading/error states, Last synced)
  - MSO aggregate plumbing (aggregate.ts pure helpers + getSnapshotsForShops .in-clamped read)
  - Shop-switcher typeahead at >=8 memberships (filterShops + TYPEAHEAD_THRESHOLD)
  - E2E: analytics.spec (real chart SVG + axe AA + aggregation proof + empty state + live typeahead) + lcp.spec (throttled LCP gate)
  - Deterministic local snapshot seed + MEGA 9-shop fixture
affects: [09-03 semrush ingest, 10-google-ads, 11-ga4-gsc, 12-psg-report]

tech-stack:
  added: []
  patterns:
    - "Analytics pages: server component fetches RLS-clamped snapshots, passes plain props to client chart islands"
    - "MSO aggregate: explicit .in(shop_id, membership ids) + RLS backstop; only summable metrics surfaced from aggregates"
    - "LCP gate: CDP 4x throttle, median-of-4, LCP element logged (guards text paint, not chart hydration)"

key-files:
  created:
    - src/app/dashboard/analytics/page.tsx
    - src/app/dashboard/analytics/loading.tsx
    - src/app/dashboard/analytics/error.tsx
    - src/lib/analytics/aggregate.ts
    - e2e/analytics.spec.ts
    - e2e/lcp.spec.ts
  modified:
    - src/lib/analytics/snapshots.ts
    - src/components/dashboard/shop-switcher.tsx
    - src/app/dashboard/layout.tsx
    - e2e/global.setup.ts
    - e2e/fixtures.ts
    - supabase/migrations/20260604000000_analytics_snapshots.sql

key-decisions:
  - "Analytics UNGATED by tier (all tiers see the surface; per-source gating decided when sources land)"
  - "Aggregate KPIs exclude authority_score (a summed 0-100 score is a lie); swap in traffic-cost"
  - "LCP budgets de-conflated: /dashboard HARD 2000ms; /dashboard/analytics 4000ms calibration ceiling until 09-03"
  - "Typeahead = native input filtering the native select (no combobox ARIA, no new dep); threshold 8"

patterns-established:
  - "Every-state-designed enforced: page + loading.tsx + error.tsx + empty card per analytics route"
  - "E2E aggregation proof via deterministic seed formula (KPI 982 = 491+491), not render-only checks"

duration: ~70min
started: 2026-06-05T09:25:00Z
completed: 2026-06-05T10:35:00Z
---

# Phase 9 Plan 02: Analytics dashboard shell + MSO aggregate + typeahead + LCP gate — Summary

**`/dashboard/analytics` shipped: per-shop + MSO all-shops SEMrush-shaped analytics over the 09-01 snapshot model with designed empty/loading/error states, switcher typeahead at ≥8 shops, and real-browser chart render + axe AA + throttled LCP gates — all proven against the local stack, ZERO prod contact.**

## Performance

| Metric | Value |
|--------|-------|
| Duration | ~70min |
| Tasks | 3 completed |
| Tests | 295 unit (267→295) + 10/10 E2E |
| Files modified | 14 (7 new, 7 modified) |

## Acceptance Criteria Results

| Criterion | Status | Notes |
|-----------|--------|-------|
| AC-1: Per-shop analytics surface | **Pass** | E2E: OWNER sees KPIs + real recharts SVG + "Last synced", scoped to active shop; NAV entry live (sidebar + mobile via prop) |
| AC-2: Designed empty state | **Pass** | E2E: MEGA (zero snapshots) gets the branded empty card; no chart shells, no KPI lies; axe clean |
| AC-3: MSO cross-shop aggregate | **Pass** | E2E: toggle only for multi-shop; **aggregation PROVEN** — traffic KPI 982 = shop A 491 + shop B 491; `.in` clamp + RLS backstop |
| AC-4: Switcher typeahead | **Pass** | E2E LIVE on MEGA (9 shops): typing → "1 of 9 shops", clear → 9; 2-7 select byte-compatible (shop-switch.spec unmodified, passing) |
| AC-5: LCP regression gate | **Pass** | /dashboard median **80ms** HARD<2000 · /dashboard/analytics median **84ms** <4000 ceiling (4x CPU, median-of-4) |
| AC-6: Real chart render + axe AA | **Pass** | Browser SVG path geometry asserted; axe WCAG2a/2aa 0 serious/critical on per-shop, aggregate, empty, typeahead states |

## Accomplishments

- The reusable v0.3 analytics shell exists end-to-end: 09-03 lights it up with `upsertSnapshots(source='semrush')` alone; Phases 10/11 add panels, not plumbing.
- Three v0.2 carry-ins landed: MSO cross-shop aggregate, switcher search/typeahead, LCP<2s gate (on the ROADMAP metric route).
- Quality net deepened: aggregation proven numerically in E2E; LCP element identification built into the gate; every state designed (empty/loading/error/no-data).

## Files Created/Modified

| File | Change | Purpose |
|------|--------|---------|
| `src/app/dashboard/analytics/page.tsx` | Created | Server page: auth → active-shop context → trailing-30d snapshots → KPIs + charts; `?scope=all` for MSO; ungated by tier |
| `src/app/dashboard/analytics/loading.tsx` | Created | Branded skeleton mirroring layout (no CLS) |
| `src/app/dashboard/analytics/error.tsx` | Created | Branded error boundary + reset (every-state-designed canon) |
| `src/lib/analytics/aggregate.ts` | Created | Pure: aggregateByDate / latestSnapshot / latestSyncedAt / toSeries / formatters / trailingWindow — 100% covered |
| `src/lib/analytics/snapshots.ts` | Modified | + `getSnapshotsForShops` (`.in` membership clamp + RLS backstop) |
| `src/components/dashboard/shop-switcher.tsx` | Modified | + `filterShops` (pure) + `TYPEAHEAD_THRESHOLD=8`; ≥8 = search input + aria-live count + same native select; <8 verbatim |
| `src/app/dashboard/layout.tsx` | Modified | NAV + Analytics (MobileNav follows via prop) |
| `vitest.config.ts` | Modified | Coverage include + aggregate.ts |
| `e2e/fixtures.ts` | Modified | + MEGA (9 shops) + snapshot seed constants |
| `e2e/global.setup.ts` | Modified | + seedSnapshots (deterministic formula; OWNER 30d, MULTI A/B 14d; idempotent upsert) + MEGA seed/login |
| `e2e/analytics.spec.ts` | Created | 4 tests: per-shop SVG+axe · aggregate proof+axe · empty state+axe · live typeahead+axe |
| `e2e/lcp.spec.ts` | Created | CDP 4x throttle, median-of-4, LCP element logged; dual budgets |
| `src/lib/analytics/__tests__/aggregate.test.ts` | Created | Full-branch pure tests |
| `src/components/dashboard/__tests__/shop-switcher.test.tsx` | Created | filterShops + 5 render branches (react-dom/server) |
| `supabase/migrations/20260604000000_analytics_snapshots.sql` | Modified | DEVIATION 1: `location_id drop not null` (09-01 design conformance; LOCAL-only) |

## Decisions Made

| Decision | Rationale | Impact |
|----------|-----------|--------|
| Analytics ungated by tier | Surface is the v0.3 core value; per-source gating decided per source | Ads keeps its performance gate; parity question surfaced to operator at plan approval, default accepted |
| Aggregate drops authority_score | Summed 0-100 score is meaningless | AGGREGATE_KPIS swaps in traffic-cost; pattern for future non-summable metrics |
| LCP budgets split (2000 hard / 4000 ceiling) | Throttled-localhost ≠ field LCP; uncalibrated hard gate on a new heavy route = autonomous stall risk | 09-03 calibrates the analytics hard budget; medians recorded below |
| Native-elements typeahead, threshold 8 | No combobox ARIA risk, no dep; 2-7 e2e contract untouched | Big-MSO ready; threshold tunable in one constant |

## Deviations from Plan

### Summary

| Type | Count | Impact |
|------|-------|--------|
| Auto-fixed | 4 | Essential fixes, no scope creep |
| Boundary-touching | 1 | Migration amendment (design-conformance, local-only) |
| Deferred | 0 | — |

**1. Migration amendment (09-01 latent bug — touches the "migration final" boundary)**
- **Found during:** Task 3, E2E seed failed: `null value in column "location_id" violates not-null constraint`
- **Issue:** live `analytics_snapshots.location_id` is NOT NULL; 09-01's types/helpers/SUMMARY model it nullable (shop-level rows) but its migration never dropped the constraint
- **Fix:** amended `20260604000000_analytics_snapshots.sql` with `alter column location_id drop not null` — LOCAL-only (prod never ran this migration; 0 prod rows); aligns migration with the approved 09-01 design, not a redesign
- **Gate-batch note:** the prod apply now includes this clause; 06-01 advisor baseline+diff will surface it
- **RLS note:** INSERT policy's `location_id IN user_location_ids()` makes null-location user-session writes RLS-rejected — correct: ingest writes are service-role (`upsertSnapshots` contract)

**2. Seed end-date computed at run time (not the plan's hard constant)**
- A frozen date rots out of the page's trailing-30-day runtime window; metric values stay formula-deterministic given the run date

**3. Axe mid-fade false positive (root-caused, not papered)**
- Post-client-nav scan blended mid-animation colors into false serious contrast fails; computed-style probe proved at-rest colors are full tokens at opacity 1; animation-settle added before that one scan only

**4. Test ergonomics**
- Empty-state CardTitle matched by text (renders a div — 08-04b precedent); chart-shell img-count scoped to `main` (brand Logo is role=img)

**Note:** AGENTS.md's `node_modules/next/dist/docs/` does not exist in next@16.2.3 — in-repo Next 16 patterns used as canon (ads/page.tsx searchParams-Promise precedent).

## Issues Encountered

| Issue | Resolution |
|-------|------------|
| react-compiler lint: `Date.now()` impure in render | Moved clock read into `trailingWindow()` helper (injectable, tested) |
| Docker daemon down for local Supabase | Started Docker Desktop, `supabase start` + `db reset` clean |

## Next Phase Readiness

**Ready:**
- 09-03 SEMrush ingest plugs straight in: `research/semrush-api.md` verified contract → `upsertSnapshots(source='semrush')` → the surface lights up; `shops.url` is the per-shop key (4/7 set, 3 → designed no-data state already proven)
- E2E harness now covers analytics + typeahead + LCP; seed is idempotent

**Concerns (explicit 09-03 calibration inputs):**
- **LCP gate guards text paint only:** the analytics LCP element is the server-streamed chart caption `<p>` (logged in-run). Chart-island hydration cost is NOT captured by LCP. Promote analytics to a HARD 2000ms budget at 09-03 (medians: 80-84ms, huge headroom) and note chart perf needs a different probe if ever gated.
- Migration amendment rides in the gate-batch prod apply (advisor baseline+diff per PROTOCOL).

**Blockers:** None.

---
*Phase: 09-analytics-foundation-semrush, Plan: 02*
*Completed: 2026-06-05*
