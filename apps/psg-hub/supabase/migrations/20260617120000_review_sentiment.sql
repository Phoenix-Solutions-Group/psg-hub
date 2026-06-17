-- Phase 14 / 14-03 — review_sentiment: per-review LLM sentiment classification.
-- A NEW sibling table to review_items (keeps review_items PRISTINE — it mirrors the
-- external source). One classification row per review (UNIQUE(review_item_id)), holding
-- the structured-output labels (polarity/confidence/themes/actionable_complaint), the raw
-- model JSON (auditability + prompt_version re-analysis), and governance (model_id /
-- prompt_version / version). classified_updated_at stores the review_items.updated_at the
-- row was classified against — the dirty-key the orchestrator uses to re-classify an EDITED
-- review (14-01 maps v4 updateTime -> review_items.updated_at, bumped on re-upsert).
--
-- shop_id is DENORMALIZED (mirrors how 06-04 put shop_id on review_responses) so RLS clamps
-- directly `shop_id IN (SELECT user_shop_ids())` — the simple, per-shop-indexable review_items
-- policy idiom, not the nested review_responses subquery. NO analytics_sync_runs source-CHECK
-- widen (the classify worker keeps no ledger; per-row columns + llm_call_log are the audit).
-- Additive + idempotent (run-once safe). AUTHORED ONLY — NOT applied to prod here; prod apply
-- is the Phase-14 gate batch (mirrors 13-04, PROTOCOL-migration-safety.md). ZERO data written.

create table if not exists public.review_sentiment (
  id uuid primary key default gen_random_uuid(),
  review_item_id uuid not null references public.review_items(id) on delete cascade,
  shop_id uuid not null references public.shops(id) on delete cascade,
  polarity text,
  confidence numeric,
  themes text[] not null default '{}'::text[],
  actionable_complaint boolean not null default false,
  raw jsonb,
  model_id text,
  prompt_version text,
  version integer not null default 1,
  classified_updated_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- One sentiment row per review item: required for the classify upsert's onConflict(review_item_id).
do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conrelid = 'public.review_sentiment'::regclass
      and conname = 'review_sentiment_review_item_id_key'
  ) then
    alter table public.review_sentiment
      add constraint review_sentiment_review_item_id_key unique (review_item_id);
  end if;
end$$;

-- Named CHECK on polarity (the zod enum is the app-side gate; this is the DB backstop).
do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conrelid = 'public.review_sentiment'::regclass
      and conname = 'review_sentiment_polarity_check'
  ) then
    alter table public.review_sentiment
      add constraint review_sentiment_polarity_check
      check (polarity in ('positive', 'neutral', 'negative'));
  end if;
end$$;

-- RLS: membership-clamped, mirroring the live review_items policies (shop_id IN user_shop_ids()).
-- Default-deny; the service-role classify worker bypasses RLS. drop-then-create = idempotent.
alter table public.review_sentiment enable row level security;

drop policy if exists review_sentiment_select on public.review_sentiment;
create policy review_sentiment_select on public.review_sentiment
  for select using (shop_id in (select public.user_shop_ids()));

drop policy if exists review_sentiment_insert on public.review_sentiment;
create policy review_sentiment_insert on public.review_sentiment
  for insert with check (shop_id in (select public.user_shop_ids()));

drop policy if exists review_sentiment_update on public.review_sentiment;
create policy review_sentiment_update on public.review_sentiment
  for update using (shop_id in (select public.user_shop_ids()))
  with check (shop_id in (select public.user_shop_ids()));

drop policy if exists review_sentiment_delete on public.review_sentiment;
create policy review_sentiment_delete on public.review_sentiment
  for delete using (shop_id in (select public.user_shop_ids()));

create index if not exists review_sentiment_shop_idx on public.review_sentiment(shop_id);
