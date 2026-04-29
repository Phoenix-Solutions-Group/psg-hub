CREATE TABLE IF NOT EXISTS crash_event_sources (
  id BIGSERIAL PRIMARY KEY,
  source_key TEXT NOT NULL,
  source_url TEXT NOT NULL,
  geography TEXT NOT NULL,
  source_year INTEGER NOT NULL,
  row_count INTEGER DEFAULT 0,
  status TEXT NOT NULL,
  import_batch_id TEXT NOT NULL,
  notes TEXT,
  imported_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(source_key, geography, source_year)
);

CREATE INDEX IF NOT EXISTS idx_crash_event_sources_year
  ON crash_event_sources(source_key, source_year DESC);

CREATE TABLE IF NOT EXISTS crash_events (
  id BIGSERIAL PRIMARY KEY,
  source TEXT NOT NULL,
  source_event_id TEXT NOT NULL,
  event_time TIMESTAMPTZ,
  reported_time TIMESTAMPTZ,
  state TEXT,
  city TEXT,
  latitude DOUBLE PRECISION,
  longitude DOUBLE PRECISION,
  location GEOGRAPHY(POINT, 4326),
  severity TEXT,
  fatalities INTEGER,
  injuries_total INTEGER,
  injuries_incapacitating INTEGER,
  vehicles_involved INTEGER,
  damage TEXT,
  weather_condition TEXT,
  roadway_surface_condition TEXT,
  collision_type TEXT,
  primary_contributory_cause TEXT,
  source_lag_days INTEGER,
  confidence_score NUMERIC DEFAULT 0,
  import_batch_id TEXT,
  imported_at TIMESTAMPTZ DEFAULT NOW(),
  raw_payload JSONB DEFAULT '{}'::jsonb,
  UNIQUE(source, source_event_id)
);

CREATE INDEX IF NOT EXISTS idx_crash_events_source_time ON crash_events(source, event_time);
CREATE INDEX IF NOT EXISTS idx_crash_events_state_city ON crash_events(state, city);
CREATE INDEX IF NOT EXISTS idx_crash_events_severity ON crash_events(severity);
CREATE INDEX IF NOT EXISTS idx_crash_events_location ON crash_events USING GIST(location)
  WHERE location IS NOT NULL;

CREATE TABLE IF NOT EXISTS crash_zip_annual (
  source TEXT NOT NULL,
  zip TEXT NOT NULL,
  state TEXT,
  city TEXT,
  year INTEGER NOT NULL,
  total_crashes INTEGER DEFAULT 0,
  fatal_crashes INTEGER DEFAULT 0,
  injury_crashes INTEGER DEFAULT 0,
  tow_or_injury_crashes INTEGER DEFAULT 0,
  property_damage_crashes INTEGER DEFAULT 0,
  weather_related_crashes INTEGER DEFAULT 0,
  weighted_crash_demand_score NUMERIC DEFAULT 0,
  unmatched_crash_count INTEGER DEFAULT 0,
  refreshed_at TIMESTAMPTZ DEFAULT NOW(),
  PRIMARY KEY (source, zip, year)
);

CREATE INDEX IF NOT EXISTS idx_crash_zip_annual_state_year
  ON crash_zip_annual(state, year);
CREATE INDEX IF NOT EXISTS idx_crash_zip_annual_demand
  ON crash_zip_annual(weighted_crash_demand_score DESC);

