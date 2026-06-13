-- Phase 12 / 12-03 — Monthly report artifacts (table + private-bucket RLS).
-- AUTHORED NOT APPLIED. Per PROTOCOL-migration-safety.md: build-local only; the
-- prod apply (advisor baseline + diff) and the private "monthly-reports" bucket
-- CREATION are the Phase 12 / 12-04 operator-gate batch, NOT this plan.
--
-- Idempotent + re-runnable. Mirrors the established v0.3 RLS shape: member SELECT
-- via public.user_shop_ids(); writes are service-role only (no INSERT/UPDATE policy
-- -> default-deny for sessions; the cron writes with the service client, RLS-bypass).
--
-- What this migration provisions:
--   1. public.monthly_reports — one row per (shop_id, period_month) idempotency key,
--      tracking the stored PDF path + email send time. Member-readable, service-write.
--   2. storage.objects RLS for the private "monthly-reports" bucket — a customer may
--      SELECT (download) only objects under their own shop folder
--      ("{shop_id}/..."); writes are service-role only.

-- ── 1. monthly_reports table ────────────────────────────────────────────────
create table if not exists public.monthly_reports (
  shop_id uuid not null references public.shops (id) on delete cascade,
  period_month text not null,                       -- 'YYYY-MM'
  storage_path text not null,                        -- "{shop_id}/{period}.pdf"
  emailed_at timestamptz,
  created_at timestamptz not null default now(),
  primary key (shop_id, period_month)
);

alter table public.monthly_reports
  drop constraint if exists monthly_reports_period_month_check;
alter table public.monthly_reports
  add constraint monthly_reports_period_month_check
  check (period_month ~ '^\d{4}-\d{2}$');

alter table public.monthly_reports enable row level security;

-- Member SELECT (defense-in-depth on top of the download route's explicit gate).
drop policy if exists monthly_reports_select on public.monthly_reports;
create policy monthly_reports_select
  on public.monthly_reports
  for select
  using (shop_id in (select public.user_shop_ids()));

-- No INSERT/UPDATE/DELETE policy: writes are service-role only (RLS-bypass), like
-- analytics_snapshots / review_responses. A customer session can never write.

-- ── 2. private "monthly-reports" bucket RLS ─────────────────────────────────
-- NOTE: the bucket itself is CREATED at the 12-04 gate batch (private). The RLS
-- below gates downloads once it exists; bucket_id is matched by string, so the
-- policy is valid to author independently of bucket creation.
-- Key layout: "{shop_id}/{period}.pdf" -> (storage.foldername(name))[1] = shop_id.
drop policy if exists monthly_reports_objects_select on storage.objects;
create policy monthly_reports_objects_select
  on storage.objects
  for select
  to authenticated
  using (
    bucket_id = 'monthly-reports'
    and ((storage.foldername(name))[1])::uuid in (select public.user_shop_ids())
  );

-- No INSERT/UPDATE/DELETE policy on storage.objects for this bucket: uploads are
-- service-role only (the storeReportPdf/storeReportNarrative writers), RLS-bypass.
