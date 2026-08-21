-- PSG-1707 — Google Ads customer request workflow.
--
-- Customers can ask PSG for a campaign adjustment or a new campaign. This is
-- an intake and review workflow only; no row here executes a Google Ads change.
-- Writes are service-role only through controlled server routes. Customer reads
-- are clamped to the user's shops by RLS.

create table if not exists public.google_ads_customer_requests (
  id uuid primary key default gen_random_uuid(),
  shop_id uuid not null references public.shops(id) on delete cascade,
  requested_by_profile_id uuid not null references public.profiles(id) on delete restrict,
  request_type text not null
    check (request_type in ('campaign_adjustment', 'new_campaign')),
  campaign_id uuid references public.google_ads_campaigns(id) on delete set null,
  campaign_name text,
  title text not null,
  details text not null,
  desired_launch_date date,
  budget_notes text,
  status text not null default 'submitted'
    check (
      status in (
        'submitted',
        'psg_reviewing',
        'needs_more_info',
        'in_progress',
        'done',
        'declined'
      )
    ),
  psg_response text,
  decline_reason text,
  updated_by_profile_id uuid references public.profiles(id) on delete set null,
  resolved_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists google_ads_customer_requests_shop_status_idx
  on public.google_ads_customer_requests (shop_id, status, created_at desc);

create index if not exists google_ads_customer_requests_requested_by_idx
  on public.google_ads_customer_requests (requested_by_profile_id, created_at desc);

alter table public.google_ads_customer_requests enable row level security;

drop policy if exists google_ads_customer_requests_select on public.google_ads_customer_requests;
create policy google_ads_customer_requests_select
  on public.google_ads_customer_requests
  for select to authenticated
  using (shop_id in (select public.user_shop_ids()));

drop trigger if exists set_updated_at_google_ads_customer_requests
  on public.google_ads_customer_requests;
create trigger set_updated_at_google_ads_customer_requests
  before update on public.google_ads_customer_requests
  for each row execute function public.set_updated_at();
