-- v1.2 / PSG-26 — Ads Mutation Studio: observability + audit-trail tables.
--
-- Why: v1.2 surfaces the shipped apps/psg-ads-mutations/ Python (Google Ads + GTM)
-- via a web UI on a Vercel Sandbox Python-worker bridge. Two persistence concerns
-- are gate-INDEPENDENT (no ops shell, no live Sandbox required) and stand up here:
--   1. python_worker_jobs  — one row per bridge invocation (dry_run | execute) for
--      observability: status, params, result/diff, Sandbox id, mirrored-log path.
--   2. ads_audit_logs       — append-only audit trail mirroring the Python
--      write_audit() JSON records (before / requested_changes / after) into the DB,
--      alongside the raw log file in Supabase Storage.
--
-- RLS posture (mirrors 20260605000000_analytics_sync_runs.sql + 20260603120000_llm_call_log.sql):
--   RLS ENABLED, default-deny, NO anon/authenticated policy. Both tables are written
--   AND read exclusively via the service-role client (createServiceClient, "server-only")
--   behind server routes that gate on private.current_user_has_fn('ads_mutations').
--   Expect one advisor INFO (rls_enabled_no_policy) per table — intended.
--
-- ads_audit_logs is APPEND-ONLY: UPDATE/DELETE are revoked AND blocked by a trigger
-- (defense-in-depth; the trigger fires even for service_role, the one principal that
-- RLS does not constrain). This matches the v1.5 "append-only audit log" requirement.
--
-- Idempotent + re-runnable. LOCAL-applied during build; PROD apply is operator-gated
-- under the same migration-safety protocol as the Phase-10 ads tables. ZERO data written.

-- ── python_worker_jobs ───────────────────────────────────────────────────────
create table if not exists public.python_worker_jobs (
  id uuid primary key default gen_random_uuid(),
  mutation_key text not null,
  platform text not null
    check (platform in ('google_ads', 'gtm')),
  mode text not null
    check (mode in ('dry_run', 'execute')),
  -- Google Ads customer_id or GTM container public id (governance: target is required).
  target_ref text not null,
  shop_id uuid references public.shops (id) on delete set null,
  status text not null default 'pending'
    check (status in ('pending', 'running', 'succeeded', 'failed', 'cancelled')),
  params_jsonb jsonb not null default '{}'::jsonb,
  result_jsonb jsonb,
  error text,
  -- Vercel Sandbox execution id, for cross-system tracing (null until Sandbox gate clears).
  sandbox_id text,
  -- Supabase Storage path to the mirrored Python audit/log JSON for this run.
  logs_storage_path text,
  requested_by uuid references public.profiles (id) on delete set null,
  -- Board/superadmin approval ref for high-risk mutations (null for low/medium).
  approval_id text,
  started_at timestamptz,
  finished_at timestamptz,
  created_at timestamptz not null default now()
);

create index if not exists python_worker_jobs_status_created_idx
  on public.python_worker_jobs (status, created_at desc);
create index if not exists python_worker_jobs_mutation_created_idx
  on public.python_worker_jobs (mutation_key, created_at desc);
create index if not exists python_worker_jobs_shop_created_idx
  on public.python_worker_jobs (shop_id, created_at desc);
create index if not exists python_worker_jobs_target_created_idx
  on public.python_worker_jobs (target_ref, created_at desc);

alter table public.python_worker_jobs enable row level security;

-- ── ads_audit_logs ───────────────────────────────────────────────────────────
create table if not exists public.ads_audit_logs (
  id uuid primary key default gen_random_uuid(),
  job_id uuid references public.python_worker_jobs (id) on delete set null,
  op_name text not null,
  mutation_key text,
  platform text not null
    check (platform in ('google_ads', 'gtm')),
  target_ref text not null,
  shop_id uuid references public.shops (id) on delete set null,
  mode text not null
    check (mode in ('dry_run', 'execute')),
  before_jsonb jsonb,
  requested_changes_jsonb jsonb,
  after_jsonb jsonb,
  logs_storage_path text,
  actor uuid references public.profiles (id) on delete set null,
  approval_id text,
  created_at timestamptz not null default now()
);

create index if not exists ads_audit_logs_mutation_created_idx
  on public.ads_audit_logs (mutation_key, created_at desc);
create index if not exists ads_audit_logs_target_created_idx
  on public.ads_audit_logs (target_ref, created_at desc);
create index if not exists ads_audit_logs_job_idx
  on public.ads_audit_logs (job_id);

alter table public.ads_audit_logs enable row level security;

-- Append-only enforcement (defense-in-depth; fires for every principal incl. service_role).
create or replace function private.ads_audit_logs_block_mutate()
  returns trigger
  language plpgsql
  security definer
  set search_path = ''
as $$
begin
  raise exception 'ads_audit_logs is append-only: % is not permitted', tg_op;
end;
$$;

drop trigger if exists ads_audit_logs_no_update on public.ads_audit_logs;
create trigger ads_audit_logs_no_update
  before update or delete on public.ads_audit_logs
  for each row execute function private.ads_audit_logs_block_mutate();

revoke update, delete on public.ads_audit_logs from authenticated, anon;
