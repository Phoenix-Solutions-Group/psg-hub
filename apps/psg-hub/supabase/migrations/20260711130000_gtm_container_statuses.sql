-- PSG-1082 — Google Tag Manager container status mirror for BSM readiness.
--
-- This is read-side inventory only. The cadenced collector/service role upserts the
-- latest GTM state per shop/container; mutation actions stay in the existing
-- Ads Mutation Studio dry-run -> approval -> execute path.

create table if not exists public.gtm_container_statuses (
  id uuid primary key default gen_random_uuid(),
  shop_id uuid not null references public.shops(id) on delete cascade,
  container_public_id text not null,
  account_name text,
  container_name text,
  workspace_id text,
  workspace_name text,
  workspace_fingerprint text,
  workspace_status text not null default 'unknown'
    check (workspace_status in ('unknown', 'clean', 'modified', 'published', 'error')),
  published_version_id text,
  published_version_name text,
  published_version_fingerprint text,
  tags_jsonb jsonb not null default '[]'::jsonb,
  triggers_jsonb jsonb not null default '[]'::jsonb,
  raw_jsonb jsonb not null default '{}'::jsonb,
  last_checked_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint gtm_container_statuses_shop_container_key unique (shop_id, container_public_id),
  constraint gtm_container_statuses_container_public_id_present check (btrim(container_public_id) <> ''),
  constraint gtm_container_statuses_tags_array check (jsonb_typeof(tags_jsonb) = 'array'),
  constraint gtm_container_statuses_triggers_array check (jsonb_typeof(triggers_jsonb) = 'array'),
  constraint gtm_container_statuses_raw_object check (jsonb_typeof(raw_jsonb) = 'object')
);

comment on table public.gtm_container_statuses is
  'PSG-1082: read-only GTM container readiness mirror per shop. Written by service-role collector; read by BSM readiness/reporting surfaces.';

create index if not exists gtm_container_statuses_shop_checked_idx
  on public.gtm_container_statuses (shop_id, last_checked_at desc);

alter table public.gtm_container_statuses enable row level security;

drop policy if exists gtm_container_statuses_shop_select on public.gtm_container_statuses;
create policy gtm_container_statuses_shop_select on public.gtm_container_statuses
  for select using (
    shop_id in (
      select su.shop_id
      from public.shop_users su
      where su.user_id = auth.uid()
    )
  );

drop policy if exists gtm_container_statuses_ops_select on public.gtm_container_statuses;
create policy gtm_container_statuses_ops_select on public.gtm_container_statuses
  for select using (private.current_user_has_fn('ads_mutations'));

