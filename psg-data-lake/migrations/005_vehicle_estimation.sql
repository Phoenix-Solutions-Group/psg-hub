-- 005_vehicle_estimation.sql
-- Census vehicle availability, county registrations, and ZIP-level estimates

-- Census ACS5 B25046/B25044: household vehicle availability per ZCTA
CREATE TABLE IF NOT EXISTS zcta_vehicle_availability (
  id BIGSERIAL PRIMARY KEY,
  zcta TEXT NOT NULL,
  year INTEGER NOT NULL,
  aggregate_vehicles INTEGER,
  aggregate_vehicles_moe INTEGER,
  owner_vehicles INTEGER,
  renter_vehicles INTEGER,
  total_occupied_units INTEGER,
  owner_occupied INTEGER,
  owner_0veh INTEGER,
  owner_1veh INTEGER,
  owner_2veh INTEGER,
  owner_3veh INTEGER,
  owner_4veh INTEGER,
  owner_5plus INTEGER,
  renter_occupied INTEGER,
  renter_0veh INTEGER,
  renter_1veh INTEGER,
  renter_2veh INTEGER,
  renter_3veh INTEGER,
  renter_4veh INTEGER,
  renter_5plus INTEGER,
  source TEXT NOT NULL DEFAULT 'us_census',
  source_table TEXT,
  raw_payload JSONB,
  imported_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (zcta, year)
);

CREATE INDEX IF NOT EXISTS zcta_veh_avail_year_idx ON zcta_vehicle_availability (year);

-- County-level vehicle registrations from state open data portals (TX, MD, WA)
CREATE TABLE IF NOT EXISTS county_vehicle_registrations (
  id BIGSERIAL PRIMARY KEY,
  county_name TEXT NOT NULL,
  state TEXT NOT NULL,
  vehicle_count INTEGER NOT NULL,
  snapshot_date TEXT,
  source TEXT NOT NULL,
  source_dataset TEXT,
  raw_payload JSONB,
  import_batch_id TEXT,
  imported_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (county_name, state, source, snapshot_date)
);

CREATE INDEX IF NOT EXISTS county_veh_reg_state_idx ON county_vehicle_registrations (state);

-- Estimated total vehicles per ZIP: model output from vehicle_estimation.py
CREATE TABLE IF NOT EXISTS estimated_zip_vehicles (
  id BIGSERIAL PRIMARY KEY,
  zip TEXT NOT NULL,
  state TEXT,
  year INTEGER NOT NULL,
  household_vehicles INTEGER,
  adjustment_factor NUMERIC(8, 4),
  estimated_total_vehicles INTEGER,
  ev_count INTEGER,
  ev_pct NUMERIC(6, 4),
  data_quality_flag TEXT NOT NULL DEFAULT 'model_estimate',
  source_mix TEXT,
  import_batch_id TEXT,
  imported_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (zip, year)
);

CREATE INDEX IF NOT EXISTS est_zip_veh_state_idx ON estimated_zip_vehicles (state);
CREATE INDEX IF NOT EXISTS est_zip_veh_year_idx ON estimated_zip_vehicles (year);
CREATE INDEX IF NOT EXISTS est_zip_veh_flag_idx ON estimated_zip_vehicles (data_quality_flag);
