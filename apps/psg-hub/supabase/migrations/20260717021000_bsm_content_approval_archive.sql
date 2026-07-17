-- PSG-1720 — BSM approved-content archive.
--
-- Customer-approved files and generated pages share one shop-scoped review model.
-- Customers can read only their own shop rows through public.user_shop_ids().
-- PSG/admin writes stay service-role only after app-level permission checks.

create table if not exists public.bsm_content_review_items (
  id uuid primary key default gen_random_uuid(),
  shop_id uuid not null references public.shops(id) on delete cascade,
  source_content_item_id uuid references public.content_items(id) on delete set null,
  source_kind text not null
    check (source_kind in ('uploaded_file', 'generated_page', 'content_item')),
  title text not null,
  content_type text not null,
  status text not null default 'draft'
    check (status in ('draft', 'sent', 'in_review', 'updates_requested', 'approved', 'declined', 'archived')),
  current_version_id uuid,
  admin_context_note text,
  sent_at timestamptz,
  approved_at timestamptz,
  archived_at timestamptz,
  created_by_profile_id uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.bsm_content_review_versions (
  id uuid primary key default gen_random_uuid(),
  shop_id uuid not null references public.shops(id) on delete cascade,
  review_item_id uuid not null references public.bsm_content_review_items(id) on delete cascade,
  version_number integer not null check (version_number > 0),
  version_label text,
  storage_bucket text,
  storage_object_path text,
  generated_page_path text,
  source_content_item_id uuid references public.content_items(id) on delete set null,
  preview_url text,
  snapshot_jsonb jsonb not null default '{}'::jsonb,
  checksum text,
  created_by_profile_id uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  unique (review_item_id, version_number),
  constraint bsm_content_review_versions_source_check
    check (
      storage_object_path is not null
      or generated_page_path is not null
      or source_content_item_id is not null
      or preview_url is not null
      or snapshot_jsonb <> '{}'::jsonb
    )
);

alter table public.bsm_content_review_items
  drop constraint if exists bsm_content_review_items_current_version_fk;
alter table public.bsm_content_review_items
  add constraint bsm_content_review_items_current_version_fk
  foreign key (current_version_id)
  references public.bsm_content_review_versions(id)
  on delete set null;

create table if not exists public.bsm_content_review_decisions (
  id uuid primary key default gen_random_uuid(),
  shop_id uuid not null references public.shops(id) on delete cascade,
  review_item_id uuid not null references public.bsm_content_review_items(id) on delete cascade,
  version_id uuid not null references public.bsm_content_review_versions(id) on delete restrict,
  decision text not null check (decision in ('approved', 'declined', 'updates_requested')),
  message text,
  actor_profile_id uuid references public.profiles(id) on delete set null,
  actor_display_name text,
  actor_role text not null default 'customer'
    check (actor_role in ('customer', 'psg_admin', 'system')),
  decided_at timestamptz not null default now(),
  created_at timestamptz not null default now()
);

create table if not exists public.bsm_content_review_events (
  id uuid primary key default gen_random_uuid(),
  shop_id uuid not null references public.shops(id) on delete cascade,
  review_item_id uuid not null references public.bsm_content_review_items(id) on delete cascade,
  version_id uuid references public.bsm_content_review_versions(id) on delete set null,
  decision_id uuid references public.bsm_content_review_decisions(id) on delete set null,
  event_type text not null,
  actor_profile_id uuid references public.profiles(id) on delete set null,
  payload_jsonb jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create index if not exists bsm_content_review_items_shop_status_idx
  on public.bsm_content_review_items (shop_id, status, updated_at desc);
create index if not exists bsm_content_review_versions_item_idx
  on public.bsm_content_review_versions (review_item_id, version_number desc);
create index if not exists bsm_content_review_decisions_archive_idx
  on public.bsm_content_review_decisions (shop_id, decision, decided_at desc);
create index if not exists bsm_content_review_events_item_idx
  on public.bsm_content_review_events (review_item_id, created_at desc);

alter table public.bsm_content_review_items enable row level security;
alter table public.bsm_content_review_versions enable row level security;
alter table public.bsm_content_review_decisions enable row level security;
alter table public.bsm_content_review_events enable row level security;

drop policy if exists bsm_content_review_items_select_shop_member on public.bsm_content_review_items;
create policy bsm_content_review_items_select_shop_member
  on public.bsm_content_review_items
  for select
  to authenticated
  using (shop_id in (select public.user_shop_ids()));

drop policy if exists bsm_content_review_versions_select_shop_member on public.bsm_content_review_versions;
create policy bsm_content_review_versions_select_shop_member
  on public.bsm_content_review_versions
  for select
  to authenticated
  using (shop_id in (select public.user_shop_ids()));

drop policy if exists bsm_content_review_decisions_select_shop_member on public.bsm_content_review_decisions;
create policy bsm_content_review_decisions_select_shop_member
  on public.bsm_content_review_decisions
  for select
  to authenticated
  using (shop_id in (select public.user_shop_ids()));

drop policy if exists bsm_content_review_events_select_shop_member on public.bsm_content_review_events;
create policy bsm_content_review_events_select_shop_member
  on public.bsm_content_review_events
  for select
  to authenticated
  using (shop_id in (select public.user_shop_ids()));

-- No customer INSERT/UPDATE/DELETE policies yet. Decision/comment write routes
-- must add app-level gates before enabling customer writes in later tasks.

drop trigger if exists set_updated_at_bsm_content_review_items on public.bsm_content_review_items;
create trigger set_updated_at_bsm_content_review_items
  before update on public.bsm_content_review_items
  for each row execute function public.set_updated_at();
