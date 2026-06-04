CREATE INDEX IF NOT EXISTS idx_accidents_market_city_state_zip
  ON accidents (LOWER(city), UPPER(state), zipcode);

CREATE INDEX IF NOT EXISTS idx_accidents_market_city_state_time
  ON accidents (LOWER(city), UPPER(state), start_time);

CREATE INDEX IF NOT EXISTS idx_accident_density_state_total
  ON accident_density (state, total_count DESC);

CREATE INDEX IF NOT EXISTS idx_storm_zip_monthly_zip_demand
  ON storm_zip_monthly (zip, weighted_storm_demand_score DESC);
