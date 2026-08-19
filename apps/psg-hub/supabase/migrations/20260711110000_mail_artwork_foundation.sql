-- PSG-2687 — capture the production mail artwork storage bucket in code.
--
-- Production already has a `mail_artwork_foundation` migration ledger entry and
-- a `mail-artwork` bucket, but the repo was missing the migration source. Keep
-- the embedded migration name aligned with the existing ledger so the name-based
-- migration drift check stays clean while fresh rebuilds reproduce the bucket.

insert into storage.buckets (
  id,
  name,
  public,
  file_size_limit,
  allowed_mime_types
) values (
  'mail-artwork',
  'mail-artwork',
  false,
  52428800,
  array[
    'application/pdf',
    'image/jpeg',
    'image/png',
    'image/svg+xml',
    'image/webp'
  ]
)
on conflict (id) do update
set name = excluded.name,
    public = excluded.public,
    file_size_limit = excluded.file_size_limit,
    allowed_mime_types = excluded.allowed_mime_types;
