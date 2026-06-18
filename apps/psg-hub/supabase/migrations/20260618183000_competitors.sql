-- v1.6 / 16-02 — competitors + competitor_scores: the internal competitor engine store.
-- `competitors` mirrors discovered/known rival body shops near one of our shops (one row
-- per shop+competitor, idempotent on UNIQUE(shop_id, normalized_name)). `competitor_scores`
-- is a SIBLING table (one row per competitor, UNIQUE(competitor_id)) holding the nightly
-- consolidator-aware threat score + sub-scores + rank + rationale — same sibling-of-mirror
-- pattern as review_sentiment (keeps the mirror table free of derived columns).
--
-- shop_id is DENORMALIZED onto both tables so RLS clamps directly to
-- `shop_id IN (SELECT user_shop_ids())` — the per-shop-indexable idiom used by
-- review_sentiment / analytics_snapshots. Writes are service-role (RLS bypassed); the
-- membership policies guard customer reads. Additive + idempotent (run-once safe).
-- AUTHORED ONLY — NOT applied to prod here; prod apply is the v1.6 gate batch
-- (PROTOCOL-migration-safety.md, mirrors 13-04 / 14-03). ZERO data written.

create table if not exists public.competitors (
  id uuid primary key default gen_random_uuid(),
  shop_id uuid not null references public.shops(id) on delete cascade,
  name text not null,
  normalized_name text not null,
  type text not null default 'independent',
  consolidator_group text,
  latitude double precision,
  longitude double precision,
  distance_miles numeric,
  rating numeric,
  review_count integer,
  website text,
  place_id text,
  source text not null default 'manual',
  raw jsonb,
  discovered_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- Idempotent discovery upsert key: one record per competitor per shop.
do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conrelid = 'public.competitors'::regclass
      and conname = 'competitors_shop_id_normalized_name_key'
  ) then
    alter table public.competitors
      add constraint competitors_shop_id_normalized_name_key unique (shop_id, normalized_name);
  end if;
end$$;

-- DB backstop for the app-side enum (independent | consolidator).
do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conrelid = 'public.competitors'::regclass
      and conname = 'competitors_type_check'
  ) then
    alter table public.competitors
      add constraint competitors_type_check check (type in ('independent', 'consolidator'));
  end if;
end$$;

create index if not exists competitors_shop_idx on public.competitors(shop_id);

create table if not exists public.competitor_scores (
  id uuid primary key default gen_random_uuid(),
  competitor_id uuid not null references public.competitors(id) on delete cascade,
  shop_id uuid not null references public.shops(id) on delete cascade,
  threat_score numeric not null,
  proximity_score numeric not null,
  presence_score numeric not null,
  consolidator_weight numeric not null,
  rank integer not null,
  rationale text,
  model_version text,
  scored_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- One score row per competitor: required for the nightly scoring upsert onConflict(competitor_id).
do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conrelid = 'public.competitor_scores'::regclass
      and conname = 'competitor_scores_competitor_id_key'
  ) then
    alter table public.competitor_scores
      add constraint competitor_scores_competitor_id_key unique (competitor_id);
  end if;
end$$;

create index if not exists competitor_scores_shop_idx on public.competitor_scores(shop_id);

-- RLS: membership-clamped reads, mirroring review_sentiment. Default-deny; the
-- service-role scoring worker bypasses RLS. drop-then-create = idempotent.
alter table public.competitors enable row level security;
alter table public.competitor_scores enable row level security;

drop policy if exists competitors_select on public.competitors;
create policy competitors_select on public.competitors
  for select using (shop_id in (select public.user_shop_ids()));

drop policy if exists competitors_insert on public.competitors;
create policy competitors_insert on public.competitors
  for insert with check (shop_id in (select public.user_shop_ids()));

drop policy if exists competitors_update on public.competitors;
create policy competitors_update on public.competitors
  for update using (shop_id in (select public.user_shop_ids()))
  with check (shop_id in (select public.user_shop_ids()));

drop policy if exists competitors_delete on public.competitors;
create policy competitors_delete on public.competitors
  for delete using (shop_id in (select public.user_shop_ids()));

drop policy if exists competitor_scores_select on public.competitor_scores;
create policy competitor_scores_select on public.competitor_scores
  for select using (shop_id in (select public.user_shop_ids()));

drop policy if exists competitor_scores_insert on public.competitor_scores;
create policy competitor_scores_insert on public.competitor_scores
  for insert with check (shop_id in (select public.user_shop_ids()));

drop policy if exists competitor_scores_update on public.competitor_scores;
create policy competitor_scores_update on public.competitor_scores
  for update using (shop_id in (select public.user_shop_ids()))
  with check (shop_id in (select public.user_shop_ids()));

drop policy if exists competitor_scores_delete on public.competitor_scores;
create policy competitor_scores_delete on public.competitor_scores
  for delete using (shop_id in (select public.user_shop_ids()));
