-- PSG-617 (parent PSG-614) — CAPTURE-ONLY: prod-only storage buckets.
--
-- WHY THIS EXISTS: production carries three storage buckets that NO repo migration
-- creates — they were made by hand during operator "gate batches", so a from-scratch
-- rebuild (`supabase db reset`) would produce none of them and any upload/download
-- against them would fail. (`pilot-intake` is NOT here — it is already created by
-- 20260629120000_pilot_intake_bucket.sql.) Captured faithfully from prod
-- `gylkkzmcmbdftxieyabw` (localreach) on 2026-07-07. Idempotent (`on conflict do
-- nothing`); already present in prod, so a no-op there. No storage.objects RLS
-- policy references these buckets in prod (verified 2026-07-07):
--   • private buckets are reached only by the service-role backend (RLS bypass)
--   • public-assets is a public bucket (served without RLS by design)
-- Rollback: delete from storage.buckets where id in
--   ('monthly-reports','ads-mutation-logs','public-assets').

-- monthly-reports — private. Report artifacts ({shop_id}/{period}.pdf). Its
-- storage.objects download RLS already ships in 20260610000000_monthly_reports.sql,
-- which explicitly defers bucket creation to "the 12-04 gate batch" — this is it.
insert into storage.buckets (id, name, public)
values ('monthly-reports', 'monthly-reports', false)
on conflict (id) do nothing;

-- ads-mutation-logs — private. Append-only JSON logs of Google Ads mutations,
-- written service-side by src/lib/ads-mutations/log-storage.ts (upsert upload).
-- Gate: PSG-26c / PSG-98. Code assumes the bucket already exists (no createBucket).
insert into storage.buckets (id, name, public)
values ('ads-mutation-logs', 'ads-mutation-logs', false)
on conflict (id) do nothing;

-- public-assets — PUBLIC, 1 MiB per-object size limit, no MIME restriction.
-- No code reference found (2026-07-07); captured as-is for rebuild fidelity. Flagged
-- with the vestigial invoicer tables for a keep-vs-drop review (see PSG-617).
insert into storage.buckets (id, name, public, file_size_limit)
values ('public-assets', 'public-assets', true, 1048576)
on conflict (id) do nothing;
