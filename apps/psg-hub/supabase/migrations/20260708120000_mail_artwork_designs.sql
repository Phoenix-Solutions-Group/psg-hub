-- PSG-868 (parent PSG-847 / PSG-836) — Mail-Artwork backend foundation.
-- Phase-1 spine: the private "mail-artwork" Storage bucket + the versioned
-- `mail_artwork_designs` table that stores one mail piece's artwork JSON doc.
--
-- AUTHORED NOT APPLIED. Per PROTOCOL-migration-safety.md the prod `db push` +
-- advisor diff is the operator-gate step, NOT this plan. Idempotent + re-runnable.
--
-- ACCESS MODEL (PSG-only): the mail-artwork designer is an INTERNAL PSG tool — a
-- PSG staffer lays out artwork on behalf of a body-shop customer; the customer
-- never touches it. So both the bucket and the table are gated by the ops
-- capability `design_mail_artwork` via private.current_user_has_fn(...), matching
-- the v1.1 ops backbone (ops_foundation_v1_1.sql). Default-deny: no policy => no
-- access; service-role bypasses RLS for server-side render/ingestion.
--   psg_superadmin passes implicitly; a psg_internal user needs the flag granted.
-- The app mirrors this in requireOpsFn('design_mail_artwork') (ops-access.ts) as
-- defense-in-depth ahead of RLS.
--
-- Rollback (manual, reverse order):
--   drop trigger if exists set_updated_at_mail_artwork_designs on public.mail_artwork_designs;
--   drop table if exists public.mail_artwork_designs;
--   drop policy if exists mail_artwork_objects_all on storage.objects;
--   delete from storage.buckets where id = 'mail-artwork';

-- ── 1. private "mail-artwork" bucket ─────────────────────────────────────────
-- public=false → no anonymous URLs; objects reachable only via the PSG-gated
-- policy below, the service-role client, or a time-limited signed URL. Accepts
-- PNG/JPEG/PDF base graphics (enforced at the app layer in mail-artwork-asset.ts;
-- allowed_mime_types set here as an in-bucket backstop).
insert into storage.buckets (id, name, public, allowed_mime_types)
values (
  'mail-artwork',
  'mail-artwork',
  false,
  array['image/png', 'image/jpeg', 'application/pdf']
)
on conflict (id) do update
  set public = excluded.public,
      allowed_mime_types = excluded.allowed_mime_types;

-- ── 2. PSG-only CRUD on the bucket ───────────────────────────────────────────
-- One "for all" policy: a PSG staffer with the design_mail_artwork capability may
-- read/write/delete objects in this bucket; everyone else is denied. Path
-- convention: "{company_id}/{template_key}/{face}-{hash}.{ext}". Defense-in-depth
-- on top of the capability-gated upload/render routes.
drop policy if exists mail_artwork_objects_all on storage.objects;
create policy mail_artwork_objects_all
  on storage.objects
  for all
  to authenticated
  using (
    bucket_id = 'mail-artwork'
    and private.current_user_has_fn('design_mail_artwork')
  )
  with check (
    bucket_id = 'mail-artwork'
    and private.current_user_has_fn('design_mail_artwork')
  );

-- ── 3. mail_artwork_designs table ────────────────────────────────────────────
-- One row = one VERSION of one template's artwork for one company. Saving a new
-- version inserts a new row (version increments per company_id+template_key), so
-- the table is an append-style version history; the highest version is "current".
create table if not exists public.mail_artwork_designs (
  id           uuid primary key default gen_random_uuid(),
  -- Owning PSG customer company (the body shop the artwork is for).
  company_id   uuid not null references public.companies(id) on delete cascade,
  -- Registry key from mail-registry.ts, e.g. "postcard:4x6" / "letter:8.5x11".
  template_key text not null,
  -- Denormalised piece type + Lob size token (also encoded in template_key) so
  -- reporting can filter without parsing the key. 'postcard'|'letter'|'self_mailer'.
  piece_type   text not null check (piece_type in ('postcard', 'letter', 'self_mailer')),
  size_key     text not null,
  -- Monotonic version within (company_id, template_key); 1 for the first save.
  version      integer not null default 1 check (version >= 1),
  -- Lifecycle: 'draft' while editing, 'ready' when preflight-clean, 'archived'
  -- when superseded. Send-gating happens downstream (Phase-3), not here.
  status       text not null default 'draft' check (status in ('draft', 'ready', 'archived')),
  -- The artwork JSON doc (mail-artwork-doc.ts ArtworkDoc): size key, base graphic
  -- asset refs per face, positioned freeform elements. Stored opaquely; validated
  -- at the app layer by validateArtworkDoc(...).
  doc          jsonb not null,
  created_by   uuid references auth.users(id) on delete set null,
  updated_by   uuid references auth.users(id) on delete set null,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now(),
  -- Exactly one row per (company, template, version).
  unique (company_id, template_key, version)
);

comment on table public.mail_artwork_designs is
  'PSG-868: versioned mail-artwork JSON docs (one row per company+template+version). PSG-only via design_mail_artwork capability. doc shape = mail-artwork-doc.ts ArtworkDoc.';

create index if not exists mail_artwork_designs_company_idx
  on public.mail_artwork_designs (company_id);
create index if not exists mail_artwork_designs_template_idx
  on public.mail_artwork_designs (company_id, template_key, version desc);

-- Default-deny RLS + a single capability-gated "for all" policy (PSG-only).
alter table public.mail_artwork_designs enable row level security;

drop policy if exists mail_artwork_designs_ops_all on public.mail_artwork_designs;
create policy mail_artwork_designs_ops_all
  on public.mail_artwork_designs
  for all
  to authenticated
  using (private.current_user_has_fn('design_mail_artwork'))
  with check (private.current_user_has_fn('design_mail_artwork'));

-- updated_at maintenance (reuses the shared ops trigger fn).
drop trigger if exists set_updated_at_mail_artwork_designs on public.mail_artwork_designs;
create trigger set_updated_at_mail_artwork_designs
  before update on public.mail_artwork_designs
  for each row execute function public.set_updated_at();
