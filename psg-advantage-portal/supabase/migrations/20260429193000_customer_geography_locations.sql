-- Customer geography storage for private/home-address geocoding.
-- Exact geocoded points remain in sensitive schema and are not exposed by default APIs.

CREATE TABLE IF NOT EXISTS sensitive.repair_customer_locations (
  id BIGSERIAL PRIMARY KEY,
  repair_customer_id BIGINT NOT NULL,
  repair_id TEXT,
  shop_id TEXT,
  shop_name TEXT,
  repair_date DATE,
  customer_zip TEXT,
  customer_city TEXT,
  customer_state TEXT,
  address_hash TEXT,
  latitude DOUBLE PRECISION,
  longitude DOUBLE PRECISION,
  location geography(Point, 4326),
  geocode_provider TEXT NOT NULL,
  geocode_status TEXT NOT NULL,
  geocode_confidence NUMERIC,
  formatted_address TEXT,
  failure_reason TEXT,
  raw_geocode_payload JSONB NOT NULL DEFAULT '{}'::jsonb,
  import_batch_id TEXT,
  imported_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (repair_customer_id)
);

ALTER TABLE sensitive.repair_customer_locations ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON sensitive.repair_customer_locations FROM PUBLIC;
REVOKE ALL ON sensitive.repair_customer_locations FROM anon;
REVOKE ALL ON sensitive.repair_customer_locations FROM authenticated;

CREATE INDEX IF NOT EXISTS idx_sensitive_repair_customer_locations_repair_customer_id
  ON sensitive.repair_customer_locations(repair_customer_id);

CREATE INDEX IF NOT EXISTS idx_sensitive_repair_customer_locations_address_hash
  ON sensitive.repair_customer_locations(address_hash);

CREATE INDEX IF NOT EXISTS idx_sensitive_repair_customer_locations_shop_id
  ON sensitive.repair_customer_locations(shop_id);

CREATE INDEX IF NOT EXISTS idx_sensitive_repair_customer_locations_repair_date
  ON sensitive.repair_customer_locations(repair_date);

CREATE INDEX IF NOT EXISTS idx_sensitive_repair_customer_locations_import_batch
  ON sensitive.repair_customer_locations(import_batch_id);

CREATE INDEX IF NOT EXISTS idx_sensitive_repair_customer_locations_status
  ON sensitive.repair_customer_locations(geocode_status);

CREATE INDEX IF NOT EXISTS idx_sensitive_repair_customer_locations_location
  ON sensitive.repair_customer_locations USING GIST(location);

CREATE TABLE IF NOT EXISTS public.customer_zip_report_monthly (
  month DATE NOT NULL,
  shop_id TEXT NOT NULL,
  shop_name TEXT,
  zip TEXT NOT NULL,
  county_name TEXT,
  state TEXT,
  repair_count BIGINT NOT NULL DEFAULT 0,
  unique_household_count BIGINT NOT NULL DEFAULT 0,
  avg_repair_total NUMERIC,
  total_repair_value NUMERIC,
  mean_household_income NUMERIC,
  median_household_income NUMERIC,
  income_band TEXT,
  crash_demand_score NUMERIC,
  storm_demand_score NUMERIC,
  market_opportunity_score NUMERIC,
  import_batch_id TEXT,
  imported_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (month, shop_id, zip)
);

CREATE INDEX IF NOT EXISTS idx_customer_zip_report_monthly_zip
  ON public.customer_zip_report_monthly(zip);

CREATE INDEX IF NOT EXISTS idx_customer_zip_report_monthly_month
  ON public.customer_zip_report_monthly(month);

CREATE INDEX IF NOT EXISTS idx_customer_zip_report_monthly_shop
  ON public.customer_zip_report_monthly(shop_id);

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'service_role') THEN
    GRANT SELECT, INSERT, UPDATE, DELETE ON sensitive.repair_customer_locations TO service_role;
    GRANT USAGE, SELECT ON SEQUENCE sensitive.repair_customer_locations_id_seq TO service_role;
  END IF;
END
$$;

