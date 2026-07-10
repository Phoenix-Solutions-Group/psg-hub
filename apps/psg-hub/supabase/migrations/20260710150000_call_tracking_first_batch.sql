-- PSG-1081 — first-batch call tracking data path for BSM.
--
-- Decision: start with a manual-import storage path, not provider API OAuth.
-- The first-batch repo inventory identifies Wallace, Tedesco, and Tracy's as
-- the pilot cohort, but no checked-in source proves CallRail or WhatConverts is
-- already connected for any one shop. A provider-neutral import table lets PSG
-- load CallRail / WhatConverts exports immediately and keeps the door open for a
-- read-only API connector later with the same destination table.
--
-- Privacy posture: this table stores report fields only. It intentionally does
-- not store caller phone numbers or call recordings/transcripts. The tracking
-- number is the shop-owned number used in marketing, not the caller's number.
--
-- RLS: default-deny writes. Authenticated users can SELECT only rows for shops
-- they can already access; imports/upserts run through the service role.

create table if not exists public.call_tracking_calls (
  id uuid primary key default gen_random_uuid(),
  shop_id uuid not null references public.shops(id) on delete cascade,
  provider text not null
    check (provider in ('callrail', 'whatconverts', 'other')),
  provider_call_id text,
  provider_account_id text,
  idempotency_key text not null,
  call_started_at timestamptz not null,
  duration_seconds integer check (duration_seconds is null or duration_seconds >= 0),
  source text,
  campaign text,
  qualified boolean,
  tracking_number text,
  imported_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (shop_id, provider, idempotency_key)
);

alter table public.call_tracking_calls enable row level security;

drop policy if exists call_tracking_calls_select on public.call_tracking_calls;
create policy call_tracking_calls_select
  on public.call_tracking_calls
  for select
  using (shop_id in (select public.user_shop_ids()));

create index if not exists call_tracking_calls_shop_started_idx
  on public.call_tracking_calls (shop_id, call_started_at);

create index if not exists call_tracking_calls_shop_source_campaign_idx
  on public.call_tracking_calls (shop_id, source, campaign);

drop trigger if exists set_updated_at_call_tracking_calls on public.call_tracking_calls;
create trigger set_updated_at_call_tracking_calls
  before update on public.call_tracking_calls
  for each row execute function public.set_updated_at();
