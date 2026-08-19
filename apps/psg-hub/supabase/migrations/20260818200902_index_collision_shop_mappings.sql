create index collision_shop_mappings_company_idx
  on public.collision_shop_mappings (company_id)
  where company_id is not null;

create index collision_shop_mappings_shop_idx
  on public.collision_shop_mappings (shop_id)
  where shop_id is not null;
