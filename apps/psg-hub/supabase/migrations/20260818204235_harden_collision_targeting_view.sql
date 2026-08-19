alter view public.v_collision_targeting_zip_annual
  set (security_invoker = true);

revoke all on public.v_collision_targeting_zip_annual from anon, authenticated;
grant select on public.v_collision_targeting_zip_annual to service_role;

comment on view public.v_collision_targeting_zip_annual is
  'Service-only annual ZIP collision targeting context. Uses invoker security and is not an insurer claim estimate.';
