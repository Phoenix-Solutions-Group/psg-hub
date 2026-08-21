alter view public.v_market_opportunity set (security_invoker = true);
alter view public.v_shop_coverage set (security_invoker = true);
alter view public.v_storm_demand_examples set (security_invoker = true);
alter view public.v_accident_trends_by_zip set (security_invoker = true);

revoke all on public.v_market_opportunity from anon, authenticated;
revoke all on public.v_shop_coverage from anon, authenticated;
revoke all on public.v_storm_demand_examples from anon, authenticated;
revoke all on public.v_accident_trends_by_zip from anon, authenticated;

grant select on public.v_market_opportunity to service_role;
grant select on public.v_shop_coverage to service_role;
grant select on public.v_storm_demand_examples to service_role;
grant select on public.v_accident_trends_by_zip to service_role;
