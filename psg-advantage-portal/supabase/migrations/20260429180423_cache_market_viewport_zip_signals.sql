DROP TABLE IF EXISTS market_zip_latest_signal;

CREATE TABLE market_zip_latest_signal (
  zip TEXT PRIMARY KEY,
  longitude DOUBLE PRECISION,
  latitude DOUBLE PRECISION,
  state TEXT,
  city TEXT,
  year INTEGER,
  total_crashes NUMERIC NOT NULL DEFAULT 0,
  injury_crashes NUMERIC NOT NULL DEFAULT 0,
  weather_related_crashes NUMERIC NOT NULL DEFAULT 0,
  storm_events NUMERIC NOT NULL DEFAULT 0,
  hail_events NUMERIC NOT NULL DEFAULT 0,
  wind_events NUMERIC NOT NULL DEFAULT 0,
  storm_demand_score NUMERIC NOT NULL DEFAULT 0,
  targeting_score NUMERIC NOT NULL DEFAULT 0
);

CREATE INDEX IF NOT EXISTS idx_market_zip_latest_signal_lng_lat
  ON market_zip_latest_signal (longitude, latitude);

CREATE INDEX IF NOT EXISTS idx_market_zip_latest_signal_score
  ON market_zip_latest_signal (targeting_score DESC, total_crashes DESC, storm_events DESC);

CREATE OR REPLACE FUNCTION refresh_market_zip_latest_signal()
RETURNS BIGINT
LANGUAGE plpgsql
AS $$
DECLARE
  refreshed_count BIGINT;
BEGIN
  CREATE TEMP TABLE next_market_zip_latest_signal ON COMMIT DROP AS
  WITH latest_crash_year AS (
    SELECT MAX(year) AS year
    FROM crash_zip_annual
    WHERE zip <> '__UNMATCHED__'
  ),
  crash_by_zip AS (
    SELECT
      cza.zip,
      MAX(cza.state) AS state,
      MAX(cza.city) AS city,
      cza.year,
      SUM(cza.total_crashes)::numeric AS total_crashes,
      SUM(cza.injury_crashes)::numeric AS injury_crashes,
      SUM(cza.weather_related_crashes)::numeric AS weather_related_crashes,
      SUM(cza.weighted_crash_demand_score)::numeric AS weighted_crash_demand_score
    FROM crash_zip_annual cza
    JOIN latest_crash_year lcy ON lcy.year = cza.year
    WHERE cza.zip <> '__UNMATCHED__'
    GROUP BY cza.zip, cza.year
  ),
  storm_by_zip AS (
    SELECT
      szm.zip,
      MAX(szm.state) AS state,
      EXTRACT(YEAR FROM szm.month)::integer AS year,
      SUM(szm.total_events)::numeric AS storm_events,
      SUM(szm.hail_events)::numeric AS hail_events,
      SUM(szm.wind_events)::numeric AS wind_events,
      SUM(szm.weighted_storm_demand_score)::numeric AS storm_demand_score
    FROM storm_zip_monthly szm
    JOIN latest_crash_year lcy ON lcy.year = EXTRACT(YEAR FROM szm.month)::integer
    WHERE szm.zip <> '__UNMATCHED__'
    GROUP BY szm.zip, EXTRACT(YEAR FROM szm.month)::integer
  )
  SELECT
    zb.zip_code AS zip,
    ST_X(ST_PointOnSurface(zb.boundary))::double precision AS longitude,
    ST_Y(ST_PointOnSurface(zb.boundary))::double precision AS latitude,
    COALESCE(cbz.state, sbz.state, 'US') AS state,
    cbz.city,
    COALESCE(cbz.year, sbz.year, (SELECT year FROM latest_crash_year)) AS year,
    COALESCE(cbz.total_crashes, 0) AS total_crashes,
    COALESCE(cbz.injury_crashes, 0) AS injury_crashes,
    COALESCE(cbz.weather_related_crashes, 0) AS weather_related_crashes,
    COALESCE(sbz.storm_events, 0) AS storm_events,
    COALESCE(sbz.hail_events, 0) AS hail_events,
    COALESCE(sbz.wind_events, 0) AS wind_events,
    COALESCE(sbz.storm_demand_score, 0) AS storm_demand_score,
    ROUND(
      (
        COALESCE(cbz.weighted_crash_demand_score, 0)
        + COALESCE(sbz.storm_demand_score, 0) * 0.35
      )::numeric,
      2
    ) AS targeting_score
  FROM zipcode_boundaries zb
  LEFT JOIN crash_by_zip cbz ON cbz.zip = zb.zip_code
  LEFT JOIN storm_by_zip sbz ON sbz.zip = zb.zip_code
  WHERE zb.boundary IS NOT NULL;

  TRUNCATE market_zip_latest_signal;

  INSERT INTO market_zip_latest_signal
  SELECT *
  FROM next_market_zip_latest_signal;

  GET DIAGNOSTICS refreshed_count = ROW_COUNT;
  RETURN refreshed_count;
