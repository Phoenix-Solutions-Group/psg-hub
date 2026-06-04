-- Harden the private PII schema so future objects stay private by default.

REVOKE ALL ON SCHEMA sensitive FROM PUBLIC;
REVOKE ALL ON SCHEMA sensitive FROM anon;
REVOKE ALL ON SCHEMA sensitive FROM authenticated;

REVOKE ALL ON ALL TABLES IN SCHEMA sensitive FROM PUBLIC;
REVOKE ALL ON ALL TABLES IN SCHEMA sensitive FROM anon;
REVOKE ALL ON ALL TABLES IN SCHEMA sensitive FROM authenticated;
REVOKE ALL ON ALL SEQUENCES IN SCHEMA sensitive FROM PUBLIC;
REVOKE ALL ON ALL SEQUENCES IN SCHEMA sensitive FROM anon;
REVOKE ALL ON ALL SEQUENCES IN SCHEMA sensitive FROM authenticated;
REVOKE ALL ON ALL FUNCTIONS IN SCHEMA sensitive FROM PUBLIC;
REVOKE ALL ON ALL FUNCTIONS IN SCHEMA sensitive FROM anon;
REVOKE ALL ON ALL FUNCTIONS IN SCHEMA sensitive FROM authenticated;

ALTER DEFAULT PRIVILEGES IN SCHEMA sensitive
  REVOKE ALL ON TABLES FROM PUBLIC, anon, authenticated;
ALTER DEFAULT PRIVILEGES IN SCHEMA sensitive
  REVOKE ALL ON SEQUENCES FROM PUBLIC, anon, authenticated;
ALTER DEFAULT PRIVILEGES IN SCHEMA sensitive
  REVOKE ALL ON FUNCTIONS FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION sensitive.log_pii_access(
  p_action TEXT,
  p_target_table TEXT,
  p_actor_user_id UUID DEFAULT NULL,
  p_actor_email TEXT DEFAULT NULL,
  p_actor_role TEXT DEFAULT NULL,
  p_target_key TEXT DEFAULT NULL,
  p_reason TEXT DEFAULT NULL,
  p_request_metadata JSONB DEFAULT '{}'::jsonb
)
RETURNS BIGINT
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = sensitive, pg_catalog
AS $$
DECLARE
  v_log_id BIGINT;
BEGIN
  INSERT INTO sensitive.pii_access_log (
    actor_user_id,
    actor_email,
    actor_role,
    action,
    target_table,
    target_key,
    reason,
    request_metadata
  )
  VALUES (
    p_actor_user_id,
    p_actor_email,
    p_actor_role,
    p_action,
    p_target_table,
    p_target_key,
    p_reason,
    COALESCE(p_request_metadata, '{}'::jsonb)
  )
  RETURNING id INTO v_log_id;

  RETURN v_log_id;
END;
$$;

REVOKE ALL ON FUNCTION sensitive.log_pii_access(
  TEXT,
  TEXT,
  UUID,
  TEXT,
  TEXT,
  TEXT,
  TEXT,
  JSONB
) FROM PUBLIC;
REVOKE ALL ON FUNCTION sensitive.log_pii_access(
  TEXT,
  TEXT,
  UUID,
  TEXT,
  TEXT,
  TEXT,
  TEXT,
  JSONB
) FROM anon;
REVOKE ALL ON FUNCTION sensitive.log_pii_access(
  TEXT,
  TEXT,
  UUID,
  TEXT,
  TEXT,
  TEXT,
  TEXT,
  JSONB
) FROM authenticated;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'service_role') THEN
    GRANT USAGE ON SCHEMA sensitive TO service_role;
    GRANT SELECT, INSERT ON ALL TABLES IN SCHEMA sensitive TO service_role;
    GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA sensitive TO service_role;
    GRANT EXECUTE ON FUNCTION sensitive.log_pii_access(
      TEXT,
      TEXT,
      UUID,
      TEXT,
      TEXT,
      TEXT,
      TEXT,
      JSONB
    ) TO service_role;

    ALTER DEFAULT PRIVILEGES IN SCHEMA sensitive
      GRANT SELECT, INSERT ON TABLES TO service_role;
    ALTER DEFAULT PRIVILEGES IN SCHEMA sensitive
      GRANT USAGE, SELECT ON SEQUENCES TO service_role;
  END IF;
END
$$;

COMMENT ON SCHEMA sensitive IS
  'Private PSG PII schema. Not intended for browser-facing Supabase clients.';
COMMENT ON FUNCTION sensitive.log_pii_access(
  TEXT,
  TEXT,
  UUID,
  TEXT,
  TEXT,
  TEXT,
  TEXT,
  JSONB
) IS
  'Service-role-only audit helper for explicit PII access events.';
