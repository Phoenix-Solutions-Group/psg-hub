CREATE OR REPLACE FUNCTION shop_list(start_date DATE, end_date DATE)
RETURNS TABLE(
  shop_name TEXT,
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
  WITH survey_metrics AS (
    SELECT
      sr.shop_name,
      REGEXP_REPLACE(LOWER(sr.shop_name), '[^a-z0-9]', '', 'g') AS normalized_name,
      COUNT(*) AS total_surveys,
      ROUND(AVG(sr.scale_emi_pct) * 100, 1) AS avg_emi_pct,
      MAX(sr.survey_date) AS latest_survey_date
    FROM survey_responses sr
    WHERE sr.survey_date BETWEEN $1 AND $2
    GROUP BY sr.shop_name
  ),
  directory_matches AS (
    SELECT
      s.*,
      COUNT(*) OVER (PARTITION BY s.normalized_name) AS match_count
    FROM body_shops s
  ),
  unique_directory_matches AS (
    SELECT dm.*
    FROM directory_matches dm
    WHERE dm.match_count = 1
  )
  SELECT
    sm.shop_name,
    sm.total_surveys,
    sm.avg_emi_pct,
    sm.latest_survey_date,
    s.place_id,
    s.address,
    s.phone,
    s.website,
    s.rating,
    s.category,
    s.latitude,
    s.longitude
  FROM survey_metrics sm
  LEFT JOIN unique_directory_matches s
    ON s.normalized_name = sm.normalized_name
  ORDER BY sm.total_surveys DESC, sm.avg_emi_pct DESC
  LIMIT 500;
$$;
