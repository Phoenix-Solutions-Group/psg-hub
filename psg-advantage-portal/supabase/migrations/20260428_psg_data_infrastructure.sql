-- PSG data infrastructure migration from BigQuery to Supabase.
-- Apply manually after reviewing against the target Supabase project.

CREATE EXTENSION IF NOT EXISTS postgis;
CREATE EXTENSION IF NOT EXISTS pg_trgm;

CREATE TABLE IF NOT EXISTS survey_responses (
  id BIGSERIAL PRIMARY KEY,
  shop_name TEXT NOT NULL,
  survey_date DATE NOT NULL,
  scale_emi_pct NUMERIC(7,6),
  q05_01 NUMERIC,
  q05_02 NUMERIC,
  q05_03 NUMERIC,
  q05_04 NUMERIC,
  text_customer_comments TEXT,
  source TEXT DEFAULT 'bigquery_migration',
  import_batch_id TEXT,
  imported_at TIMESTAMPTZ DEFAULT NOW(),
  created_at TIMESTAMPTZ DEFAULT NOW(),
  raw_payload JSONB DEFAULT '{}'::jsonb
);

CREATE INDEX IF NOT EXISTS idx_survey_shop_date ON survey_responses(shop_name, survey_date);
CREATE INDEX IF NOT EXISTS idx_survey_date ON survey_responses(survey_date);
CREATE INDEX IF NOT EXISTS idx_survey_comments_trgm
  ON survey_responses USING GIN (text_customer_comments gin_trgm_ops)
  WHERE text_customer_comments IS NOT NULL AND text_customer_comments <> '';

CREATE TABLE IF NOT EXISTS body_shops (
  shop_id TEXT PRIMARY KEY,
  shop_name TEXT NOT NULL,
  place_id TEXT UNIQUE,
  address TEXT,
  phone TEXT,
  website TEXT,
  rating NUMERIC,
  category TEXT,
  latitude DOUBLE PRECISION,
  longitude DOUBLE PRECISION,
  location GEOGRAPHY(POINT, 4326),
  source TEXT DEFAULT 'bigquery_migration',
  imported_at TIMESTAMPTZ DEFAULT NOW(),
  raw_payload JSONB DEFAULT '{}'::jsonb
);

CREATE INDEX IF NOT EXISTS idx_body_shops_name ON body_shops(shop_name);
CREATE INDEX IF NOT EXISTS idx_body_shops_location ON body_shops USING GIST(location);

