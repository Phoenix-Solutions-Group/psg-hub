-- PSG-2972 — Make the comment's shop inseparable from its parent review.
-- RLS still limits reads/writes to user_shop_ids(); this composite foreign key
-- also prevents a direct API client from pairing an accessible shop_id with a
-- review_item_id owned by another shop.

alter table public.review_items
  add constraint review_items_id_shop_id_key unique (id, shop_id);

alter table public.review_response_comments
  add constraint review_response_comments_review_shop_fk
  foreign key (review_item_id, shop_id)
  references public.review_items (id, shop_id)
  on delete cascade;

alter table public.review_responses
  add constraint review_responses_id_review_shop_key
  unique (id, review_item_id, shop_id);

alter table public.review_response_comments
  add constraint review_response_comments_response_review_shop_fk
  foreign key (review_response_id, review_item_id, shop_id)
  references public.review_responses (id, review_item_id, shop_id)
  on delete set null (review_response_id);
