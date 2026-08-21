-- Forecast review and publication require an actual customer audience. A PSG
-- staff membership must never satisfy the participating-shop gate.

create or replace function public.collision_shop_has_customer_audience(
  p_shop_id uuid
)
returns boolean
language sql
stable
security invoker
set search_path = ''
as $$
  select exists (
    select 1
    from public.shop_users membership
    join public.app_user_roles role
      on role.profile_id = membership.user_id
     and role.role = 'customer'
    where membership.shop_id = p_shop_id
  );
$$;

comment on function public.collision_shop_has_customer_audience(uuid) is
  'True only when a shop has at least one member whose global PSG Hub role is customer.';

revoke execute on function public.collision_shop_has_customer_audience(uuid)
  from public, anon, authenticated;
grant execute on function public.collision_shop_has_customer_audience(uuid)
  to service_role;

create or replace function public.enforce_collision_forecast_customer_audience()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
begin
  if new.promotion_status in ('review', 'approved')
    and not public.collision_shop_has_customer_audience(new.shop_id)
  then
    raise exception 'At least one customer shop member is required for forecast review or approval'
      using errcode = 'check_violation';
  end if;
  return new;
end;
$$;
revoke execute on function public.enforce_collision_forecast_customer_audience()
  from public, anon, authenticated;

drop trigger if exists collision_forecast_model_customer_audience
  on public.collision_forecast_model_registry;
create trigger collision_forecast_model_customer_audience
  before insert or update of shop_id, promotion_status
  on public.collision_forecast_model_registry
  for each row execute function public.enforce_collision_forecast_customer_audience();

drop trigger if exists collision_forecast_horizon_customer_audience
  on public.collision_forecast_horizon_registry;
create trigger collision_forecast_horizon_customer_audience
  before insert or update of shop_id, promotion_status
  on public.collision_forecast_horizon_registry
  for each row execute function public.enforce_collision_forecast_customer_audience();

create or replace function public.enforce_collision_forecast_publication_audience()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
begin
  if new.status = 'published'
    and not public.collision_shop_has_customer_audience(new.shop_id)
  then
    raise exception 'A forecast cannot be published without a customer shop member'
      using errcode = 'check_violation';
  end if;
  return new;
end;
$$;

revoke execute on function public.enforce_collision_forecast_publication_audience()
  from public, anon, authenticated;

drop trigger if exists collision_forecast_publication_customer_audience
  on public.collision_demand_forecasts;
create trigger collision_forecast_publication_customer_audience
  before insert or update of shop_id, status
  on public.collision_demand_forecasts
  for each row execute function public.enforce_collision_forecast_publication_audience();

do $$
begin
  if exists (
    select 1
    from public.collision_demand_forecasts forecast
    where forecast.status = 'published'
      and not public.collision_shop_has_customer_audience(forecast.shop_id)
  ) then
    raise exception 'Existing published collision forecast lacks a customer audience';
  end if;
end;
$$;
