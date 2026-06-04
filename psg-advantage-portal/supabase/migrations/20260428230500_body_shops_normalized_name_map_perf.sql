ALTER TABLE body_shops
  ADD COLUMN IF NOT EXISTS normalized_name TEXT GENERATED ALWAYS AS (
    REGEXP_REPLACE(LOWER(shop_name), '[^a-z0-9]', '', 'g')
  ) STORED;

CREATE INDEX IF NOT EXISTS idx_body_shops_normalized_name
  ON body_shops (normalized_name);

CREATE OR REPLACE FUNCTION market_map_points(
  p_state TEXT DEFAULT NULL,
  p_directory_limit INTEGER DEFAULT 40000
)
RETURNS TABLE(
  layer TEXT,
  id TEXT,
  shop_name TEXT,
  psg_id TEXT,
  invoiced_id BIGINT,
  place_id TEXT,
  address TEXT,
  phone TEXT,
  website TEXT,
  rating NUMERIC,
  latitude DOUBLE PRECISION,
  longitude DOUBLE PRECISION,
  state TEXT,
  city TEXT,
  survey_count BIGINT,
  avg_emi_pct NUMERIC,
  match_status TEXT
)
LANGUAGE sql
STABLE
AS $$
  WITH survey_metrics AS MATERIALIZED (
    SELECT
      REGEXP_REPLACE(LOWER(sr.shop_name), '[^a-z0-9]', '', 'g') AS normalized_name,
      COUNT(*)::bigint AS survey_count,
      ROUND(AVG(sr.scale_emi_pct) * 100, 1) AS avg_emi_pct
    FROM survey_responses sr
    GROUP BY REGEXP_REPLACE(LOWER(sr.shop_name), '[^a-z0-9]', '', 'g')
  ),
  psg_anchor AS MATERIALIZED (
    SELECT
      'psg_customer'::text AS layer,
      ic.psg_id AS id,
      ic.name AS shop_name,
      ic.psg_id,
      ic.invoiced_id,
      anchor.place_id,
      anchor.address,
      anchor.phone,
      anchor.website,
      anchor.rating,
      anchor.latitude,
      anchor.longitude,
      UPPER(ic.state) AS state,
      ic.city,
      sm.survey_count,
      sm.avg_emi_pct,
      'invoiced_city_state'::text AS match_status
    FROM invoiced_customers ic
    LEFT JOIN survey_metrics sm ON sm.normalized_name = ic.normalized_name
    JOIN LATERAL (
      SELECT b.*
      FROM body_shops b
      WHERE b.location IS NOT NULL
        AND b.normalized_name = ic.normalized_name
        AND (COALESCE(ic.city, '') = '' OR b.address ILIKE '%' || ic.city || '%')
        AND (COALESCE(ic.state, '') = '' OR b.address ILIKE '%' || ic.state || '%')
      ORDER BY
        CASE WHEN b.address ILIKE '%' || COALESCE(ic.city, '') || '%' THEN 0 ELSE 1 END,
        CASE WHEN b.address ILIKE '%' || COALESCE(ic.state, '') || '%' THEN 0 ELSE 1 END,
        b.rating DESC NULLS LAST
      LIMIT 1
    ) anchor ON TRUE
    WHERE ($1 IS NULL OR UPPER(ic.state) = UPPER($1))
  ),
  directory_scope AS (
    SELECT
      'directory_shop'::text AS layer,
      COALESCE(b.shop_id, b.place_id) AS id,
      b.shop_name,
      NULL::text AS psg_id,
      NULL::bigint AS invoiced_id,
      b.place_id,
      b.address,
      b.phone,
      b.website,
      b.rating,
      b.latitude,
      b.longitude,
      SUBSTRING(b.address FROM ', ([A-Z]{2}) [0-9]{5}') AS state,
      NULL::text AS city,
      NULL::bigint AS survey_count,
      NULL::numeric AS avg_emi_pct,
      'body_shops_directory'::text AS match_status
    FROM body_shops b
    WHERE b.location IS NOT NULL
      AND ($1 IS NULL OR SUBSTRING(b.address FROM ', ([A-Z]{2}) [0-9]{5}') = UPPER($1))
      AND NOT EXISTS (
        SELECT 1
        FROM psg_anchor pa
        WHERE pa.place_id IS NOT DISTINCT FROM b.place_id
      )
    ORDER BY b.rating DESC NULLS LAST, b.shop_name ASC
    LIMIT LEAST(GREATEST(COALESCE($2, 40000), 1), 50000)
  )
  SELECT * FROM psg_anchor
  UNION ALL
  SELECT * FROM directory_scope;
$$;
