# 09-01 SUMMARY — Analytics data model + Recharts chart primitives

**Status:** ✅ APPLY complete, all gates green. Code-only, ZERO prod write. **Loop:** PLAN ✓ → APPLY ✓ → UNIFY (this).

## What shipped
- **Analytics data model (AC-1) — GROUNDED REFRAME: EXTEND, not create.** `public.analytics_snapshots` ALREADY EXISTED on prod (in `20260602105554_remote_schema.sql`) — `shop_id` + `location_id` + `date` + `metrics jsonb` + `created_at`, **0 rows**, and already RLS-secured with the exact policies I'd have written (`select USING shop_id IN user_shop_ids()`; `insert WITH CHECK shop_id IN user_shop_ids() AND location_id IN user_location_ids()`). So migration `20260604000000_analytics_snapshots.sql` EXTENDS it source-agnostic (06-04 reviews precedent; 0 rows = zero data risk): `add source/period/synced_at` + nullable CHECK constraints + idempotency `unique(shop_id, source, date, period)` + index. **No RLS change** (existing policies are correct + add location scoping). Applied LOCAL-only via `supabase db reset` (exit 0); prod apply deferred to the gate batch.
- **Snapshot helpers (AC-2):** `src/lib/analytics/{types.ts,snapshots.ts}` — `upsertSnapshots(service, rows)` idempotent on the conflict key (service-role write); `getSnapshots(client, {...})` RLS-clamped read, `[]` on no-data, throws on real error. `SemrushMetrics` jsonb shape documented (first source). 6 unit tests (mocked chainable client): upsert idempotency/empty/error + read filter-chain/empty/error.
- **Chart primitives (AC-3):** `recharts@3.8.1` + `react-is@19.2.4` (clean install, no `--legacy-peer-deps`). `src/components/analytics/charts.tsx` — `"use client"` `LineChartCard`/`BarChartCard`/`Sparkline`, brand-themed via `var(--chart-N)`/`var(--border)`/`var(--muted-foreground)` (0 raw hex; `--chart-1..5` already in globals.css), `role="img"`+`aria-label` (axe AA), `min-h` (ResponsiveContainer measure), `isAnimationActive={false}`, explicit no-data states. 6 chrome tests (recharts mocked — Recharts 3 emits no SVG in node SSR; real render + axe → 09-02 Playwright).
- **Coverage gate:** `snapshots.ts` added to the vitest include set; `charts.tsx` excluded with rationale (DOM/recharts → E2E, mobile-nav precedent); `types.ts` no executable lines.

## Gates
- `supabase db reset` exit 0 (extend migration replays clean; the prior `CREATE INDEX` failure on missing `source` is gone) · typecheck clean · lint 0 err (1 pre-existing middleware warn) · `pnpm test --coverage` **267 passed (+12), 89.2%, perFile≥70 exit 0** · `pnpm build` ✓ (after a stale `.next` clear).

## Deviations
1. **EXTEND not create** (grounding) — `analytics_snapshots` pre-existed; migration rewritten alter-table. Code uses the real column `date` (not `metric_date`) + nullable `location_id`.
2. **recharts test mock** — Proxy-stub made the module look thenable (vitest skipped it); switched to explicit named-export stubs.

## Research applied (RESEARCH.md)
SEMrush HTTP contract (→ 09-03) · Recharts 3.8.1 + node-SSR-empty reality (→ this + 09-02 Playwright) · LCP PerformanceObserver gate (→ 09-02).

## Carry to next plans
- **09-02:** analytics dashboard shell + MSO cross-shop aggregate + switcher typeahead + LCP<2s gate (`e2e/lcp.spec.ts`, CPU 4x, median, storageState) + real chart render + axe AA via Playwright.
- **09-03:** SEMrush client (verified HTTP contract) → `upsertSnapshots` with `source='semrush'`.
- **Gate batch (phase end):** prod migration apply · `SEMRUSH_API_KEY` · `.vercel` link resolution + deploy · visual verify.

## Boundaries held
ZERO prod write/migration. No RLS change. No existing-table data touched. Only NEW analytics files + recharts dep + vitest.config include + the extend migration (local-applied).
