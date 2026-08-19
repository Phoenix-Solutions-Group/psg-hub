-- PSG-2029 — printed duplicate prevention for production documents.
--
-- FileMaker prevented repeat sends with per-letter printed date stamps. The
-- psg-hub production queue now carries the same guard directly on each document:
-- only rows without printed_at are submitted, retries skip stamped rows, and the
-- operator who initiated the print is retained for audit.

alter table if exists public.production_documents
  add column if not exists printed_at timestamptz;

alter table if exists public.production_documents
  add column if not exists printed_by_profile_id uuid references public.profiles(id) on delete set null;

alter table if exists public.production_documents
  add column if not exists letter_eligibility_id uuid;

do $$
begin
  if to_regclass('public.letter_eligibility') is not null
    and not exists (
      select 1
      from pg_constraint
      where conname = 'production_documents_letter_eligibility_id_fkey'
    ) then
    alter table public.production_documents
      add constraint production_documents_letter_eligibility_id_fkey
      foreign key (letter_eligibility_id)
      references public.letter_eligibility(id)
      on delete set null;
  end if;
end $$;

create index if not exists idx_production_documents_unprinted
  on public.production_documents (batch_id, status)
  where printed_at is null;

create index if not exists idx_production_documents_printed_at
  on public.production_documents (printed_at)
  where printed_at is not null;

create index if not exists idx_production_documents_letter_eligibility
  on public.production_documents (letter_eligibility_id)
  where letter_eligibility_id is not null;
