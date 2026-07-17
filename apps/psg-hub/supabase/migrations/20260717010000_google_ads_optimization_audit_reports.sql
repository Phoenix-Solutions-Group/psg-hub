-- PSG-1708 — Google Ads optimization audit report artifacts.
--
-- Human-reviewed Google Ads audit PDFs are stored in a private bucket and
-- indexed by a shop-scoped metadata row. Customer sessions may read only rows
-- and objects under shops they belong to. Writes are service-role only through
-- the ops publish route so publishing can be audited in access_audit.

create table if not exists public.google_ads_optimization_audit_reports (
  id uuid primary key default gen_random_uuid(),
  shop_id uuid not null references public.shops (id) on delete cascade,
  title text not null,
  period_month text,
  storage_path text not null unique,
  original_filename text,
  content_type text not null default 'application/pdf',
  byte_size integer not null check (byte_size > 0),
  published_by_profile_id uuid not null references public.profiles (id) on delete restrict,
  published_at timestamptz not null default now(),
  metadata_jsonb jsonb not null default '{}'::jsonb
);

alter table public.google_ads_optimization_audit_reports
  drop constraint if exists google_ads_optimization_audit_reports_period_month_check;
alter table public.google_ads_optimization_audit_reports
  add constraint google_ads_optimization_audit_reports_period_month_check
  check (period_month is null or period_month ~ '^\d{4}-\d{2}$');

alter table public.google_ads_optimization_audit_reports
  drop constraint if exists google_ads_optimization_audit_reports_pdf_check;
alter table public.google_ads_optimization_audit_reports
  add constraint google_ads_optimization_audit_reports_pdf_check
  check (
    content_type = 'application/pdf'
    and storage_path ~ ('^' || shop_id::text || '/[0-9a-f-]{36}\.pdf$')
  );

create index if not exists google_ads_optimization_audit_reports_shop_published_idx
  on public.google_ads_optimization_audit_reports (shop_id, published_at desc);

alter table public.google_ads_optimization_audit_reports enable row level security;

drop policy if exists google_ads_optimization_audit_reports_select_shop_member
  on public.google_ads_optimization_audit_reports;
create policy google_ads_optimization_audit_reports_select_shop_member
  on public.google_ads_optimization_audit_reports
  for select
  to authenticated
  using (shop_id in (select public.user_shop_ids()));

-- No INSERT/UPDATE/DELETE policy: publishing uses service-role after an ops gate.

insert into storage.buckets (id, name, public)
values ('google-ads-audit-reports', 'google-ads-audit-reports', false)
on conflict (id) do nothing;

drop policy if exists google_ads_audit_reports_objects_select on storage.objects;
create policy google_ads_audit_reports_objects_select
  on storage.objects
  for select
  to authenticated
  using (
    bucket_id = 'google-ads-audit-reports'
    and ((storage.foldername(name))[1])::uuid in (select public.user_shop_ids())
  );

-- No INSERT/UPDATE/DELETE policy on storage.objects for this bucket: uploads are
-- service-role only through the audited PSG publish route.