CREATE TABLE IF NOT EXISTS state_references (
  state_fips TEXT PRIMARY KEY,
  state_abbr TEXT NOT NULL UNIQUE,
  state_name TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS county_references (
  county_fips TEXT PRIMARY KEY,
  state_abbr TEXT NOT NULL,
  county_name TEXT NOT NULL,
  state_fips TEXT REFERENCES state_references(state_fips)
);

CREATE TABLE IF NOT EXISTS zip_references (
  zip_code TEXT NOT NULL,
  state_fips TEXT REFERENCES state_references(state_fips),
  county_fips TEXT REFERENCES county_references(county_fips),
  PRIMARY KEY (zip_code, county_fips)
);

CREATE INDEX IF NOT EXISTS idx_zip_references_zip ON zip_references(zip_code);

CREATE TABLE IF NOT EXISTS zcta_zip_mapping (
  zip_code TEXT PRIMARY KEY,
  reporting_year INTEGER,
  zip_type TEXT,
  city_name TEXT,
  state_name TEXT,
  state_abbr TEXT,
  enc_zip TEXT,
  zcta TEXT
);

CREATE TABLE IF NOT EXISTS accidents (
  id TEXT,
  source TEXT,
  severity INTEGER,
  start_time TIMESTAMPTZ,
  end_time TIMESTAMPTZ,
  start_lat DOUBLE PRECISION,
  start_lng DOUBLE PRECISION,
  end_lat DOUBLE PRECISION,
  end_lng DOUBLE PRECISION,
  location GEOGRAPHY(POINT, 4326),
  distance_mi NUMERIC,
  description TEXT,
  street TEXT,
  city TEXT,
  county TEXT,
  state TEXT,
  zipcode TEXT,
  country TEXT,
  timezone TEXT,
  airport_code TEXT,
  weather_timestamp TIMESTAMPTZ,
  temperature_f NUMERIC,
  wind_chill_f NUMERIC,
  humidity_pct NUMERIC,
  pressure_in NUMERIC,
  visibility_mi NUMERIC,
  wind_direction TEXT,
  wind_speed_mph NUMERIC,
  precipitation_in NUMERIC,
  weather_condition TEXT,
  amenity BOOLEAN,
  bump BOOLEAN,
  crossing BOOLEAN,
  give_way BOOLEAN,
  junction BOOLEAN,
  no_exit BOOLEAN,
  railway BOOLEAN,
  roundabout BOOLEAN,
  station BOOLEAN,
  stop BOOLEAN,
  traffic_calming BOOLEAN,
  traffic_signal BOOLEAN,
  turning_loop BOOLEAN,
  sunrise_sunset TEXT,
  civil_twilight TEXT,
  nautical_twilight TEXT,
  astronomical_twilight TEXT,
  import_batch_id TEXT,
  imported_at TIMESTAMPTZ DEFAULT NOW(),
  raw_payload JSONB DEFAULT '{}'::jsonb
) PARTITION BY RANGE (start_time);

CREATE TABLE IF NOT EXISTS accidents_2016 PARTITION OF accidents FOR VALUES FROM ('2016-01-01') TO ('2017-01-01');
CREATE TABLE IF NOT EXISTS accidents_2017 PARTITION OF accidents FOR VALUES FROM ('2017-01-01') TO ('2018-01-01');
CREATE TABLE IF NOT EXISTS accidents_2018 PARTITION OF accidents FOR VALUES FROM ('2018-01-01') TO ('2019-01-01');
CREATE TABLE IF NOT EXISTS accidents_2019 PARTITION OF accidents FOR VALUES FROM ('2019-01-01') TO ('2020-01-01');
CREATE TABLE IF NOT EXISTS accidents_2020 PARTITION OF accidents FOR VALUES FROM ('2020-01-01') TO ('2021-01-01');
CREATE TABLE IF NOT EXISTS accidents_2021 PARTITION OF accidents FOR VALUES FROM ('2021-01-01') TO ('2022-01-01');
CREATE TABLE IF NOT EXISTS accidents_2022 PARTITION OF accidents FOR VALUES FROM ('2022-01-01') TO ('2023-01-01');
CREATE TABLE IF NOT EXISTS accidents_2023 PARTITION OF accidents FOR VALUES FROM ('2023-01-01') TO ('2024-01-01');
CREATE TABLE IF NOT EXISTS accidents_2024 PARTITION OF accidents FOR VALUES FROM ('2024-01-01') TO ('2025-01-01');
CREATE TABLE IF NOT EXISTS accidents_2025 PARTITION OF accidents FOR VALUES FROM ('2025-01-01') TO ('2026-01-01');
CREATE TABLE IF NOT EXISTS accidents_2026 PARTITION OF accidents FOR VALUES FROM ('2026-01-01') TO ('2027-01-01');
CREATE TABLE IF NOT EXISTS accidents_2027 PARTITION OF accidents FOR VALUES FROM ('2027-01-01') TO ('2028-01-01');
CREATE TABLE IF NOT EXISTS accidents_default PARTITION OF accidents DEFAULT;

CREATE INDEX IF NOT EXISTS idx_accidents_zip ON accidents(zipcode);
CREATE INDEX IF NOT EXISTS idx_accidents_state ON accidents(state);
CREATE INDEX IF NOT EXISTS idx_accidents_start_time ON accidents(start_time);
CREATE INDEX IF NOT EXISTS idx_accidents_severity ON accidents(severity);
CREATE INDEX IF NOT EXISTS idx_accidents_location ON accidents USING GIST(location);

CREATE TABLE IF NOT EXISTS zipcode_boundaries (
  zip_code TEXT PRIMARY KEY,
  state_fips TEXT,
  boundary GEOMETRY(MULTIPOLYGON, 4326),
  boundary_geojson JSONB,
  imported_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_boundaries_geo ON zipcode_boundaries USING GIST(boundary);

CREATE TABLE IF NOT EXISTS accident_density (
  zip TEXT NOT NULL,
  state TEXT,
  year INTEGER NOT NULL,
  severity_1_count INTEGER DEFAULT 0,
  severity_2_count INTEGER DEFAULT 0,
  severity_3_count INTEGER DEFAULT 0,
  severity_4_count INTEGER DEFAULT 0,
  total_count INTEGER DEFAULT 0,
  weather_related_count INTEGER DEFAULT 0,
  PRIMARY KEY (zip, year)
);

CREATE TABLE IF NOT EXISTS accident_import_sources (
  id BIGSERIAL PRIMARY KEY,
  source_key TEXT NOT NULL,
  hf_repo TEXT NOT NULL,
  hf_config TEXT NOT NULL,
  hf_split TEXT NOT NULL,
  expected_row_count INTEGER NOT NULL,
  expected_column_count INTEGER NOT NULL,
  license TEXT,
  status TEXT NOT NULL,
  import_batch_id TEXT NOT NULL,
  loaded_rows INTEGER DEFAULT 0,
  observed_existing_rows INTEGER,
  sample_overlap INTEGER,
  notes TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_accident_import_sources_created_at
  ON accident_import_sources(created_at DESC);

CREATE TABLE IF NOT EXISTS storm_events (
  id BIGSERIAL PRIMARY KEY,
  source TEXT NOT NULL DEFAULT 'ncei_storm_events',
  source_event_id BIGINT NOT NULL,
  episode_id BIGINT,
  event_type TEXT NOT NULL,
  event_type_normalized TEXT NOT NULL,
  begin_time TIMESTAMPTZ,
  end_time TIMESTAMPTZ,
  state TEXT,
  state_fips TEXT,
  source_year INTEGER,
  source_month INTEGER,
  month_name TEXT,
  cz_type TEXT,
  cz_fips TEXT,
  cz_name TEXT,
  wfo TEXT,
  magnitude NUMERIC,
  magnitude_type TEXT,
  injuries_direct INTEGER,
  injuries_indirect INTEGER,
  deaths_direct INTEGER,
  deaths_indirect INTEGER,
  damage_property_usd NUMERIC,
  damage_crops_usd NUMERIC,
  begin_lat DOUBLE PRECISION,
  begin_lng DOUBLE PRECISION,
  end_lat DOUBLE PRECISION,
  end_lng DOUBLE PRECISION,
  begin_location GEOGRAPHY(POINT, 4326),
  end_location GEOGRAPHY(POINT, 4326),
  repair_demand_weight NUMERIC NOT NULL DEFAULT 1,
  import_batch_id TEXT,
  imported_at TIMESTAMPTZ DEFAULT NOW(),
  raw_payload JSONB DEFAULT '{}'::jsonb,
  UNIQUE(source, source_event_id)
);

CREATE INDEX IF NOT EXISTS idx_storm_events_begin_time ON storm_events(begin_time);
CREATE INDEX IF NOT EXISTS idx_storm_events_state ON storm_events(state);
CREATE INDEX IF NOT EXISTS idx_storm_events_type ON storm_events(event_type_normalized);
CREATE INDEX IF NOT EXISTS idx_storm_events_source_event_id ON storm_events(source, source_event_id);
CREATE INDEX IF NOT EXISTS idx_storm_events_begin_location ON storm_events USING GIST(begin_location)
  WHERE begin_location IS NOT NULL;

CREATE TABLE IF NOT EXISTS storm_event_sources (
  id BIGSERIAL PRIMARY KEY,
  source_key TEXT NOT NULL,
  source_url TEXT NOT NULL,
  file_family TEXT NOT NULL,
  source_year INTEGER NOT NULL,
  cycle TEXT NOT NULL,
  file_url TEXT NOT NULL,
  row_count INTEGER DEFAULT 0,
  status TEXT NOT NULL,
  import_batch_id TEXT NOT NULL,
  notes TEXT,
  imported_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(source_key, file_family, source_year, cycle)
);

CREATE INDEX IF NOT EXISTS idx_storm_event_sources_year
  ON storm_event_sources(source_key, source_year DESC);
CREATE INDEX IF NOT EXISTS idx_storm_event_sources_imported_at
  ON storm_event_sources(imported_at DESC);

CREATE TABLE IF NOT EXISTS storm_zip_monthly (
  zip TEXT NOT NULL,
  month DATE NOT NULL,
  state TEXT,
  total_events INTEGER DEFAULT 0,
  hail_events INTEGER DEFAULT 0,
  wind_events INTEGER DEFAULT 0,
  tornado_events INTEGER DEFAULT 0,
  flood_events INTEGER DEFAULT 0,
  hurricane_tropical_events INTEGER DEFAULT 0,
  lightning_events INTEGER DEFAULT 0,
  winter_storm_events INTEGER DEFAULT 0,
  high_wind_events INTEGER DEFAULT 0,
  weighted_storm_demand_score NUMERIC DEFAULT 0,
  max_hail_size NUMERIC,
  max_wind_speed NUMERIC,
  property_damage_usd NUMERIC DEFAULT 0,
  unmatched_event_count INTEGER DEFAULT 0,
  fallback_event_count INTEGER DEFAULT 0,
  refreshed_at TIMESTAMPTZ DEFAULT NOW(),
  PRIMARY KEY (zip, month)
);

CREATE INDEX IF NOT EXISTS idx_storm_zip_monthly_month ON storm_zip_monthly(month);
CREATE INDEX IF NOT EXISTS idx_storm_zip_monthly_state_month ON storm_zip_monthly(state, month);
CREATE INDEX IF NOT EXISTS idx_storm_zip_monthly_demand
  ON storm_zip_monthly(weighted_storm_demand_score DESC);

CREATE OR REPLACE VIEW v_storm_demand_examples AS
SELECT
  szm.zip,
  szm.month,
  szm.state,
  szm.total_events,
  szm.hail_events,
  szm.wind_events,
  szm.tornado_events,
  szm.flood_events,
  szm.high_wind_events,
  szm.weighted_storm_demand_score,
  szm.max_hail_size,
  szm.max_wind_speed,
  szm.property_damage_usd,
  CASE
    WHEN szm.hail_events >= GREATEST(szm.wind_events, szm.tornado_events, szm.flood_events) THEN 'hail'
    WHEN szm.wind_events >= GREATEST(szm.hail_events, szm.tornado_events, szm.flood_events) THEN 'damaging wind'
    WHEN szm.tornado_events > 0 THEN 'tornado'
    WHEN szm.flood_events > 0 THEN 'flood'
    ELSE 'storm activity'
  END AS primary_demand_signal,
  CONCAT(
    'ZIP ', szm.zip, ' had ', szm.total_events::text,
    ' NOAA storm events in ', TO_CHAR(szm.month, 'Mon YYYY'),
    ', including ', szm.hail_events::text, ' hail, ',
    szm.wind_events::text, ' wind, and ',
    szm.tornado_events::text, ' tornado events.'
  ) AS example_detail
FROM storm_zip_monthly szm
WHERE szm.zip <> '__UNMATCHED__'
  AND szm.total_events > 0;

CREATE OR REPLACE FUNCTION storm_demand_examples(example_year INTEGER DEFAULT NULL, result_limit INTEGER DEFAULT 25)
RETURNS TABLE(
  zip TEXT,
  month DATE,
  state TEXT,
  total_events INTEGER,
  hail_events INTEGER,
  wind_events INTEGER,
  tornado_events INTEGER,
  weighted_storm_demand_score NUMERIC,
  max_hail_size NUMERIC,
  max_wind_speed NUMERIC,
  primary_demand_signal TEXT,
  example_detail TEXT
)
LANGUAGE sql
STABLE
AS $$
  SELECT
    zip,
    month,
    state,
    total_events,
    hail_events,
    wind_events,
    tornado_events,
    weighted_storm_demand_score,
    max_hail_size,
    max_wind_speed,
    primary_demand_signal,
    example_detail
  FROM v_storm_demand_examples
  WHERE ($1 IS NULL OR EXTRACT(YEAR FROM month)::integer = $1)
  ORDER BY weighted_storm_demand_score DESC, total_events DESC
  LIMIT GREATEST($2, 1);
$$;

ALTER TABLE survey_responses ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS survey_responses_admin_all ON survey_responses;
CREATE POLICY survey_responses_admin_all ON survey_responses
  FOR ALL
  USING (
    EXISTS (
      SELECT 1
      FROM portal_users
      WHERE portal_users.id = auth.uid()
        AND portal_users.role = 'psg_admin'
    )
  );

DROP POLICY IF EXISTS survey_responses_shop_owner_select ON survey_responses;
CREATE POLICY survey_responses_shop_owner_select ON survey_responses
  FOR SELECT
  USING (
    shop_name = (
      SELECT portal_users.shop_id
      FROM portal_users
      WHERE portal_users.id = auth.uid()
    )
  );

CREATE OR REPLACE FUNCTION health_check()
RETURNS TABLE(test INTEGER)
LANGUAGE sql
STABLE
AS $$
  SELECT 1 AS test;
$$;

CREATE OR REPLACE FUNCTION network_summary(start_date DATE, end_date DATE)
RETURNS TABLE(total_surveys BIGINT, avg_emi_pct NUMERIC, active_shops BIGINT, alert_count BIGINT)
LANGUAGE sql
STABLE
AS $$
  SELECT
    COUNT(*) AS total_surveys,
    COALESCE(ROUND(AVG(scale_emi_pct) * 100, 1), 0) AS avg_emi_pct,
    COUNT(DISTINCT shop_name) AS active_shops,
    (
      SELECT COUNT(*)
      FROM (
        SELECT s2.shop_name
        FROM survey_responses s2
        WHERE s2.survey_date BETWEEN $1 AND $2
        GROUP BY s2.shop_name
        HAVING ROUND(AVG(s2.scale_emi_pct) * 100, 1) < 88
      ) alerts
    ) AS alert_count
  FROM survey_responses
  WHERE survey_date BETWEEN $1 AND $2;
$$;

CREATE OR REPLACE FUNCTION network_trend(months INTEGER DEFAULT 24)
RETURNS TABLE(month TEXT, surveys BIGINT, avg_emi_pct NUMERIC)
LANGUAGE sql
STABLE
AS $$
  SELECT *
  FROM (
    SELECT
      TO_CHAR(DATE_TRUNC('month', survey_date), 'YYYY-MM') AS month,
      COUNT(*) AS surveys,
      ROUND(AVG(scale_emi_pct) * 100, 1) AS avg_emi_pct
    FROM survey_responses
    GROUP BY DATE_TRUNC('month', survey_date)
    ORDER BY DATE_TRUNC('month', survey_date) DESC
    LIMIT GREATEST($1, 1)
  ) recent_months
  ORDER BY month ASC;
$$;

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
      COUNT(*) AS total_surveys,
      ROUND(AVG(sr.scale_emi_pct) * 100, 1) AS avg_emi_pct,
      MAX(sr.survey_date) AS latest_survey_date
    FROM survey_responses sr
    WHERE sr.survey_date BETWEEN $1 AND $2
    GROUP BY sr.shop_name
  )
  SELECT
    COALESCE(sm.shop_name, s.shop_name) AS shop_name,
    COALESCE(sm.total_surveys, 0) AS total_surveys,
    COALESCE(sm.avg_emi_pct, 0) AS avg_emi_pct,
    sm.latest_survey_date,
    s.place_id,
    s.address,
    s.phone,
    s.website,
    s.rating,
    s.category,
    s.latitude,
    s.longitude
  FROM body_shops s
  FULL OUTER JOIN survey_metrics sm ON LOWER(REGEXP_REPLACE(s.shop_name, '[^a-z0-9]', '', 'g')) = LOWER(REGEXP_REPLACE(sm.shop_name, '[^a-z0-9]', '', 'g'))
  ORDER BY COALESCE(sm.total_surveys, 0) DESC, COALESCE(sm.avg_emi_pct, 0) DESC, COALESCE(s.rating, 0) DESC
  LIMIT 500;
$$;

CREATE OR REPLACE FUNCTION network_alerts(threshold NUMERIC DEFAULT 88, months INTEGER DEFAULT 3)
RETURNS TABLE(shop_name TEXT, avg_emi_pct NUMERIC, total_surveys BIGINT, months_below INTEGER)
LANGUAGE sql
STABLE
AS $$
  SELECT
    sr.shop_name,
    ROUND(AVG(sr.scale_emi_pct) * 100, 1) AS avg_emi_pct,
    COUNT(*) AS total_surveys,
    $2 AS months_below
  FROM survey_responses sr
  WHERE sr.survey_date >= CURRENT_DATE - ($2 || ' months')::interval
  GROUP BY sr.shop_name
  HAVING ROUND(AVG(sr.scale_emi_pct) * 100, 1) < $1
  ORDER BY avg_emi_pct ASC;
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
  network_avg_communication NUMERIC
)
LANGUAGE sql
STABLE
AS $$
  SELECT
    sr.shop_name,
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
    ) AS network_avg_communication
  FROM survey_responses sr
  WHERE sr.shop_name = $1
    AND sr.survey_date BETWEEN $2 AND $3
  GROUP BY sr.shop_name;
