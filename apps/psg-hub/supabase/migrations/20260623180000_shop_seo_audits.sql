-- Wave 1C / PSG-227 — shop_seo_audits: persisted baseline SEO audit deliverables.
-- One row per audit RUN (the deliverable is re-runnable on demand, so history is
-- kept — never overwritten). The full client-ready ShopAuditReport is stored as
-- `report` jsonb so the customer-facing renderer can re-project any past audit
-- without re-crawling; the scalar columns (mode/health_score/grade/summary) are
-- denormalized for cheap list/summary reads on the dashboard surface.
--
-- shop_id is denormalized so RLS clamps directly to `shop_id IN (SELECT user_shop_ids())`
-- — the per-shop idiom used by competitors / verified_facts / review_sentiment.
-- Customer reads/inserts are membership-gated; the audit worker runs service-role
-- (RLS bypassed). APPEND-ONLY by policy: no update/delete policy, so a stored
-- audit is an immutable record. Additive + idempotent (run-once safe).
-- AUTHORED ONLY — NOT applied to prod here; prod apply is the gate batch
-- (PROTOCOL-migration-safety.md). ZERO data written.

create table if not exists public.shop_seo_audits (
  id uuid primary key default gen_random_uuid(),
  shop_id uuid not null references public.shops(id) on delete cascade,
  -- The audited domain at run time, or null for a greenfield (no-site) audit.
  domain text,
  mode text not null default 'audited',
  -- 0–100 health score; null for greenfield (nothing live to score).
  health_score integer,
  grade text not null default '—',
  -- Denormalized KPI block for list views (pagesCrawled/keep/improve/keyword counts).
  summary jsonb not null default '{}'::jsonb,
  -- The full ShopAuditReport (findings + inventory + keyword targets), the renderer's input.
  report jsonb not null default '{}'::jsonb,
  created_by uuid,
  generated_at timestamptz not null default now(),
  created_at timestamptz not null default now()
);

-- DB backstop for the app-side enums.
do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conrelid = 'public.shop_seo_audits'::regclass
      and conname = 'shop_seo_audits_mode_check'
  ) then
    alter table public.shop_seo_audits
      add constraint shop_seo_audits_mode_check check (mode in ('audited', 'greenfield'));
  end if;
  if not exists (
    select 1 from pg_constraint
    where conrelid = 'public.shop_seo_audits'::regclass
      and conname = 'shop_seo_audits_score_range_check'
  ) then
    alter table public.shop_seo_audits
      add constraint shop_seo_audits_score_range_check
      check (health_score is null or (health_score >= 0 and health_score <= 100));
  end if;
end$$;

create index if not exists shop_seo_audits_shop_idx
  on public.shop_seo_audits(shop_id, generated_at desc);

-- RLS: default-deny, membership-clamped reads + inserts. APPEND-ONLY — no update
-- or delete policy is granted, so customer clients can never mutate a stored
-- audit. Service-role (the audit worker) bypasses RLS. drop-then-create = idempotent.
alter table public.shop_seo_audits enable row level security;

drop policy if exists shop_seo_audits_select on public.shop_seo_audits;
create policy shop_seo_audits_select on public.shop_seo_audits
  for select using (shop_id in (select public.user_shop_ids()));

drop policy if exists shop_seo_audits_insert on public.shop_seo_audits;
create policy shop_seo_audits_insert on public.shop_seo_audits
  for insert with check (shop_id in (select public.user_shop_ids()));
