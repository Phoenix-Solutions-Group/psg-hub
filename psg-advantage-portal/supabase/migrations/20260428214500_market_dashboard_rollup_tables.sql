CREATE TABLE IF NOT EXISTS accident_market_rollup (
  city TEXT NOT NULL,
  state TEXT NOT NULL,
  row_count BIGINT NOT NULL,
  weather_related_count BIGINT NOT NULL,
  high_severity_count BIGINT NOT NULL,
  distance_weighted_sum NUMERIC NOT NULL,
  PRIMARY KEY (city, state)
);

CREATE INDEX IF NOT EXISTS idx_accident_market_rollup_state
  ON accident_market_rollup (state);

CREATE TABLE IF NOT EXISTS accident_market_zip_rollup (
  city TEXT NOT NULL,
  state TEXT NOT NULL,
  zip TEXT NOT NULL,
  accidents BIGINT NOT NULL,
  PRIMARY KEY (city, state, zip)
);

CREATE INDEX IF NOT EXISTS idx_accident_market_zip_rollup_state
  ON accident_market_zip_rollup (state);

CREATE INDEX IF NOT EXISTS idx_accident_market_zip_rollup_zip
  ON accident_market_zip_rollup (zip);

CREATE TABLE IF NOT EXISTS accident_market_daypart_rollup (
  city TEXT NOT NULL,
  state TEXT NOT NULL,
  bucket TEXT NOT NULL,
  bucket_order INTEGER NOT NULL,
  claims BIGINT NOT NULL,
  PRIMARY KEY (city, state, bucket)
);

CREATE INDEX IF NOT EXISTS idx_accident_market_daypart_rollup_state
  ON accident_market_daypart_rollup (state);

CREATE OR REPLACE FUNCTION refresh_accident_market_rollups()
RETURNS void
LANGUAGE plpgsql
AS $$
BEGIN
  TRUNCATE accident_market_rollup;
  INSERT INTO accident_market_rollup (
    city,
    state,
    row_count,
    weather_related_count,
    high_severity_count,
    distance_weighted_sum
  )
  SELECT
    LOWER(TRIM(a.city)) AS city,
    UPPER(TRIM(a.state)) AS state,
    COUNT(*)::bigint AS row_count,
    COUNT(*) FILTER (
      WHERE LOWER(COALESCE(a.weather_condition, '')) ~ 'rain|snow|storm|hail|sleet|fog|thunder'
        OR COALESCE(a.precipitation_in, 0) > 0
    )::bigint AS weather_related_count,
    COUNT(*) FILTER (WHERE a.severity IN (3, 4))::bigint AS high_severity_count,
    COALESCE(SUM(COALESCE(a.distance_mi, 0)), 0)::numeric AS distance_weighted_sum
  FROM accidents a
  WHERE a.city IS NOT NULL
    AND TRIM(a.city) <> ''
    AND a.state IS NOT NULL
    AND TRIM(a.state) <> ''
  GROUP BY LOWER(TRIM(a.city)), UPPER(TRIM(a.state));

  TRUNCATE accident_market_zip_rollup;
  INSERT INTO accident_market_zip_rollup (city, state, zip, accidents)
  SELECT
    LOWER(TRIM(a.city)) AS city,
    UPPER(TRIM(a.state)) AS state,
    a.zipcode AS zip,
    COUNT(*)::bigint AS accidents
  FROM accidents a
  WHERE a.city IS NOT NULL
    AND TRIM(a.city) <> ''
    AND a.state IS NOT NULL
    AND TRIM(a.state) <> ''
    AND a.zipcode IS NOT NULL
  GROUP BY LOWER(TRIM(a.city)), UPPER(TRIM(a.state)), a.zipcode;

  TRUNCATE accident_market_daypart_rollup;
  INSERT INTO accident_market_daypart_rollup (city, state, bucket, bucket_order, claims)
  SELECT
    LOWER(TRIM(a.city)) AS city,
    UPPER(TRIM(a.state)) AS state,
    CASE
      WHEN EXTRACT(HOUR FROM a.start_time) BETWEEN 0 AND 2 THEN '12a'
      WHEN EXTRACT(HOUR FROM a.start_time) BETWEEN 3 AND 5 THEN '3a'
      WHEN EXTRACT(HOUR FROM a.start_time) BETWEEN 6 AND 8 THEN '6a'
      WHEN EXTRACT(HOUR FROM a.start_time) BETWEEN 9 AND 11 THEN '9a'
      WHEN EXTRACT(HOUR FROM a.start_time) BETWEEN 12 AND 14 THEN '12p'
      WHEN EXTRACT(HOUR FROM a.start_time) BETWEEN 15 AND 17 THEN '3p'
      WHEN EXTRACT(HOUR FROM a.start_time) BETWEEN 18 AND 20 THEN '6p'
      ELSE '9p'
    END AS bucket,
    CASE
      WHEN EXTRACT(HOUR FROM a.start_time) BETWEEN 0 AND 2 THEN 0
      WHEN EXTRACT(HOUR FROM a.start_time) BETWEEN 3 AND 5 THEN 1
      WHEN EXTRACT(HOUR FROM a.start_time) BETWEEN 6 AND 8 THEN 2
      WHEN EXTRACT(HOUR FROM a.start_time) BETWEEN 9 AND 11 THEN 3
      WHEN EXTRACT(HOUR FROM a.start_time) BETWEEN 12 AND 14 THEN 4
      WHEN EXTRACT(HOUR FROM a.start_time) BETWEEN 15 AND 17 THEN 5
      WHEN EXTRACT(HOUR FROM a.start_time) BETWEEN 18 AND 20 THEN 6
      ELSE 7
    END AS bucket_order,
    COUNT(*)::bigint AS claims
  FROM accidents a
  WHERE a.city IS NOT NULL
    AND TRIM(a.city) <> ''
    AND a.state IS NOT NULL
    AND TRIM(a.state) <> ''
    AND a.start_time IS NOT NULL
  GROUP BY
    LOWER(TRIM(a.city)),
    UPPER(TRIM(a.state)),
    CASE
      WHEN EXTRACT(HOUR FROM a.start_time) BETWEEN 0 AND 2 THEN '12a'
      WHEN EXTRACT(HOUR FROM a.start_time) BETWEEN 3 AND 5 THEN '3a'
      WHEN EXTRACT(HOUR FROM a.start_time) BETWEEN 6 AND 8 THEN '6a'
      WHEN EXTRACT(HOUR FROM a.start_time) BETWEEN 9 AND 11 THEN '9a'
      WHEN EXTRACT(HOUR FROM a.start_time) BETWEEN 12 AND 14 THEN '12p'
      WHEN EXTRACT(HOUR FROM a.start_time) BETWEEN 15 AND 17 THEN '3p'
      WHEN EXTRACT(HOUR FROM a.start_time) BETWEEN 18 AND 20 THEN '6p'
      ELSE '9p'
    END,
    CASE
      WHEN EXTRACT(HOUR FROM a.start_time) BETWEEN 0 AND 2 THEN 0
      WHEN EXTRACT(HOUR FROM a.start_time) BETWEEN 3 AND 5 THEN 1
      WHEN EXTRACT(HOUR FROM a.start_time) BETWEEN 6 AND 8 THEN 2
      WHEN EXTRACT(HOUR FROM a.start_time) BETWEEN 9 AND 11 THEN 3
      WHEN EXTRACT(HOUR FROM a.start_time) BETWEEN 12 AND 14 THEN 4
      WHEN EXTRACT(HOUR FROM a.start_time) BETWEEN 15 AND 17 THEN 5
      WHEN EXTRACT(HOUR FROM a.start_time) BETWEEN 18 AND 20 THEN 6
      ELSE 7
    END;