$$;

CREATE OR REPLACE FUNCTION shop_trend(shop_name TEXT)
RETURNS TABLE(month TEXT, avg_emi_pct NUMERIC, surveys BIGINT)
LANGUAGE sql
STABLE
AS $$
  SELECT
    TO_CHAR(DATE_TRUNC('month', survey_date), 'YYYY-MM') AS month,
    ROUND(AVG(scale_emi_pct) * 100, 1) AS avg_emi_pct,
    COUNT(*) AS surveys
  FROM survey_responses
  WHERE survey_responses.shop_name = $1
  GROUP BY DATE_TRUNC('month', survey_date)
  ORDER BY month ASC;
$$;

CREATE OR REPLACE FUNCTION shop_comments(shop_name TEXT, search TEXT DEFAULT NULL, result_limit INTEGER DEFAULT 20, result_offset INTEGER DEFAULT 0)
RETURNS TABLE(survey_date DATE, comment_text TEXT, scale_emi_pct NUMERIC)
LANGUAGE sql
STABLE
AS $$
  SELECT
    sr.survey_date,
    sr.text_customer_comments AS comment_text,
    ROUND(sr.scale_emi_pct * 100, 1) AS scale_emi_pct
  FROM survey_responses sr
  WHERE sr.shop_name = $1
    AND sr.text_customer_comments IS NOT NULL
    AND sr.text_customer_comments <> ''
    AND ($2 IS NULL OR sr.text_customer_comments ILIKE '%' || $2 || '%')
  ORDER BY sr.survey_date DESC
  LIMIT GREATEST($3, 1)
  OFFSET GREATEST($4, 0);
