-- BSM Phase 0 / PSG-143 — verified_facts: the per-shop claim-integrity record.
--
-- The ONLY source of assertable facts for the Content Writer engine (Content
-- Writer spec §2). One row per shop (UNIQUE(shop_id), idempotent upsert key).
-- The app-side shape + validation live in src/lib/claim-integrity/types.ts
-- (verifiedFactsSchema); this table is its durable store. Arrays/blocks are
-- JSONB to mirror that schema 1:1 without a wide column explosion; the
-- drp_disclosure opt-in is the compliance-critical block (spec §5).
--
-- shop_id is the tenant key. RLS is DEFAULT-DENY, membership-clamped to
-- `shop_id IN (SELECT user_shop_ids())`, mirroring competitors / review_sentiment.
-- Writes are service-role (RLS bypassed — the onboarding/enrichment worker and
-- the superadmin facts editor); membership policies guard customer reads.
-- Additive + idempotent (run-once safe).
-- AUTHORED ONLY — NOT applied to prod here; prod apply is the BSM Phase 0 gate
-- batch (PROTOCOL-migration-safety.md). ZERO data written.

create table if not exists public.verified_facts (
  id uuid primary key default gen_random_uuid(),
  shop_id uuid not null references public.shops(id) on delete cascade,
  -- Verified credentials: [{ kind, label, level?, issuer? }]
  certifications jsonb not null default '[]'::jsonb,
  -- Warranty block: { terms, lifetime, years? } or null
  warranty jsonb,
  years_in_business integer,
  -- Approved review quotes: [{ quote, attribution?, source? }]
  approved_review_quotes jsonb not null default '[]'::jsonb,
  -- DRP opt-in: { allowed, authorizedCarriers[], authorizedBy?, authorizedAt? }
  drp_disclosure jsonb not null default '{"allowed": false, "authorizedCarriers": []}'::jsonb,
  -- Per-shop competitor names additionally denied in copy.
  known_competitors text[] not null default '{}',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- One verified-facts record per shop: required for the onConflict(shop_id) upsert.
do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conrelid = 'public.verified_facts'::regclass
      and conname = 'verified_facts_shop_id_key'
  ) then
    alter table public.verified_facts
      add constraint verified_facts_shop_id_key unique (shop_id);
  end if;
end$$;

-- Guard against a non-negative tenure at the DB level (app schema also enforces).
do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conrelid = 'public.verified_facts'::regclass
      and conname = 'verified_facts_years_nonneg_check'
  ) then
    alter table public.verified_facts
      add constraint verified_facts_years_nonneg_check
      check (years_in_business is null or years_in_business >= 0);
  end if;
end$$;

create index if not exists verified_facts_shop_idx on public.verified_facts(shop_id);

-- RLS: default-deny, membership-clamped reads/writes. Service-role bypasses RLS
-- for the enrichment worker. drop-then-create = idempotent.
alter table public.verified_facts enable row level security;

drop policy if exists verified_facts_select on public.verified_facts;
create policy verified_facts_select on public.verified_facts
  for select using (shop_id in (select public.user_shop_ids()));

drop policy if exists verified_facts_insert on public.verified_facts;
create policy verified_facts_insert on public.verified_facts
  for insert with check (shop_id in (select public.user_shop_ids()));

drop policy if exists verified_facts_update on public.verified_facts;
create policy verified_facts_update on public.verified_facts
  for update using (shop_id in (select public.user_shop_ids()))
  with check (shop_id in (select public.user_shop_ids()));

drop policy if exists verified_facts_delete on public.verified_facts;
create policy verified_facts_delete on public.verified_facts
  for delete using (shop_id in (select public.user_shop_ids()));
