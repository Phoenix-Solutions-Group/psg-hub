-- PSG-3052 — structured, reviewed customer Ads requests.
-- Requests remain service-role writes through the owner/manager-gated route.

alter table public.google_ads_customer_requests
  drop constraint if exists google_ads_customer_requests_request_type_check;

alter table public.google_ads_customer_requests
  add constraint google_ads_customer_requests_request_type_check
  check (request_type in (
    'campaign_adjustment',
    'budget_change',
    'campaign_status_change',
    'new_campaign',
    'ad_copy_change',
    'location_change',
    'destination_change',
    'performance_review',
    'problem_report'
  ));

alter table public.google_ads_customer_requests
  add column if not exists request_values jsonb not null default '{}'::jsonb,
  add column if not exists acknowledged_at timestamptz;

comment on column public.google_ads_customer_requests.request_values is
  'Exact structured values shown to the customer before submission; review intake only.';
comment on column public.google_ads_customer_requests.acknowledged_at is
  'When the requester acknowledged that PSG review is required before any live change.';
