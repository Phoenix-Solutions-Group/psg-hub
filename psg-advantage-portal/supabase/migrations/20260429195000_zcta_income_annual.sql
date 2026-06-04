CREATE TABLE IF NOT EXISTS public.zcta_income_annual (
  year INTEGER NOT NULL,
  zip TEXT NOT NULL,
  name TEXT,
  households BIGINT,
  aggregate_household_income NUMERIC,
  mean_household_income NUMERIC,
  median_household_income NUMERIC,
  source TEXT NOT NULL DEFAULT 'us_census',
  source_table TEXT NOT NULL DEFAULT 'acs5.B11001/B19013/B19025',
  raw_payload JSONB NOT NULL DEFAULT '{}'::jsonb,
  imported_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (year, zip)
);

CREATE INDEX IF NOT EXISTS idx_zcta_income_annual_zip ON public.zcta_income_annual(zip);
CREATE INDEX IF NOT EXISTS idx_zcta_income_annual_year ON public.zcta_income_annual(year);
CREATE INDEX IF NOT EXISTS idx_zcta_income_annual_mean_income ON public.zcta_income_annual(mean_household_income);

