-- PSG-2972 safe QA fixture. All names and review text are synthetic.
-- Run only in a QA/preview database, never production:
--   psql "$QA_DATABASE_URL" -v qa_user_id="<Tess test user's auth UUID>" \
--     -f supabase/seeds/review_comments_tenant_isolation_qa.sql
--
-- The supplied user becomes a viewer of the synthetic non-Riverside shop. To
-- test denial from Riverside, remove that membership (last DELETE below) or use
-- a Riverside-only test account, then request the deterministic review UUID.

\set qa_client_id '29720000-0000-4000-8000-000000000001'
\set qa_shop_id '29720000-0000-4000-8000-000000000002'
\set qa_location_id '29720000-0000-4000-8000-000000000003'
\set qa_review_id '29720000-0000-4000-8000-000000000004'

insert into public.clients (id, name, website_url, primary_market, zip_code)
values (:'qa_client_id', 'PSG QA Fixture Client', 'https://example.invalid', 'Test Market', '00000')
on conflict (id) do update set name = excluded.name;

insert into public.shops (id, client_id, name, slug, subscription_tier)
values (:'qa_shop_id', :'qa_client_id', 'Non-Riverside QA Shop', 'non-riverside-qa-shop', 'essentials')
on conflict (id) do update set name = excluded.name;

insert into public.locations (id, shop_id, name, slug, is_primary)
values (:'qa_location_id', :'qa_shop_id', 'Synthetic QA Location', 'synthetic-qa-location', true)
on conflict (id) do update set name = excluded.name;

insert into public.review_items (id, shop_id, location_id, platform, rating, text, author, reviewed_at)
values (
  :'qa_review_id', :'qa_shop_id', :'qa_location_id', 'google', 4,
  'Synthetic review used only to verify shop isolation.', 'QA Fixture', now()
)
on conflict (id) do update set text = excluded.text;

insert into public.shop_users (user_id, shop_id, role)
values (:'qa_user_id', :'qa_shop_id', 'viewer')
on conflict (user_id, shop_id) do update set role = excluded.role;

select :'qa_shop_id' as synthetic_shop_id, :'qa_review_id' as synthetic_review_id;

-- To restore a Riverside-only account after testing:
-- delete from public.shop_users
-- where user_id = :'qa_user_id' and shop_id = :'qa_shop_id';