CREATE OR REPLACE VIEW v_collision_targeting_zip_annual AS
WITH shop_zip AS (
  SELECT
    zb.zip_code AS zip,
    COUNT(*) FILTER (WHERE points.layer = 'psg_customer') AS psg_customer_count,
    COUNT(*) FILTER (WHERE points.layer = 'directory_shop') AS directory_shop_count,
    COUNT(*) FILTER (
      WHERE points.layer = 'psg_customer'
        AND COALESCE(points.survey_count, 0) > 0
    ) AS surveyed_psg_customer_count
  FROM market_map_points(NULL, 40000) points
  JOIN zipcode_boundaries zb
    ON zb.boundary IS NOT NULL
   AND ST_Covers(
      zb.boundary,
      ST_SetSRID(ST_MakePoint(points.longitude, points.latitude), 4326)
    )
  GROUP BY zb.zip_code
),
storm_by_zip_year AS (
  SELECT
    zip,
    EXTRACT(YEAR FROM month)::integer AS year,
    SUM(total_events) AS storm_event_count,
    SUM(hail_events) AS hail_event_count,
    SUM(wind_events) AS wind_event_count,
    SUM(tornado_events) AS tornado_event_count,
    SUM(weighted_storm_demand_score) AS storm_demand_score
  FROM storm_zip_monthly
  WHERE zip <> '__UNMATCHED__'
  GROUP BY zip, EXTRACT(YEAR FROM month)::integer
)
SELECT
  cza.source,
  cza.zip,
  cza.state,
  cza.city,
  cza.year,
  cza.total_crashes,
  cza.fatal_crashes,
  cza.injury_crashes,
  cza.tow_or_injury_crashes,
  cza.property_damage_crashes,
  cza.weather_related_crashes,
  cza.weighted_crash_demand_score,
  COALESCE(szy.storm_event_count, 0) AS storm_event_count,
  COALESCE(szy.hail_event_count, 0) AS hail_event_count,
  COALESCE(szy.wind_event_count, 0) AS wind_event_count,
  COALESCE(szy.tornado_event_count, 0) AS tornado_event_count,
  COALESCE(szy.storm_demand_score, 0) AS storm_demand_score,
  COALESCE(sz.psg_customer_count, 0) AS psg_customer_count,
  COALESCE(sz.directory_shop_count, 0) AS directory_shop_count,
  COALESCE(sz.surveyed_psg_customer_count, 0) AS surveyed_psg_customer_count,
  ROUND(
    (
      cza.weighted_crash_demand_score
      + COALESCE(szy.storm_demand_score, 0) * 0.35
      + GREATEST(10 - COALESCE(sz.psg_customer_count, 0), 0) * 25
    )::numeric,
    2
  ) AS collision_targeting_score
FROM crash_zip_annual cza
LEFT JOIN storm_by_zip_year szy ON szy.zip = cza.zip AND szy.year = cza.year
LEFT JOIN shop_zip sz ON sz.zip = cza.zip
WHERE cza.zip <> '__UNMATCHED__';

DROP FUNCTION IF EXISTS collision_targeting_examples(TEXT, INTEGER, INTEGER);
CREATE OR REPLACE FUNCTION collision_targeting_examples(p_state TEXT DEFAULT NULL, p_year INTEGER DEFAULT NULL, result_limit INTEGER DEFAULT 25)
RETURNS TABLE(
  zip TEXT,
  state TEXT,
  city TEXT,
  year INTEGER,
  total_crashes INTEGER,
  injury_crashes INTEGER,
  weather_related_crashes INTEGER,
  storm_event_count NUMERIC,
  hail_event_count NUMERIC,
  wind_event_count NUMERIC,
  psg_customer_count BIGINT,
  directory_shop_count BIGINT,
  collision_targeting_score NUMERIC,
  example_detail TEXT
)
LANGUAGE sql
STABLE
AS $$
  SELECT
    zip,
    state,
    city,
    year,
    total_crashes,
    injury_crashes,
    weather_related_crashes,
    storm_event_count,
    hail_event_count,
    wind_event_count,
    psg_customer_count,
    directory_shop_count,
    collision_targeting_score,
    CONCAT(
      'ZIP ', zip, ' had ', total_crashes::text,
      ' official crash records in ', year::text,
      ', plus ', storm_event_count::text,
      ' storm events and ', psg_customer_count::text,
      ' mapped PSG customer shops.'
    ) AS example_detail
  FROM v_collision_targeting_zip_annual
  WHERE ($1 IS NULL OR UPPER(state) = UPPER($1))
    AND ($2 IS NULL OR year = $2)
  ORDER BY collision_targeting_score DESC, total_crashes DESC
  LIMIT GREATEST($3, 1);
$$;
