CREATE OR REPLACE FUNCTION normalize_shop_name_key(p_name TEXT)
RETURNS TEXT
LANGUAGE sql
IMMUTABLE
AS $$
  SELECT REGEXP_REPLACE(LOWER(COALESCE(p_name, '')), '[^a-z0-9]', '', 'g');
$$;

CREATE OR REPLACE FUNCTION google_profile_shop_name_key(p_name TEXT)
RETURNS TEXT
LANGUAGE sql
IMMUTABLE
AS $$
  SELECT normalize_shop_name_key(REGEXP_REPLACE(COALESCE(p_name, ''), '\s+-\s+', ' of ', 'g'));
$$;

DROP FUNCTION IF EXISTS shop_list(DATE, DATE);

CREATE OR REPLACE FUNCTION shop_list(start_date DATE, end_date DATE)
RETURNS TABLE(
  shop_name TEXT,
  canonical_shop_name TEXT,
  total_surveys BIGINT,
  avg_emi_pct NUMERIC,
  latest_survey_date DATE,
  place_id TEXT,
  address TEXT,
  phone TEXT,
  website TEXT,
  rating NUMERIC,
  category TEXT,
  latitude DOUBLE PRECISION,
  longitude DOUBLE PRECISION
)
LANGUAGE sql
STABLE
AS $$
  WITH survey_metrics AS MATERIALIZED (
    SELECT
      MIN(sr.shop_name) AS survey_shop_name,
      normalize_shop_name_key(sr.shop_name) AS normalized_name,
      COUNT(*) AS total_surveys,
      ROUND(AVG(sr.scale_emi_pct) * 100, 1) AS avg_emi_pct,
      MAX(sr.survey_date) AS latest_survey_date
    FROM survey_responses sr
    WHERE sr.survey_date BETWEEN $1 AND $2
    GROUP BY normalize_shop_name_key(sr.shop_name)
  ),
  customer_rows AS (
    SELECT
      COALESCE(gbp.shop_name, ic.name) AS shop_name,
      ic.name AS canonical_shop_name,
      COALESCE(sm.total_surveys, 0)::bigint AS total_surveys,
      COALESCE(sm.avg_emi_pct, 0)::numeric AS avg_emi_pct,
      sm.latest_survey_date,
      gbp.place_id,
      gbp.address,
      gbp.phone,
      gbp.website,
      gbp.rating,
      gbp.category,
      gbp.latitude,
      gbp.longitude
    FROM invoiced_customers ic
    LEFT JOIN survey_metrics sm ON sm.normalized_name = ic.normalized_name
    LEFT JOIN LATERAL (
      SELECT b.*
      FROM body_shops b
      WHERE b.normalized_name IN (ic.normalized_name, google_profile_shop_name_key(ic.name))
        AND (COALESCE(ic.city, '') = '' OR b.address ILIKE '%' || ic.city || '%')
        AND (COALESCE(ic.state, '') = '' OR b.address ILIKE '%' || ic.state || '%')
      ORDER BY
        CASE WHEN b.normalized_name = google_profile_shop_name_key(ic.name) THEN 0 ELSE 1 END,
        CASE WHEN b.address ILIKE '%' || COALESCE(ic.city, '') || '%' THEN 0 ELSE 1 END,
        CASE WHEN b.address ILIKE '%' || COALESCE(ic.state, '') || '%' THEN 0 ELSE 1 END,
        b.rating DESC NULLS LAST
      LIMIT 1
    ) gbp ON TRUE
  ),
  survey_only_rows AS (
    SELECT
      COALESCE(gbp.shop_name, sm.survey_shop_name) AS shop_name,
      sm.survey_shop_name AS canonical_shop_name,
      sm.total_surveys,
      sm.avg_emi_pct,
      sm.latest_survey_date,
      gbp.place_id,
      gbp.address,
      gbp.phone,
      gbp.website,
      gbp.rating,
      gbp.category,
      gbp.latitude,
      gbp.longitude
    FROM survey_metrics sm
    LEFT JOIN invoiced_customers ic ON ic.normalized_name = sm.normalized_name
    LEFT JOIN LATERAL (
      SELECT b.*
      FROM body_shops b
      WHERE b.normalized_name = sm.normalized_name
      ORDER BY b.rating DESC NULLS LAST
      LIMIT 1
    ) gbp ON TRUE
    WHERE ic.invoiced_id IS NULL
  )
  SELECT * FROM customer_rows
  UNION ALL
  SELECT * FROM survey_only_rows
  ORDER BY total_surveys DESC, avg_emi_pct DESC, shop_name ASC
  LIMIT 1000;
$$;

