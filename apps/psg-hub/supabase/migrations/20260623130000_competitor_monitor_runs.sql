-- v1.6 / Wave 1B (PSG-226) — competitor_monitor_runs: the per-shop monitor cadence log.
-- One row per shop per scheduled monitor pass (the continuous competitor-monitoring cadence
-- brought over from Providence, feeding BSM's existing intel scoring/report engine — it does
-- NOT fork the scoring). Each row records that a shop was monitored, how many competitors were
-- tracked, the top threat at that moment, and whether the (G5-gated) grounded narrative ran or
-- degraded to pending-activation. This is the durable "last monitored at X" signal the report
-- surface and superadmin can read; the report itself stays computed-on-demand over the
-- continuously-refreshed `competitors`/`competitor_scores` tables.
--
-- shop_id is DENORMALIZED so RLS clamps directly to `shop_id IN (SELECT user_shop_ids())`,
-- the same per-shop-indexable idiom as competitors/competitor_scores/review_sentiment. Writes
-- are service-role only (the cron worker bypasses RLS) — there is intentionally NO customer
-- insert/update/delete policy, so the table is append-only from any tenant's perspective
-- (audit-log shape). Customers can only SELECT their own shop's run history.
-- Additive + idempotent (run-once safe).
-- AUTHORED ONLY — NOT applied to prod here; prod apply is the v1.6 gate batch
-- (PROTOCOL-migration-safety.md). ZERO data written.

create table if not exists public.competitor_monitor_runs (
  id uuid primary key default gen_random_uuid(),
  shop_id uuid not null references public.shops(id) on delete cascade,
  ran_at timestamptz not null default now(),
  -- succeeded = grounded report; degraded = deterministic report, narrative pending (G5 off or
  -- spend cap hit); skipped = no competitor data yet; failed = the per-shop pass threw.
  status text not null,
  competitors_tracked integer not null default 0,
  top_threat_score numeric,
  narrative_status text,
  error text,
  created_at timestamptz not null default now()
);

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conrelid = 'public.competitor_monitor_runs'::regclass
      and conname = 'competitor_monitor_runs_status_check'
  ) then
    alter table public.competitor_monitor_runs
      add constraint competitor_monitor_runs_status_check
      check (status in ('succeeded', 'degraded', 'skipped', 'failed'));
  end if;
end$$;

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conrelid = 'public.competitor_monitor_runs'::regclass
      and conname = 'competitor_monitor_runs_narrative_status_check'
  ) then
    alter table public.competitor_monitor_runs
      add constraint competitor_monitor_runs_narrative_status_check
      check (narrative_status is null or narrative_status in ('grounded', 'pending_activation'));
  end if;
end$$;

-- "Latest run per shop" is the hot read (report header + ops table): index shop_id, ran_at desc.
create index if not exists competitor_monitor_runs_shop_ran_idx
  on public.competitor_monitor_runs(shop_id, ran_at desc);

-- RLS: default-deny. Membership-clamped SELECT only (append-only audit shape); the service-role
-- monitor worker bypasses RLS to write. No customer insert/update/delete policy by design.
alter table public.competitor_monitor_runs enable row level security;

drop policy if exists competitor_monitor_runs_select on public.competitor_monitor_runs;
create policy competitor_monitor_runs_select on public.competitor_monitor_runs
  for select using (shop_id in (select public.user_shop_ids()));
