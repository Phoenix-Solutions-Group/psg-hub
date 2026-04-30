-- 004_vehicle_registrations.sql
-- EV registrations: ZIP-level from Atlas EV Hub and similar sources

CREATE TABLE IF NOT EXISTS ev_registrations (
  id BIGSERIAL PRIMARY KEY,
  zip TEXT NOT NULL,
  state TEXT,
  vehicle_count INTEGER NOT NULL,
  make TEXT,
  model TEXT,
  powertrain_type TEXT,
  vehicle_category TEXT,
  snapshot_date DATE NOT NULL,
  source TEXT NOT NULL,
  source_dataset TEXT,
  raw_payload JSONB,
  import_batch_id TEXT,
  imported_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE UNIQUE INDEX IF NOT EXISTS ev_registrations_zip_source_snapshot_idx
  ON ev_registrations (zip, source, snapshot_date, COALESCE(make, ''), COALESCE(model, ''), COALESCE(powertrain_type, ''));

CREATE INDEX IF NOT EXISTS ev_registrations_state_idx ON ev_registrations (state);
CREATE INDEX IF NOT EXISTS ev_registrations_source_idx ON ev_registrations (source);

-- State-level total vehicle registrations: FHWA MV-1 national baseline

CREATE TABLE IF NOT EXISTS state_vehicle_registrations (
  id BIGSERIAL PRIMARY KEY,
  state TEXT NOT NULL,
  year INTEGER NOT NULL,
  auto_count INTEGER,
  bus_count INTEGER,
  truck_count INTEGER,
  motorcycle_count INTEGER,
  total_count INTEGER GENERATED ALWAYS AS (
    COALESCE(auto_count, 0) + COALESCE(bus_count, 0) +
    COALESCE(truck_count, 0) + COALESCE(motorcycle_count, 0)
  ) STORED,
  source TEXT NOT NULL,
  source_dataset TEXT,
  raw_payload JSONB,
  import_batch_id TEXT,
  imported_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (state, year, source)
);

CREATE INDEX IF NOT EXISTS state_veh_reg_state_idx ON state_vehicle_registrations (state);
