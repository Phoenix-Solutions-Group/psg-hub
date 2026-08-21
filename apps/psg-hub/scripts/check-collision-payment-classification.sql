begin;

do $$
declare
  mismatch text;
begin
  select pg_catalog.string_agg(
    pg_catalog.format('%L/%L -> %L (expected %L)', raw_value, canonical_value, actual, expected),
    '; '
  ) into mismatch
  from (
    select
      sample.*,
      public.collision_payment_category(sample.raw_value, sample.canonical_value) as actual
    from (values
      ('Customer Insurance', null, 'insurance'),
      ('Claimant (Other Insurance)', null, 'insurance'),
      ('Ins Pay Which Party Unknown', null, 'insurance'),
      ('Cash Customer Pay', null, 'customer'),
      ('Third Party Pay', null, 'third_party'),
      ('Non Insurance', null, 'non_insurance'),
      ('Total Loss', null, 'other'),
      ('unrecognized', 'insurance', 'insurance'),
      ('unrecognized', null, 'unknown')
    ) sample(raw_value, canonical_value, expected)
  ) classified
  where actual is distinct from expected;

  if mismatch is not null then
    raise exception 'collision payment classification failed: %', mismatch;
  end if;

  if pg_catalog.has_function_privilege(
    'anon',
    'public.collision_payment_category(text,text)',
    'execute'
  ) or pg_catalog.has_function_privilege(
    'authenticated',
    'public.collision_payment_category(text,text)',
    'execute'
  ) then
    raise exception 'Collision payment classifier must remain service-role-only';
  end if;

  if not pg_catalog.has_function_privilege(
    'service_role',
    'public.collision_payment_category(text,text)',
    'execute'
  ) then
    raise exception 'Service role cannot execute collision payment classifier';
  end if;
end
$$;

rollback;
