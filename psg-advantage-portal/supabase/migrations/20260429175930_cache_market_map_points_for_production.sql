DROP TABLE IF EXISTS market_map_point_cache;

CREATE TABLE market_map_point_cache AS
SELECT *
FROM market_map_points(NULL, 50000);

ALTER TABLE market_map_point_cache
  ADD PRIMARY KEY (layer, id);

CREATE INDEX IF NOT EXISTS idx_market_map_point_cache_lng_lat
  ON market_map_point_cache (longitude, latitude);

CREATE INDEX IF NOT EXISTS idx_market_map_point_cache_state_layer
  ON market_map_point_cache (state, layer);

CREATE INDEX IF NOT EXISTS idx_market_map_point_cache_layer_rating_name
  ON market_map_point_cache (layer, rating DESC NULLS LAST, shop_name);

CREATE OR REPLACE FUNCTION refresh_market_map_point_cache()
RETURNS BIGINT
LANGUAGE plpgsql
AS $$
DECLARE
  refreshed_count BIGINT;
BEGIN
  CREATE TEMP TABLE next_market_map_point_cache ON COMMIT DROP AS
  WITH survey_metrics AS MATERIALIZED (
    SELECT
      normalize_shop_name_key(sr.shop_name) AS normalized_name,
      COUNT(*)::bigint AS survey_count,
      ROUND(AVG(sr.scale_emi_pct) * 100, 1) AS avg_emi_pct
    FROM survey_responses sr
    GROUP BY normalize_shop_name_key(sr.shop_name)
  ),
  psg_anchor AS MATERIALIZED (
    SELECT
      'psg_customer'::text AS layer,
      ic.psg_id AS id,
      COALESCE(anchor.shop_name, ic.name) AS shop_name,
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
      CASE
        WHEN anchor.place_id IS NULL THEN 'invoiced_unmatched'
        WHEN anchor.normalized_name = google_profile_shop_name_key(ic.name) THEN 'google_profile_branch_match'
        ELSE 'google_profile_exact_match'
      END AS match_status
    FROM invoiced_customers ic
    LEFT JOIN survey_metrics sm ON sm.normalized_name = ic.normalized_name
    JOIN LATERAL (
      SELECT b.*
      FROM body_shops b
      WHERE b.location IS NOT NULL
        AND b.normalized_name IN (ic.normalized_name, google_profile_shop_name_key(ic.name))
        AND (COALESCE(ic.city, '') = '' OR b.address ILIKE '%' || ic.city || '%')
        AND (COALESCE(ic.state, '') = '' OR b.address ILIKE '%' || ic.state || '%')
      ORDER BY
        CASE WHEN b.normalized_name = google_profile_shop_name_key(ic.name) THEN 0 ELSE 1 END,
        CASE WHEN b.address ILIKE '%' || COALESCE(ic.city, '') || '%' THEN 0 ELSE 1 END,
        CASE WHEN b.address ILIKE '%' || COALESCE(ic.state, '') || '%' THEN 0 ELSE 1 END,
        b.rating DESC NULLS LAST
      LIMIT 1
    ) anchor ON TRUE
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
      AND NOT EXISTS (
        SELECT 1
        FROM psg_anchor pa
        WHERE pa.place_id IS NOT DISTINCT FROM b.place_id
      )
    ORDER BY b.rating DESC NULLS LAST, b.shop_name ASC
    LIMIT 50000
  )
  SELECT * FROM psg_anchor
  UNION ALL
  SELECT * FROM directory_scope;

  TRUNCATE market_map_point_cache;

  INSERT INTO market_map_point_cache
  SELECT *
  FROM next_market_map_point_cache;

  GET DIAGNOSTICS refreshed_count = ROW_COUNT;
  RETURN refreshed_count;
END;
$$;

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
  WITH psg AS (
    SELECT *
    FROM market_map_point_cache mmpc
    WHERE mmpc.layer = 'psg_customer'
      AND ($1 IS NULL OR mmpc.state = UPPER($1))
  ),
  directory AS (
    SELECT *
    FROM market_map_point_cache mmpc
    WHERE mmpc.layer = 'directory_shop'
      AND ($1 IS NULL OR mmpc.state = UPPER($1))
    ORDER BY mmpc.rating DESC NULLS LAST, mmpc.shop_name ASC
    LIMIT LEAST(GREATEST(COALESCE($2, 40000), 1), 50000)
  )
  SELECT * FROM psg
  UNION ALL
  SELECT * FROM directory;
$$;
