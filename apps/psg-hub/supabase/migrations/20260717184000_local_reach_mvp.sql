-- PSG-2040 - Local Reach MVP data model.
--
-- Local Reach is recommendation-first: PSG may create recommendations and
-- evidence, customers may review linked BSM approval items, and publishing is a
-- manual WordPress/Elementor handoff for the pilot. No table here stores
-- website credentials or enables automatic live-site edits.

create table if not exists public.local_reach_customer_settings (
  id uuid primary key default gen_random_uuid(),
  shop_id uuid not null references public.shops (id) on delete cascade,
  enabled boolean not null default true,
  shop_name text not null default 'Supreme Collision',
  market text not null default 'Ontario, Canada',
  pilot_status text not null default 'Setup audit in progress',
  wordpress_site_url text,
  publishing_mode text not null default 'manual',
  default_approval_profile_id uuid references public.profiles (id) on delete set null,
  last_audit_at timestamptz,
  sources_checked_through date,
  service_area_jsonb jsonb not null default '[]'::jsonb,
  services_jsonb jsonb not null default '[]'::jsonb,
  certifications_jsonb jsonb not null default '[]'::jsonb,
  claims_to_avoid_jsonb jsonb not null default '[]'::jsonb,
  approval_contacts_jsonb jsonb not null default '[]'::jsonb,
  publishing_notes text not null default 'Manual WordPress/Elementor publishing only. No automatic live website edits.',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint local_reach_customer_settings_unique_shop unique (shop_id),
  constraint local_reach_customer_settings_publishing_mode_check
    check (publishing_mode in ('manual')),
  constraint local_reach_customer_settings_arrays_check
    check (
      jsonb_typeof(service_area_jsonb) = 'array'
      and jsonb_typeof(services_jsonb) = 'array'
      and jsonb_typeof(certifications_jsonb) = 'array'
      and jsonb_typeof(claims_to_avoid_jsonb) = 'array'
      and jsonb_typeof(approval_contacts_jsonb) = 'array'
    )
);

create table if not exists public.local_reach_source_registry (
  id uuid primary key default gen_random_uuid(),
  shop_id uuid not null references public.shops (id) on delete cascade,
  source_type text not null,
  source_name text not null,
  source_url text not null,
  allowed_use text not null,
  robots_status text,
  terms_note text,
  last_checked_at timestamptz not null default now(),
  created_at timestamptz not null default now()
);

create table if not exists public.local_reach_recommendations (
  id uuid primary key default gen_random_uuid(),
  shop_id uuid not null references public.shops (id) on delete cascade,
  location_id text,
  recommendation_type text not null,
  title text not null,
  summary text not null,
  why_it_matters text not null,
  value_line text not null,
  business_value text not null,
  priority integer not null default 50,
  risk_level text not null default 'low',
  status text not null default 'draft',
  market text not null default 'Ontario, Canada',
  source_date date,
  target_page text,
  draft_preview text,
  location_safety_note text not null,
  approval_item_id uuid references public.bsm_content_review_items (id) on delete set null,
  created_by_profile_id uuid references public.profiles (id) on delete set null,
  published_url text,
  published_at timestamptz,
  verification_note text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint local_reach_recommendations_risk_check
    check (risk_level in ('low', 'medium', 'high')),
  constraint local_reach_recommendations_status_check
    check (status in ('draft', 'ready_for_review', 'approved', 'publishing', 'published', 'changes_requested', 'rejected', 'cancelled')),
  constraint local_reach_recommendations_publish_check
    check (
      status <> 'published'
      or (published_url is not null and published_at is not null and verification_note is not null)
    )
);

create table if not exists public.local_reach_evidence_links (
  id uuid primary key default gen_random_uuid(),
  recommendation_id uuid not null references public.local_reach_recommendations (id) on delete cascade,
  shop_id uuid not null references public.shops (id) on delete cascade,
  source_registry_id uuid references public.local_reach_source_registry (id) on delete set null,
  source_name text not null,
  url text not null,
  evidence_type text not null default 'public_source',
  source_date date not null,
  summary text not null,
  captured_at timestamptz not null default now()
);

create table if not exists public.local_reach_approval_status (
  id uuid primary key default gen_random_uuid(),
  recommendation_id uuid not null references public.local_reach_recommendations (id) on delete cascade,
  shop_id uuid not null references public.shops (id) on delete cascade,
  review_item_id uuid references public.bsm_content_review_items (id) on delete set null,
  decision text not null,
  decision_profile_id uuid references public.profiles (id) on delete set null,
  decision_note text,
  decided_at timestamptz not null default now(),
  constraint local_reach_approval_status_decision_check
    check (decision in ('approve', 'decline', 'request_updates'))
);

