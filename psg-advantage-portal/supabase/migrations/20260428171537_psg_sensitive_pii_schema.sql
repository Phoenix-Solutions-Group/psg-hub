-- Private PII schema for PSG customer/survey identity data.
-- This schema is intentionally not used by browser/client code.

CREATE SCHEMA IF NOT EXISTS sensitive;

REVOKE ALL ON SCHEMA sensitive FROM PUBLIC;
REVOKE ALL ON SCHEMA sensitive FROM anon;
REVOKE ALL ON SCHEMA sensitive FROM authenticated;

CREATE TABLE IF NOT EXISTS sensitive.survey_pii (
  id BIGSERIAL PRIMARY KEY,
  response_id TEXT,
  match_key TEXT,
  customer_first_name TEXT,
  customer_last_name TEXT,
  customer_address TEXT,
  customer_address2 TEXT,
  customer_city TEXT,
  customer_state TEXT,
  customer_zip TEXT,
  customer_phone_home TEXT,
  customer_phone_mobile TEXT,
  customer_phone_night TEXT,
  agent_first_name TEXT,
  agent_last_name TEXT,
  agent_address TEXT,
  agent_address2 TEXT,
  agent_city TEXT,
  agent_state TEXT,
  agent_zip TEXT,
  vehicle_make TEXT,
  vehicle_model TEXT,
  source_loaded_at TIMESTAMPTZ,
  imported_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  raw_payload JSONB NOT NULL DEFAULT '{}'::jsonb
);

CREATE TABLE IF NOT EXISTS sensitive.repair_customers (
  id BIGSERIAL PRIMARY KEY,
  repair_id TEXT,
  match_key TEXT,
  shop_id TEXT,
  shop_name TEXT,
  creation_date DATE,
  date_in DATE,
  date_out DATE,
  ro_number TEXT,
  repair_total NUMERIC,
  pay_type TEXT,
  insurance_company TEXT,
  vehicle_year INTEGER,
  vehicle_make TEXT,
  vehicle_model TEXT,
  customer_first_name TEXT,
  customer_last_name TEXT,
  customer_email TEXT,
  customer_phone TEXT,
  source_platform TEXT,
  survey_sent BOOLEAN,
  survey_sent_date DATE,
  anomaly_flag BOOLEAN,
  source_loaded_at TIMESTAMPTZ,
  imported_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  raw_payload JSONB NOT NULL DEFAULT '{}'::jsonb
);

CREATE TABLE IF NOT EXISTS sensitive.pii_access_log (
  id BIGSERIAL PRIMARY KEY,
  accessed_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  actor_user_id UUID,
  actor_email TEXT,
  actor_role TEXT,
  action TEXT NOT NULL,
  target_table TEXT NOT NULL,
  target_key TEXT,
  reason TEXT,
  request_metadata JSONB NOT NULL DEFAULT '{}'::jsonb
);

ALTER TABLE sensitive.survey_pii ENABLE ROW LEVEL SECURITY;
ALTER TABLE sensitive.repair_customers ENABLE ROW LEVEL SECURITY;
ALTER TABLE sensitive.pii_access_log ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON ALL TABLES IN SCHEMA sensitive FROM PUBLIC;
REVOKE ALL ON ALL TABLES IN SCHEMA sensitive FROM anon;
REVOKE ALL ON ALL TABLES IN SCHEMA sensitive FROM authenticated;
REVOKE ALL ON ALL SEQUENCES IN SCHEMA sensitive FROM PUBLIC;
REVOKE ALL ON ALL SEQUENCES IN SCHEMA sensitive FROM anon;
REVOKE ALL ON ALL SEQUENCES IN SCHEMA sensitive FROM authenticated;

CREATE INDEX IF NOT EXISTS idx_sensitive_survey_pii_response_id
  ON sensitive.survey_pii(response_id);
CREATE INDEX IF NOT EXISTS idx_sensitive_survey_pii_match_key
  ON sensitive.survey_pii(match_key);
CREATE INDEX IF NOT EXISTS idx_sensitive_survey_pii_source_loaded_at
  ON sensitive.survey_pii(source_loaded_at);

CREATE INDEX IF NOT EXISTS idx_sensitive_repair_customers_repair_id
  ON sensitive.repair_customers(repair_id);
CREATE INDEX IF NOT EXISTS idx_sensitive_repair_customers_match_key
  ON sensitive.repair_customers(match_key);
CREATE INDEX IF NOT EXISTS idx_sensitive_repair_customers_shop_id
  ON sensitive.repair_customers(shop_id);
CREATE INDEX IF NOT EXISTS idx_sensitive_repair_customers_source_loaded_at
  ON sensitive.repair_customers(source_loaded_at);

CREATE INDEX IF NOT EXISTS idx_sensitive_pii_access_log_accessed_at
  ON sensitive.pii_access_log(accessed_at);
CREATE INDEX IF NOT EXISTS idx_sensitive_pii_access_log_actor_user_id
  ON sensitive.pii_access_log(actor_user_id);
CREATE INDEX IF NOT EXISTS idx_sensitive_pii_access_log_target
  ON sensitive.pii_access_log(target_table, target_key);

ALTER TABLE public.survey_responses
  ADD COLUMN IF NOT EXISTS response_id TEXT,
  ADD COLUMN IF NOT EXISTS match_key TEXT,
  ADD COLUMN IF NOT EXISTS shop_id TEXT;

UPDATE public.survey_responses
SET
  response_id = COALESCE(response_id, raw_payload->>'response_id'),
  match_key = COALESCE(match_key, raw_payload->>'match_key'),
  shop_id = COALESCE(shop_id, raw_payload->>'shop_id')
WHERE raw_payload ?| ARRAY['response_id', 'match_key', 'shop_id']
  AND (response_id IS NULL OR match_key IS NULL OR shop_id IS NULL);

CREATE INDEX IF NOT EXISTS idx_survey_response_id ON public.survey_responses(response_id);
CREATE INDEX IF NOT EXISTS idx_survey_match_key ON public.survey_responses(match_key);
CREATE INDEX IF NOT EXISTS idx_survey_shop_id ON public.survey_responses(shop_id);

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'service_role') THEN
    GRANT USAGE ON SCHEMA sensitive TO service_role;
    GRANT SELECT, INSERT ON ALL TABLES IN SCHEMA sensitive TO service_role;
    GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA sensitive TO service_role;
  END IF;
END
$$;
