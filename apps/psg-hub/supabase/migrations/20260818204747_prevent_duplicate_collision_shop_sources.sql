create unique index collision_shop_mappings_mapped_shop_uidx
  on public.collision_shop_mappings (shop_id)
  where mapping_status = 'mapped';

comment on index public.collision_shop_mappings_mapped_shop_uidx is
  'Prevents two active source mappings from double-counting one PSG Hub shop.';
