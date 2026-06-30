-- PSG-434 — Pipedrive deals mirror (open-pipeline-$ for pipeline-weighted forecast).
-- Parent: PSG-432 Accounting/Sales overhaul (§2.1 / Phase 3). Sibling gap: PSG-433.
--
-- Why: the overhaul forecast needs open-deal count + total open-pipeline-$ (and a
-- per-stage breakdown, S0–S8) weighted by stage win-probability. Pipedrive deals
-- live nowhere queryable today (only the Organizations master was one-time
-- imported). This table is the durable read mirror: a cadenced sync (service-role
-- ingestion) UPSERTs the live deal set here, and reporting/forecast reads it.
--
-- Pattern matches the v1.1 ops backbone: default-deny RLS on the table, gated reads
-- for internal users, service-role bypass for ingestion. Idempotent.

create table if not exists public.pipedrive_deals (
  -- Pipedrive deal id is the natural key (stable across syncs → UPSERT target).
  deal_id            bigint        primary key,
  title              text,
  -- Monetary value of the deal in `currency`. Open-pipeline-$ = sum(value) over open.
  value              numeric(14,2) not null default 0,
  currency           text          not null default 'USD',
  -- 'open' | 'won' | 'lost' | 'deleted' (Pipedrive deal status).
  status             text          not null default 'open',
  -- Stage placement. stage_id maps to the S0–S8 pipeline stages; we mirror the
  -- name + Pipedrive's per-deal win probability (0–100) so the forecast can weight.
  pipeline_id        bigint,
  stage_id           bigint,
  stage_name         text,
  win_probability    numeric(5,2),            -- 0–100, nullable when Pipedrive omits it
  -- Quoted scope/price context for the forecast (free-form + structured).
  org_id             bigint,
  org_name           text,
  person_id          bigint,
  expected_close_date date,
  pipedrive_add_time  timestamptz,
  pipedrive_update_time timestamptz,
  -- Full raw deal payload for any field not promoted to a column (audit + future use).
  raw                jsonb,
  -- Sync bookkeeping.
  synced_at          timestamptz   not null default now()
);

comment on table public.pipedrive_deals is
  'PSG-434: durable mirror of Pipedrive deals for open-pipeline-$ / pipeline-weighted forecast. Written by the cadenced sync (service role); read by reporting. Refresh path: docs in src/lib/pipedrive/README.md.';

create index if not exists pipedrive_deals_status_idx       on public.pipedrive_deals (status);
create index if not exists pipedrive_deals_stage_idx        on public.pipedrive_deals (stage_id);
create index if not exists pipedrive_deals_pipeline_idx     on public.pipedrive_deals (pipeline_id);

-- A run log so we can confirm the "documented refresh path" actually ran on cadence
-- and surface staleness (last successful sync, deal counts, errors).
create table if not exists public.pipedrive_sync_runs (
  id            bigint generated always as identity primary key,
  started_at    timestamptz not null default now(),
  finished_at   timestamptz,
  ok            boolean,
  open_deals    integer,
  total_deals   integer,
  error         text
);

comment on table public.pipedrive_sync_runs is
  'PSG-434: one row per Pipedrive deals sync run (cadence health + staleness signal).';

-- Default-deny RLS. Service-role (ingestion) bypasses RLS entirely. Internal users
-- with the sales-pipeline capability may read; nobody reads by default.
alter table public.pipedrive_deals     enable row level security;
alter table public.pipedrive_sync_runs enable row level security;

drop policy if exists pipedrive_deals_select on public.pipedrive_deals;
create policy pipedrive_deals_select on public.pipedrive_deals
  for select using (private.current_user_has_fn('view_sales_pipeline'));

drop policy if exists pipedrive_sync_runs_select on public.pipedrive_sync_runs;
create policy pipedrive_sync_runs_select on public.pipedrive_sync_runs
  for select using (private.current_user_has_fn('view_sales_pipeline'));
