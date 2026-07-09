-- PSG-936 — persist production piece rendering options for reliable vendor submission.
-- Adds size/color so self-mailer and letter-family templates carry authoring intent
-- from generation → DB → print, instead of relying on defaults at print time.

alter table if exists public.production_documents
  add column if not exists color boolean;

alter table if exists public.production_documents
  add column if not exists size text;

-- Validates only known mailing sizes while allowing older rows where size is not
-- set (legacy data + paths that never selected a letter-family size).
do $$
begin
  alter table public.production_documents
    drop constraint if exists production_documents_size_check;

  alter table public.production_documents
    add constraint production_documents_size_check
    check (size is null or size in ('4x6', '6x9', '6x11', '8.5x11'));
end $$;
