-- PSG-1453 — first-login pilot signal instrumentation.
--
-- Adds directly queryable, append-only evidence for the BSM first-login pilot:
--   - explicit audit outcome fields on shop_seo_audits
--   - lightweight countable events for setup start, first-win card view, and
--     Google connect clicks
--
-- Events intentionally store only ids, event names, and small non-private
-- metadata. They do not store customer content, URLs, addresses, phone numbers,
-- or OAuth tokens.

alter table public.shop_seo_audits
  add column if not exists audit_status text not null default 'completed',
  add column if not exists audit_outcome text not null default 'audited',
  add column if not exists error_reason text;

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conrelid = 'public.shop_seo_audits'::regclass
      and conname = 'shop_seo_audits_audit_status_check'
  ) then
    alter table public.shop_seo_audits
      add constraint shop_seo_audits_audit_status_check
      check (audit_status in ('completed', 'failed'));
  end if;

  if not exists (
    select 1 from pg_constraint
    where conrelid = 'public.shop_seo_audits'::regclass
      and conname = 'shop_seo_audits_audit_outcome_check'
  ) then
    alter table public.shop_seo_audits
      add constraint shop_seo_audits_audit_outcome_check
      check (audit_outcome in ('audited', 'no_live_site', 'crawl_failed'));
  end if;
end$$;

create index if not exists shop_seo_audits_outcome_idx
  on public.shop_seo_audits(shop_id, audit_status, audit_outcome, generated_at desc);

create table if not exists public.bsm_pilot_events (
  id uuid primary key default gen_random_uuid(),
  event_name text not null check (
    event_name in (
      'setup_started',
      'first_login_card_viewed',
      'connect_google_clicked',
      'audit_save_failed'
    )
  ),
  shop_id uuid references public.shops(id) on delete cascade,
  user_id uuid,
  properties jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  constraint bsm_pilot_events_properties_object check (jsonb_typeof(properties) = 'object')
);

create index if not exists bsm_pilot_events_name_created_idx
  on public.bsm_pilot_events(event_name, created_at desc);

create index if not exists bsm_pilot_events_shop_name_created_idx
  on public.bsm_pilot_events(shop_id, event_name, created_at desc)
  where shop_id is not null;

alter table public.bsm_pilot_events enable row level security;

drop policy if exists bsm_pilot_events_shop_select on public.bsm_pilot_events;
create policy bsm_pilot_events_shop_select on public.bsm_pilot_events
  for select using (shop_id in (select public.user_shop_ids()));

revoke update, delete on public.bsm_pilot_events from anon, authenticated;
