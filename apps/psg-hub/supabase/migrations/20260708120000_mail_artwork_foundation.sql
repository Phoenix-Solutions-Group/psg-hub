-- PSG-860 / Mail-Artwork Studio Phase 1 — backend foundation.
--
-- Two things live here, both fail-closed to PSG staff only:
--   1. Private "mail-artwork" Storage bucket for uploaded print assets
--      (PNG / JPEG / PDF), and
--   2. public.mail_artwork_designs — the versioned JSON artwork document keyed to
--      a company + template key.
--
-- "PSG-only" gate: both are gated by private.current_user_has_fn('manage_production')
-- — the exact capability the v1.3 Production module already uses (postcards are a
-- production concern). A customer session never carries that capability, so under
-- default-deny RLS a non-PSG session can neither read nor write either surface.
-- service-role bypasses RLS for signed-upload minting / server render, mirroring
-- the pilot-intake + production tables.
--
-- Builds on: v1.1 Ops Foundation (public.set_updated_at trigger fn), the
-- rbac_helpers (private.current_user_has_fn), and the pilot-intake bucket RLS shape.
--
-- AUTHORED NOT APPLIED. Per PROTOCOL-migration-safety.md the prod `db push` +
-- advisor diff is the operator-gate step. Idempotent + re-runnable.
--
-- Rollback (manual, reverse order):
--   drop table if exists public.mail_artwork_designs;
--   drop policy if exists mail_artwork_objects_all on storage.objects;
--   delete from storage.buckets where id = 'mail-artwork';

-- ── 1. private "mail-artwork" bucket (PNG / JPEG / PDF only, 25 MiB cap) ──────
-- public=false → no anonymous/public URLs; reachable only via the PSG-only policy
-- below, the service-role client, or a time-limited signed URL. allowed_mime_types
-- is enforced by Storage on upload; file_size_limit caps object size in bytes.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'mail-artwork',
  'mail-artwork',
  false,
  26214400, -- 25 MiB (matches MAX_ASSET_BYTES in src/lib/mail-artwork/asset-validation.ts)
  array['image/png', 'image/jpeg', 'application/pdf']
)
on conflict (id) do update
  set public = excluded.public,
      file_size_limit = excluded.file_size_limit,
      allowed_mime_types = excluded.allowed_mime_types;

-- ── 2. PSG-only access to mail-artwork objects (all commands, default-deny) ───
-- One FOR ALL policy: a session may read/write objects in this bucket only if it
-- holds the manage_production capability. No capability → no row passes → the
-- bucket is invisible and unwritable to customer sessions. Uploads in practice go
-- through service-role signed-upload URLs; this policy is the authoritative RLS
-- backstop and the read path for PSG staff.
drop policy if exists mail_artwork_objects_all on storage.objects;
create policy mail_artwork_objects_all
  on storage.objects
  for all
  to authenticated
  using (
    bucket_id = 'mail-artwork'
    and private.current_user_has_fn('manage_production')
  )
  with check (
    bucket_id = 'mail-artwork'
    and private.current_user_has_fn('manage_production')
  );

-- ── 3. mail_artwork_designs — versioned artwork document per company + template ─
-- doc jsonb = the portable ArtworkDoc (src/lib/mail-artwork/types.ts). Versioned:
-- each save of a template key writes a new (company_id, template_key, version) row
-- so history is retained and a design can be rolled back. company_id scopes the
-- design to the PSG client program it is for.
create table if not exists public.mail_artwork_designs (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete restrict,
  -- Logical design identity within a company (e.g. "spring-promo-postcard").
  template_key text not null,
  -- Monotonic version within (company_id, template_key). App writes N+1 on save.
  version integer not null default 1 check (version >= 1),
  status text not null default 'draft' check (status in ('draft', 'ready', 'archived')),
  -- The versioned artwork document (ArtworkDoc). Registry geometry is never copied
  -- in — it is re-derived from doc.specKey against the spec registry.
  doc jsonb not null default '{}'::jsonb,
  created_by_profile_id uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  -- One row per version of a template within a company.
  unique (company_id, template_key, version)
);
alter table public.mail_artwork_designs enable row level security;

create index if not exists idx_mail_artwork_designs_company
  on public.mail_artwork_designs (company_id);
create index if not exists idx_mail_artwork_designs_template
  on public.mail_artwork_designs (company_id, template_key);

-- PSG-only, default-deny: same manage_production gate as the production tables.
drop policy if exists mail_artwork_designs_ops_all on public.mail_artwork_designs;
create policy mail_artwork_designs_ops_all
  on public.mail_artwork_designs
  for all
  to authenticated
  using (private.current_user_has_fn('manage_production'))
  with check (private.current_user_has_fn('manage_production'));

-- updated_at maintenance (shared ops-foundation trigger fn).
drop trigger if exists set_updated_at_mail_artwork_designs on public.mail_artwork_designs;
create trigger set_updated_at_mail_artwork_designs
  before update on public.mail_artwork_designs
  for each row execute function public.set_updated_at();
