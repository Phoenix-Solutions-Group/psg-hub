CREATE OR REPLACE FUNCTION shop_competitor_overlay(
  p_shop_name TEXT,
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
  WITH directory_matches AS (
    SELECT
      s.*,
      LOWER(REGEXP_REPLACE(s.shop_name, '[^a-z0-9]', '', 'g')) AS normalized_name,
      COUNT(*) OVER (
        PARTITION BY LOWER(REGEXP_REPLACE(s.shop_name, '[^a-z0-9]', '', 'g'))
      ) AS match_count
    FROM body_shops s
    WHERE s.location IS NOT NULL
  ),
  anchor AS (
    SELECT *
    FROM directory_matches dm
    WHERE dm.normalized_name = LOWER(REGEXP_REPLACE(p_shop_name, '[^a-z0-9]', '', 'g'))
      AND dm.match_count = 1
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
      AND LOWER(REGEXP_REPLACE(b.shop_name, '[^a-z0-9]', '', 'g')) IS DISTINCT FROM a.normalized_name
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

CREATE INDEX IF NOT EXISTS idx_body_shops_location_geography
  ON body_shops
  USING gist ((location::geography));
