CREATE OR REPLACE FUNCTION market_map_search(
  p_query TEXT,
  p_limit INTEGER DEFAULT 20
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
  WITH search AS (
    SELECT
      TRIM(COALESCE(p_query, '')) AS raw_query,
      LOWER(TRIM(COALESCE(p_query, ''))) AS query,
      normalize_shop_name_key(TRIM(COALESCE(p_query, ''))) AS normalized_query
  )
  SELECT
    mmpc.layer,
    mmpc.id,
    mmpc.shop_name,
    mmpc.psg_id,
    mmpc.invoiced_id,
    mmpc.place_id,
    mmpc.address,
    mmpc.phone,
    mmpc.website,
    mmpc.rating,
    mmpc.latitude,
    mmpc.longitude,
    mmpc.state,
    mmpc.city,
    mmpc.survey_count,
    mmpc.avg_emi_pct,
    mmpc.match_status
  FROM market_map_point_cache mmpc
  CROSS JOIN search s
  WHERE LENGTH(s.raw_query) >= 2
    AND (
      LOWER(mmpc.shop_name) LIKE '%' || s.query || '%'
      OR LOWER(COALESCE(mmpc.address, '')) LIKE '%' || s.query || '%'
      OR LOWER(COALESCE(mmpc.city, '')) LIKE '%' || s.query || '%'
      OR LOWER(COALESCE(mmpc.phone, '')) LIKE '%' || s.query || '%'
      OR LOWER(COALESCE(mmpc.psg_id, '')) LIKE '%' || s.query || '%'
      OR LOWER(COALESCE(mmpc.place_id, '')) = s.query
      OR mmpc.state = UPPER(s.raw_query)
      OR normalize_shop_name_key(mmpc.shop_name) LIKE '%' || s.normalized_query || '%'
    )
  ORDER BY
    CASE WHEN mmpc.layer = 'psg_customer' THEN 0 ELSE 1 END,
    CASE WHEN LOWER(mmpc.shop_name) = s.query THEN 0 ELSE 1 END,
    CASE WHEN LOWER(mmpc.shop_name) LIKE s.query || '%' THEN 0 ELSE 1 END,
    COALESCE(mmpc.survey_count, 0) DESC,
    mmpc.rating DESC NULLS LAST,
    mmpc.shop_name ASC
  LIMIT LEAST(GREATEST(COALESCE(p_limit, 20), 1), 50);
$$;

CREATE OR REPLACE FUNCTION shop_competitor_overlay_by_place_id(
  p_place_id TEXT,
  p_radius_miles NUMERIC DEFAULT 25,
  p_limit INTEGER DEFAULT 25
)
RETURNS TABLE(
  is_anchor BOOLEAN,
  shop_name TEXT,
  place_id TEXT,
  address TEXT,
  phone TEXT,
  website TEXT,
  rating NUMERIC,
  category TEXT,
  latitude DOUBLE PRECISION,
  longitude DOUBLE PRECISION,
  distance_miles NUMERIC
)
LANGUAGE sql
STABLE
AS $$
  WITH anchor AS (
    SELECT b.*
    FROM body_shops b
    WHERE b.place_id = p_place_id
      AND b.location IS NOT NULL
    LIMIT 1
  ),
  competitors AS (
    SELECT
      FALSE AS is_anchor,
      b.shop_name,
      b.place_id,
      b.address,
      b.phone,
      b.website,
      b.rating,
      b.category,
      b.latitude,
      b.longitude,
      ROUND((ST_Distance(b.location::geography, a.location::geography) / 1609.344)::numeric, 2) AS distance_miles
    FROM body_shops b
    CROSS JOIN anchor a
    WHERE b.location IS NOT NULL
      AND b.place_id IS DISTINCT FROM a.place_id
      AND b.normalized_name IS DISTINCT FROM a.normalized_name
      AND ST_DWithin(
        b.location::geography,
        a.location::geography,
        LEAST(GREATEST(COALESCE(p_radius_miles, 25), 1), 100) * 1609.344
      )
    ORDER BY b.location::geography <-> a.location::geography
    LIMIT LEAST(GREATEST(COALESCE(p_limit, 25), 1), 100)
  )
  SELECT
    TRUE AS is_anchor,
    a.shop_name,
    a.place_id,
    a.address,
    a.phone,
    a.website,
    a.rating,
    a.category,
    a.latitude,
    a.longitude,
    0::numeric AS distance_miles
  FROM anchor a
  UNION ALL
  SELECT * FROM competitors
  ORDER BY is_anchor DESC, distance_miles ASC;
$$;