END;
$$;

CREATE OR REPLACE FUNCTION marketing_metadata(city TEXT DEFAULT NULL, state TEXT DEFAULT NULL)
RETURNS TABLE(
  row_count BIGINT,
  weather_related_count BIGINT,
  severe_accident_rate NUMERIC,
  weather_related_rate NUMERIC,
  average_distance_miles NUMERIC,
  storm_event_count BIGINT,
  hail_event_count BIGINT,
  wind_event_count BIGINT,
  tornado_event_count BIGINT,
  storm_demand_score NUMERIC,
  max_hail_size NUMERIC,
  max_wind_speed NUMERIC
)
LANGUAGE sql
STABLE
AS $$
  WITH accident_stats AS (
    SELECT
      COALESCE(SUM(amr.row_count), 0)::bigint AS row_count,
      COALESCE(SUM(amr.weather_related_count), 0)::bigint AS weather_related_count,
      COALESCE(SUM(amr.high_severity_count), 0)::bigint AS high_severity_count,
      COALESCE(SUM(amr.distance_weighted_sum), 0)::numeric AS distance_weighted_sum
    FROM accident_market_rollup amr
    WHERE ($1 IS NULL OR amr.city = LOWER(TRIM($1)))
      AND ($2 IS NULL OR amr.state = UPPER(TRIM($2)))
  ),
  zip_scope AS (
    SELECT DISTINCT amzr.zip
    FROM accident_market_zip_rollup amzr
    WHERE NOT ($1 IS NULL AND $2 IS NULL)
      AND ($1 IS NULL OR amzr.city = LOWER(TRIM($1)))
      AND ($2 IS NULL OR amzr.state = UPPER(TRIM($2)))
  ),
  storm_stats AS (
    SELECT
      COALESCE(SUM(total_events), 0)::bigint AS storm_event_count,
      COALESCE(SUM(hail_events), 0)::bigint AS hail_event_count,
      COALESCE(SUM(wind_events), 0)::bigint AS wind_event_count,
      COALESCE(SUM(tornado_events), 0)::bigint AS tornado_event_count,
      COALESCE(ROUND(SUM(weighted_storm_demand_score)::numeric, 1), 0) AS storm_demand_score,
      MAX(max_hail_size) AS max_hail_size,
      MAX(max_wind_speed) AS max_wind_speed
    FROM storm_zip_monthly szm
    WHERE $1 IS NULL AND $2 IS NULL
    UNION ALL
    SELECT
      COALESCE(SUM(szm.total_events), 0)::bigint AS storm_event_count,
      COALESCE(SUM(szm.hail_events), 0)::bigint AS hail_event_count,
      COALESCE(SUM(szm.wind_events), 0)::bigint AS wind_event_count,
      COALESCE(SUM(szm.tornado_events), 0)::bigint AS tornado_event_count,
      COALESCE(ROUND(SUM(szm.weighted_storm_demand_score)::numeric, 1), 0) AS storm_demand_score,
      MAX(szm.max_hail_size) AS max_hail_size,
      MAX(szm.max_wind_speed) AS max_wind_speed
    FROM storm_zip_monthly szm
    JOIN zip_scope zs ON zs.zip = szm.zip
    WHERE NOT ($1 IS NULL AND $2 IS NULL)
  )
  SELECT
    a.row_count,
    a.weather_related_count,
    ROUND(a.high_severity_count::numeric / NULLIF(a.row_count, 0) * 100, 1) AS severe_accident_rate,
    ROUND(a.weather_related_count::numeric / NULLIF(a.row_count, 0) * 100, 1) AS weather_related_rate,
    ROUND(a.distance_weighted_sum / NULLIF(a.row_count, 0), 2) AS average_distance_miles,
    COALESCE(SUM(s.storm_event_count), 0)::bigint AS storm_event_count,
    COALESCE(SUM(s.hail_event_count), 0)::bigint AS hail_event_count,
    COALESCE(SUM(s.wind_event_count), 0)::bigint AS wind_event_count,
    COALESCE(SUM(s.tornado_event_count), 0)::bigint AS tornado_event_count,
    COALESCE(SUM(s.storm_demand_score), 0) AS storm_demand_score,
    MAX(s.max_hail_size) AS max_hail_size,
    MAX(s.max_wind_speed) AS max_wind_speed
  FROM accident_stats a
  CROSS JOIN storm_stats s
  GROUP BY
    a.row_count,
    a.weather_related_count,
    a.high_severity_count,
    a.distance_weighted_sum;
