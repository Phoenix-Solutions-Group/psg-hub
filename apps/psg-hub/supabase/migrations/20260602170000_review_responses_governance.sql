-- Phase 6 / 06-04 — Extend review_responses to the psg-hub governance model (path: EXTEND).
-- review_responses is already RLS-on with membership-clamped policies
-- (review_item_id -> review_items.shop_id -> user_shop_ids()). This migration does NOT
-- change RLS or policies. It ONLY adds the governance columns the reviews code reads/writes,
-- plus a UNIQUE(review_item_id) so the one-response-per-review-item draft upsert (onConflict)
-- resolves. review_responses + review_items are 0 rows => zero data risk. Idempotent; run-once safe.
-- Decision: 06-04 Task 1 = EXTEND + app-side rename review_id -> review_item_id (live draft_text kept;
-- app body <-> draft_text via PostgREST alias). See PROTOCOL-migration-safety.md.
-- Rollback: drop the added columns + the unique constraint.

alter table public.review_responses
  add column if not exists shop_id uuid references public.shops(id) on delete cascade,
  add column if not exists tone_preset text,
  add column if not exists model_id text,
  add column if not exists prompt_version text,
  add column if not exists version integer not null default 1,
  add column if not exists safety_flags text[] not null default '{}'::text[],
  add column if not exists safety_overridden boolean not null default false,
  add column if not exists safety_overridden_by uuid,
  add column if not exists created_by uuid,
  add column if not exists approved_by uuid,
  add column if not exists approved_at timestamptz;

-- One response per review item: required for the draft upsert's onConflict(review_item_id).
do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conrelid = 'public.review_responses'::regclass
      and conname = 'review_responses_review_item_id_key'
  ) then
    alter table public.review_responses
      add constraint review_responses_review_item_id_key unique (review_item_id);
  end if;
end$$;
