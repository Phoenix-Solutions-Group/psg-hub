-- BSM Phase 0 / PSG-194 — content_items publish-gate persistence + enforcement.
--
-- content_items already exists (20260602105554_remote_schema.sql) with the
-- status lifecycle draft|pending_review|approved|published and shop-scoped,
-- default-deny RLS. This migration adds the PSG-191 Content Writer run-harness
-- review metadata and the approved -> published trust enforcement:
--
--   1. New columns carrying the claims manifest + the two trust verdicts so the
--      approved -> published hook can resolve against verified facts:
--        - claims_manifest          jsonb  (toContentItemDraft.claimsManifest)
--        - claim_integrity_verdict  jsonb  (PSG-143 Check 3 ClaimIntegrityResult)
--        - gate_verdict             jsonb  (PSG-173 8-check publish-gate + ship)
--        - claim_integrity_checked_at timestamptz
--        - published_at             timestamptz
--      New columns inherit the existing content_items_* shop-scoped policies (RLS
--      is table-level, not column-level), so no policy change is needed.
--
--   2. Add 'rejected' to content_items_status_check. The reject route
--      (api/content/[id]/reject) writes status='rejected', which the original
--      CHECK omits -> every reject currently fails with a 23514 DB error. This
--      makes the route's contract valid (PSG-194 reject-bug fix).
--
--   3. A DB trigger (defense in depth) that blocks ANY update moving status into
--      'published' unless a ship gate_verdict is recorded — so the publish rule
--      holds even for writes that bypass POST /api/content/[id]/publish.
--
-- Additive + idempotent (run-once safe). AUTHORED for the BSM Phase 0 migration
-- batch; prod apply is env-coordinated with Ada (verify injected Supabase ref
-- != prod `localreach gylkkzmcmbdftxieyabw` before any write — PSG-168 lesson).

-- ── 1. Review-metadata columns ──────────────────────────────────────────────
alter table public.content_items
  add column if not exists claims_manifest jsonb,
  add column if not exists claim_integrity_verdict jsonb,
  add column if not exists gate_verdict jsonb,
  add column if not exists claim_integrity_checked_at timestamptz,
  add column if not exists published_at timestamptz;

-- ── 2. Allow 'rejected' in the status CHECK (reject-route bug fix) ───────────
-- drop-then-add = idempotent; the new set is a strict superset of the old one.
alter table public.content_items
  drop constraint if exists content_items_status_check;
alter table public.content_items
  add constraint content_items_status_check
  check (status = any (array[
    'draft'::text,
    'pending_review'::text,
    'approved'::text,
    'published'::text,
    'rejected'::text
  ]));

-- ── 3. approved -> published enforcement trigger (defense in depth) ──────────
-- Any UPDATE that moves a row INTO status='published' must carry a recorded
-- ship gate_verdict (the PSG-173 publish gate's final verdict). This holds even
-- if a write skips the publish route — a manual SQL update, a future worker, or
-- a bug elsewhere cannot publish content the gate did not clear.
create or replace function public.enforce_content_publish_gate()
  returns trigger
  language plpgsql
as $$
begin
  -- Only guard the transition INTO published; leave already-published rows and
  -- all other statuses untouched.
  if new.status = 'published'
     and (old.status is distinct from 'published') then
    if coalesce(new.gate_verdict ->> 'verdict', '') <> 'ship' then
      raise exception
        'content_items % cannot be published without a ship gate_verdict (got: %)',
        new.id, coalesce(new.gate_verdict ->> 'verdict', '<null>')
        using errcode = 'check_violation';
    end if;
  end if;
  return new;
end;
$$;

drop trigger if exists content_items_publish_gate on public.content_items;
create trigger content_items_publish_gate
  before update on public.content_items
  for each row
  execute function public.enforce_content_publish_gate();
