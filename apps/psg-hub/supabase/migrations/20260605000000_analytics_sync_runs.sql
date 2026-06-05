-- Phase 9 / 09-03 — analytics ingest audit ledger.
-- The AnalyticsSyncRun type shipped in 09-01 (src/lib/analytics/types.ts) but
-- the table was never migrated (grounding catch at 09-03 plan time). One row
-- per ingest run: running -> success (rows_written) | error (message).
--
-- Service-role-only by design: RLS ENABLED with NO policy (default-deny), the
-- llm_call_log precedent — customers never read the ops ledger.
--
-- Idempotent + re-runnable. LOCAL-applied during build; prod apply happens at
-- the Phase-9 operator gate batch (PROTOCOL-migration-safety.md, advisor
-- baseline + diff).

create table if not exists public.analytics_sync_runs (
  id uuid primary key default gen_random_uuid(),
  shop_id uuid references public.shops (id),
  source text not null check (source in ('semrush', 'google_ads', 'ga4', 'gsc')),
  status text not null check (status in ('running', 'success', 'error')),
  rows_written integer not null default 0,
  error text,
  started_at timestamptz not null default now(),
  finished_at timestamptz
);

create index if not exists analytics_sync_runs_source_started_idx
  on public.analytics_sync_runs (source, started_at desc);

alter table public.analytics_sync_runs enable row level security;