END;
$$;

SELECT refresh_market_zip_latest_signal();

CREATE OR REPLACE FUNCTION market_viewport_intelligence(
  p_west DOUBLE PRECISION,
  p_south DOUBLE PRECISION,
  p_east DOUBLE PRECISION,
  p_north DOUBLE PRECISION,
  p_zoom DOUBLE PRECISION DEFAULT NULL,
  result_limit INTEGER DEFAULT 8
)
RETURNS TABLE(
  viewport_label TEXT,
  zoom DOUBLE PRECISION,
  psg_customer_count BIGINT,
  directory_shop_count BIGINT,
  surveyed_psg_customer_count BIGINT,
  crash_count NUMERIC,
  injury_crash_count NUMERIC,
  weather_related_crash_count NUMERIC,
  storm_event_count NUMERIC,
  hail_event_count NUMERIC,
  wind_event_count NUMERIC,
  storm_demand_score NUMERIC,
  top_zips JSONB,
  top_customers JSONB
)
LANGUAGE sql
STABLE
AS $$
  WITH visible_points AS (
    SELECT points.*
    FROM market_map_point_cache points
    WHERE points.longitude BETWEEN LEAST(p_west, p_east) AND GREATEST(p_west, p_east)
      AND points.latitude BETWEEN LEAST(p_south, p_north) AND GREATEST(p_south, p_north)
  ),
  point_summary AS (
    SELECT
      COUNT(*) FILTER (WHERE layer = 'psg_customer') AS psg_customers,
      COUNT(*) FILTER (WHERE layer = 'directory_shop') AS directory_shops,
      COUNT(*) FILTER (
        WHERE layer = 'psg_customer'
          AND COALESCE(survey_count, 0) > 0
      ) AS surveyed_customers
    FROM visible_points
  ),
  zip_rollup AS (
    SELECT mzls.*
    FROM market_zip_latest_signal mzls
    WHERE mzls.longitude BETWEEN LEAST(p_west, p_east) AND GREATEST(p_west, p_east)
      AND mzls.latitude BETWEEN LEAST(p_south, p_north) AND GREATEST(p_south, p_north)
  ),
  totals AS (
    SELECT
      COALESCE(SUM(total_crashes), 0) AS total_crashes,
      COALESCE(SUM(injury_crashes), 0) AS injury_crashes,
      COALESCE(SUM(weather_related_crashes), 0) AS weather_related_crashes,
      COALESCE(SUM(storm_events), 0) AS storm_events,
      COALESCE(SUM(hail_events), 0) AS hail_events,
      COALESCE(SUM(wind_events), 0) AS wind_events,
      COALESCE(SUM(storm_demand_score), 0) AS storm_demand_score
    FROM zip_rollup
  ),
  top_zip_rows AS (
    SELECT *
    FROM zip_rollup
    WHERE total_crashes > 0 OR storm_events > 0
    ORDER BY targeting_score DESC, total_crashes DESC, storm_events DESC
    LIMIT GREATEST(result_limit, 1)
  ),
  top_customer_rows AS (
    SELECT
      shop_name,
      psg_id,
      city,
      state,
      survey_count,
      avg_emi_pct
    FROM visible_points
    WHERE layer = 'psg_customer'
    ORDER BY COALESCE(survey_count, 0) DESC, shop_name
    LIMIT GREATEST(result_limit, 1)
  )
  SELECT
    CASE
      WHEN COALESCE(p_zoom, 0) >= 9 THEN 'Local market view'
      WHEN COALESCE(p_zoom, 0) >= 6 THEN 'Metro view'
      WHEN COALESCE(p_zoom, 0) >= 4 THEN 'Regional view'
      ELSE 'National view'
    END AS viewport_label,
    p_zoom AS zoom,
    COALESCE(ps.psg_customers, 0) AS psg_customer_count,
    COALESCE(ps.directory_shops, 0) AS directory_shop_count,
    COALESCE(ps.surveyed_customers, 0) AS surveyed_psg_customer_count,
    totals.total_crashes AS crash_count,
    totals.injury_crashes AS injury_crash_count,
    totals.weather_related_crashes AS weather_related_crash_count,
    totals.storm_events AS storm_event_count,
    totals.hail_events AS hail_event_count,
    totals.wind_events AS wind_event_count,
    totals.storm_demand_score AS storm_demand_score,
    COALESCE(
      (
        SELECT jsonb_agg(to_jsonb(top_zip_rows) ORDER BY targeting_score DESC, total_crashes DESC)
        FROM top_zip_rows
      ),
      '[]'::jsonb
    ) AS top_zips,
    COALESCE(
      (
        SELECT jsonb_agg(to_jsonb(top_customer_rows) ORDER BY COALESCE(survey_count, 0) DESC, shop_name)
        FROM top_customer_rows
      ),
      '[]'::jsonb
    ) AS top_customers
  FROM point_summary ps
  CROSS JOIN totals;
$$;
