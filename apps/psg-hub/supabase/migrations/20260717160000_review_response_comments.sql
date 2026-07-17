-- PSG-1716 — Internal comment thread for customer review response decisions.
-- Adds a shop-scoped comment trail so managers and owners can discuss a drafted
-- reply before approving, rejecting, or overriding safety flags.

create table if not exists public.review_response_comments (
  id uuid primary key default gen_random_uuid(),
  review_item_id uuid not null references public.review_items(id) on delete cascade,
  review_response_id uuid references public.review_responses(id) on delete set null,
  shop_id uuid not null references public.shops(id) on delete cascade,
  body text not null check (char_length(btrim(body)) > 0 and char_length(body) <= 2000),
  created_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now()
);

alter table public.review_response_comments enable row level security;

drop policy if exists review_response_comments_select on public.review_response_comments;
create policy review_response_comments_select on public.review_response_comments
  for select using (shop_id in (select public.user_shop_ids()));

drop policy if exists review_response_comments_insert on public.review_response_comments;
create policy review_response_comments_insert on public.review_response_comments
  for insert with check (shop_id in (select public.user_shop_ids()));

create index if not exists review_response_comments_review_idx
  on public.review_response_comments (review_item_id, created_at asc);

create index if not exists review_response_comments_shop_idx
  on public.review_response_comments (shop_id, created_at desc);

comment on table public.review_response_comments is
  'Internal team comments attached to a customer review response approval workflow.';
