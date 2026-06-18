-- Phase 15 / 15-01 — reconcile the subscription tier source-of-truth.
-- GROUNDING (research §4, confirmed by file reads):
--   * src/lib/tier/gate.ts gates on subscriptions.tier (a 3-value TS enum:
--     essentials | growth | performance). It NEVER reads shops.subscription_tier.
--   * shops.subscription_tier (DEFAULT 'essentials', CHECK incl. 'multi_location')
--     is vestigial — zero source readers (grep multi_location over src/ = none).
--   * Both the shops and subscriptions tier CHECKs admit a 4th value 'multi_location'
--     that the TS enum does not, so the DB and the app disagree on the tier domain.
--
-- TWO changes, single source of truth = subscriptions.tier (3 values):
--   1. DROP COLUMN shops.subscription_tier (drops its CHECK with it).
--   2. Tighten subscriptions_tier_check to ('essentials','growth','performance').
--
-- AUTO-NAMED CONSTRAINT TRAP (the 12-05a/b + 13-01 lesson): resolve the LIVE tier
-- CHECK name from pg_constraint by its definition and drop it by that real name,
-- rather than assuming the name — then re-add the tightened CHECK.
--
-- ⚠️ GATE PRE-CHECK (Phase-15 gate batch, NOT here): tightening the CHECK fails if any
-- live subscriptions row has tier='multi_location'. Before applying to prod, verify
-- `select count(*) from public.subscriptions where tier = 'multi_location'` = 0 (or
-- remap those rows first). This migration intentionally does NOT mutate data — a schema
-- migration should not silently rewrite a customer's tier.
--
-- Additive-safe + idempotent (drop-if-exists column; resolve-then-readd CHECK).
-- AUTHORED ONLY — NOT applied to prod here; prod apply is the Phase-15 gate batch under
-- PROTOCOL-migration-safety.md with an advisor baseline+diff. ZERO data written.

-- 1. Drop the vestigial column (its CHECK constraint drops with it).
alter table public.shops drop column if exists subscription_tier;

-- 2. Tighten subscriptions.tier to the 3-value domain the TS enum uses.
do $$
declare
  cname text;
begin
  select conname
    into cname
    from pg_constraint
   where conrelid = 'public.subscriptions'::regclass
     and contype = 'c'
     and pg_get_constraintdef(oid) ilike '%tier%'
   limit 1;

  if cname is not null then
    execute format(
      'alter table public.subscriptions drop constraint %I', cname
    );
  end if;
end $$;

alter table public.subscriptions
  add constraint subscriptions_tier_check
  check (tier in ('essentials', 'growth', 'performance'));
