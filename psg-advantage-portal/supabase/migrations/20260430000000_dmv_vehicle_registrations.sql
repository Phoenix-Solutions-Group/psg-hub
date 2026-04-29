-- DMV vehicle registration counts aggregated by ZIP
CREATE TABLE IF NOT EXISTS public.dmv_vehicle_registrations (
  id BIGSERIAL PRIMARY KEY,
  zip TEXT NOT NULL,
  county TEXT,
  registration_class TEXT,
  vehicle_count INT NOT NULL,
  passenger_count INT,
  commercial_count INT,
  snapshot_date DATE NOT NULL,
  source TEXT NOT NULL DEFAULT 'ny_dmv',
  source_dataset TEXT NOT NULL DEFAULT 'w4pv-hbkt',
  raw_payload JSONB,
  imported_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (zip, snapshot_date)
);

CREATE INDEX IF NOT EXISTS idx_dmv_veh_zip
  ON public.dmv_vehicle_registrations (zip);

CREATE INDEX IF NOT EXISTS idx_dmv_veh_snapshot
  ON public.dmv_vehicle_registrations (snapshot_date);

-- Add registered_vehicles column to the precomputed report table
ALTER TABLE public.customer_zip_report_monthly
  ADD COLUMN IF NOT EXISTS registered_vehicles INT;
