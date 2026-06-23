# PSG-226 — Continuous competitor monitor: tenant-isolation QA plan

Wave 1B of PSG-215. Owner: Ravi · QA: Tess.

This is the **gating-risk** test plan for the issue: intel is Demo-shop-only today, so we must
prove **per-shop RLS isolation** before the monitor cron runs across real customers.

## What shipped (branch `feat/psg-226`)

- `src/lib/intel/competitor/sync.ts` — extracted reusable per-shop scoring (`scoreShopRow`,
  `scoreShopById`); the all-shops nightly loop now reuses it (no fork).
- `src/lib/intel/monitor/run-monitor.ts` — `runCompetitorMonitor(service)`: per-shop pass that
  re-scores → `runCompetitorReport` (existing engine) → logs a `competitor_monitor_runs` row.
  Budget-capped per shop (`INTEL_MONITOR_SPEND_CAP_USD`, default $50) against the shared
  month-to-date intel ledger.
- `src/app/api/cron/competitor-monitor/route.ts` — `CRON_SECRET`-gated GET/POST trigger.
- `vercel.json` — weekly cron `0 10 * * 1` (Mon 10:00 UTC).
- `supabase/migrations/20260623150000_competitor_monitor_runs.sql` — append-only per-shop
  monitor log. **Authored, NOT yet applied to prod** (v1.6 gate batch). RLS default-deny,
  membership-clamped SELECT only; service-role writes.

## Pre-req for QA

1. Apply the migration to the QA/prod DB (operator/Ada gate): `20260623150000_competitor_monitor_runs.sql`
   (renamed from `20260623130000_*` in PSG-265 to clear a duplicate-version collision; SQL byte-identical).
2. Pick a **real (non-Demo) shop** as the test tenant. Today only Demo has competitors, so seed
   the real shop with ≥2 manual competitor rows (zero-spend; discovery is the separate G5-gated
   step and is out of scope here):

   ```sql
   -- as service role; replace :real_shop with a real shop id (NOT the Demo shop)
   insert into public.competitors (shop_id, name, normalized_name, type, consolidator_group,
     latitude, longitude, distance_miles, rating, review_count, source)
   values
     (:real_shop, 'Caliber Collision - Test Ave', 'caliber collision test ave', 'consolidator',
      'Caliber Collision', 33.45, -112.07, 2.3, 4.3, 380, 'manual'),
     (:real_shop, 'Independent Body Test', 'independent body test', 'independent', null,
      33.50, -112.10, 5.1, 4.6, 70, 'manual');
   ```

## A. Tenant-isolation (RLS) — the gating test

Prove a customer authenticated to **shop A** cannot read **shop B**'s competitor data or monitor
runs, on all three intel tables. Run in the DB with RLS enforced (NOT the service role).

For each table in `competitors`, `competitor_scores`, `competitor_monitor_runs`:

1. Seed one row for `shop_A` and one for `shop_B` (service role).
2. Simulate a shop-A member session and SELECT:

   ```sql
   -- simulate an authenticated user who belongs to shop_A only
   set local role authenticated;
   set local request.jwt.claims = '{"sub":"<user_in_shop_A>","role":"authenticated"}';

   select shop_id, count(*) from public.competitor_monitor_runs group by shop_id;
   ```

   **PASS:** only `shop_A` rows return; `shop_B` rows are invisible. Repeat for `competitors`
   and `competitor_scores`.
3. Confirm a customer **cannot write** `competitor_monitor_runs` (append-only / no insert policy):

   ```sql
   set local role authenticated;
   set local request.jwt.claims = '{"sub":"<user_in_shop_A>","role":"authenticated"}';
   insert into public.competitor_monitor_runs (shop_id, status) values ('<shop_A>', 'succeeded');
   -- EXPECT: 0 rows / RLS violation (no insert policy for customers)
   ```
4. Reset role; confirm the service role still sees all shops (write path unaffected).

**Acceptance:** cross-shop SELECT returns nothing; customer INSERT to the run log is denied;
service role unaffected.

## B. Functional — scheduled run produces a fresh report for a real shop, within budget

1. Trigger the cron manually (operator) with the configured secret:

   ```
   POST /api/cron/competitor-monitor
   Authorization: Bearer $CRON_SECRET
   ```

   **PASS:** 200 with a summary `{ shopsProcessed, reportsGenerated, degraded, skipped, failed }`.
   The seeded real shop appears with `reportsGenerated ≥ 1` (it will be `degraded`/pending-activation
   until G5 — that is expected and means **zero vendor spend**, same as the scoring cron).
2. Verify a `competitor_monitor_runs` row landed for the real shop:

   ```sql
   select shop_id, status, competitors_tracked, top_threat_score, narrative_status, ran_at
   from public.competitor_monitor_runs
   where shop_id = :real_shop order by ran_at desc limit 1;
   ```

   **PASS:** one fresh row, `competitors_tracked = 2`, `top_threat_score` populated,
   `status in ('succeeded','degraded')`.
3. **Budget:** confirm no unexpected spend — `llm_call_log` shows no `intel:%` rows beyond the
   cap for this run (until G5, expect none). Confirm the per-shop cap is honored: setting
   `INTEL_MONITOR_SPEND_CAP_USD=0` makes every shop degrade with zero metered calls.

## C. Existing manual path still works (no regression)

```
GET /api/ops/intel/competitor-report?shopId=:real_shop&format=html
Authorization: superadmin session
```

**PASS:** 200 HTML threat-ranking report for the real shop (reflecting the freshly-monitored
scores); the Demo path is unchanged.

## D. Auth + test-suite gates

- `POST/GET /api/cron/competitor-monitor` without/with wrong `CRON_SECRET` → **401**, monitor never runs.
- `pnpm test --filter=psg-hub` (or vitest over `src/lib/intel` + `src/app/api/cron`) — green, no
  regression. Branch verified: intel + cron suites **38/38**, `tsc` 0, `eslint` 0.

## Out of scope (follow-on)

- **Live competitor discovery** (web_grounded/Yext) that auto-populates real shops' `competitors`
  is the separate **G5-gated** step (`discovery.ts`, not built). Until it lands or shops are
  seeded manually, the monitor produces a fresh report only for shops that already have
  competitor rows. Flag to Ada for a Wave-1B follow-on ticket.
- **Grounded narrative** in scheduled reports requires G5 activation (funding hold). The monitor
  is built to light up automatically when G5 clears — no code change needed.