create table if not exists public.local_reach_publish_events (
  id uuid primary key default gen_random_uuid(),
  recommendation_id uuid not null references public.local_reach_recommendations (id) on delete cascade,
  shop_id uuid not null references public.shops (id) on delete cascade,
  publish_mode text not null default 'manual',
  target_url text not null,
  published_by_profile_id uuid references public.profiles (id) on delete set null,
  published_at timestamptz not null default now(),
  verification_jsonb jsonb not null default '{}'::jsonb,
  constraint local_reach_publish_events_mode_check
    check (publish_mode = 'manual')
);

create table if not exists public.local_reach_learning_feedback (
  id uuid primary key default gen_random_uuid(),
  shop_id uuid not null references public.shops (id) on delete cascade,
  recommendation_id uuid references public.local_reach_recommendations (id) on delete cascade,
  feedback_type text not null,
  feedback_jsonb jsonb not null default '{}'::jsonb,
  created_by_profile_id uuid references public.profiles (id) on delete set null,
  created_at timestamptz not null default now()
);

create index if not exists local_reach_recommendations_shop_status_idx
  on public.local_reach_recommendations (shop_id, status, priority, updated_at desc);
create index if not exists local_reach_evidence_links_recommendation_idx
  on public.local_reach_evidence_links (recommendation_id, source_date desc);
create index if not exists local_reach_approval_status_recommendation_idx
  on public.local_reach_approval_status (recommendation_id, decided_at desc);
create index if not exists local_reach_publish_events_recommendation_idx
  on public.local_reach_publish_events (recommendation_id, published_at desc);
create index if not exists local_reach_learning_feedback_shop_idx
  on public.local_reach_learning_feedback (shop_id, created_at desc);

alter table public.local_reach_customer_settings enable row level security;
alter table public.local_reach_source_registry enable row level security;
alter table public.local_reach_recommendations enable row level security;
alter table public.local_reach_evidence_links enable row level security;
alter table public.local_reach_approval_status enable row level security;
alter table public.local_reach_publish_events enable row level security;
alter table public.local_reach_learning_feedback enable row level security;

drop policy if exists local_reach_customer_settings_shop_select on public.local_reach_customer_settings;
create policy local_reach_customer_settings_shop_select
  on public.local_reach_customer_settings for select to authenticated
  using (shop_id in (select public.user_shop_ids()));

drop policy if exists local_reach_source_registry_shop_select on public.local_reach_source_registry;
create policy local_reach_source_registry_shop_select
  on public.local_reach_source_registry for select to authenticated
  using (shop_id in (select public.user_shop_ids()));

drop policy if exists local_reach_recommendations_shop_select on public.local_reach_recommendations;
create policy local_reach_recommendations_shop_select
  on public.local_reach_recommendations for select to authenticated
  using (shop_id in (select public.user_shop_ids()));

drop policy if exists local_reach_evidence_links_shop_select on public.local_reach_evidence_links;
create policy local_reach_evidence_links_shop_select
  on public.local_reach_evidence_links for select to authenticated
  using (shop_id in (select public.user_shop_ids()));

drop policy if exists local_reach_approval_status_shop_select on public.local_reach_approval_status;
create policy local_reach_approval_status_shop_select
  on public.local_reach_approval_status for select to authenticated
  using (shop_id in (select public.user_shop_ids()));

drop policy if exists local_reach_publish_events_shop_select on public.local_reach_publish_events;
create policy local_reach_publish_events_shop_select
  on public.local_reach_publish_events for select to authenticated
  using (shop_id in (select public.user_shop_ids()));

drop policy if exists local_reach_learning_feedback_shop_select on public.local_reach_learning_feedback;
create policy local_reach_learning_feedback_shop_select
  on public.local_reach_learning_feedback for select to authenticated
  using (shop_id in (select public.user_shop_ids()));

-- Writes stay PSG-owned in the MVP. Customer decisions continue through the
-- existing BSM approval routes; service-role jobs then mirror the status here.
grant select on public.local_reach_customer_settings to authenticated;
grant select on public.local_reach_source_registry to authenticated;
grant select on public.local_reach_recommendations to authenticated;
grant select on public.local_reach_evidence_links to authenticated;
grant select on public.local_reach_approval_status to authenticated;
grant select on public.local_reach_publish_events to authenticated;
grant select on public.local_reach_learning_feedback to authenticated;

grant all on public.local_reach_customer_settings to service_role;
grant all on public.local_reach_source_registry to service_role;
grant all on public.local_reach_recommendations to service_role;
grant all on public.local_reach_evidence_links to service_role;
grant all on public.local_reach_approval_status to service_role;
grant all on public.local_reach_publish_events to service_role;
grant all on public.local_reach_learning_feedback to service_role;

drop trigger if exists set_updated_at_local_reach_customer_settings on public.local_reach_customer_settings;
create trigger set_updated_at_local_reach_customer_settings
  before update on public.local_reach_customer_settings
  for each row execute function public.set_updated_at();

drop trigger if exists set_updated_at_local_reach_recommendations on public.local_reach_recommendations;
create trigger set_updated_at_local_reach_recommendations
  before update on public.local_reach_recommendations
  for each row execute function public.set_updated_at();
