-- PSG-866 — allow self-mailer as a first-class production piece type.
--
-- Extends the production document piece_type contract from ("postcard", "letter")
-- to include "self_mailer", which uses the same Lob / in-house letter asset
-- format as a letter and a dedicated Lob endpoint (`/letters`).

do $$
begin
  alter table if exists public.production_documents
    drop constraint if exists production_documents_piece_type_check;

  alter table public.production_documents
    add constraint production_documents_piece_type_check
    check (
      piece_type in ('postcard', 'letter', 'self_mailer')
    );
end $$;
