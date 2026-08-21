insert into public.shop_users (user_id, shop_id, role)
select users.id, shops.id, 'viewer'
from auth.users as users
cross join public.shops as shops
where lower(users.email) = 'admin@psghub.me'
  and lower(trim(shops.name)) = 'south lincoln'
on conflict (user_id, shop_id) do nothing;