$$;

CREATE OR REPLACE FUNCTION shop_comments_count(shop_name TEXT, search TEXT DEFAULT NULL)
RETURNS TABLE(total BIGINT)
LANGUAGE sql
STABLE
AS $$
  SELECT COUNT(*) AS total
  FROM survey_responses sr
  WHERE sr.shop_name = $1
    AND sr.text_customer_comments IS NOT NULL
    AND sr.text_customer_comments <> ''
    AND ($2 IS NULL OR sr.text_customer_comments ILIKE '%' || $2 || '%');
$$;

DROP FUNCTION IF EXISTS marketing_metadata(TEXT, TEXT);
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
      COUNT(*) AS row_count,
      COUNT(*) FILTER (
        WHERE LOWER(COALESCE(weather_condition, '')) ~ 'rain|snow|storm|hail|sleet|fog|thunder'
          OR COALESCE(precipitation_in, 0) > 0
      ) AS weather_related_count,
      ROUND((COUNT(*) FILTER (WHERE severity IN (3, 4)))::numeric / NULLIF(COUNT(*), 0) * 100, 1) AS severe_accident_rate,
      ROUND((COUNT(*) FILTER (
        WHERE LOWER(COALESCE(weather_condition, '')) ~ 'rain|snow|storm|hail|sleet|fog|thunder'
          OR COALESCE(precipitation_in, 0) > 0
      ))::numeric / NULLIF(COUNT(*), 0) * 100, 1) AS weather_related_rate,
      ROUND(AVG(distance_mi), 2) AS average_distance_miles
    FROM accidents a
    WHERE ($1 IS NULL OR LOWER(a.city) = LOWER($1))
      AND ($2 IS NULL OR UPPER(a.state) = UPPER($2))
  ),
  zip_scope AS (
    SELECT DISTINCT a.zipcode AS zip
    FROM accidents a
    WHERE NOT ($1 IS NULL AND $2 IS NULL)
      AND ($1 IS NULL OR LOWER(a.city) = LOWER($1))
      AND ($2 IS NULL OR UPPER(a.state) = UPPER($2))
      AND a.zipcode IS NOT NULL
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
    a.severe_accident_rate,
    a.weather_related_rate,
    a.average_distance_miles,
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
    a.severe_accident_rate,
    a.weather_related_rate,
    a.average_distance_miles;
$$;

DROP FUNCTION IF EXISTS marketing_top_zips(TEXT, TEXT);
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
    SELECT a.zipcode AS zip, COUNT(*) AS accidents
    FROM accidents a
    WHERE ($1 IS NULL OR LOWER(a.city) = LOWER($1))
      AND ($2 IS NULL OR UPPER(a.state) = UPPER($2))
      AND a.zipcode IS NOT NULL
    GROUP BY a.zipcode
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
       OR szm.zip IN (SELECT zip FROM accident_counts)
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
  WITH buckets AS (
    SELECT
      CASE
        WHEN EXTRACT(HOUR FROM start_time) BETWEEN 0 AND 2 THEN '12a'
        WHEN EXTRACT(HOUR FROM start_time) BETWEEN 3 AND 5 THEN '3a'
        WHEN EXTRACT(HOUR FROM start_time) BETWEEN 6 AND 8 THEN '6a'
        WHEN EXTRACT(HOUR FROM start_time) BETWEEN 9 AND 11 THEN '9a'
        WHEN EXTRACT(HOUR FROM start_time) BETWEEN 12 AND 14 THEN '12p'
        WHEN EXTRACT(HOUR FROM start_time) BETWEEN 15 AND 17 THEN '3p'
        WHEN EXTRACT(HOUR FROM start_time) BETWEEN 18 AND 20 THEN '6p'
        ELSE '9p'
      END AS bucket
    FROM accidents a
    WHERE ($1 IS NULL OR LOWER(a.city) = LOWER($1))
      AND ($2 IS NULL OR UPPER(a.state) = UPPER($2))
      AND a.start_time IS NOT NULL
  )
  SELECT
    bucket AS "time",
    COUNT(*) AS claims
  FROM buckets
  GROUP BY bucket
  ORDER BY CASE bucket
    WHEN '12a' THEN 0
    WHEN '3a' THEN 1
    WHEN '6a' THEN 2
    WHEN '9a' THEN 3
    WHEN '12p' THEN 4
    WHEN '3p' THEN 5
    WHEN '6p' THEN 6
    ELSE 7
  END;
$$;

CREATE OR REPLACE VIEW v_market_opportunity AS
WITH storm_by_zip AS (
  SELECT
    zip,
    SUM(weighted_storm_demand_score) AS storm_demand_score
  FROM storm_zip_monthly
  GROUP BY zip
),
base AS (
  SELECT
    d.zip,
    d.state,
    SUM(d.total_count) AS total_accidents,
    SUM(d.severity_3_count + d.severity_4_count) AS high_severity_count,
    (SUM(d.severity_3_count + d.severity_4_count))::numeric / NULLIF(SUM(d.total_count), 0) AS high_severity_pct,
    COALESCE(MAX(sbz.storm_demand_score), 0) AS storm_demand_score
  FROM accident_density d
  LEFT JOIN storm_by_zip sbz ON sbz.zip = d.zip
  GROUP BY d.zip, d.state
),
scored AS (
  SELECT
    *,
    ROUND(
      (
        PERCENT_RANK() OVER (ORDER BY total_accidents) * 55
        + PERCENT_RANK() OVER (ORDER BY high_severity_pct) * 25
        + PERCENT_RANK() OVER (ORDER BY storm_demand_score) * 20
      )::numeric,
      1
    ) AS opportunity_score
  FROM base
)
SELECT
  zip,
  state,
  total_accidents,
  high_severity_count,
  high_severity_pct,
  NULL::double precision AS nearest_shop_meters,
  opportunity_score,
  CASE
    WHEN opportunity_score >= 75 THEN 'High'
    WHEN opportunity_score >= 40 THEN 'Medium'
    ELSE 'Low'
  END AS opportunity_tier
FROM scored;

CREATE OR REPLACE VIEW v_shop_coverage AS
WITH accident_counts AS (
  SELECT
    s.shop_id,
    COUNT(a.*) AS accidents_within_10mi
  FROM body_shops s
  LEFT JOIN accidents a
    ON s.location IS NOT NULL
   AND a.location IS NOT NULL
   AND ST_DWithin(s.location, a.location, 16093.4)
  GROUP BY s.shop_id
),
competitor_counts AS (
  SELECT
    s1.shop_id,
    COUNT(DISTINCT s2.shop_id) AS competing_shops_within_10mi
  FROM body_shops s1
  LEFT JOIN body_shops s2
    ON s1.shop_id <> s2.shop_id
   AND s1.location IS NOT NULL
   AND s2.location IS NOT NULL
   AND ST_DWithin(s1.location, s2.location, 16093.4)
  GROUP BY s1.shop_id
)
SELECT
  s.shop_id,
  s.shop_name,
  COALESCE(ac.accidents_within_10mi, 0) AS accidents_within_10mi,
  COALESCE(cc.competing_shops_within_10mi, 0) AS competing_shops_within_10mi
FROM body_shops s
LEFT JOIN accident_counts ac ON s.shop_id = ac.shop_id
LEFT JOIN competitor_counts cc ON s.shop_id = cc.shop_id
WHERE s.location IS NOT NULL;

CREATE OR REPLACE VIEW v_accident_trends_by_zip AS
WITH yearly AS (
  SELECT
    zipcode AS zip,
    state,
    EXTRACT(YEAR FROM start_time)::integer AS year,
    COUNT(*) AS accident_count,
    COUNT(*) FILTER (WHERE severity >= 3) AS high_severity_count,
    ROUND(AVG(severity)::numeric, 2) AS avg_severity
  FROM accidents
  WHERE zipcode IS NOT NULL AND start_time IS NOT NULL
  GROUP BY zipcode, state, EXTRACT(YEAR FROM start_time)
)
SELECT
  zip,
  state,
  year,
  accident_count,
  high_severity_count,
  avg_severity,
  LAG(accident_count) OVER (PARTITION BY zip ORDER BY year) AS prev_year_count,
  ROUND(
    (accident_count - LAG(accident_count) OVER (PARTITION BY zip ORDER BY year))::numeric
    / NULLIF(LAG(accident_count) OVER (PARTITION BY zip ORDER BY year), 0) * 100,
    1
  ) AS yoy_change_pct
FROM yearly;
