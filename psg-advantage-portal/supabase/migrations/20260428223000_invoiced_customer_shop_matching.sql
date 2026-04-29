CREATE TABLE IF NOT EXISTS invoiced_customers (
  invoiced_id BIGINT PRIMARY KEY,
  psg_id TEXT NOT NULL,
  name TEXT NOT NULL,
  normalized_name TEXT GENERATED ALWAYS AS (
    LOWER(REGEXP_REPLACE(name, '[^a-z0-9]', '', 'g'))
  ) STORED,
  city TEXT,
  state TEXT,
  parent_invoiced_id BIGINT,
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  imported_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_invoiced_customers_psg_id
  ON invoiced_customers (psg_id);

CREATE INDEX IF NOT EXISTS idx_invoiced_customers_normalized_name
  ON invoiced_customers (normalized_name);

CREATE INDEX IF NOT EXISTS idx_invoiced_customers_city_state
  ON invoiced_customers (LOWER(city), UPPER(state));

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
  WITH target_name AS (
    SELECT LOWER(REGEXP_REPLACE(p_shop_name, '[^a-z0-9]', '', 'g')) AS normalized_name
  ),
  invoiced_matches AS (
    SELECT
      ic.*,
      COUNT(*) OVER (PARTITION BY ic.normalized_name) AS match_count
    FROM invoiced_customers ic
    JOIN target_name tn ON tn.normalized_name = ic.normalized_name
  ),
  invoiced_anchor AS (
    SELECT *
    FROM invoiced_matches im
    WHERE im.match_count = 1
    LIMIT 1
  ),
  directory_matches AS (
    SELECT
      s.*,
      LOWER(REGEXP_REPLACE(s.shop_name, '[^a-z0-9]', '', 'g')) AS normalized_name,
      COUNT(*) OVER (
        PARTITION BY LOWER(REGEXP_REPLACE(s.shop_name, '[^a-z0-9]', '', 'g'))
      ) AS match_count
    FROM body_shops s
    WHERE s.location IS NOT NULL
  ),
  invoiced_directory_anchor AS (
    SELECT dm.*
    FROM directory_matches dm
    JOIN invoiced_anchor ia ON ia.normalized_name = dm.normalized_name
    WHERE (COALESCE(ia.city, '') = '' OR dm.address ILIKE '%' || ia.city || '%')
      AND (COALESCE(ia.state, '') = '' OR dm.address ILIKE '%' || ia.state || '%')
    ORDER BY
      CASE WHEN dm.address ILIKE '%' || COALESCE(ia.city, '') || '%' THEN 0 ELSE 1 END,
      CASE WHEN dm.address ILIKE '%' || COALESCE(ia.state, '') || '%' THEN 0 ELSE 1 END,
      dm.rating DESC NULLS LAST
    LIMIT 1
  ),
  unique_directory_anchor AS (
    SELECT dm.*
    FROM directory_matches dm
    JOIN target_name tn ON tn.normalized_name = dm.normalized_name
    WHERE dm.match_count = 1
    LIMIT 1
  ),
  anchor AS (
    SELECT * FROM invoiced_directory_anchor
    UNION ALL
    SELECT * FROM unique_directory_anchor
    WHERE NOT EXISTS (SELECT 1 FROM invoiced_directory_anchor)
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
