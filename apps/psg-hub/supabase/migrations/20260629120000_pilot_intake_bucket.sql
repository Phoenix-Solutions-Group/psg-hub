-- Track A / PSG-394 — Private "pilot-intake" Storage bucket for the real pilot
-- FileMaker RO/Estimate export (07-10 critical path; feeds PSG-387 E2E).
--
-- AUTHORED NOT APPLIED. Per PROTOCOL-migration-safety.md the prod `db push` +
-- advisor diff is the operator-gate step, NOT this plan. The bucket itself is
-- created here (idempotent insert into storage.buckets) so that once the operator
-- pushes, the superadmin signed-upload route (POST /api/ops/intake/signed-upload)
-- can mint createSignedUploadUrl tokens against an existing private bucket.
--
-- Idempotent + re-runnable. Mirrors the established v0.3 RLS shape from the
-- "monthly-reports" bucket (20260610000000_monthly_reports.sql): private bucket,
-- default-deny RLS, member SELECT only; writes are service-role / signed-token
-- only (no INSERT/UPDATE/DELETE policy for sessions).
--
-- Path convention: "{companySlug}/{shopSlug}/..." e.g.
--   "collision-leaders/shelton-collision/ro-export-2026-06.csv"
-- so (storage.foldername(name))[2] = shopSlug, joined to public.shops.slug to
-- scope member reads to the caller's own shops.
--
-- Rollback (manual, reverse order):
--   drop policy if exists pilot_intake_objects_select on storage.objects;
--   delete from storage.buckets where id = 'pilot-intake';

-- ── 1. private "pilot-intake" bucket ────────────────────────────────────────
-- public=false → no anonymous/public URLs; objects reachable only via the member
-- SELECT policy below, the service-role client, or a time-limited signed URL.
insert into storage.buckets (id, name, public)
values ('pilot-intake', 'pilot-intake', false)
on conflict (id) do nothing;

-- ── 2. member SELECT on the private bucket ──────────────────────────────────
-- A member may download (SELECT) only objects under a shop slug they belong to.
-- Defense-in-depth on top of the superadmin-gated mint route; RLS is the
-- authoritative backstop. Raw intake exports are operator-facing, so this policy
-- is deliberately the ONLY session-reachable access path.
drop policy if exists pilot_intake_objects_select on storage.objects;
create policy pilot_intake_objects_select
  on storage.objects
  for select
  to authenticated
  using (
    bucket_id = 'pilot-intake'
    and (storage.foldername(name))[2] in (
      select s.slug
      from public.shops s
      where s.id in (select public.user_shop_ids())
        and s.slug is not null
    )
  );

-- No INSERT/UPDATE/DELETE policy on storage.objects for this bucket: uploads are
-- minted as time-limited signed-upload URLs (createSignedUploadUrl, service-role)
-- and deletes/overwrites are service-role only (RLS-bypass). A customer session
-- can never write to or delete from pilot-intake.
