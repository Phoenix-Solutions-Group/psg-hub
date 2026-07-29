-- PSG-2457: make the BSM review-workspace create contract match the table shape.
--
-- Some earlier convergence migrations added source_kind only when the table
-- already existed, while their CREATE TABLE IF NOT EXISTS shape omitted it. A
-- fresh or partially converged local database can therefore create
-- bsm_content_review_items without the column the review-workspace route inserts.

alter table if exists public.bsm_content_review_items
  add column if not exists source_kind text;

update public.bsm_content_review_items
set source_kind = case
  when source_kind is not null then source_kind
  when source_content_item_id is not null then 'content_item'
  when content_type = 'generated_page' then 'generated_page'
  else 'uploaded_file'
end
where source_kind is null;

alter table public.bsm_content_review_items
  alter column source_kind set default 'uploaded_file';

alter table public.bsm_content_review_items
  alter column source_kind set not null;

alter table public.bsm_content_review_items
  drop constraint if exists bsm_content_review_items_source_kind_check;

alter table public.bsm_content_review_items
  add constraint bsm_content_review_items_source_kind_check
  check (source_kind in ('uploaded_file', 'generated_page', 'content_item'));