$$;

CREATE OR REPLACE FUNCTION marketing_top_zips(city TEXT DEFAULT NULL, state TEXT DEFAULT NULL)
RETURNS TABLE(
  zip TEXT,
  accidents BIGINT,
  storm_event_count BIGINT,
  hail_event_count BIGINT,
  wind_event_count BIGINT,
  tornado_event_count BIGINT,
  storm_demand_score NUMERIC
)
LANGUAGE sql
STABLE
AS $$
  WITH accident_counts AS (
    SELECT amzr.zip, SUM(amzr.accidents)::bigint AS accidents
    FROM accident_market_zip_rollup amzr
    WHERE ($1 IS NULL OR amzr.city = LOWER(TRIM($1)))
      AND ($2 IS NULL OR amzr.state = UPPER(TRIM($2)))
    GROUP BY amzr.zip
  ),
  storm_counts AS (
    SELECT
      szm.zip,
      SUM(szm.total_events)::bigint AS storm_event_count,
      SUM(szm.hail_events)::bigint AS hail_event_count,
      SUM(szm.wind_events)::bigint AS wind_event_count,
      SUM(szm.tornado_events)::bigint AS tornado_event_count,
      ROUND(SUM(szm.weighted_storm_demand_score)::numeric, 1) AS storm_demand_score
    FROM storm_zip_monthly szm
    WHERE ($1 IS NULL AND $2 IS NULL)
       OR szm.zip IN (SELECT accident_counts.zip FROM accident_counts)
    GROUP BY szm.zip
  )
  SELECT
    ac.zip,
    ac.accidents,
    COALESCE(sc.storm_event_count, 0) AS storm_event_count,
    COALESCE(sc.hail_event_count, 0) AS hail_event_count,
    COALESCE(sc.wind_event_count, 0) AS wind_event_count,
    COALESCE(sc.tornado_event_count, 0) AS tornado_event_count,
    COALESCE(sc.storm_demand_score, 0) AS storm_demand_score
  FROM accident_counts ac
  LEFT JOIN storm_counts sc ON sc.zip = ac.zip
  ORDER BY (ac.accidents + COALESCE(sc.storm_demand_score, 0) * 10) DESC
  LIMIT 5;
$$;

CREATE OR REPLACE FUNCTION marketing_daypart(city TEXT DEFAULT NULL, state TEXT DEFAULT NULL)
RETURNS TABLE("time" TEXT, claims BIGINT)
LANGUAGE sql
STABLE
AS $$
  SELECT
    amdr.bucket AS "time",
    SUM(amdr.claims)::bigint AS claims
  FROM accident_market_daypart_rollup amdr
  WHERE ($1 IS NULL OR amdr.city = LOWER(TRIM($1)))
    AND ($2 IS NULL OR amdr.state = UPPER(TRIM($2)))
  GROUP BY amdr.bucket, amdr.bucket_order
  ORDER BY amdr.bucket_order;
$$;
