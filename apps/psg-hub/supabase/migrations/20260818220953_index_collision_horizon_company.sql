create index collision_forecast_horizon_registry_company_idx
  on public.collision_forecast_horizon_registry (company_id)
  where company_id is not null;
