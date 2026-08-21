begin;

do $$
begin
  if pg_catalog.has_function_privilege(
    'anon',
    'public.stage_collision_forecast_model_review(text,text,jsonb,uuid,text)',
    'execute'
  ) or pg_catalog.has_function_privilege(
    'authenticated',
    'public.stage_collision_forecast_model_review(text,text,jsonb,uuid,text)',
    'execute'
  ) then
    raise exception 'Model review staging must remain service-role-only';
  end if;

  if not pg_catalog.has_function_privilege(
    'service_role',
    'public.stage_collision_forecast_model_review(text,text,jsonb,uuid,text)',
    'execute'
  ) then
    raise exception 'Service role cannot stage model review evidence';
  end if;

  if pg_catalog.has_function_privilege(
    'anon',
    'public.review_collision_forecast_models(uuid,text,uuid,text)',
    'execute'
  ) or pg_catalog.has_function_privilege(
    'authenticated',
    'public.review_collision_forecast_models(uuid,text,uuid,text)',
    'execute'
  ) then
    raise exception 'Model review decisions must remain service-role-only';
  end if;

  if not pg_catalog.has_function_privilege(
    'service_role',
    'public.review_collision_forecast_models(uuid,text,uuid,text)',
    'execute'
  ) then
    raise exception 'Service role cannot decide staged model evidence';
  end if;

  if pg_catalog.strpos(
    pg_catalog.pg_get_functiondef(
      'public.stage_collision_forecast_model_review(text,text,jsonb,uuid,text)'::regprocedure
    ),
    'join public.app_user_roles role'
  ) = 0 then
    raise exception 'Model review staging does not join the authoritative role table';
  end if;

  if pg_catalog.strpos(
    pg_catalog.pg_get_functiondef(
      'public.stage_collision_forecast_model_review(text,text,jsonb,uuid,text)'::regprocedure
    ),
    'role.role = ''customer'''
  ) = 0 then
    raise exception 'Model review staging accepts a non-customer shop membership';
  end if;

  if pg_catalog.strpos(
    pg_catalog.pg_get_functiondef(
      'public.review_collision_forecast_models(uuid,text,uuid,text)'::regprocedure
    ),
    'join public.app_user_roles role'
  ) = 0 then
    raise exception 'Model approval does not join the authoritative role table';
  end if;

  if pg_catalog.strpos(
    pg_catalog.pg_get_functiondef(
      'public.review_collision_forecast_models(uuid,text,uuid,text)'::regprocedure
    ),
    'role.role = ''customer'''
  ) = 0 then
    raise exception 'Model approval accepts a non-customer shop membership';
  end if;

  begin
    perform public.stage_collision_forecast_model_review(
      'unsupported_source',
      'PS1',
      '[]'::jsonb,
      '00000000-0000-4000-8000-000000000000'::uuid,
      'This call must fail before any mutation occurs.'
    );
    raise exception 'Unsupported source unexpectedly passed';
  exception
    when invalid_parameter_value then null;
  end;

  begin
    perform public.review_collision_forecast_models(
      null,
      'approve',
      '00000000-0000-4000-8000-000000000000'::uuid,
      'This call must fail before any mutation occurs.'
    );
    raise exception 'A model decision without a shop unexpectedly passed';
  exception
    when invalid_parameter_value then null;
  end;
end;
$$;

rollback;