CREATE OR REPLACE FUNCTION shop_detail(p_shop_name TEXT, start_date DATE, end_date DATE)
RETURNS TABLE(
  shop_name TEXT,
  avg_emi_pct NUMERIC,
  total_surveys BIGINT,
  avg_quality NUMERIC,
  avg_cleanliness NUMERIC,
  avg_communication NUMERIC,
  avg_courtesy NUMERIC,
  network_avg_communication NUMERIC,
  invoiced_id BIGINT,
  psg_id TEXT,
  invoiced_city TEXT,
  invoiced_state TEXT
)
LANGUAGE sql
STABLE
AS $$
  WITH target_name AS (
    SELECT normalize_shop_name_key(p_shop_name) AS normalized_name
  ),
  identity AS (
    SELECT ic.*
    FROM invoiced_customers ic
    JOIN target_name tn
      ON tn.normalized_name IN (ic.normalized_name, google_profile_shop_name_key(ic.name))
    ORDER BY ic.imported_at DESC
    LIMIT 1
  ),
  gbp AS (
    SELECT b.*
    FROM body_shops b
    JOIN identity i
      ON b.normalized_name IN (i.normalized_name, google_profile_shop_name_key(i.name))
    WHERE (COALESCE(i.city, '') = '' OR b.address ILIKE '%' || i.city || '%')
      AND (COALESCE(i.state, '') = '' OR b.address ILIKE '%' || i.state || '%')
    ORDER BY
      CASE WHEN b.normalized_name = google_profile_shop_name_key(i.name) THEN 0 ELSE 1 END,
      CASE WHEN b.address ILIKE '%' || COALESCE(i.city, '') || '%' THEN 0 ELSE 1 END,
      CASE WHEN b.address ILIKE '%' || COALESCE(i.state, '') || '%' THEN 0 ELSE 1 END,
      b.rating DESC NULLS LAST
    LIMIT 1
  )
  SELECT
    COALESCE((SELECT gbp.shop_name FROM gbp), MIN(sr.shop_name)) AS shop_name,
    ROUND(AVG(sr.scale_emi_pct) * 100, 1) AS avg_emi_pct,
    COUNT(*) AS total_surveys,
    ROUND(AVG(sr.q05_01), 1) AS avg_quality,
    ROUND(AVG(sr.q05_02), 1) AS avg_cleanliness,
    ROUND(AVG(sr.q05_03), 1) AS avg_communication,
    ROUND(AVG(sr.q05_04), 1) AS avg_courtesy,
    (
      SELECT ROUND(AVG(n.q05_03), 1)
      FROM survey_responses n
      WHERE n.survey_date BETWEEN $2 AND $3
    ) AS network_avg_communication,
    identity.invoiced_id,
    identity.psg_id,
    identity.city AS invoiced_city,
    identity.state AS invoiced_state
  FROM survey_responses sr
  LEFT JOIN identity ON TRUE
  WHERE sr.survey_date BETWEEN $2 AND $3
    AND (
      (identity.invoiced_id IS NOT NULL AND normalize_shop_name_key(sr.shop_name) = identity.normalized_name)
      OR (identity.invoiced_id IS NULL AND sr.shop_name = $1)
    )
  GROUP BY
    identity.invoiced_id,
    identity.psg_id,
    identity.city,
    identity.state;
$$;

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
    SELECT normalize_shop_name_key(p_shop_name) AS normalized_name
  ),
  invoiced_anchor AS (
    SELECT ic.*
    FROM invoiced_customers ic
    JOIN target_name tn
      ON tn.normalized_name IN (ic.normalized_name, google_profile_shop_name_key(ic.name))
    ORDER BY ic.imported_at DESC
    LIMIT 1
  ),
  invoiced_directory_anchor AS (
    SELECT dm.*
    FROM body_shops dm
    JOIN invoiced_anchor ia
      ON dm.normalized_name IN (ia.normalized_name, google_profile_shop_name_key(ia.name))
    WHERE dm.location IS NOT NULL
      AND (COALESCE(ia.city, '') = '' OR dm.address ILIKE '%' || ia.city || '%')
      AND (COALESCE(ia.state, '') = '' OR dm.address ILIKE '%' || ia.state || '%')
    ORDER BY
      CASE WHEN dm.normalized_name = google_profile_shop_name_key(ia.name) THEN 0 ELSE 1 END,
      CASE WHEN dm.address ILIKE '%' || COALESCE(ia.city, '') || '%' THEN 0 ELSE 1 END,
      CASE WHEN dm.address ILIKE '%' || COALESCE(ia.state, '') || '%' THEN 0 ELSE 1 END,
      dm.rating DESC NULLS LAST
    LIMIT 1
  ),
  unique_directory_anchor AS (
    SELECT dm.*
    FROM body_shops dm
    JOIN target_name tn ON tn.normalized_name = dm.normalized_name
    WHERE dm.location IS NOT NULL
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
