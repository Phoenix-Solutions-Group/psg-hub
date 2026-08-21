create index collision_demand_forecasts_company_idx
  on public.collision_demand_forecasts (company_id)
  where company_id is not null;

create index collision_forecast_model_registry_company_idx
  on public.collision_forecast_model_registry (company_id)
  where company_id is not null;
