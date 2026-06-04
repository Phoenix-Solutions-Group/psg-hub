


SET statement_timeout = 0;
SET lock_timeout = 0;
SET idle_in_transaction_session_timeout = 0;
SET client_encoding = 'UTF8';
SET standard_conforming_strings = on;
SELECT pg_catalog.set_config('search_path', '', false);
SET check_function_bodies = false;
SET xmloption = content;
SET client_min_messages = warning;
SET row_security = off;


CREATE SCHEMA IF NOT EXISTS "bigquery_raw";


ALTER SCHEMA "bigquery_raw" OWNER TO "postgres";


COMMENT ON SCHEMA "public" IS 'standard public schema';



CREATE SCHEMA IF NOT EXISTS "sensitive";


ALTER SCHEMA "sensitive" OWNER TO "postgres";


COMMENT ON SCHEMA "sensitive" IS 'Private PSG PII schema. Not intended for browser-facing Supabase clients.';



CREATE SCHEMA IF NOT EXISTS "vecs";


ALTER SCHEMA "vecs" OWNER TO "postgres";


CREATE EXTENSION IF NOT EXISTS "pg_stat_statements" WITH SCHEMA "extensions";






CREATE EXTENSION IF NOT EXISTS "pg_trgm" WITH SCHEMA "public";






CREATE EXTENSION IF NOT EXISTS "pgcrypto" WITH SCHEMA "extensions";






CREATE EXTENSION IF NOT EXISTS "postgis" WITH SCHEMA "public";






CREATE EXTENSION IF NOT EXISTS "supabase_vault" WITH SCHEMA "vault";






CREATE EXTENSION IF NOT EXISTS "uuid-ossp" WITH SCHEMA "extensions";






CREATE EXTENSION IF NOT EXISTS "vector" WITH SCHEMA "extensions";






CREATE EXTENSION IF NOT EXISTS "wrappers" WITH SCHEMA "extensions";






CREATE OR REPLACE FUNCTION "public"."collision_targeting_examples"("p_state" "text" DEFAULT NULL::"text", "p_year" integer DEFAULT NULL::integer, "result_limit" integer DEFAULT 25) RETURNS TABLE("zip" "text", "state" "text", "city" "text", "year" integer, "total_crashes" integer, "injury_crashes" integer, "weather_related_crashes" integer, "storm_event_count" numeric, "hail_event_count" numeric, "wind_event_count" numeric, "psg_customer_count" bigint, "directory_shop_count" bigint, "collision_targeting_score" numeric, "example_detail" "text")
    LANGUAGE "sql" STABLE
    AS $_$
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
$_$;


ALTER FUNCTION "public"."collision_targeting_examples"("p_state" "text", "p_year" integer, "result_limit" integer) OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."google_profile_shop_name_key"("p_name" "text") RETURNS "text"
    LANGUAGE "sql" IMMUTABLE
    AS $$
  SELECT normalize_shop_name_key(REGEXP_REPLACE(COALESCE(p_name, ''), '\s+-\s+', ' of ', 'g'));
$$;


ALTER FUNCTION "public"."google_profile_shop_name_key"("p_name" "text") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."handle_new_user"() RETURNS "trigger"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
BEGIN
  INSERT INTO public.profiles (id, display_name)
  VALUES (NEW.id, COALESCE(NEW.raw_user_meta_data->>'display_name', NEW.email));
  RETURN NEW;
END;
$$;


ALTER FUNCTION "public"."handle_new_user"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."health_check"() RETURNS TABLE("test" integer)
    LANGUAGE "sql" STABLE
    AS $$
  SELECT 1 AS test;
$$;


ALTER FUNCTION "public"."health_check"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."market_map_payload"("p_state" "text" DEFAULT NULL::"text", "p_directory_limit" integer DEFAULT 40000) RETURNS TABLE("payload" "jsonb")
    LANGUAGE "sql" STABLE
    AS $$
  WITH points AS MATERIALIZED (
    SELECT *
    FROM market_map_points(p_state, p_directory_limit)
  ),
  point_payload AS (
    SELECT COALESCE(
      JSONB_AGG(
        JSONB_BUILD_OBJECT(
          'layer', layer,
          'id', id,
          'shop_name', shop_name,
          'psg_id', psg_id,
          'invoiced_id', invoiced_id,
          'place_id', place_id,
          'address', address,
          'phone', phone,
          'website', website,
          'rating', rating,
          'latitude', latitude,
          'longitude', longitude,
          'state', state,
          'city', city,
          'survey_count', survey_count,
          'avg_emi_pct', avg_emi_pct,
          'match_status', match_status
        )
        ORDER BY CASE WHEN layer = 'psg_customer' THEN 0 ELSE 1 END, shop_name
      ),
      '[]'::jsonb
    ) AS points
    FROM points
  ),
  state_payload AS (
    SELECT COALESCE(JSONB_AGG(state ORDER BY state), '[]'::jsonb) AS states
    FROM (
      SELECT DISTINCT state
      FROM points
      WHERE state IS NOT NULL
    ) states
  ),
  summary_payload AS (
    SELECT
      COUNT(*) FILTER (WHERE layer = 'psg_customer') AS psg_customers,
      COUNT(*) FILTER (WHERE layer = 'directory_shop') AS directory_shops,
      COUNT(*) FILTER (
        WHERE layer = 'psg_customer'
          AND COALESCE(survey_count, 0) > 0
      ) AS surveyed_psg_customers
    FROM points
  )
  SELECT JSONB_BUILD_OBJECT(
    'points', point_payload.points,
    'summary', JSONB_BUILD_OBJECT(
      'psg_customers', summary_payload.psg_customers,
      'directory_shops', summary_payload.directory_shops,
      'surveyed_psg_customers', summary_payload.surveyed_psg_customers,
      'states', state_payload.states
    )
  ) AS payload
  FROM point_payload
  CROSS JOIN state_payload
  CROSS JOIN summary_payload;
$$;


ALTER FUNCTION "public"."market_map_payload"("p_state" "text", "p_directory_limit" integer) OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."market_map_points"("p_state" "text" DEFAULT NULL::"text", "p_directory_limit" integer DEFAULT 40000) RETURNS TABLE("layer" "text", "id" "text", "shop_name" "text", "psg_id" "text", "invoiced_id" bigint, "place_id" "text", "address" "text", "phone" "text", "website" "text", "rating" numeric, "latitude" double precision, "longitude" double precision, "state" "text", "city" "text", "survey_count" bigint, "avg_emi_pct" numeric, "match_status" "text")
    LANGUAGE "sql" STABLE
    AS $_$
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
$_$;


ALTER FUNCTION "public"."market_map_points"("p_state" "text", "p_directory_limit" integer) OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."market_map_search"("p_query" "text", "p_limit" integer DEFAULT 20) RETURNS TABLE("layer" "text", "id" "text", "shop_name" "text", "psg_id" "text", "invoiced_id" bigint, "place_id" "text", "address" "text", "phone" "text", "website" "text", "rating" numeric, "latitude" double precision, "longitude" double precision, "state" "text", "city" "text", "survey_count" bigint, "avg_emi_pct" numeric, "match_status" "text")
    LANGUAGE "sql" STABLE
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


ALTER FUNCTION "public"."market_map_search"("p_query" "text", "p_limit" integer) OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."market_state_rollup"() RETURNS TABLE("state" "text", "total_accidents" bigint, "high_severity_count" bigint, "weather_related_count" bigint, "zip_count" bigint, "severe_rate" numeric, "weather_rate" numeric, "opportunity_score" numeric)
    LANGUAGE "sql" STABLE
    AS $$
  WITH base AS (
    SELECT
      d.state,
      COUNT(DISTINCT d.zip) AS zip_count,
      SUM(d.total_count)::bigint AS total_accidents,
      SUM(d.severity_3_count + d.severity_4_count)::bigint AS high_severity_count,
      SUM(d.weather_related_count)::bigint AS weather_related_count
    FROM accident_density d
    WHERE d.state IS NOT NULL
    GROUP BY d.state
  ),
  scored AS (
    SELECT
      *,
      ROUND(high_severity_count::numeric / NULLIF(total_accidents, 0) * 100, 1) AS severe_rate,
      ROUND(weather_related_count::numeric / NULLIF(total_accidents, 0) * 100, 1) AS weather_rate,
      ROUND(
        (
          PERCENT_RANK() OVER (ORDER BY total_accidents) * 55
          + PERCENT_RANK() OVER (
              ORDER BY high_severity_count::numeric / NULLIF(total_accidents, 0)
            ) * 30
          + PERCENT_RANK() OVER (
              ORDER BY weather_related_count::numeric / NULLIF(total_accidents, 0)
            ) * 15
        )::numeric,
        1
      ) AS opportunity_score
    FROM base
  )
  SELECT
    scored.state,
    scored.total_accidents,
    scored.high_severity_count,
    scored.weather_related_count,
    scored.zip_count,
    scored.severe_rate,
    scored.weather_rate,
    scored.opportunity_score
  FROM scored
  ORDER BY scored.opportunity_score DESC, scored.total_accidents DESC;
$$;


ALTER FUNCTION "public"."market_state_rollup"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."market_viewport_intelligence"("p_west" double precision, "p_south" double precision, "p_east" double precision, "p_north" double precision, "p_zoom" double precision DEFAULT NULL::double precision, "result_limit" integer DEFAULT 8) RETURNS TABLE("viewport_label" "text", "zoom" double precision, "psg_customer_count" bigint, "directory_shop_count" bigint, "surveyed_psg_customer_count" bigint, "crash_count" numeric, "injury_crash_count" numeric, "weather_related_crash_count" numeric, "storm_event_count" numeric, "hail_event_count" numeric, "wind_event_count" numeric, "storm_demand_score" numeric, "top_zips" "jsonb", "top_customers" "jsonb")
    LANGUAGE "sql" STABLE
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


ALTER FUNCTION "public"."market_viewport_intelligence"("p_west" double precision, "p_south" double precision, "p_east" double precision, "p_north" double precision, "p_zoom" double precision, "result_limit" integer) OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."marketing_daypart"("city" "text" DEFAULT NULL::"text", "state" "text" DEFAULT NULL::"text") RETURNS TABLE("time" "text", "claims" bigint)
    LANGUAGE "sql" STABLE
    AS $_$
  SELECT
    amdr.bucket AS "time",
    SUM(amdr.claims)::bigint AS claims
  FROM accident_market_daypart_rollup amdr
  WHERE ($1 IS NULL OR amdr.city = LOWER(TRIM($1)))
    AND ($2 IS NULL OR amdr.state = UPPER(TRIM($2)))
  GROUP BY amdr.bucket, amdr.bucket_order
  ORDER BY amdr.bucket_order;
$_$;


ALTER FUNCTION "public"."marketing_daypart"("city" "text", "state" "text") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."marketing_metadata"("city" "text" DEFAULT NULL::"text", "state" "text" DEFAULT NULL::"text") RETURNS TABLE("row_count" bigint, "weather_related_count" bigint, "severe_accident_rate" numeric, "weather_related_rate" numeric, "average_distance_miles" numeric, "storm_event_count" bigint, "hail_event_count" bigint, "wind_event_count" bigint, "tornado_event_count" bigint, "storm_demand_score" numeric, "max_hail_size" numeric, "max_wind_speed" numeric)
    LANGUAGE "sql" STABLE
    AS $_$
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
$_$;


ALTER FUNCTION "public"."marketing_metadata"("city" "text", "state" "text") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."marketing_top_zips"("city" "text" DEFAULT NULL::"text", "state" "text" DEFAULT NULL::"text") RETURNS TABLE("zip" "text", "accidents" bigint, "storm_event_count" bigint, "hail_event_count" bigint, "wind_event_count" bigint, "tornado_event_count" bigint, "storm_demand_score" numeric)
    LANGUAGE "sql" STABLE
    AS $_$
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
$_$;


ALTER FUNCTION "public"."marketing_top_zips"("city" "text", "state" "text") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."match_knowledge_chunks"("query_embedding" "extensions"."vector", "match_threshold" double precision DEFAULT 0.7, "match_count" integer DEFAULT 10) RETURNS TABLE("id" "uuid", "doc_id" "text", "chunk_index" integer, "content" "text", "metadata" "jsonb", "similarity" double precision)
    LANGUAGE "plpgsql"
    AS $$
BEGIN
  RETURN QUERY
  SELECT
    c.id,
    c.doc_id,
    c.chunk_index,
    c.content,
    c.metadata,
    1 - (c.embedding <=> query_embedding) AS similarity
  FROM public.psg_knowledge_chunks c
  WHERE 1 - (c.embedding <=> query_embedding) > match_threshold
  ORDER BY c.embedding <=> query_embedding
  LIMIT match_count;
END;
$$;


ALTER FUNCTION "public"."match_knowledge_chunks"("query_embedding" "extensions"."vector", "match_threshold" double precision, "match_count" integer) OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."network_alerts"("threshold" numeric DEFAULT 88, "months" integer DEFAULT 3) RETURNS TABLE("shop_name" "text", "avg_emi_pct" numeric, "total_surveys" bigint, "months_below" integer)
    LANGUAGE "sql" STABLE
    AS $_$
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
$_$;


ALTER FUNCTION "public"."network_alerts"("threshold" numeric, "months" integer) OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."network_summary"("start_date" "date", "end_date" "date") RETURNS TABLE("total_surveys" bigint, "avg_emi_pct" numeric, "active_shops" bigint, "alert_count" bigint)
    LANGUAGE "sql" STABLE
    AS $_$
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
$_$;


ALTER FUNCTION "public"."network_summary"("start_date" "date", "end_date" "date") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."network_trend"("months" integer DEFAULT 24) RETURNS TABLE("month" "text", "surveys" bigint, "avg_emi_pct" numeric)
    LANGUAGE "sql" STABLE
    AS $_$
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
$_$;


ALTER FUNCTION "public"."network_trend"("months" integer) OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."normalize_shop_name_key"("p_name" "text") RETURNS "text"
    LANGUAGE "sql" IMMUTABLE
    AS $$
  SELECT REGEXP_REPLACE(LOWER(COALESCE(p_name, '')), '[^a-z0-9]', '', 'g');
$$;


ALTER FUNCTION "public"."normalize_shop_name_key"("p_name" "text") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."refresh_accident_market_rollups"() RETURNS "void"
    LANGUAGE "plpgsql"
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


ALTER FUNCTION "public"."refresh_accident_market_rollups"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."refresh_market_map_point_cache"() RETURNS bigint
    LANGUAGE "plpgsql"
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


ALTER FUNCTION "public"."refresh_market_map_point_cache"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."refresh_market_zip_latest_signal"() RETURNS bigint
    LANGUAGE "plpgsql"
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


ALTER FUNCTION "public"."refresh_market_zip_latest_signal"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."rls_auto_enable"() RETURNS "event_trigger"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'pg_catalog'
    AS $$
DECLARE
  cmd record;
BEGIN
  FOR cmd IN
    SELECT *
    FROM pg_event_trigger_ddl_commands()
    WHERE command_tag IN ('CREATE TABLE', 'CREATE TABLE AS', 'SELECT INTO')
      AND object_type IN ('table','partitioned table')
  LOOP
     IF cmd.schema_name IS NOT NULL AND cmd.schema_name IN ('public') AND cmd.schema_name NOT IN ('pg_catalog','information_schema') AND cmd.schema_name NOT LIKE 'pg_toast%' AND cmd.schema_name NOT LIKE 'pg_temp%' THEN
      BEGIN
        EXECUTE format('alter table if exists %s enable row level security', cmd.object_identity);
        RAISE LOG 'rls_auto_enable: enabled RLS on %', cmd.object_identity;
      EXCEPTION
        WHEN OTHERS THEN
          RAISE LOG 'rls_auto_enable: failed to enable RLS on %', cmd.object_identity;
      END;
     ELSE
        RAISE LOG 'rls_auto_enable: skip % (either system schema or not in enforced list: %.)', cmd.object_identity, cmd.schema_name;
     END IF;
  END LOOP;
END;
$$;


ALTER FUNCTION "public"."rls_auto_enable"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."set_updated_at"() RETURNS "trigger"
    LANGUAGE "plpgsql"
    AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$;


ALTER FUNCTION "public"."set_updated_at"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."shop_comments"("shop_name" "text", "search" "text" DEFAULT NULL::"text", "result_limit" integer DEFAULT 20, "result_offset" integer DEFAULT 0) RETURNS TABLE("survey_date" "date", "comment_text" "text", "scale_emi_pct" numeric)
    LANGUAGE "sql" STABLE
    AS $_$
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
$_$;


ALTER FUNCTION "public"."shop_comments"("shop_name" "text", "search" "text", "result_limit" integer, "result_offset" integer) OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."shop_comments_count"("shop_name" "text", "search" "text" DEFAULT NULL::"text") RETURNS TABLE("total" bigint)
    LANGUAGE "sql" STABLE
    AS $_$
  SELECT COUNT(*) AS total
  FROM survey_responses sr
  WHERE sr.shop_name = $1
    AND sr.text_customer_comments IS NOT NULL
    AND sr.text_customer_comments <> ''
    AND ($2 IS NULL OR sr.text_customer_comments ILIKE '%' || $2 || '%');
$_$;


ALTER FUNCTION "public"."shop_comments_count"("shop_name" "text", "search" "text") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."shop_competitor_overlay"("p_shop_name" "text", "p_radius_miles" numeric DEFAULT 25, "p_limit" integer DEFAULT 25) RETURNS TABLE("is_anchor" boolean, "shop_name" "text", "place_id" "text", "address" "text", "phone" "text", "website" "text", "rating" numeric, "category" "text", "latitude" double precision, "longitude" double precision, "distance_miles" numeric)
    LANGUAGE "sql" STABLE
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


ALTER FUNCTION "public"."shop_competitor_overlay"("p_shop_name" "text", "p_radius_miles" numeric, "p_limit" integer) OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."shop_competitor_overlay_by_place_id"("p_place_id" "text", "p_radius_miles" numeric DEFAULT 25, "p_limit" integer DEFAULT 25) RETURNS TABLE("is_anchor" boolean, "shop_name" "text", "place_id" "text", "address" "text", "phone" "text", "website" "text", "rating" numeric, "category" "text", "latitude" double precision, "longitude" double precision, "distance_miles" numeric)
    LANGUAGE "sql" STABLE
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


ALTER FUNCTION "public"."shop_competitor_overlay_by_place_id"("p_place_id" "text", "p_radius_miles" numeric, "p_limit" integer) OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."shop_detail"("p_shop_name" "text", "start_date" "date", "end_date" "date") RETURNS TABLE("shop_name" "text", "avg_emi_pct" numeric, "total_surveys" bigint, "avg_quality" numeric, "avg_cleanliness" numeric, "avg_communication" numeric, "avg_courtesy" numeric, "network_avg_communication" numeric, "invoiced_id" bigint, "psg_id" "text", "invoiced_city" "text", "invoiced_state" "text")
    LANGUAGE "sql" STABLE
    AS $_$
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
$_$;


ALTER FUNCTION "public"."shop_detail"("p_shop_name" "text", "start_date" "date", "end_date" "date") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."shop_list"("start_date" "date", "end_date" "date") RETURNS TABLE("shop_name" "text", "canonical_shop_name" "text", "total_surveys" bigint, "avg_emi_pct" numeric, "latest_survey_date" "date", "place_id" "text", "address" "text", "phone" "text", "website" "text", "rating" numeric, "category" "text", "latitude" double precision, "longitude" double precision)
    LANGUAGE "sql" STABLE
    AS $_$
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
$_$;


ALTER FUNCTION "public"."shop_list"("start_date" "date", "end_date" "date") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."shop_trend"("shop_name" "text") RETURNS TABLE("month" "text", "avg_emi_pct" numeric, "surveys" bigint)
    LANGUAGE "sql" STABLE
    AS $_$
  SELECT
    TO_CHAR(DATE_TRUNC('month', survey_date), 'YYYY-MM') AS month,
    ROUND(AVG(scale_emi_pct) * 100, 1) AS avg_emi_pct,
    COUNT(*) AS surveys
  FROM survey_responses
  WHERE survey_responses.shop_name = $1
  GROUP BY DATE_TRUNC('month', survey_date)
  ORDER BY month ASC;
$_$;


ALTER FUNCTION "public"."shop_trend"("shop_name" "text") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."storm_demand_examples"("example_year" integer DEFAULT NULL::integer, "result_limit" integer DEFAULT 25) RETURNS TABLE("zip" "text", "month" "date", "state" "text", "total_events" integer, "hail_events" integer, "wind_events" integer, "tornado_events" integer, "weighted_storm_demand_score" numeric, "max_hail_size" numeric, "max_wind_speed" numeric, "primary_demand_signal" "text", "example_detail" "text")
    LANGUAGE "sql" STABLE
    AS $_$
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
$_$;


ALTER FUNCTION "public"."storm_demand_examples"("example_year" integer, "result_limit" integer) OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."update_updated_at"() RETURNS "trigger"
    LANGUAGE "plpgsql"
    AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$;


ALTER FUNCTION "public"."update_updated_at"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."user_is_shop_owner"("target_shop_id" "uuid") RETURNS boolean
    LANGUAGE "sql" STABLE SECURITY DEFINER
    AS $$
  SELECT EXISTS (
    SELECT 1 FROM shop_users
    WHERE user_id = auth.uid()
      AND shop_id = target_shop_id
      AND role = 'owner'
  );
$$;


ALTER FUNCTION "public"."user_is_shop_owner"("target_shop_id" "uuid") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."user_location_ids"() RETURNS SETOF "uuid"
    LANGUAGE "sql" STABLE SECURITY DEFINER
    AS $$
  SELECT l.id FROM locations l
  WHERE l.shop_id IN (SELECT user_shop_ids());
$$;


ALTER FUNCTION "public"."user_location_ids"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."user_shop_ids"() RETURNS SETOF "uuid"
    LANGUAGE "sql" STABLE SECURITY DEFINER
    AS $$
  SELECT shop_id FROM shop_users WHERE user_id = auth.uid();
$$;


ALTER FUNCTION "public"."user_shop_ids"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "sensitive"."log_pii_access"("p_action" "text", "p_target_table" "text", "p_actor_user_id" "uuid" DEFAULT NULL::"uuid", "p_actor_email" "text" DEFAULT NULL::"text", "p_actor_role" "text" DEFAULT NULL::"text", "p_target_key" "text" DEFAULT NULL::"text", "p_reason" "text" DEFAULT NULL::"text", "p_request_metadata" "jsonb" DEFAULT '{}'::"jsonb") RETURNS bigint
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'sensitive', 'pg_catalog'
    AS $$
DECLARE
  v_log_id BIGINT;
BEGIN
  INSERT INTO sensitive.pii_access_log (
    actor_user_id,
    actor_email,
    actor_role,
    action,
    target_table,
    target_key,
    reason,
    request_metadata
  )
  VALUES (
    p_actor_user_id,
    p_actor_email,
    p_actor_role,
    p_action,
    p_target_table,
    p_target_key,
    p_reason,
    COALESCE(p_request_metadata, '{}'::jsonb)
  )
  RETURNING id INTO v_log_id;

  RETURN v_log_id;
END;
$$;


ALTER FUNCTION "sensitive"."log_pii_access"("p_action" "text", "p_target_table" "text", "p_actor_user_id" "uuid", "p_actor_email" "text", "p_actor_role" "text", "p_target_key" "text", "p_reason" "text", "p_request_metadata" "jsonb") OWNER TO "postgres";


COMMENT ON FUNCTION "sensitive"."log_pii_access"("p_action" "text", "p_target_table" "text", "p_actor_user_id" "uuid", "p_actor_email" "text", "p_actor_role" "text", "p_target_key" "text", "p_reason" "text", "p_request_metadata" "jsonb") IS 'Service-role-only audit helper for explicit PII access events.';


SET default_tablespace = '';

SET default_table_access_method = "heap";


CREATE TABLE IF NOT EXISTS "bigquery_raw"."psg_advantage_data__shops" (
    "data" "jsonb" NOT NULL
);


ALTER TABLE "bigquery_raw"."psg_advantage_data__shops" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "bigquery_raw"."psg_advantage_data__survey_contacts" (
    "data" "jsonb" NOT NULL
);


ALTER TABLE "bigquery_raw"."psg_advantage_data__survey_contacts" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "bigquery_raw"."psg_advantage_data__survey_field_definitions" (
    "data" "jsonb" NOT NULL
);


ALTER TABLE "bigquery_raw"."psg_advantage_data__survey_field_definitions" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "bigquery_raw"."psg_advantage_data__system_config_insurance" (
    "data" "jsonb" NOT NULL
);


ALTER TABLE "bigquery_raw"."psg_advantage_data__system_config_insurance" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "bigquery_raw"."psg_advantage_data__system_config_products" (
    "data" "jsonb" NOT NULL
);


ALTER TABLE "bigquery_raw"."psg_advantage_data__system_config_products" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "bigquery_raw"."psg_advantage_data__system_config_vehicles" (
    "data" "jsonb" NOT NULL
);


ALTER TABLE "bigquery_raw"."psg_advantage_data__system_config_vehicles" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "bigquery_raw"."psg_geo_data__calmatters_ev" (
    "data" "jsonb" NOT NULL
);


ALTER TABLE "bigquery_raw"."psg_geo_data__calmatters_ev" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "bigquery_raw"."psg_geo_data__national_benchmarks" (
    "data" "jsonb" NOT NULL
);


ALTER TABLE "bigquery_raw"."psg_geo_data__national_benchmarks" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "bigquery_raw"."psg_geo_data__shops" (
    "data" "jsonb" NOT NULL
);


ALTER TABLE "bigquery_raw"."psg_geo_data__shops" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "bigquery_raw"."psg_geo_data__zip_demographics" (
    "data" "jsonb" NOT NULL
);


ALTER TABLE "bigquery_raw"."psg_geo_data__zip_demographics" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "bigquery_raw"."psg_geo_data__zip_geo" (
    "data" "jsonb" NOT NULL
);


ALTER TABLE "bigquery_raw"."psg_geo_data__zip_geo" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "bigquery_raw"."psg_geo_data__zip_naics_density" (
    "data" "jsonb" NOT NULL
);


ALTER TABLE "bigquery_raw"."psg_geo_data__zip_naics_density" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "bigquery_raw"."psg_geo_data__zip_opportunity_scores" (
    "data" "jsonb" NOT NULL
);


ALTER TABLE "bigquery_raw"."psg_geo_data__zip_opportunity_scores" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."accident_density" (
    "zip" "text" NOT NULL,
    "state" "text",
    "year" integer NOT NULL,
    "severity_1_count" integer DEFAULT 0,
    "severity_2_count" integer DEFAULT 0,
    "severity_3_count" integer DEFAULT 0,
    "severity_4_count" integer DEFAULT 0,
    "total_count" integer DEFAULT 0,
    "weather_related_count" integer DEFAULT 0
);


ALTER TABLE "public"."accident_density" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."accident_import_sources" (
    "id" bigint NOT NULL,
    "source_key" "text" NOT NULL,
    "hf_repo" "text" NOT NULL,
    "hf_config" "text" NOT NULL,
    "hf_split" "text" NOT NULL,
    "expected_row_count" integer NOT NULL,
    "expected_column_count" integer NOT NULL,
    "license" "text",
    "status" "text" NOT NULL,
    "import_batch_id" "text" NOT NULL,
    "loaded_rows" integer DEFAULT 0,
    "observed_existing_rows" integer,
    "sample_overlap" integer,
    "notes" "text",
    "created_at" timestamp with time zone DEFAULT "now"()
);


ALTER TABLE "public"."accident_import_sources" OWNER TO "postgres";


CREATE SEQUENCE IF NOT EXISTS "public"."accident_import_sources_id_seq"
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


ALTER SEQUENCE "public"."accident_import_sources_id_seq" OWNER TO "postgres";


ALTER SEQUENCE "public"."accident_import_sources_id_seq" OWNED BY "public"."accident_import_sources"."id";



CREATE TABLE IF NOT EXISTS "public"."accident_market_daypart_rollup" (
    "city" "text" NOT NULL,
    "state" "text" NOT NULL,
    "bucket" "text" NOT NULL,
    "bucket_order" integer NOT NULL,
    "claims" bigint NOT NULL
);


ALTER TABLE "public"."accident_market_daypart_rollup" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."accident_market_rollup" (
    "city" "text" NOT NULL,
    "state" "text" NOT NULL,
    "row_count" bigint NOT NULL,
    "weather_related_count" bigint NOT NULL,
    "high_severity_count" bigint NOT NULL,
    "distance_weighted_sum" numeric NOT NULL
);


ALTER TABLE "public"."accident_market_rollup" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."accident_market_zip_rollup" (
    "city" "text" NOT NULL,
    "state" "text" NOT NULL,
    "zip" "text" NOT NULL,
    "accidents" bigint NOT NULL
);


ALTER TABLE "public"."accident_market_zip_rollup" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."accidents" (
    "id" "text",
    "source" "text",
    "severity" integer,
    "start_time" timestamp with time zone,
    "end_time" timestamp with time zone,
    "start_lat" double precision,
    "start_lng" double precision,
    "end_lat" double precision,
    "end_lng" double precision,
    "location" "public"."geography"(Point,4326),
    "distance_mi" numeric,
    "description" "text",
    "street" "text",
    "city" "text",
    "county" "text",
    "state" "text",
    "zipcode" "text",
    "country" "text",
    "timezone" "text",
    "airport_code" "text",
    "weather_timestamp" timestamp with time zone,
    "temperature_f" numeric,
    "wind_chill_f" numeric,
    "humidity_pct" numeric,
    "pressure_in" numeric,
    "visibility_mi" numeric,
    "wind_direction" "text",
    "wind_speed_mph" numeric,
    "precipitation_in" numeric,
    "weather_condition" "text",
    "amenity" boolean,
    "bump" boolean,
    "crossing" boolean,
    "give_way" boolean,
    "junction" boolean,
    "no_exit" boolean,
    "railway" boolean,
    "roundabout" boolean,
    "station" boolean,
    "stop" boolean,
    "traffic_calming" boolean,
    "traffic_signal" boolean,
    "turning_loop" boolean,
    "sunrise_sunset" "text",
    "civil_twilight" "text",
    "nautical_twilight" "text",
    "astronomical_twilight" "text",
    "import_batch_id" "text",
    "imported_at" timestamp with time zone DEFAULT "now"(),
    "raw_payload" "jsonb" DEFAULT '{}'::"jsonb"
)
PARTITION BY RANGE ("start_time");


ALTER TABLE "public"."accidents" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."accidents_2016" (
    "id" "text",
    "source" "text",
    "severity" integer,
    "start_time" timestamp with time zone,
    "end_time" timestamp with time zone,
    "start_lat" double precision,
    "start_lng" double precision,
    "end_lat" double precision,
    "end_lng" double precision,
    "location" "public"."geography"(Point,4326),
    "distance_mi" numeric,
    "description" "text",
    "street" "text",
    "city" "text",
    "county" "text",
    "state" "text",
    "zipcode" "text",
    "country" "text",
    "timezone" "text",
    "airport_code" "text",
    "weather_timestamp" timestamp with time zone,
    "temperature_f" numeric,
    "wind_chill_f" numeric,
    "humidity_pct" numeric,
    "pressure_in" numeric,
    "visibility_mi" numeric,
    "wind_direction" "text",
    "wind_speed_mph" numeric,
    "precipitation_in" numeric,
    "weather_condition" "text",
    "amenity" boolean,
    "bump" boolean,
    "crossing" boolean,
    "give_way" boolean,
    "junction" boolean,
    "no_exit" boolean,
    "railway" boolean,
    "roundabout" boolean,
    "station" boolean,
    "stop" boolean,
    "traffic_calming" boolean,
    "traffic_signal" boolean,
    "turning_loop" boolean,
    "sunrise_sunset" "text",
    "civil_twilight" "text",
    "nautical_twilight" "text",
    "astronomical_twilight" "text",
    "import_batch_id" "text",
    "imported_at" timestamp with time zone DEFAULT "now"(),
    "raw_payload" "jsonb" DEFAULT '{}'::"jsonb"
);


ALTER TABLE "public"."accidents_2016" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."accidents_2017" (
    "id" "text",
    "source" "text",
    "severity" integer,
    "start_time" timestamp with time zone,
    "end_time" timestamp with time zone,
    "start_lat" double precision,
    "start_lng" double precision,
    "end_lat" double precision,
    "end_lng" double precision,
    "location" "public"."geography"(Point,4326),
    "distance_mi" numeric,
    "description" "text",
    "street" "text",
    "city" "text",
    "county" "text",
    "state" "text",
    "zipcode" "text",
    "country" "text",
    "timezone" "text",
    "airport_code" "text",
    "weather_timestamp" timestamp with time zone,
    "temperature_f" numeric,
    "wind_chill_f" numeric,
    "humidity_pct" numeric,
    "pressure_in" numeric,
    "visibility_mi" numeric,
    "wind_direction" "text",
    "wind_speed_mph" numeric,
    "precipitation_in" numeric,
    "weather_condition" "text",
    "amenity" boolean,
    "bump" boolean,
    "crossing" boolean,
    "give_way" boolean,
    "junction" boolean,
    "no_exit" boolean,
    "railway" boolean,
    "roundabout" boolean,
    "station" boolean,
    "stop" boolean,
    "traffic_calming" boolean,
    "traffic_signal" boolean,
    "turning_loop" boolean,
    "sunrise_sunset" "text",
    "civil_twilight" "text",
    "nautical_twilight" "text",
    "astronomical_twilight" "text",
    "import_batch_id" "text",
    "imported_at" timestamp with time zone DEFAULT "now"(),
    "raw_payload" "jsonb" DEFAULT '{}'::"jsonb"
);


ALTER TABLE "public"."accidents_2017" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."accidents_2018" (
    "id" "text",
    "source" "text",
    "severity" integer,
    "start_time" timestamp with time zone,
    "end_time" timestamp with time zone,
    "start_lat" double precision,
    "start_lng" double precision,
    "end_lat" double precision,
    "end_lng" double precision,
    "location" "public"."geography"(Point,4326),
    "distance_mi" numeric,
    "description" "text",
    "street" "text",
    "city" "text",
    "county" "text",
    "state" "text",
    "zipcode" "text",
    "country" "text",
    "timezone" "text",
    "airport_code" "text",
    "weather_timestamp" timestamp with time zone,
    "temperature_f" numeric,
    "wind_chill_f" numeric,
    "humidity_pct" numeric,
    "pressure_in" numeric,
    "visibility_mi" numeric,
    "wind_direction" "text",
    "wind_speed_mph" numeric,
    "precipitation_in" numeric,
    "weather_condition" "text",
    "amenity" boolean,
    "bump" boolean,
    "crossing" boolean,
    "give_way" boolean,
    "junction" boolean,
    "no_exit" boolean,
    "railway" boolean,
    "roundabout" boolean,
    "station" boolean,
    "stop" boolean,
    "traffic_calming" boolean,
    "traffic_signal" boolean,
    "turning_loop" boolean,
    "sunrise_sunset" "text",
    "civil_twilight" "text",
    "nautical_twilight" "text",
    "astronomical_twilight" "text",
    "import_batch_id" "text",
    "imported_at" timestamp with time zone DEFAULT "now"(),
    "raw_payload" "jsonb" DEFAULT '{}'::"jsonb"
);


ALTER TABLE "public"."accidents_2018" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."accidents_2019" (
    "id" "text",
    "source" "text",
    "severity" integer,
    "start_time" timestamp with time zone,
    "end_time" timestamp with time zone,
    "start_lat" double precision,
    "start_lng" double precision,
    "end_lat" double precision,
    "end_lng" double precision,
    "location" "public"."geography"(Point,4326),
    "distance_mi" numeric,
    "description" "text",
    "street" "text",
    "city" "text",
    "county" "text",
    "state" "text",
    "zipcode" "text",
    "country" "text",
    "timezone" "text",
    "airport_code" "text",
    "weather_timestamp" timestamp with time zone,
    "temperature_f" numeric,
    "wind_chill_f" numeric,
    "humidity_pct" numeric,
    "pressure_in" numeric,
    "visibility_mi" numeric,
    "wind_direction" "text",
    "wind_speed_mph" numeric,
    "precipitation_in" numeric,
    "weather_condition" "text",
    "amenity" boolean,
    "bump" boolean,
    "crossing" boolean,
    "give_way" boolean,
    "junction" boolean,
    "no_exit" boolean,
    "railway" boolean,
    "roundabout" boolean,
    "station" boolean,
    "stop" boolean,
    "traffic_calming" boolean,
    "traffic_signal" boolean,
    "turning_loop" boolean,
    "sunrise_sunset" "text",
    "civil_twilight" "text",
    "nautical_twilight" "text",
    "astronomical_twilight" "text",
    "import_batch_id" "text",
    "imported_at" timestamp with time zone DEFAULT "now"(),
    "raw_payload" "jsonb" DEFAULT '{}'::"jsonb"
);


ALTER TABLE "public"."accidents_2019" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."accidents_2020" (
    "id" "text",
    "source" "text",
    "severity" integer,
    "start_time" timestamp with time zone,
    "end_time" timestamp with time zone,
    "start_lat" double precision,
    "start_lng" double precision,
    "end_lat" double precision,
    "end_lng" double precision,
    "location" "public"."geography"(Point,4326),
    "distance_mi" numeric,
    "description" "text",
    "street" "text",
    "city" "text",
    "county" "text",
    "state" "text",
    "zipcode" "text",
    "country" "text",
    "timezone" "text",
    "airport_code" "text",
    "weather_timestamp" timestamp with time zone,
    "temperature_f" numeric,
    "wind_chill_f" numeric,
    "humidity_pct" numeric,
    "pressure_in" numeric,
    "visibility_mi" numeric,
    "wind_direction" "text",
    "wind_speed_mph" numeric,
    "precipitation_in" numeric,
    "weather_condition" "text",
    "amenity" boolean,
    "bump" boolean,
    "crossing" boolean,
    "give_way" boolean,
    "junction" boolean,
    "no_exit" boolean,
    "railway" boolean,
    "roundabout" boolean,
    "station" boolean,
    "stop" boolean,
    "traffic_calming" boolean,
    "traffic_signal" boolean,
    "turning_loop" boolean,
    "sunrise_sunset" "text",
    "civil_twilight" "text",
    "nautical_twilight" "text",
    "astronomical_twilight" "text",
    "import_batch_id" "text",
    "imported_at" timestamp with time zone DEFAULT "now"(),
    "raw_payload" "jsonb" DEFAULT '{}'::"jsonb"
);


ALTER TABLE "public"."accidents_2020" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."accidents_2021" (
    "id" "text",
    "source" "text",
    "severity" integer,
    "start_time" timestamp with time zone,
    "end_time" timestamp with time zone,
    "start_lat" double precision,
    "start_lng" double precision,
    "end_lat" double precision,
    "end_lng" double precision,
    "location" "public"."geography"(Point,4326),
    "distance_mi" numeric,
    "description" "text",
    "street" "text",
    "city" "text",
    "county" "text",
    "state" "text",
    "zipcode" "text",
    "country" "text",
    "timezone" "text",
    "airport_code" "text",
    "weather_timestamp" timestamp with time zone,
    "temperature_f" numeric,
    "wind_chill_f" numeric,
    "humidity_pct" numeric,
    "pressure_in" numeric,
    "visibility_mi" numeric,
    "wind_direction" "text",
    "wind_speed_mph" numeric,
    "precipitation_in" numeric,
    "weather_condition" "text",
    "amenity" boolean,
    "bump" boolean,
    "crossing" boolean,
    "give_way" boolean,
    "junction" boolean,
    "no_exit" boolean,
    "railway" boolean,
    "roundabout" boolean,
    "station" boolean,
    "stop" boolean,
    "traffic_calming" boolean,
    "traffic_signal" boolean,
    "turning_loop" boolean,
    "sunrise_sunset" "text",
    "civil_twilight" "text",
    "nautical_twilight" "text",
    "astronomical_twilight" "text",
    "import_batch_id" "text",
    "imported_at" timestamp with time zone DEFAULT "now"(),
    "raw_payload" "jsonb" DEFAULT '{}'::"jsonb"
);


ALTER TABLE "public"."accidents_2021" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."accidents_2022" (
    "id" "text",
    "source" "text",
    "severity" integer,
    "start_time" timestamp with time zone,
    "end_time" timestamp with time zone,
    "start_lat" double precision,
    "start_lng" double precision,
    "end_lat" double precision,
    "end_lng" double precision,
    "location" "public"."geography"(Point,4326),
    "distance_mi" numeric,
    "description" "text",
    "street" "text",
    "city" "text",
    "county" "text",
    "state" "text",
    "zipcode" "text",
    "country" "text",
    "timezone" "text",
    "airport_code" "text",
    "weather_timestamp" timestamp with time zone,
    "temperature_f" numeric,
    "wind_chill_f" numeric,
    "humidity_pct" numeric,
    "pressure_in" numeric,
    "visibility_mi" numeric,
    "wind_direction" "text",
    "wind_speed_mph" numeric,
    "precipitation_in" numeric,
    "weather_condition" "text",
    "amenity" boolean,
    "bump" boolean,
    "crossing" boolean,
    "give_way" boolean,
    "junction" boolean,
    "no_exit" boolean,
    "railway" boolean,
    "roundabout" boolean,
    "station" boolean,
    "stop" boolean,
    "traffic_calming" boolean,
    "traffic_signal" boolean,
    "turning_loop" boolean,
    "sunrise_sunset" "text",
    "civil_twilight" "text",
    "nautical_twilight" "text",
    "astronomical_twilight" "text",
    "import_batch_id" "text",
    "imported_at" timestamp with time zone DEFAULT "now"(),
    "raw_payload" "jsonb" DEFAULT '{}'::"jsonb"
);


ALTER TABLE "public"."accidents_2022" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."accidents_2023" (
    "id" "text",
    "source" "text",
    "severity" integer,
    "start_time" timestamp with time zone,
    "end_time" timestamp with time zone,
    "start_lat" double precision,
    "start_lng" double precision,
    "end_lat" double precision,
    "end_lng" double precision,
    "location" "public"."geography"(Point,4326),
    "distance_mi" numeric,
    "description" "text",
    "street" "text",
    "city" "text",
    "county" "text",
    "state" "text",
    "zipcode" "text",
    "country" "text",
    "timezone" "text",
    "airport_code" "text",
    "weather_timestamp" timestamp with time zone,
    "temperature_f" numeric,
    "wind_chill_f" numeric,
    "humidity_pct" numeric,
    "pressure_in" numeric,
    "visibility_mi" numeric,
    "wind_direction" "text",
    "wind_speed_mph" numeric,
    "precipitation_in" numeric,
    "weather_condition" "text",
    "amenity" boolean,
    "bump" boolean,
    "crossing" boolean,
    "give_way" boolean,
    "junction" boolean,
    "no_exit" boolean,
    "railway" boolean,
    "roundabout" boolean,
    "station" boolean,
    "stop" boolean,
    "traffic_calming" boolean,
    "traffic_signal" boolean,
    "turning_loop" boolean,
    "sunrise_sunset" "text",
    "civil_twilight" "text",
    "nautical_twilight" "text",
    "astronomical_twilight" "text",
    "import_batch_id" "text",
    "imported_at" timestamp with time zone DEFAULT "now"(),
    "raw_payload" "jsonb" DEFAULT '{}'::"jsonb"
);


ALTER TABLE "public"."accidents_2023" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."accidents_2024" (
    "id" "text",
    "source" "text",
    "severity" integer,
    "start_time" timestamp with time zone,
    "end_time" timestamp with time zone,
    "start_lat" double precision,
    "start_lng" double precision,
    "end_lat" double precision,
    "end_lng" double precision,
    "location" "public"."geography"(Point,4326),
    "distance_mi" numeric,
    "description" "text",
    "street" "text",
    "city" "text",
    "county" "text",
    "state" "text",
    "zipcode" "text",
    "country" "text",
    "timezone" "text",
    "airport_code" "text",
    "weather_timestamp" timestamp with time zone,
    "temperature_f" numeric,
    "wind_chill_f" numeric,
    "humidity_pct" numeric,
    "pressure_in" numeric,
    "visibility_mi" numeric,
    "wind_direction" "text",
    "wind_speed_mph" numeric,
    "precipitation_in" numeric,
    "weather_condition" "text",
    "amenity" boolean,
    "bump" boolean,
    "crossing" boolean,
    "give_way" boolean,
    "junction" boolean,
    "no_exit" boolean,
    "railway" boolean,
    "roundabout" boolean,
    "station" boolean,
    "stop" boolean,
    "traffic_calming" boolean,
    "traffic_signal" boolean,
    "turning_loop" boolean,
    "sunrise_sunset" "text",
    "civil_twilight" "text",
    "nautical_twilight" "text",
    "astronomical_twilight" "text",
    "import_batch_id" "text",
    "imported_at" timestamp with time zone DEFAULT "now"(),
    "raw_payload" "jsonb" DEFAULT '{}'::"jsonb"
);


ALTER TABLE "public"."accidents_2024" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."accidents_2025" (
    "id" "text",
    "source" "text",
    "severity" integer,
    "start_time" timestamp with time zone,
    "end_time" timestamp with time zone,
    "start_lat" double precision,
    "start_lng" double precision,
    "end_lat" double precision,
    "end_lng" double precision,
    "location" "public"."geography"(Point,4326),
    "distance_mi" numeric,
    "description" "text",
    "street" "text",
    "city" "text",
    "county" "text",
    "state" "text",
    "zipcode" "text",
    "country" "text",
    "timezone" "text",
    "airport_code" "text",
    "weather_timestamp" timestamp with time zone,
    "temperature_f" numeric,
    "wind_chill_f" numeric,
    "humidity_pct" numeric,
    "pressure_in" numeric,
    "visibility_mi" numeric,
    "wind_direction" "text",
    "wind_speed_mph" numeric,
    "precipitation_in" numeric,
    "weather_condition" "text",
    "amenity" boolean,
    "bump" boolean,
    "crossing" boolean,
    "give_way" boolean,
    "junction" boolean,
    "no_exit" boolean,
    "railway" boolean,
    "roundabout" boolean,
    "station" boolean,
    "stop" boolean,
    "traffic_calming" boolean,
    "traffic_signal" boolean,
    "turning_loop" boolean,
    "sunrise_sunset" "text",
    "civil_twilight" "text",
    "nautical_twilight" "text",
    "astronomical_twilight" "text",
    "import_batch_id" "text",
    "imported_at" timestamp with time zone DEFAULT "now"(),
    "raw_payload" "jsonb" DEFAULT '{}'::"jsonb"
);


ALTER TABLE "public"."accidents_2025" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."accidents_2026" (
    "id" "text",
    "source" "text",
    "severity" integer,
    "start_time" timestamp with time zone,
    "end_time" timestamp with time zone,
    "start_lat" double precision,
    "start_lng" double precision,
    "end_lat" double precision,
    "end_lng" double precision,
    "location" "public"."geography"(Point,4326),
    "distance_mi" numeric,
    "description" "text",
    "street" "text",
    "city" "text",
    "county" "text",
    "state" "text",
    "zipcode" "text",
    "country" "text",
    "timezone" "text",
    "airport_code" "text",
    "weather_timestamp" timestamp with time zone,
    "temperature_f" numeric,
    "wind_chill_f" numeric,
    "humidity_pct" numeric,
    "pressure_in" numeric,
    "visibility_mi" numeric,
    "wind_direction" "text",
    "wind_speed_mph" numeric,
    "precipitation_in" numeric,
    "weather_condition" "text",
    "amenity" boolean,
    "bump" boolean,
    "crossing" boolean,
    "give_way" boolean,
    "junction" boolean,
    "no_exit" boolean,
    "railway" boolean,
    "roundabout" boolean,
    "station" boolean,
    "stop" boolean,
    "traffic_calming" boolean,
    "traffic_signal" boolean,
    "turning_loop" boolean,
    "sunrise_sunset" "text",
    "civil_twilight" "text",
    "nautical_twilight" "text",
    "astronomical_twilight" "text",
    "import_batch_id" "text",
    "imported_at" timestamp with time zone DEFAULT "now"(),
    "raw_payload" "jsonb" DEFAULT '{}'::"jsonb"
);


ALTER TABLE "public"."accidents_2026" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."accidents_2027" (
    "id" "text",
    "source" "text",
    "severity" integer,
    "start_time" timestamp with time zone,
    "end_time" timestamp with time zone,
    "start_lat" double precision,
    "start_lng" double precision,
    "end_lat" double precision,
    "end_lng" double precision,
    "location" "public"."geography"(Point,4326),
    "distance_mi" numeric,
    "description" "text",
    "street" "text",
    "city" "text",
    "county" "text",
    "state" "text",
    "zipcode" "text",
    "country" "text",
    "timezone" "text",
    "airport_code" "text",
    "weather_timestamp" timestamp with time zone,
    "temperature_f" numeric,
    "wind_chill_f" numeric,
    "humidity_pct" numeric,
    "pressure_in" numeric,
    "visibility_mi" numeric,
    "wind_direction" "text",
    "wind_speed_mph" numeric,
    "precipitation_in" numeric,
    "weather_condition" "text",
    "amenity" boolean,
    "bump" boolean,
    "crossing" boolean,
    "give_way" boolean,
    "junction" boolean,
    "no_exit" boolean,
    "railway" boolean,
    "roundabout" boolean,
    "station" boolean,
    "stop" boolean,
    "traffic_calming" boolean,
    "traffic_signal" boolean,
    "turning_loop" boolean,
    "sunrise_sunset" "text",
    "civil_twilight" "text",
    "nautical_twilight" "text",
    "astronomical_twilight" "text",
    "import_batch_id" "text",
    "imported_at" timestamp with time zone DEFAULT "now"(),
    "raw_payload" "jsonb" DEFAULT '{}'::"jsonb"
);


ALTER TABLE "public"."accidents_2027" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."accidents_default" (
    "id" "text",
    "source" "text",
    "severity" integer,
    "start_time" timestamp with time zone,
    "end_time" timestamp with time zone,
    "start_lat" double precision,
    "start_lng" double precision,
    "end_lat" double precision,
    "end_lng" double precision,
    "location" "public"."geography"(Point,4326),
    "distance_mi" numeric,
    "description" "text",
    "street" "text",
    "city" "text",
    "county" "text",
    "state" "text",
    "zipcode" "text",
    "country" "text",
    "timezone" "text",
    "airport_code" "text",
    "weather_timestamp" timestamp with time zone,
    "temperature_f" numeric,
    "wind_chill_f" numeric,
    "humidity_pct" numeric,
    "pressure_in" numeric,
    "visibility_mi" numeric,
    "wind_direction" "text",
    "wind_speed_mph" numeric,
    "precipitation_in" numeric,
    "weather_condition" "text",
    "amenity" boolean,
    "bump" boolean,
    "crossing" boolean,
    "give_way" boolean,
    "junction" boolean,
    "no_exit" boolean,
    "railway" boolean,
    "roundabout" boolean,
    "station" boolean,
    "stop" boolean,
    "traffic_calming" boolean,
    "traffic_signal" boolean,
    "turning_loop" boolean,
    "sunrise_sunset" "text",
    "civil_twilight" "text",
    "nautical_twilight" "text",
    "astronomical_twilight" "text",
    "import_batch_id" "text",
    "imported_at" timestamp with time zone DEFAULT "now"(),
    "raw_payload" "jsonb" DEFAULT '{}'::"jsonb"
);


ALTER TABLE "public"."accidents_default" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."activity_log" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "actor_id" "uuid",
    "action" "text",
    "entity_type" "text",
    "entity_id" "uuid",
    "metadata" "jsonb",
    "created_at" timestamp with time zone DEFAULT "now"()
);


ALTER TABLE "public"."activity_log" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."ad_copy_events" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "campaign_name" "text" DEFAULT 'NWI Hail 2026'::"text" NOT NULL,
    "event_type" "text" NOT NULL,
    "channel" "text",
    "ad_set" "text",
    "filter_label" "text",
    "ad_count" integer DEFAULT 1 NOT NULL
);


ALTER TABLE "public"."ad_copy_events" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."ai_prompt_templates" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "version" integer NOT NULL,
    "content_type" "text" NOT NULL,
    "persona" "text",
    "system_prompt" "text" NOT NULL,
    "user_prompt" "text" NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL
);


ALTER TABLE "public"."ai_prompt_templates" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."analytics_snapshots" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "shop_id" "uuid" NOT NULL,
    "location_id" "uuid" NOT NULL,
    "date" "date" NOT NULL,
    "metrics" "jsonb" NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL
);


ALTER TABLE "public"."analytics_snapshots" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."api_cache" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "cache_key" "text" NOT NULL,
    "api_name" "text" NOT NULL,
    "request_params" "jsonb" NOT NULL,
    "response_data" "jsonb" NOT NULL,
    "cached_at" timestamp with time zone DEFAULT "now"(),
    "expires_at" timestamp with time zone NOT NULL,
    "hit_count" integer DEFAULT 0,
    "last_hit_at" timestamp with time zone
);


ALTER TABLE "public"."api_cache" OWNER TO "postgres";


COMMENT ON TABLE "public"."api_cache" IS 'Cache for slow-changing API responses. TTLs: SEMrush 30d, Census 365d, WhoisXML 90d, PageSpeed 7d.';



CREATE TABLE IF NOT EXISTS "public"."body_shops" (
    "shop_id" "text" NOT NULL,
    "shop_name" "text" NOT NULL,
    "place_id" "text",
    "address" "text",
    "phone" "text",
    "website" "text",
    "rating" numeric,
    "category" "text",
    "latitude" double precision,
    "longitude" double precision,
    "location" "public"."geography"(Point,4326),
    "source" "text" DEFAULT 'bigquery_migration'::"text",
    "imported_at" timestamp with time zone DEFAULT "now"(),
    "raw_payload" "jsonb" DEFAULT '{}'::"jsonb",
    "normalized_name" "text" GENERATED ALWAYS AS ("regexp_replace"("lower"("shop_name"), '[^a-z0-9]'::"text", ''::"text", 'g'::"text")) STORED
);


ALTER TABLE "public"."body_shops" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."bsm_campaigns" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "shop_id" "uuid" NOT NULL,
    "location_id" "uuid",
    "type" "text" NOT NULL,
    "template" "jsonb",
    "audience" "jsonb",
    "schedule" "jsonb",
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    CONSTRAINT "bsm_campaigns_type_check" CHECK (("type" = ANY (ARRAY['email'::"text", 'sms'::"text"])))
);


ALTER TABLE "public"."bsm_campaigns" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."campaign_budget_snapshots" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "campaign_name" "text" DEFAULT 'NWI Hail 2026'::"text" NOT NULL,
    "total_budget" integer NOT NULL,
    "channel" "text" NOT NULL,
    "allocated" integer NOT NULL,
    "daily_min" integer,
    "daily_max" integer,
    "notes" "text"
);


ALTER TABLE "public"."campaign_budget_snapshots" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."campaign_sends" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "campaign_id" "uuid" NOT NULL,
    "recipient" "text" NOT NULL,
    "status" "text" DEFAULT 'pending'::"text" NOT NULL,
    "sent_at" timestamp with time zone,
    "opened_at" timestamp with time zone,
    "clicked_at" timestamp with time zone,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL
);


ALTER TABLE "public"."campaign_sends" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."campaigns" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "client_id" "uuid",
    "name" "text",
    "status" "text" DEFAULT 'draft'::"text",
    "workflow_step" "text",
    "ai_model" "text",
    "config" "jsonb",
    "discovery_job_id" "text",
    "localreach_job_id" "text",
    "created_by" "uuid",
    "created_at" timestamp with time zone DEFAULT "now"(),
    "updated_at" timestamp with time zone DEFAULT "now"(),
    "template_page_url" "text",
    "review_token" "text",
    CONSTRAINT "campaigns_status_check" CHECK (("status" = ANY (ARRAY['draft'::"text", 'discovery'::"text", 'generating'::"text", 'reviewing'::"text", 'approved'::"text", 'completed'::"text", 'failed'::"text", 'created'::"text", 'ingesting'::"text", 'review'::"text", 'deploying'::"text", 'complete'::"text"])))
);


ALTER TABLE "public"."campaigns" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."clients" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "name" "text" NOT NULL,
    "website_url" "text",
    "primary_market" "text",
    "zip_code" "text",
    "service_radius_miles" integer,
    "competitors" "jsonb" DEFAULT '[]'::"jsonb",
    "created_by" "uuid",
    "created_at" timestamp with time zone DEFAULT "now"(),
    "updated_at" timestamp with time zone DEFAULT "now"(),
    "is_dpm_client" boolean DEFAULT false,
    "yext_account_id" "text",
    "yext_entity_id" "text",
    "notes" "text",
    "wp_site_url" "text",
    "wp_username" "text",
    "wp_app_password" "text",
    "elementor_template_url" "text",
    "ssh_hostname" "text",
    "ssh_username" "text",
    "wp_install_path" "text",
    "hosting_provider" "text",
    "wp_admin_username" "text",
    "wp_admin_password" "text"
);


ALTER TABLE "public"."clients" OWNER TO "postgres";


COMMENT ON COLUMN "public"."clients"."is_dpm_client" IS 'True if this client is an active PSG DPM customer. Triggers Yext live data pull instead of scan.';



COMMENT ON COLUMN "public"."clients"."yext_entity_id" IS 'Yext Knowledge Graph entity ID for this client. Required when is_dpm_client = true.';



COMMENT ON COLUMN "public"."clients"."wp_site_url" IS 'WordPress site URL for REST API access';



COMMENT ON COLUMN "public"."clients"."wp_username" IS 'WordPress username for application password auth';



COMMENT ON COLUMN "public"."clients"."wp_app_password" IS 'WordPress application password';



COMMENT ON COLUMN "public"."clients"."elementor_template_url" IS 'URL of existing page to use as Elementor template — system resolves WP page ID at deployment time';



COMMENT ON COLUMN "public"."clients"."ssh_hostname" IS 'SSH hostname for WP-CLI access';



COMMENT ON COLUMN "public"."clients"."ssh_username" IS 'SSH username for WP-CLI access';



COMMENT ON COLUMN "public"."clients"."wp_install_path" IS 'WordPress install path on server (e.g. /home/user/public_html/)';



COMMENT ON COLUMN "public"."clients"."hosting_provider" IS 'Hosting provider (cpanel, rocketnet, siteground, etc.)';



COMMENT ON COLUMN "public"."clients"."wp_admin_username" IS 'WP Admin username for Playwright visual editing';



COMMENT ON COLUMN "public"."clients"."wp_admin_password" IS 'WP Admin regular login password for Playwright';



CREATE TABLE IF NOT EXISTS "public"."competitors" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "shop_id" "uuid" NOT NULL,
    "report_id" "uuid",
    "name" "text" NOT NULL,
    "address" "text",
    "city" "text",
    "state" "text",
    "zip" "text",
    "latitude" double precision,
    "longitude" double precision,
    "distance_miles" double precision,
    "google_place_id" "text",
    "google_rating" double precision,
    "google_review_count" integer,
    "has_website" boolean DEFAULT false,
    "website_url" "text",
    "consolidator_id" "uuid",
    "is_consolidator" boolean DEFAULT false,
    "is_franchise" boolean DEFAULT false,
    "is_regional_mso" boolean DEFAULT false,
    "competitor_score" integer,
    "rank_in_set" integer,
    "user_requested" boolean DEFAULT false,
    "semrush_data" "jsonb",
    "pagespeed_data" "jsonb",
    "yext_scan_data" "jsonb",
    "cached_at" timestamp with time zone DEFAULT "now"(),
    "cache_expires_at" timestamp with time zone DEFAULT ("now"() + '6 mons'::interval),
    "created_at" timestamp with time zone DEFAULT "now"()
);


ALTER TABLE "public"."competitors" OWNER TO "postgres";


COMMENT ON TABLE "public"."competitors" IS 'Scored competitor set per shop. Consolidators always included. Cache expires 6 months.';



CREATE TABLE IF NOT EXISTS "public"."configs" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "name" "text",
    "client_id" "uuid",
    "settings" "jsonb",
    "created_by" "uuid",
    "created_at" timestamp with time zone DEFAULT "now"(),
    "updated_at" timestamp with time zone DEFAULT "now"()
);


ALTER TABLE "public"."configs" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."consolidators" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "name" "text" NOT NULL,
    "type" "text" NOT NULL,
    "aliases" "text"[],
    "parent_company" "text",
    "acquisition_note" "text",
    "always_include" boolean DEFAULT true,
    "created_at" timestamp with time zone DEFAULT "now"(),
    CONSTRAINT "consolidators_type_check" CHECK (("type" = ANY (ARRAY['consolidator'::"text", 'franchise'::"text", 'regional_mso'::"text"])))
);


ALTER TABLE "public"."consolidators" OWNER TO "postgres";


COMMENT ON TABLE "public"."consolidators" IS 'Known consolidators, franchises, and regional MSOs. Any shop matching these names within radius is always included in competitor set.';



CREATE TABLE IF NOT EXISTS "public"."content_items" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "shop_id" "uuid" NOT NULL,
    "location_id" "uuid" NOT NULL,
    "type" "text" NOT NULL,
    "title" "text",
    "body" "text",
    "status" "text" DEFAULT 'draft'::"text" NOT NULL,
    "scheduled_at" timestamp with time zone,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    CONSTRAINT "content_items_status_check" CHECK (("status" = ANY (ARRAY['draft'::"text", 'pending_review'::"text", 'approved'::"text", 'published'::"text"])))
);


ALTER TABLE "public"."content_items" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."county_references" (
    "county_fips" "text" NOT NULL,
    "state_abbr" "text" NOT NULL,
    "county_name" "text" NOT NULL,
    "state_fips" "text"
);


ALTER TABLE "public"."county_references" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."county_vehicle_registrations" (
    "id" bigint NOT NULL,
    "county_name" "text" NOT NULL,
    "state" "text" NOT NULL,
    "vehicle_count" integer NOT NULL,
    "snapshot_date" "text",
    "source" "text" NOT NULL,
    "source_dataset" "text",
    "raw_payload" "jsonb",
    "import_batch_id" "text",
    "imported_at" timestamp with time zone DEFAULT "now"() NOT NULL
);


ALTER TABLE "public"."county_vehicle_registrations" OWNER TO "postgres";


CREATE SEQUENCE IF NOT EXISTS "public"."county_vehicle_registrations_id_seq"
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


ALTER SEQUENCE "public"."county_vehicle_registrations_id_seq" OWNER TO "postgres";


ALTER SEQUENCE "public"."county_vehicle_registrations_id_seq" OWNED BY "public"."county_vehicle_registrations"."id";



CREATE TABLE IF NOT EXISTS "public"."crash_event_sources" (
    "id" bigint NOT NULL,
    "source_key" "text" NOT NULL,
    "source_url" "text" NOT NULL,
    "geography" "text" NOT NULL,
    "source_year" integer NOT NULL,
    "row_count" integer DEFAULT 0,
    "status" "text" NOT NULL,
    "import_batch_id" "text" NOT NULL,
    "notes" "text",
    "imported_at" timestamp with time zone DEFAULT "now"()
);


ALTER TABLE "public"."crash_event_sources" OWNER TO "postgres";


CREATE SEQUENCE IF NOT EXISTS "public"."crash_event_sources_id_seq"
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


ALTER SEQUENCE "public"."crash_event_sources_id_seq" OWNER TO "postgres";


ALTER SEQUENCE "public"."crash_event_sources_id_seq" OWNED BY "public"."crash_event_sources"."id";



CREATE TABLE IF NOT EXISTS "public"."crash_events" (
    "id" bigint NOT NULL,
    "source" "text" NOT NULL,
    "source_event_id" "text" NOT NULL,
    "event_time" timestamp with time zone,
    "reported_time" timestamp with time zone,
    "state" "text",
    "city" "text",
    "latitude" double precision,
    "longitude" double precision,
    "location" "public"."geography"(Point,4326),
    "severity" "text",
    "fatalities" integer,
    "injuries_total" integer,
    "injuries_incapacitating" integer,
    "vehicles_involved" integer,
    "damage" "text",
    "weather_condition" "text",
    "roadway_surface_condition" "text",
    "collision_type" "text",
    "primary_contributory_cause" "text",
    "source_lag_days" integer,
    "confidence_score" numeric DEFAULT 0,
    "import_batch_id" "text",
    "imported_at" timestamp with time zone DEFAULT "now"(),
    "raw_payload" "jsonb" DEFAULT '{}'::"jsonb"
);


ALTER TABLE "public"."crash_events" OWNER TO "postgres";


CREATE SEQUENCE IF NOT EXISTS "public"."crash_events_id_seq"
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


ALTER SEQUENCE "public"."crash_events_id_seq" OWNER TO "postgres";


ALTER SEQUENCE "public"."crash_events_id_seq" OWNED BY "public"."crash_events"."id";



CREATE TABLE IF NOT EXISTS "public"."crash_zip_annual" (
    "source" "text" NOT NULL,
    "zip" "text" NOT NULL,
    "state" "text",
    "city" "text",
    "year" integer NOT NULL,
    "total_crashes" integer DEFAULT 0,
    "fatal_crashes" integer DEFAULT 0,
    "injury_crashes" integer DEFAULT 0,
    "tow_or_injury_crashes" integer DEFAULT 0,
    "property_damage_crashes" integer DEFAULT 0,
    "weather_related_crashes" integer DEFAULT 0,
    "weighted_crash_demand_score" numeric DEFAULT 0,
    "unmatched_crash_count" integer DEFAULT 0,
    "refreshed_at" timestamp with time zone DEFAULT "now"()
);


ALTER TABLE "public"."crash_zip_annual" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."customer_zip_report_monthly" (
    "month" "date" NOT NULL,
    "shop_id" "text" NOT NULL,
    "shop_name" "text",
    "zip" "text" NOT NULL,
    "county_name" "text",
    "state" "text",
    "repair_count" bigint DEFAULT 0 NOT NULL,
    "unique_household_count" bigint DEFAULT 0 NOT NULL,
    "avg_repair_total" numeric,
    "total_repair_value" numeric,
    "mean_household_income" numeric,
    "median_household_income" numeric,
    "income_band" "text",
    "crash_demand_score" numeric,
    "storm_demand_score" numeric,
    "market_opportunity_score" numeric,
    "import_batch_id" "text",
    "imported_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "registered_vehicles" integer,
    "competitor_shop_count" integer,
    "ev_vehicle_count" integer
);


ALTER TABLE "public"."customer_zip_report_monthly" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."discovery_briefs" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "campaign_id" "uuid",
    "input_data" "jsonb",
    "geo_data" "jsonb",
    "research_cities" "jsonb",
    "questionnaire_path" "text",
    "raw_brief" "jsonb",
    "created_at" timestamp with time zone DEFAULT "now"(),
    "semrush_data" "jsonb",
    "social_data" "jsonb",
    "keyword_strategy" "jsonb",
    "persona_targeting" "jsonb",
    "shop_address" "text",
    "shop_latitude" double precision,
    "shop_longitude" double precision,
    "is_urban" boolean,
    "search_radius_miles" integer,
    "weather_data" "jsonb",
    "weather_correlation" "jsonb",
    "yext_data" "jsonb",
    "google_places_data" "jsonb",
    "pagespeed_data" "jsonb",
    "whoisxml_data" "jsonb",
    "forum_sentiment" "jsonb",
    "ai_readiness_score" integer,
    "geo_audit" "jsonb"
);


ALTER TABLE "public"."discovery_briefs" OWNER TO "postgres";


COMMENT ON COLUMN "public"."discovery_briefs"."semrush_data" IS 'Raw SEMrush keyword data';



COMMENT ON COLUMN "public"."discovery_briefs"."social_data" IS 'Web scraping sentiment data';



COMMENT ON COLUMN "public"."discovery_briefs"."keyword_strategy" IS 'Prioritized keyword list';



COMMENT ON COLUMN "public"."discovery_briefs"."persona_targeting" IS 'Matched personas + anxieties';



CREATE TABLE IF NOT EXISTS "public"."dmv_vehicle_registrations" (
    "id" bigint NOT NULL,
    "zip" "text" NOT NULL,
    "county" "text",
    "registration_class" "text",
    "vehicle_count" integer NOT NULL,
    "passenger_count" integer,
    "commercial_count" integer,
    "snapshot_date" "date" NOT NULL,
    "source" "text" DEFAULT 'ny_dmv'::"text" NOT NULL,
    "source_dataset" "text" DEFAULT 'w4pv-hbkt'::"text" NOT NULL,
    "raw_payload" "jsonb",
    "imported_at" timestamp with time zone DEFAULT "now"() NOT NULL
);


ALTER TABLE "public"."dmv_vehicle_registrations" OWNER TO "postgres";


CREATE SEQUENCE IF NOT EXISTS "public"."dmv_vehicle_registrations_id_seq"
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


ALTER SEQUENCE "public"."dmv_vehicle_registrations_id_seq" OWNER TO "postgres";


ALTER SEQUENCE "public"."dmv_vehicle_registrations_id_seq" OWNED BY "public"."dmv_vehicle_registrations"."id";



CREATE TABLE IF NOT EXISTS "public"."elements" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "campaign_id" "uuid",
    "source_url" "text",
    "tag_name" "text",
    "xpath" "text",
    "text_content" "text",
    "attributes" "jsonb",
    "element_type" "text",
    "created_at" timestamp with time zone DEFAULT "now"()
);


ALTER TABLE "public"."elements" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."email_events" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "sg_event_id" "text" NOT NULL,
    "event" "text" NOT NULL,
    "email" "text",
    "message_id" "text",
    "payload" "jsonb" NOT NULL,
    "occurred_at" timestamp with time zone,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL
);


ALTER TABLE "public"."email_events" OWNER TO "postgres";


COMMENT ON TABLE "public"."email_events" IS 'SendGrid Event Webhook log (psg-hub Phase 3 / 03-01). sg_event_id UNIQUE = idempotency key. Service-role writes only; no public RLS policies.';



CREATE TABLE IF NOT EXISTS "public"."estimated_zip_vehicles" (
    "id" bigint NOT NULL,
    "zip" "text" NOT NULL,
    "state" "text",
    "year" integer NOT NULL,
    "household_vehicles" integer,
    "adjustment_factor" numeric(8,4),
    "estimated_total_vehicles" integer,
    "ev_count" integer,
    "ev_pct" numeric(6,4),
    "data_quality_flag" "text" DEFAULT 'model_estimate'::"text" NOT NULL,
    "source_mix" "text",
    "import_batch_id" "text",
    "imported_at" timestamp with time zone DEFAULT "now"() NOT NULL
);


ALTER TABLE "public"."estimated_zip_vehicles" OWNER TO "postgres";


CREATE SEQUENCE IF NOT EXISTS "public"."estimated_zip_vehicles_id_seq"
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


ALTER SEQUENCE "public"."estimated_zip_vehicles_id_seq" OWNER TO "postgres";


ALTER SEQUENCE "public"."estimated_zip_vehicles_id_seq" OWNED BY "public"."estimated_zip_vehicles"."id";



CREATE TABLE IF NOT EXISTS "public"."ev_registrations" (
    "id" bigint NOT NULL,
    "zip" "text" NOT NULL,
    "state" "text",
    "vehicle_count" integer NOT NULL,
    "make" "text",
    "model" "text",
    "powertrain_type" "text",
    "vehicle_category" "text",
    "snapshot_date" "date" NOT NULL,
    "source" "text" NOT NULL,
    "source_dataset" "text",
    "raw_payload" "jsonb",
    "import_batch_id" "text",
    "imported_at" timestamp with time zone DEFAULT "now"() NOT NULL
);


ALTER TABLE "public"."ev_registrations" OWNER TO "postgres";


CREATE SEQUENCE IF NOT EXISTS "public"."ev_registrations_id_seq"
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


ALTER SEQUENCE "public"."ev_registrations_id_seq" OWNER TO "postgres";


ALTER SEQUENCE "public"."ev_registrations_id_seq" OWNED BY "public"."ev_registrations"."id";



CREATE TABLE IF NOT EXISTS "public"."integrations" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "shop_id" "uuid" NOT NULL,
    "location_id" "uuid",
    "provider" "text" NOT NULL,
    "credentials_vault_id" "text",
    "status" "text" DEFAULT 'disconnected'::"text" NOT NULL,
    "last_sync" timestamp with time zone,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL
);


ALTER TABLE "public"."integrations" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."invoiced_customers" (
    "invoiced_id" bigint NOT NULL,
    "psg_id" "text" NOT NULL,
    "name" "text" NOT NULL,
    "city" "text",
    "state" "text",
    "parent_invoiced_id" bigint,
    "metadata" "jsonb" DEFAULT '{}'::"jsonb" NOT NULL,
    "imported_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "normalized_name" "text" GENERATED ALWAYS AS ("regexp_replace"("lower"("name"), '[^a-z0-9]'::"text", ''::"text", 'g'::"text")) STORED
);


ALTER TABLE "public"."invoiced_customers" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."leads" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "shop_id" "uuid" NOT NULL,
    "location_id" "uuid" NOT NULL,
    "source" "text",
    "channel" "text",
    "form_data" "jsonb",
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL
);


ALTER TABLE "public"."leads" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."localreach_pages" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "shop_id" "uuid" NOT NULL,
    "location_id" "uuid" NOT NULL,
    "service_slug" "text" NOT NULL,
    "service_name" "text" NOT NULL,
    "neighborhood" "text",
    "title" "text" NOT NULL,
    "meta_description" "text" NOT NULL,
    "body_content" "text" NOT NULL,
    "is_active" boolean DEFAULT true NOT NULL,
    "impressions" integer DEFAULT 0 NOT NULL,
    "clicks" integer DEFAULT 0 NOT NULL,
    "generated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL
);


ALTER TABLE "public"."localreach_pages" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."location_brand" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "location_id" "uuid" NOT NULL,
    "logo_url" "text",
    "colors" "jsonb",
    "fonts" "jsonb",
    "tagline" "text",
    "voice_description" "text",
    "sample_content" "text"[],
    "brand_photos" "text"[],
    "inherit_from_shop" boolean DEFAULT false NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL
);


ALTER TABLE "public"."location_brand" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."location_certifications" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "location_id" "uuid" NOT NULL,
    "cert_name" "text" NOT NULL,
    "cert_body" "text",
    "cert_number" "text",
    "expiry_date" "date",
    "logo_url" "text",
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL
);


ALTER TABLE "public"."location_certifications" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."location_insurance" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "location_id" "uuid" NOT NULL,
    "drp_partners" "text"[],
    "preferred_insurers" "text"[],
    "accepts_all_insurance" boolean DEFAULT false NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL
);


ALTER TABLE "public"."location_insurance" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."location_market" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "location_id" "uuid" NOT NULL,
    "primary_city" "text",
    "service_radius_miles" integer,
    "target_neighborhoods" "text"[],
    "competitor_names" "text"[],
    "competitor_urls" "text"[],
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL
);


ALTER TABLE "public"."location_market" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."location_paperclip_mapping" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "shop_id" "uuid" NOT NULL,
    "location_id" "uuid" NOT NULL,
    "paperclip_company_id" "uuid" NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL
);


ALTER TABLE "public"."location_paperclip_mapping" OWNER TO "postgres";


COMMENT ON TABLE "public"."location_paperclip_mapping" IS 'Maps BSM locations to Paperclip companies. Each location = one Paperclip company. UNIQUE on location_id and paperclip_company_id prevents duplicates on retry.';



CREATE TABLE IF NOT EXISTS "public"."location_profiles" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "location_id" "uuid" NOT NULL,
    "address" "text",
    "phone" "text",
    "hours" "jsonb",
    "website" "text",
    "year_established" integer,
    "manager_name" "text",
    "manager_bio" "text",
    "geo" "point",
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL
);


ALTER TABLE "public"."location_profiles" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."location_services" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "location_id" "uuid" NOT NULL,
    "service_name" "text" NOT NULL,
    "description" "text",
    "is_specialty" boolean DEFAULT false NOT NULL,
    "display_order" integer DEFAULT 0 NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL
);


ALTER TABLE "public"."location_services" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."locations" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "shop_id" "uuid" NOT NULL,
    "name" "text" NOT NULL,
    "slug" "text" NOT NULL,
    "is_primary" boolean DEFAULT false NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL
);


ALTER TABLE "public"."locations" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."market_map_point_cache" (
    "layer" "text" NOT NULL,
    "id" "text" NOT NULL,
    "shop_name" "text",
    "psg_id" "text",
    "invoiced_id" bigint,
    "place_id" "text",
    "address" "text",
    "phone" "text",
    "website" "text",
    "rating" numeric,
    "latitude" double precision,
    "longitude" double precision,
    "state" "text",
    "city" "text",
    "survey_count" bigint,
    "avg_emi_pct" numeric,
    "match_status" "text"
);


ALTER TABLE "public"."market_map_point_cache" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."market_zip_latest_signal" (
    "zip" "text" NOT NULL,
    "longitude" double precision,
    "latitude" double precision,
    "state" "text",
    "city" "text",
    "year" integer,
    "total_crashes" numeric DEFAULT 0 NOT NULL,
    "injury_crashes" numeric DEFAULT 0 NOT NULL,
    "weather_related_crashes" numeric DEFAULT 0 NOT NULL,
    "storm_events" numeric DEFAULT 0 NOT NULL,
    "hail_events" numeric DEFAULT 0 NOT NULL,
    "wind_events" numeric DEFAULT 0 NOT NULL,
    "storm_demand_score" numeric DEFAULT 0 NOT NULL,
    "targeting_score" numeric DEFAULT 0 NOT NULL
);


ALTER TABLE "public"."market_zip_latest_signal" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."pages" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "campaign_id" "uuid",
    "city_name" "text",
    "city_state" "text",
    "city_zip" "text",
    "distance_mi" double precision,
    "is_primary" boolean DEFAULT false,
    "service_page_slug" "text",
    "seo_title" "text",
    "seo_meta_description" "text",
    "seo_keywords" "text"[],
    "seo_og_tags" "jsonb",
    "content" "jsonb",
    "json_ld" "jsonb",
    "rendered_html" "text",
    "review_status" "text" DEFAULT 'pending'::"text",
    "created_at" timestamp with time zone DEFAULT "now"(),
    "updated_at" timestamp with time zone DEFAULT "now"(),
    "outline" "jsonb",
    "similarity_score" real,
    "qa_results" "jsonb",
    "qa_score" double precision,
    CONSTRAINT "pages_review_status_check" CHECK (("review_status" = ANY (ARRAY['pending'::"text", 'approved'::"text", 'needs_changes'::"text", 'rejected'::"text"])))
);


ALTER TABLE "public"."pages" OWNER TO "postgres";


COMMENT ON COLUMN "public"."pages"."qa_results" IS 'validate_content.py output';



COMMENT ON COLUMN "public"."pages"."qa_score" IS 'Overall QA score (0-100)';



CREATE TABLE IF NOT EXISTS "public"."portal_sessions_log" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "user_id" "uuid",
    "shop_id" "text",
    "action" "text",
    "ip_address" "text",
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL
);


ALTER TABLE "public"."portal_sessions_log" OWNER TO "postgres";


COMMENT ON TABLE "public"."portal_sessions_log" IS 'Audit log for portal user actions. Retained for 90 days.';



CREATE TABLE IF NOT EXISTS "public"."portal_users" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "email" "text" NOT NULL,
    "shop_id" "text" NOT NULL,
    "role" "text" DEFAULT 'shop_owner'::"text" NOT NULL,
    "full_name" "text",
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "last_login" timestamp with time zone
);


ALTER TABLE "public"."portal_users" OWNER TO "postgres";


COMMENT ON TABLE "public"."portal_users" IS 'PSG Advantage Portal users. shop_id matches PSGID in BigQuery shops table. Managed by PSG admins only.';



CREATE TABLE IF NOT EXISTS "public"."profiles" (
    "id" "uuid" NOT NULL,
    "display_name" "text",
    "role" "text" DEFAULT 'admin'::"text",
    "avatar_url" "text",
    "created_at" timestamp with time zone DEFAULT "now"(),
    "updated_at" timestamp with time zone DEFAULT "now"(),
    CONSTRAINT "profiles_role_check" CHECK (("role" = ANY (ARRAY['admin'::"text", 'reviewer'::"text", 'viewer'::"text"])))
);


ALTER TABLE "public"."profiles" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."psg_knowledge_chunks" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "doc_id" "text" NOT NULL,
    "chunk_index" integer DEFAULT 0 NOT NULL,
    "content" "text" NOT NULL,
    "content_hash" "text" NOT NULL,
    "embedding" "extensions"."vector"(768),
    "metadata" "jsonb" DEFAULT '{}'::"jsonb",
    "created_at" timestamp with time zone DEFAULT "now"()
);


ALTER TABLE "public"."psg_knowledge_chunks" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."psg_knowledge_meta" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "doc_id" "text" NOT NULL,
    "title" "text" NOT NULL,
    "file_path" "text",
    "category" "text" NOT NULL,
    "source_type" "text" NOT NULL,
    "chunk_count" integer DEFAULT 0,
    "ingested_at" timestamp with time zone DEFAULT "now"(),
    "last_updated" timestamp with time zone DEFAULT "now"(),
    "content" "text",
    "embedding" "extensions"."vector"(768),
    "content_hash" "text",
    "source_name" "text",
    "metadata" "jsonb" DEFAULT '{}'::"jsonb",
    CONSTRAINT "psg_knowledge_meta_category_check" CHECK (("category" = ANY (ARRAY['strategy'::"text", 'sales'::"text", 'market-framework'::"text", 'case-study'::"text", 'thought-leadership'::"text"])))
);


ALTER TABLE "public"."psg_knowledge_meta" OWNER TO "postgres";


COMMENT ON TABLE "public"."psg_knowledge_meta" IS 'Tracks PSG documents ingested into the pgvector knowledge base. One row per document.';



CREATE TABLE IF NOT EXISTS "public"."reports" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "user_id" "uuid" NOT NULL,
    "client_name" "text" NOT NULL,
    "brief_data" "jsonb" DEFAULT '{}'::"jsonb" NOT NULL,
    "pdf_path" "text" DEFAULT ''::"text" NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "shop_id" "uuid",
    "report_type" "text" DEFAULT 'market_intelligence'::"text",
    "status" "text" DEFAULT 'pending'::"text",
    "score_overall" integer,
    "score_seo" integer,
    "score_reviews" integer,
    "score_listings" integer,
    "score_ai_readiness" integer,
    "score_competitive" integer,
    "competitor_ids" "uuid"[],
    "weather_correlation" "jsonb",
    "rag_context_used" boolean DEFAULT false,
    "llm_models_used" "jsonb",
    "generation_time_seconds" integer,
    "pdf_url" "text",
    "error_log" "jsonb"
);


ALTER TABLE "public"."reports" OWNER TO "postgres";


COMMENT ON TABLE "public"."reports" IS 'Market intelligence briefs — one row per completed brief';



COMMENT ON COLUMN "public"."reports"."user_id" IS 'UUID of the owning user (maps to auth.uid())';



COMMENT ON COLUMN "public"."reports"."brief_data" IS 'Full synthesized brief as JSONB';



COMMENT ON COLUMN "public"."reports"."pdf_path" IS 'Relative path to generated PDF file';



CREATE TABLE IF NOT EXISTS "public"."research_artifacts" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "campaign_id" "uuid",
    "artifact_type" "text" NOT NULL,
    "source_skill" "text" NOT NULL,
    "data" "jsonb" NOT NULL,
    "file_path" "text",
    "created_at" timestamp with time zone DEFAULT "now"(),
    CONSTRAINT "research_artifacts_artifact_type_check" CHECK (("artifact_type" = ANY (ARRAY['semrush_base'::"text", 'semrush_geo'::"text", 'semrush_competitor'::"text", 'semrush_gap'::"text", 'social_sentiment'::"text", 'social_personas'::"text", 'content_brief'::"text", 'qa_report'::"text"])))
);


ALTER TABLE "public"."research_artifacts" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."review_items" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "shop_id" "uuid" NOT NULL,
    "location_id" "uuid" NOT NULL,
    "platform" "text" NOT NULL,
    "rating" integer,
    "text" "text",
    "author" "text",
    "reviewed_at" timestamp with time zone,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL
);


ALTER TABLE "public"."review_items" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."review_responses" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "review_item_id" "uuid" NOT NULL,
    "draft_text" "text",
    "status" "text" DEFAULT 'draft'::"text" NOT NULL,
    "published_at" timestamp with time zone,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL
);


ALTER TABLE "public"."review_responses" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."reviews" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "page_id" "uuid",
    "author_id" "uuid",
    "note" "text",
    "suggestion" "text",
    "target_field" "text",
    "status" "text" DEFAULT 'open'::"text",
    "resolved_by" "uuid",
    "resolved_at" timestamp with time zone,
    "created_at" timestamp with time zone DEFAULT "now"(),
    "reviewer_name" "text",
    CONSTRAINT "reviews_status_check" CHECK (("status" = ANY (ARRAY['open'::"text", 'resolved'::"text", 'dismissed'::"text"])))
);


ALTER TABLE "public"."reviews" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."shop_users" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "user_id" "uuid" NOT NULL,
    "shop_id" "uuid" NOT NULL,
    "role" "text" DEFAULT 'viewer'::"text" NOT NULL,
    "location_ids" "uuid"[],
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    CONSTRAINT "shop_users_role_check" CHECK (("role" = ANY (ARRAY['owner'::"text", 'manager'::"text", 'viewer'::"text"])))
);


ALTER TABLE "public"."shop_users" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."shops" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "client_id" "uuid" NOT NULL,
    "name" "text",
    "url" "text",
    "telephone" "text",
    "address_street" "text",
    "address_locality" "text",
    "address_region" "text",
    "address_postal_code" "text",
    "address_country" "text" DEFAULT 'US'::"text",
    "radius" integer,
    "sort_order" integer DEFAULT 0,
    "created_at" timestamp with time zone DEFAULT "now"(),
    "latitude" double precision,
    "longitude" double precision,
    "is_urban" boolean,
    "search_radius_miles" integer DEFAULT 10,
    "yext_entity_id" "text",
    "google_place_id" "text",
    "certifications" "text"[],
    "adas_capable" boolean DEFAULT false,
    "oem_certified" boolean DEFAULT false,
    "subscription_tier" "text" DEFAULT 'essentials'::"text" NOT NULL,
    "is_multi_location" boolean DEFAULT false NOT NULL,
    "slug" "text",
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    CONSTRAINT "shops_subscription_tier_check" CHECK (("subscription_tier" = ANY (ARRAY['essentials'::"text", 'growth'::"text", 'performance'::"text", 'multi_location'::"text"])))
);


ALTER TABLE "public"."shops" OWNER TO "postgres";


COMMENT ON COLUMN "public"."shops"."is_urban" IS 'Determined from BigQuery ZIP demographics. True = 10-mile radius, False = 20-mile radius.';



COMMENT ON COLUMN "public"."shops"."search_radius_miles" IS 'Competitor search radius in miles. Set automatically based on is_urban.';



CREATE TABLE IF NOT EXISTS "public"."skills" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "name" "text",
    "version" "text",
    "description" "text",
    "file_path" "text",
    "installed_by" "uuid",
    "created_at" timestamp with time zone DEFAULT "now"()
);


ALTER TABLE "public"."skills" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."sms_events" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "message_sid" "text" NOT NULL,
    "status" "text" NOT NULL,
    "direction" "text",
    "from_number" "text",
    "to_number" "text",
    "error_code" integer,
    "payload" "jsonb" NOT NULL,
    "occurred_at" timestamp with time zone,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL
);


ALTER TABLE "public"."sms_events" OWNER TO "postgres";


COMMENT ON TABLE "public"."sms_events" IS 'Twilio SMS event log (Plan 03-02). Idempotency key = UNIQUE(message_sid, status), both NOT NULL: status callbacks fire once per lifecycle transition (queued/sent/delivered) so one message_sid yields multiple rows, while a replayed (message_sid,status) dedupes via upsert ignoreDuplicates; inbound messages use status=''received''. RLS enabled, no public policies (service-role writes only) — mirrors email_events.';



CREATE TABLE IF NOT EXISTS "public"."state_references" (
    "state_fips" "text" NOT NULL,
    "state_abbr" "text" NOT NULL,
    "state_name" "text" NOT NULL
);


ALTER TABLE "public"."state_references" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."state_vehicle_registrations" (
    "id" bigint NOT NULL,
    "state" "text" NOT NULL,
    "year" integer NOT NULL,
    "auto_count" integer,
    "bus_count" integer,
    "truck_count" integer,
    "motorcycle_count" integer,
    "total_count" integer GENERATED ALWAYS AS ((((COALESCE("auto_count", 0) + COALESCE("bus_count", 0)) + COALESCE("truck_count", 0)) + COALESCE("motorcycle_count", 0))) STORED,
    "source" "text" NOT NULL,
    "source_dataset" "text",
    "raw_payload" "jsonb",
    "import_batch_id" "text",
    "imported_at" timestamp with time zone DEFAULT "now"() NOT NULL
);


ALTER TABLE "public"."state_vehicle_registrations" OWNER TO "postgres";


CREATE SEQUENCE IF NOT EXISTS "public"."state_vehicle_registrations_id_seq"
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


ALTER SEQUENCE "public"."state_vehicle_registrations_id_seq" OWNER TO "postgres";


ALTER SEQUENCE "public"."state_vehicle_registrations_id_seq" OWNED BY "public"."state_vehicle_registrations"."id";



CREATE TABLE IF NOT EXISTS "public"."storm_event_sources" (
    "id" bigint NOT NULL,
    "source_key" "text" NOT NULL,
    "source_url" "text" NOT NULL,
    "file_family" "text" NOT NULL,
    "source_year" integer NOT NULL,
    "cycle" "text" NOT NULL,
    "file_url" "text" NOT NULL,
    "row_count" integer DEFAULT 0,
    "status" "text" NOT NULL,
    "import_batch_id" "text" NOT NULL,
    "notes" "text",
    "imported_at" timestamp with time zone DEFAULT "now"()
);


ALTER TABLE "public"."storm_event_sources" OWNER TO "postgres";


CREATE SEQUENCE IF NOT EXISTS "public"."storm_event_sources_id_seq"
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


ALTER SEQUENCE "public"."storm_event_sources_id_seq" OWNER TO "postgres";


ALTER SEQUENCE "public"."storm_event_sources_id_seq" OWNED BY "public"."storm_event_sources"."id";



CREATE TABLE IF NOT EXISTS "public"."storm_events" (
    "id" bigint NOT NULL,
    "source" "text" DEFAULT 'ncei_storm_events'::"text" NOT NULL,
    "source_event_id" bigint NOT NULL,
    "episode_id" bigint,
    "event_type" "text" NOT NULL,
    "event_type_normalized" "text" NOT NULL,
    "begin_time" timestamp with time zone,
    "end_time" timestamp with time zone,
    "state" "text",
    "state_fips" "text",
    "source_year" integer,
    "source_month" integer,
    "month_name" "text",
    "cz_type" "text",
    "cz_fips" "text",
    "cz_name" "text",
    "wfo" "text",
    "magnitude" numeric,
    "magnitude_type" "text",
    "injuries_direct" integer,
    "injuries_indirect" integer,
    "deaths_direct" integer,
    "deaths_indirect" integer,
    "damage_property_usd" numeric,
    "damage_crops_usd" numeric,
    "begin_lat" double precision,
    "begin_lng" double precision,
    "end_lat" double precision,
    "end_lng" double precision,
    "begin_location" "public"."geography"(Point,4326),
    "end_location" "public"."geography"(Point,4326),
    "repair_demand_weight" numeric DEFAULT 1 NOT NULL,
    "import_batch_id" "text",
    "imported_at" timestamp with time zone DEFAULT "now"(),
    "raw_payload" "jsonb" DEFAULT '{}'::"jsonb"
);


ALTER TABLE "public"."storm_events" OWNER TO "postgres";


CREATE SEQUENCE IF NOT EXISTS "public"."storm_events_id_seq"
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


ALTER SEQUENCE "public"."storm_events_id_seq" OWNER TO "postgres";


ALTER SEQUENCE "public"."storm_events_id_seq" OWNED BY "public"."storm_events"."id";



CREATE TABLE IF NOT EXISTS "public"."storm_zip_monthly" (
    "zip" "text" NOT NULL,
    "month" "date" NOT NULL,
    "state" "text",
    "total_events" integer DEFAULT 0,
    "hail_events" integer DEFAULT 0,
    "wind_events" integer DEFAULT 0,
    "tornado_events" integer DEFAULT 0,
    "flood_events" integer DEFAULT 0,
    "hurricane_tropical_events" integer DEFAULT 0,
    "lightning_events" integer DEFAULT 0,
    "winter_storm_events" integer DEFAULT 0,
    "high_wind_events" integer DEFAULT 0,
    "weighted_storm_demand_score" numeric DEFAULT 0,
    "max_hail_size" numeric,
    "max_wind_speed" numeric,
    "property_damage_usd" numeric DEFAULT 0,
    "unmatched_event_count" integer DEFAULT 0,
    "fallback_event_count" integer DEFAULT 0,
    "refreshed_at" timestamp with time zone DEFAULT "now"()
);


ALTER TABLE "public"."storm_zip_monthly" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."subscriptions" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "shop_id" "uuid" NOT NULL,
    "stripe_customer_id" "text" NOT NULL,
    "stripe_subscription_id" "text" NOT NULL,
    "tier" "text" DEFAULT 'essentials'::"text" NOT NULL,
    "status" "text" DEFAULT 'active'::"text" NOT NULL,
    "current_period_end" timestamp with time zone,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    CONSTRAINT "subscriptions_status_check" CHECK (("status" = ANY (ARRAY['active'::"text", 'past_due'::"text", 'canceled'::"text", 'trialing'::"text"]))),
    CONSTRAINT "subscriptions_tier_check" CHECK (("tier" = ANY (ARRAY['essentials'::"text", 'growth'::"text", 'performance'::"text", 'multi_location'::"text"])))
);


ALTER TABLE "public"."subscriptions" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."survey_responses" (
    "id" bigint NOT NULL,
    "shop_name" "text" NOT NULL,
    "survey_date" "date" NOT NULL,
    "scale_emi_pct" numeric(7,6),
    "q05_01" numeric,
    "q05_02" numeric,
    "q05_03" numeric,
    "q05_04" numeric,
    "text_customer_comments" "text",
    "source" "text" DEFAULT 'bigquery_migration'::"text",
    "import_batch_id" "text",
    "imported_at" timestamp with time zone DEFAULT "now"(),
    "created_at" timestamp with time zone DEFAULT "now"(),
    "raw_payload" "jsonb" DEFAULT '{}'::"jsonb",
    "response_id" "text",
    "match_key" "text",
    "shop_id" "text"
);


ALTER TABLE "public"."survey_responses" OWNER TO "postgres";


CREATE SEQUENCE IF NOT EXISTS "public"."survey_responses_id_seq"
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


ALTER SEQUENCE "public"."survey_responses_id_seq" OWNER TO "postgres";


ALTER SEQUENCE "public"."survey_responses_id_seq" OWNED BY "public"."survey_responses"."id";



CREATE TABLE IF NOT EXISTS "public"."utm_exports" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "campaign_name" "text" DEFAULT 'NWI Hail 2026'::"text" NOT NULL,
    "channel" "text" NOT NULL,
    "medium" "text" NOT NULL,
    "utm_campaign" "text" NOT NULL,
    "utm_content" "text" NOT NULL,
    "full_url" "text" NOT NULL,
    "client" "text"
);


ALTER TABLE "public"."utm_exports" OWNER TO "postgres";


CREATE OR REPLACE VIEW "public"."v_accident_trends_by_zip" AS
 WITH "yearly" AS (
         SELECT "accidents"."zipcode" AS "zip",
            "accidents"."state",
            (EXTRACT(year FROM "accidents"."start_time"))::integer AS "year",
            "count"(*) AS "accident_count",
            "count"(*) FILTER (WHERE ("accidents"."severity" >= 3)) AS "high_severity_count",
            "round"("avg"("accidents"."severity"), 2) AS "avg_severity"
           FROM "public"."accidents"
          WHERE (("accidents"."zipcode" IS NOT NULL) AND ("accidents"."start_time" IS NOT NULL))
          GROUP BY "accidents"."zipcode", "accidents"."state", (EXTRACT(year FROM "accidents"."start_time"))
        )
 SELECT "zip",
    "state",
    "year",
    "accident_count",
    "high_severity_count",
    "avg_severity",
    "lag"("accident_count") OVER (PARTITION BY "zip" ORDER BY "year") AS "prev_year_count",
    "round"((((("accident_count" - "lag"("accident_count") OVER (PARTITION BY "zip" ORDER BY "year")))::numeric / (NULLIF("lag"("accident_count") OVER (PARTITION BY "zip" ORDER BY "year"), 0))::numeric) * (100)::numeric), 1) AS "yoy_change_pct"
   FROM "yearly";


ALTER VIEW "public"."v_accident_trends_by_zip" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."zipcode_boundaries" (
    "zip_code" "text" NOT NULL,
    "state_fips" "text",
    "boundary" "public"."geometry"(MultiPolygon,4326),
    "boundary_geojson" "jsonb",
    "imported_at" timestamp with time zone DEFAULT "now"()
);


ALTER TABLE "public"."zipcode_boundaries" OWNER TO "postgres";


CREATE OR REPLACE VIEW "public"."v_collision_targeting_zip_annual" AS
 WITH "shop_zip" AS (
         SELECT "zb"."zip_code" AS "zip",
            "count"(*) FILTER (WHERE ("points"."layer" = 'psg_customer'::"text")) AS "psg_customer_count",
            "count"(*) FILTER (WHERE ("points"."layer" = 'directory_shop'::"text")) AS "directory_shop_count",
            "count"(*) FILTER (WHERE (("points"."layer" = 'psg_customer'::"text") AND (COALESCE("points"."survey_count", (0)::bigint) > 0))) AS "surveyed_psg_customer_count"
           FROM ("public"."market_map_points"(NULL::"text", 40000) "points"("layer", "id", "shop_name", "psg_id", "invoiced_id", "place_id", "address", "phone", "website", "rating", "latitude", "longitude", "state", "city", "survey_count", "avg_emi_pct", "match_status")
             JOIN "public"."zipcode_boundaries" "zb" ON ((("zb"."boundary" IS NOT NULL) AND "public"."st_covers"("zb"."boundary", "public"."st_setsrid"("public"."st_makepoint"("points"."longitude", "points"."latitude"), 4326)))))
          GROUP BY "zb"."zip_code"
        ), "storm_by_zip_year" AS (
         SELECT "storm_zip_monthly"."zip",
            (EXTRACT(year FROM "storm_zip_monthly"."month"))::integer AS "year",
            "sum"("storm_zip_monthly"."total_events") AS "storm_event_count",
            "sum"("storm_zip_monthly"."hail_events") AS "hail_event_count",
            "sum"("storm_zip_monthly"."wind_events") AS "wind_event_count",
            "sum"("storm_zip_monthly"."tornado_events") AS "tornado_event_count",
            "sum"("storm_zip_monthly"."weighted_storm_demand_score") AS "storm_demand_score"
           FROM "public"."storm_zip_monthly"
          WHERE ("storm_zip_monthly"."zip" <> '__UNMATCHED__'::"text")
          GROUP BY "storm_zip_monthly"."zip", ((EXTRACT(year FROM "storm_zip_monthly"."month"))::integer)
        )
 SELECT "cza"."source",
    "cza"."zip",
    "cza"."state",
    "cza"."city",
    "cza"."year",
    "cza"."total_crashes",
    "cza"."fatal_crashes",
    "cza"."injury_crashes",
    "cza"."tow_or_injury_crashes",
    "cza"."property_damage_crashes",
    "cza"."weather_related_crashes",
    "cza"."weighted_crash_demand_score",
    COALESCE("szy"."storm_event_count", (0)::bigint) AS "storm_event_count",
    COALESCE("szy"."hail_event_count", (0)::bigint) AS "hail_event_count",
    COALESCE("szy"."wind_event_count", (0)::bigint) AS "wind_event_count",
    COALESCE("szy"."tornado_event_count", (0)::bigint) AS "tornado_event_count",
    COALESCE("szy"."storm_demand_score", (0)::numeric) AS "storm_demand_score",
    COALESCE("sz"."psg_customer_count", (0)::bigint) AS "psg_customer_count",
    COALESCE("sz"."directory_shop_count", (0)::bigint) AS "directory_shop_count",
    COALESCE("sz"."surveyed_psg_customer_count", (0)::bigint) AS "surveyed_psg_customer_count",
    "round"((("cza"."weighted_crash_demand_score" + (COALESCE("szy"."storm_demand_score", (0)::numeric) * 0.35)) + ((GREATEST((10 - COALESCE("sz"."psg_customer_count", (0)::bigint)), (0)::bigint) * 25))::numeric), 2) AS "collision_targeting_score"
   FROM (("public"."crash_zip_annual" "cza"
     LEFT JOIN "storm_by_zip_year" "szy" ON ((("szy"."zip" = "cza"."zip") AND ("szy"."year" = "cza"."year"))))
     LEFT JOIN "shop_zip" "sz" ON (("sz"."zip" = "cza"."zip")))
  WHERE ("cza"."zip" <> '__UNMATCHED__'::"text");


ALTER VIEW "public"."v_collision_targeting_zip_annual" OWNER TO "postgres";


CREATE OR REPLACE VIEW "public"."v_market_opportunity" AS
 WITH "storm_by_zip" AS (
         SELECT "storm_zip_monthly"."zip",
            "sum"("storm_zip_monthly"."weighted_storm_demand_score") AS "storm_demand_score"
           FROM "public"."storm_zip_monthly"
          GROUP BY "storm_zip_monthly"."zip"
        ), "base" AS (
         SELECT "d"."zip",
            "d"."state",
            "sum"("d"."total_count") AS "total_accidents",
            "sum"(("d"."severity_3_count" + "d"."severity_4_count")) AS "high_severity_count",
            (("sum"(("d"."severity_3_count" + "d"."severity_4_count")))::numeric / (NULLIF("sum"("d"."total_count"), 0))::numeric) AS "high_severity_pct",
            COALESCE("max"("sbz"."storm_demand_score"), (0)::numeric) AS "storm_demand_score"
           FROM ("public"."accident_density" "d"
             LEFT JOIN "storm_by_zip" "sbz" ON (("sbz"."zip" = "d"."zip")))
          GROUP BY "d"."zip", "d"."state"
        ), "scored" AS (
         SELECT "base"."zip",
            "base"."state",
            "base"."total_accidents",
            "base"."high_severity_count",
            "base"."high_severity_pct",
            "base"."storm_demand_score",
            "round"((((("percent_rank"() OVER (ORDER BY "base"."total_accidents") * (55)::double precision) + ("percent_rank"() OVER (ORDER BY "base"."high_severity_pct") * (25)::double precision)) + ("percent_rank"() OVER (ORDER BY "base"."storm_demand_score") * (20)::double precision)))::numeric, 1) AS "opportunity_score"
           FROM "base"
        )
 SELECT "zip",
    "state",
    "total_accidents",
    "high_severity_count",
    "high_severity_pct",
    NULL::double precision AS "nearest_shop_meters",
    "opportunity_score",
        CASE
            WHEN ("opportunity_score" >= (75)::numeric) THEN 'High'::"text"
            WHEN ("opportunity_score" >= (40)::numeric) THEN 'Medium'::"text"
            ELSE 'Low'::"text"
        END AS "opportunity_tier"
   FROM "scored";


ALTER VIEW "public"."v_market_opportunity" OWNER TO "postgres";


CREATE OR REPLACE VIEW "public"."v_shop_coverage" AS
 WITH "accident_counts" AS (
         SELECT "s_1"."shop_id",
            "count"("a".*) AS "accidents_within_10mi"
           FROM ("public"."body_shops" "s_1"
             LEFT JOIN "public"."accidents" "a" ON ((("s_1"."location" IS NOT NULL) AND ("a"."location" IS NOT NULL) AND "public"."st_dwithin"("s_1"."location", "a"."location", (16093.4)::double precision))))
          GROUP BY "s_1"."shop_id"
        ), "competitor_counts" AS (
         SELECT "s1"."shop_id",
            "count"(DISTINCT "s2"."shop_id") AS "competing_shops_within_10mi"
           FROM ("public"."body_shops" "s1"
             LEFT JOIN "public"."body_shops" "s2" ON ((("s1"."shop_id" <> "s2"."shop_id") AND ("s1"."location" IS NOT NULL) AND ("s2"."location" IS NOT NULL) AND "public"."st_dwithin"("s1"."location", "s2"."location", (16093.4)::double precision))))
          GROUP BY "s1"."shop_id"
        )
 SELECT "s"."shop_id",
    "s"."shop_name",
    COALESCE("ac"."accidents_within_10mi", (0)::bigint) AS "accidents_within_10mi",
    COALESCE("cc"."competing_shops_within_10mi", (0)::bigint) AS "competing_shops_within_10mi"
   FROM (("public"."body_shops" "s"
     LEFT JOIN "accident_counts" "ac" ON (("s"."shop_id" = "ac"."shop_id")))
     LEFT JOIN "competitor_counts" "cc" ON (("s"."shop_id" = "cc"."shop_id")))
  WHERE ("s"."location" IS NOT NULL);


ALTER VIEW "public"."v_shop_coverage" OWNER TO "postgres";


CREATE OR REPLACE VIEW "public"."v_storm_demand_examples" AS
 SELECT "zip",
    "month",
    "state",
    "total_events",
    "hail_events",
    "wind_events",
    "tornado_events",
    "flood_events",
    "high_wind_events",
    "weighted_storm_demand_score",
    "max_hail_size",
    "max_wind_speed",
    "property_damage_usd",
        CASE
            WHEN ("hail_events" >= GREATEST("wind_events", "tornado_events", "flood_events")) THEN 'hail'::"text"
            WHEN ("wind_events" >= GREATEST("hail_events", "tornado_events", "flood_events")) THEN 'damaging wind'::"text"
            WHEN ("tornado_events" > 0) THEN 'tornado'::"text"
            WHEN ("flood_events" > 0) THEN 'flood'::"text"
            ELSE 'storm activity'::"text"
        END AS "primary_demand_signal",
    "concat"('ZIP ', "zip", ' had ', ("total_events")::"text", ' NOAA storm events in ', "to_char"(("month")::timestamp with time zone, 'Mon YYYY'::"text"), ', including ', ("hail_events")::"text", ' hail, ', ("wind_events")::"text", ' wind, and ', ("tornado_events")::"text", ' tornado events.') AS "example_detail"
   FROM "public"."storm_zip_monthly" "szm"
  WHERE (("zip" <> '__UNMATCHED__'::"text") AND ("total_events" > 0));


ALTER VIEW "public"."v_storm_demand_examples" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."weather_cache" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "zip_code" "text" NOT NULL,
    "year" integer NOT NULL,
    "month" integer NOT NULL,
    "avg_precipitation_mm" double precision,
    "avg_temp_celsius" double precision,
    "precipitation_days" integer,
    "snow_days" integer,
    "severe_weather_events" integer,
    "accident_correlation_score" double precision,
    "raw_data" "jsonb",
    "cached_at" timestamp with time zone DEFAULT "now"()
);


ALTER TABLE "public"."weather_cache" OWNER TO "postgres";


COMMENT ON TABLE "public"."weather_cache" IS 'Monthly weather data per ZIP from Meteostat. Correlated with BigQuery accident data.';



CREATE TABLE IF NOT EXISTS "public"."zcta_income_annual" (
    "year" integer NOT NULL,
    "zip" "text" NOT NULL,
    "name" "text",
    "households" bigint,
    "aggregate_household_income" numeric,
    "mean_household_income" numeric,
    "median_household_income" numeric,
    "source" "text" DEFAULT 'us_census'::"text" NOT NULL,
    "source_table" "text" DEFAULT 'acs5.B11001/B19013/B19025'::"text" NOT NULL,
    "raw_payload" "jsonb" DEFAULT '{}'::"jsonb" NOT NULL,
    "imported_at" timestamp with time zone DEFAULT "now"() NOT NULL
);


ALTER TABLE "public"."zcta_income_annual" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."zcta_vehicle_availability" (
    "id" bigint NOT NULL,
    "zcta" "text" NOT NULL,
    "year" integer NOT NULL,
    "aggregate_vehicles" integer,
    "aggregate_vehicles_moe" integer,
    "owner_vehicles" integer,
    "renter_vehicles" integer,
    "total_occupied_units" integer,
    "owner_occupied" integer,
    "owner_0veh" integer,
    "owner_1veh" integer,
    "owner_2veh" integer,
    "owner_3veh" integer,
    "owner_4veh" integer,
    "owner_5plus" integer,
    "renter_occupied" integer,
    "renter_0veh" integer,
    "renter_1veh" integer,
    "renter_2veh" integer,
    "renter_3veh" integer,
    "renter_4veh" integer,
    "renter_5plus" integer,
    "source" "text" DEFAULT 'us_census'::"text" NOT NULL,
    "source_table" "text",
    "raw_payload" "jsonb",
    "imported_at" timestamp with time zone DEFAULT "now"() NOT NULL
);


ALTER TABLE "public"."zcta_vehicle_availability" OWNER TO "postgres";


CREATE SEQUENCE IF NOT EXISTS "public"."zcta_vehicle_availability_id_seq"
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


ALTER SEQUENCE "public"."zcta_vehicle_availability_id_seq" OWNER TO "postgres";


ALTER SEQUENCE "public"."zcta_vehicle_availability_id_seq" OWNED BY "public"."zcta_vehicle_availability"."id";



CREATE TABLE IF NOT EXISTS "public"."zcta_zip_mapping" (
    "zip_code" "text" NOT NULL,
    "reporting_year" integer,
    "zip_type" "text",
    "city_name" "text",
    "state_name" "text",
    "state_abbr" "text",
    "enc_zip" "text",
    "zcta" "text"
);


ALTER TABLE "public"."zcta_zip_mapping" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."zip_references" (
    "zip_code" "text" NOT NULL,
    "state_fips" "text",
    "county_fips" "text" NOT NULL
);


ALTER TABLE "public"."zip_references" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "sensitive"."pii_access_log" (
    "id" bigint NOT NULL,
    "accessed_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "actor_user_id" "uuid",
    "actor_email" "text",
    "actor_role" "text",
    "action" "text" NOT NULL,
    "target_table" "text" NOT NULL,
    "target_key" "text",
    "reason" "text",
    "request_metadata" "jsonb" DEFAULT '{}'::"jsonb" NOT NULL
);


ALTER TABLE "sensitive"."pii_access_log" OWNER TO "postgres";


CREATE SEQUENCE IF NOT EXISTS "sensitive"."pii_access_log_id_seq"
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


ALTER SEQUENCE "sensitive"."pii_access_log_id_seq" OWNER TO "postgres";


ALTER SEQUENCE "sensitive"."pii_access_log_id_seq" OWNED BY "sensitive"."pii_access_log"."id";



CREATE TABLE IF NOT EXISTS "sensitive"."repair_customer_locations" (
    "id" bigint NOT NULL,
    "repair_customer_id" bigint NOT NULL,
    "repair_id" "text",
    "shop_id" "text",
    "shop_name" "text",
    "repair_date" "date",
    "customer_zip" "text",
    "customer_city" "text",
    "customer_state" "text",
    "address_hash" "text",
    "latitude" double precision,
    "longitude" double precision,
    "location" "public"."geography"(Point,4326),
    "geocode_provider" "text" NOT NULL,
    "geocode_status" "text" NOT NULL,
    "geocode_confidence" numeric,
    "formatted_address" "text",
    "failure_reason" "text",
    "raw_geocode_payload" "jsonb" DEFAULT '{}'::"jsonb" NOT NULL,
    "import_batch_id" "text",
    "imported_at" timestamp with time zone DEFAULT "now"() NOT NULL
);


ALTER TABLE "sensitive"."repair_customer_locations" OWNER TO "postgres";


CREATE SEQUENCE IF NOT EXISTS "sensitive"."repair_customer_locations_id_seq"
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


ALTER SEQUENCE "sensitive"."repair_customer_locations_id_seq" OWNER TO "postgres";


ALTER SEQUENCE "sensitive"."repair_customer_locations_id_seq" OWNED BY "sensitive"."repair_customer_locations"."id";



CREATE TABLE IF NOT EXISTS "sensitive"."repair_customers" (
    "id" bigint NOT NULL,
    "repair_id" "text",
    "match_key" "text",
    "shop_id" "text",
    "shop_name" "text",
    "creation_date" "date",
    "date_in" "date",
    "date_out" "date",
    "ro_number" "text",
    "repair_total" numeric,
    "pay_type" "text",
    "insurance_company" "text",
    "vehicle_year" integer,
    "vehicle_make" "text",
    "vehicle_model" "text",
    "customer_first_name" "text",
    "customer_last_name" "text",
    "customer_email" "text",
    "customer_phone" "text",
    "source_platform" "text",
    "survey_sent" boolean,
    "survey_sent_date" "date",
    "anomaly_flag" boolean,
    "source_loaded_at" timestamp with time zone,
    "imported_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "raw_payload" "jsonb" DEFAULT '{}'::"jsonb" NOT NULL
);


ALTER TABLE "sensitive"."repair_customers" OWNER TO "postgres";


CREATE SEQUENCE IF NOT EXISTS "sensitive"."repair_customers_id_seq"
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


ALTER SEQUENCE "sensitive"."repair_customers_id_seq" OWNER TO "postgres";


ALTER SEQUENCE "sensitive"."repair_customers_id_seq" OWNED BY "sensitive"."repair_customers"."id";



CREATE TABLE IF NOT EXISTS "sensitive"."survey_pii" (
    "id" bigint NOT NULL,
    "response_id" "text",
    "match_key" "text",
    "customer_first_name" "text",
    "customer_last_name" "text",
    "customer_address" "text",
    "customer_address2" "text",
    "customer_city" "text",
    "customer_state" "text",
    "customer_zip" "text",
    "customer_phone_home" "text",
    "customer_phone_mobile" "text",
    "customer_phone_night" "text",
    "agent_first_name" "text",
    "agent_last_name" "text",
    "agent_address" "text",
    "agent_address2" "text",
    "agent_city" "text",
    "agent_state" "text",
    "agent_zip" "text",
    "vehicle_make" "text",
    "vehicle_model" "text",
    "source_loaded_at" timestamp with time zone,
    "imported_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "raw_payload" "jsonb" DEFAULT '{}'::"jsonb" NOT NULL
);


ALTER TABLE "sensitive"."survey_pii" OWNER TO "postgres";


CREATE SEQUENCE IF NOT EXISTS "sensitive"."survey_pii_id_seq"
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


ALTER SEQUENCE "sensitive"."survey_pii_id_seq" OWNER TO "postgres";


ALTER SEQUENCE "sensitive"."survey_pii_id_seq" OWNED BY "sensitive"."survey_pii"."id";



CREATE TABLE IF NOT EXISTS "vecs"."psg_knowledge" (
    "id" "text" NOT NULL,
    "vec" "extensions"."vector"(768) NOT NULL,
    "metadata" "jsonb" DEFAULT '{}'::"jsonb"
);


ALTER TABLE "vecs"."psg_knowledge" OWNER TO "postgres";


COMMENT ON TABLE "vecs"."psg_knowledge" IS 'PSG proprietary knowledge base. Chunks of PSG playbooks, frameworks, and case studies embedded with Vertex AI text-embedding-004 (768 dimensions).';



ALTER TABLE ONLY "public"."accidents" ATTACH PARTITION "public"."accidents_2016" FOR VALUES FROM ('2016-01-01 00:00:00+00') TO ('2017-01-01 00:00:00+00');



ALTER TABLE ONLY "public"."accidents" ATTACH PARTITION "public"."accidents_2017" FOR VALUES FROM ('2017-01-01 00:00:00+00') TO ('2018-01-01 00:00:00+00');



ALTER TABLE ONLY "public"."accidents" ATTACH PARTITION "public"."accidents_2018" FOR VALUES FROM ('2018-01-01 00:00:00+00') TO ('2019-01-01 00:00:00+00');



ALTER TABLE ONLY "public"."accidents" ATTACH PARTITION "public"."accidents_2019" FOR VALUES FROM ('2019-01-01 00:00:00+00') TO ('2020-01-01 00:00:00+00');



ALTER TABLE ONLY "public"."accidents" ATTACH PARTITION "public"."accidents_2020" FOR VALUES FROM ('2020-01-01 00:00:00+00') TO ('2021-01-01 00:00:00+00');



ALTER TABLE ONLY "public"."accidents" ATTACH PARTITION "public"."accidents_2021" FOR VALUES FROM ('2021-01-01 00:00:00+00') TO ('2022-01-01 00:00:00+00');



ALTER TABLE ONLY "public"."accidents" ATTACH PARTITION "public"."accidents_2022" FOR VALUES FROM ('2022-01-01 00:00:00+00') TO ('2023-01-01 00:00:00+00');



ALTER TABLE ONLY "public"."accidents" ATTACH PARTITION "public"."accidents_2023" FOR VALUES FROM ('2023-01-01 00:00:00+00') TO ('2024-01-01 00:00:00+00');



ALTER TABLE ONLY "public"."accidents" ATTACH PARTITION "public"."accidents_2024" FOR VALUES FROM ('2024-01-01 00:00:00+00') TO ('2025-01-01 00:00:00+00');



ALTER TABLE ONLY "public"."accidents" ATTACH PARTITION "public"."accidents_2025" FOR VALUES FROM ('2025-01-01 00:00:00+00') TO ('2026-01-01 00:00:00+00');



ALTER TABLE ONLY "public"."accidents" ATTACH PARTITION "public"."accidents_2026" FOR VALUES FROM ('2026-01-01 00:00:00+00') TO ('2027-01-01 00:00:00+00');



ALTER TABLE ONLY "public"."accidents" ATTACH PARTITION "public"."accidents_2027" FOR VALUES FROM ('2027-01-01 00:00:00+00') TO ('2028-01-01 00:00:00+00');



ALTER TABLE ONLY "public"."accidents" ATTACH PARTITION "public"."accidents_default" DEFAULT;



ALTER TABLE ONLY "public"."accident_import_sources" ALTER COLUMN "id" SET DEFAULT "nextval"('"public"."accident_import_sources_id_seq"'::"regclass");



ALTER TABLE ONLY "public"."county_vehicle_registrations" ALTER COLUMN "id" SET DEFAULT "nextval"('"public"."county_vehicle_registrations_id_seq"'::"regclass");



ALTER TABLE ONLY "public"."crash_event_sources" ALTER COLUMN "id" SET DEFAULT "nextval"('"public"."crash_event_sources_id_seq"'::"regclass");



ALTER TABLE ONLY "public"."crash_events" ALTER COLUMN "id" SET DEFAULT "nextval"('"public"."crash_events_id_seq"'::"regclass");



ALTER TABLE ONLY "public"."dmv_vehicle_registrations" ALTER COLUMN "id" SET DEFAULT "nextval"('"public"."dmv_vehicle_registrations_id_seq"'::"regclass");



ALTER TABLE ONLY "public"."estimated_zip_vehicles" ALTER COLUMN "id" SET DEFAULT "nextval"('"public"."estimated_zip_vehicles_id_seq"'::"regclass");



ALTER TABLE ONLY "public"."ev_registrations" ALTER COLUMN "id" SET DEFAULT "nextval"('"public"."ev_registrations_id_seq"'::"regclass");



ALTER TABLE ONLY "public"."state_vehicle_registrations" ALTER COLUMN "id" SET DEFAULT "nextval"('"public"."state_vehicle_registrations_id_seq"'::"regclass");



ALTER TABLE ONLY "public"."storm_event_sources" ALTER COLUMN "id" SET DEFAULT "nextval"('"public"."storm_event_sources_id_seq"'::"regclass");



ALTER TABLE ONLY "public"."storm_events" ALTER COLUMN "id" SET DEFAULT "nextval"('"public"."storm_events_id_seq"'::"regclass");



ALTER TABLE ONLY "public"."survey_responses" ALTER COLUMN "id" SET DEFAULT "nextval"('"public"."survey_responses_id_seq"'::"regclass");



ALTER TABLE ONLY "public"."zcta_vehicle_availability" ALTER COLUMN "id" SET DEFAULT "nextval"('"public"."zcta_vehicle_availability_id_seq"'::"regclass");



ALTER TABLE ONLY "sensitive"."pii_access_log" ALTER COLUMN "id" SET DEFAULT "nextval"('"sensitive"."pii_access_log_id_seq"'::"regclass");



ALTER TABLE ONLY "sensitive"."repair_customer_locations" ALTER COLUMN "id" SET DEFAULT "nextval"('"sensitive"."repair_customer_locations_id_seq"'::"regclass");



ALTER TABLE ONLY "sensitive"."repair_customers" ALTER COLUMN "id" SET DEFAULT "nextval"('"sensitive"."repair_customers_id_seq"'::"regclass");



ALTER TABLE ONLY "sensitive"."survey_pii" ALTER COLUMN "id" SET DEFAULT "nextval"('"sensitive"."survey_pii_id_seq"'::"regclass");



ALTER TABLE ONLY "public"."accident_density"
    ADD CONSTRAINT "accident_density_pkey" PRIMARY KEY ("zip", "year");



ALTER TABLE ONLY "public"."accident_import_sources"
    ADD CONSTRAINT "accident_import_sources_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."accident_market_daypart_rollup"
    ADD CONSTRAINT "accident_market_daypart_rollup_pkey" PRIMARY KEY ("city", "state", "bucket");



ALTER TABLE ONLY "public"."accident_market_rollup"
    ADD CONSTRAINT "accident_market_rollup_pkey" PRIMARY KEY ("city", "state");



ALTER TABLE ONLY "public"."accident_market_zip_rollup"
    ADD CONSTRAINT "accident_market_zip_rollup_pkey" PRIMARY KEY ("city", "state", "zip");



ALTER TABLE ONLY "public"."activity_log"
    ADD CONSTRAINT "activity_log_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."ad_copy_events"
    ADD CONSTRAINT "ad_copy_events_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."ai_prompt_templates"
    ADD CONSTRAINT "ai_prompt_templates_content_type_persona_version_key" UNIQUE ("content_type", "persona", "version");



ALTER TABLE ONLY "public"."ai_prompt_templates"
    ADD CONSTRAINT "ai_prompt_templates_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."analytics_snapshots"
    ADD CONSTRAINT "analytics_snapshots_location_id_date_key" UNIQUE ("location_id", "date");



ALTER TABLE ONLY "public"."analytics_snapshots"
    ADD CONSTRAINT "analytics_snapshots_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."api_cache"
    ADD CONSTRAINT "api_cache_cache_key_key" UNIQUE ("cache_key");



ALTER TABLE ONLY "public"."api_cache"
    ADD CONSTRAINT "api_cache_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."body_shops"
    ADD CONSTRAINT "body_shops_pkey" PRIMARY KEY ("shop_id");



ALTER TABLE ONLY "public"."body_shops"
    ADD CONSTRAINT "body_shops_place_id_key" UNIQUE ("place_id");



ALTER TABLE ONLY "public"."bsm_campaigns"
    ADD CONSTRAINT "bsm_campaigns_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."campaign_budget_snapshots"
    ADD CONSTRAINT "campaign_budget_snapshots_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."campaign_sends"
    ADD CONSTRAINT "campaign_sends_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."campaigns"
    ADD CONSTRAINT "campaigns_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."campaigns"
    ADD CONSTRAINT "campaigns_review_token_key" UNIQUE ("review_token");



ALTER TABLE ONLY "public"."clients"
    ADD CONSTRAINT "clients_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."competitors"
    ADD CONSTRAINT "competitors_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."configs"
    ADD CONSTRAINT "configs_name_key" UNIQUE ("name");



ALTER TABLE ONLY "public"."configs"
    ADD CONSTRAINT "configs_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."consolidators"
    ADD CONSTRAINT "consolidators_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."content_items"
    ADD CONSTRAINT "content_items_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."county_references"
    ADD CONSTRAINT "county_references_pkey" PRIMARY KEY ("county_fips");



ALTER TABLE ONLY "public"."county_vehicle_registrations"
    ADD CONSTRAINT "county_vehicle_registrations_county_name_state_source_snaps_key" UNIQUE ("county_name", "state", "source", "snapshot_date");



ALTER TABLE ONLY "public"."county_vehicle_registrations"
    ADD CONSTRAINT "county_vehicle_registrations_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."crash_event_sources"
    ADD CONSTRAINT "crash_event_sources_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."crash_event_sources"
    ADD CONSTRAINT "crash_event_sources_source_key_geography_source_year_key" UNIQUE ("source_key", "geography", "source_year");



ALTER TABLE ONLY "public"."crash_events"
    ADD CONSTRAINT "crash_events_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."crash_events"
    ADD CONSTRAINT "crash_events_source_source_event_id_key" UNIQUE ("source", "source_event_id");



ALTER TABLE ONLY "public"."crash_zip_annual"
    ADD CONSTRAINT "crash_zip_annual_pkey" PRIMARY KEY ("source", "zip", "year");



ALTER TABLE ONLY "public"."customer_zip_report_monthly"
    ADD CONSTRAINT "customer_zip_report_monthly_pkey" PRIMARY KEY ("month", "shop_id", "zip");



ALTER TABLE ONLY "public"."discovery_briefs"
    ADD CONSTRAINT "discovery_briefs_campaign_id_key" UNIQUE ("campaign_id");



ALTER TABLE ONLY "public"."discovery_briefs"
    ADD CONSTRAINT "discovery_briefs_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."dmv_vehicle_registrations"
    ADD CONSTRAINT "dmv_vehicle_registrations_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."dmv_vehicle_registrations"
    ADD CONSTRAINT "dmv_vehicle_registrations_zip_snapshot_date_key" UNIQUE ("zip", "snapshot_date");



ALTER TABLE ONLY "public"."elements"
    ADD CONSTRAINT "elements_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."email_events"
    ADD CONSTRAINT "email_events_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."email_events"
    ADD CONSTRAINT "email_events_sg_event_id_key" UNIQUE ("sg_event_id");



ALTER TABLE ONLY "public"."estimated_zip_vehicles"
    ADD CONSTRAINT "estimated_zip_vehicles_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."estimated_zip_vehicles"
    ADD CONSTRAINT "estimated_zip_vehicles_zip_year_key" UNIQUE ("zip", "year");



ALTER TABLE ONLY "public"."ev_registrations"
    ADD CONSTRAINT "ev_registrations_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."integrations"
    ADD CONSTRAINT "integrations_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."invoiced_customers"
    ADD CONSTRAINT "invoiced_customers_pkey" PRIMARY KEY ("invoiced_id");



ALTER TABLE ONLY "public"."leads"
    ADD CONSTRAINT "leads_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."localreach_pages"
    ADD CONSTRAINT "localreach_pages_location_id_service_slug_neighborhood_key" UNIQUE ("location_id", "service_slug", "neighborhood");



ALTER TABLE ONLY "public"."localreach_pages"
    ADD CONSTRAINT "localreach_pages_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."location_brand"
    ADD CONSTRAINT "location_brand_location_id_key" UNIQUE ("location_id");



ALTER TABLE ONLY "public"."location_brand"
    ADD CONSTRAINT "location_brand_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."location_certifications"
    ADD CONSTRAINT "location_certifications_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."location_insurance"
    ADD CONSTRAINT "location_insurance_location_id_key" UNIQUE ("location_id");



ALTER TABLE ONLY "public"."location_insurance"
    ADD CONSTRAINT "location_insurance_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."location_market"
    ADD CONSTRAINT "location_market_location_id_key" UNIQUE ("location_id");



ALTER TABLE ONLY "public"."location_market"
    ADD CONSTRAINT "location_market_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."location_paperclip_mapping"
    ADD CONSTRAINT "location_paperclip_mapping_location_id_key" UNIQUE ("location_id");



ALTER TABLE ONLY "public"."location_paperclip_mapping"
    ADD CONSTRAINT "location_paperclip_mapping_paperclip_company_id_key" UNIQUE ("paperclip_company_id");



ALTER TABLE ONLY "public"."location_paperclip_mapping"
    ADD CONSTRAINT "location_paperclip_mapping_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."location_profiles"
    ADD CONSTRAINT "location_profiles_location_id_key" UNIQUE ("location_id");



ALTER TABLE ONLY "public"."location_profiles"
    ADD CONSTRAINT "location_profiles_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."location_services"
    ADD CONSTRAINT "location_services_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."locations"
    ADD CONSTRAINT "locations_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."locations"
    ADD CONSTRAINT "locations_shop_id_slug_key" UNIQUE ("shop_id", "slug");



ALTER TABLE ONLY "public"."market_map_point_cache"
    ADD CONSTRAINT "market_map_point_cache_pkey" PRIMARY KEY ("layer", "id");



ALTER TABLE ONLY "public"."market_zip_latest_signal"
    ADD CONSTRAINT "market_zip_latest_signal_pkey" PRIMARY KEY ("zip");



ALTER TABLE ONLY "public"."pages"
    ADD CONSTRAINT "pages_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."portal_sessions_log"
    ADD CONSTRAINT "portal_sessions_log_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."portal_users"
    ADD CONSTRAINT "portal_users_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."profiles"
    ADD CONSTRAINT "profiles_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."psg_knowledge_chunks"
    ADD CONSTRAINT "psg_knowledge_chunks_content_hash_key" UNIQUE ("content_hash");



ALTER TABLE ONLY "public"."psg_knowledge_chunks"
    ADD CONSTRAINT "psg_knowledge_chunks_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."psg_knowledge_meta"
    ADD CONSTRAINT "psg_knowledge_meta_content_hash_key" UNIQUE ("content_hash");



ALTER TABLE ONLY "public"."psg_knowledge_meta"
    ADD CONSTRAINT "psg_knowledge_meta_doc_id_key" UNIQUE ("doc_id");



ALTER TABLE ONLY "public"."psg_knowledge_meta"
    ADD CONSTRAINT "psg_knowledge_meta_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."reports"
    ADD CONSTRAINT "reports_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."research_artifacts"
    ADD CONSTRAINT "research_artifacts_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."review_items"
    ADD CONSTRAINT "review_items_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."review_responses"
    ADD CONSTRAINT "review_responses_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."reviews"
    ADD CONSTRAINT "reviews_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."shop_users"
    ADD CONSTRAINT "shop_users_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."shop_users"
    ADD CONSTRAINT "shop_users_user_id_shop_id_key" UNIQUE ("user_id", "shop_id");



ALTER TABLE ONLY "public"."shops"
    ADD CONSTRAINT "shops_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."shops"
    ADD CONSTRAINT "shops_slug_key" UNIQUE ("slug");



ALTER TABLE ONLY "public"."skills"
    ADD CONSTRAINT "skills_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."sms_events"
    ADD CONSTRAINT "sms_events_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."sms_events"
    ADD CONSTRAINT "sms_events_sid_status_key" UNIQUE ("message_sid", "status");



ALTER TABLE ONLY "public"."state_references"
    ADD CONSTRAINT "state_references_pkey" PRIMARY KEY ("state_fips");



ALTER TABLE ONLY "public"."state_references"
    ADD CONSTRAINT "state_references_state_abbr_key" UNIQUE ("state_abbr");



ALTER TABLE ONLY "public"."state_vehicle_registrations"
    ADD CONSTRAINT "state_vehicle_registrations_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."state_vehicle_registrations"
    ADD CONSTRAINT "state_vehicle_registrations_state_year_source_key" UNIQUE ("state", "year", "source");



ALTER TABLE ONLY "public"."storm_event_sources"
    ADD CONSTRAINT "storm_event_sources_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."storm_event_sources"
    ADD CONSTRAINT "storm_event_sources_source_key_file_family_source_year_cycl_key" UNIQUE ("source_key", "file_family", "source_year", "cycle");



ALTER TABLE ONLY "public"."storm_events"
    ADD CONSTRAINT "storm_events_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."storm_events"
    ADD CONSTRAINT "storm_events_source_source_event_id_key" UNIQUE ("source", "source_event_id");



ALTER TABLE ONLY "public"."storm_zip_monthly"
    ADD CONSTRAINT "storm_zip_monthly_pkey" PRIMARY KEY ("zip", "month");



ALTER TABLE ONLY "public"."subscriptions"
    ADD CONSTRAINT "subscriptions_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."subscriptions"
    ADD CONSTRAINT "subscriptions_shop_id_key" UNIQUE ("shop_id");



ALTER TABLE ONLY "public"."subscriptions"
    ADD CONSTRAINT "subscriptions_stripe_subscription_id_key" UNIQUE ("stripe_subscription_id");



ALTER TABLE ONLY "public"."survey_responses"
    ADD CONSTRAINT "survey_responses_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."utm_exports"
    ADD CONSTRAINT "utm_exports_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."weather_cache"
    ADD CONSTRAINT "weather_cache_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."weather_cache"
    ADD CONSTRAINT "weather_cache_zip_code_year_month_key" UNIQUE ("zip_code", "year", "month");



ALTER TABLE ONLY "public"."zcta_income_annual"
    ADD CONSTRAINT "zcta_income_annual_pkey" PRIMARY KEY ("year", "zip");



ALTER TABLE ONLY "public"."zcta_vehicle_availability"
    ADD CONSTRAINT "zcta_vehicle_availability_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."zcta_vehicle_availability"
    ADD CONSTRAINT "zcta_vehicle_availability_zcta_year_key" UNIQUE ("zcta", "year");



ALTER TABLE ONLY "public"."zcta_zip_mapping"
    ADD CONSTRAINT "zcta_zip_mapping_pkey" PRIMARY KEY ("zip_code");



ALTER TABLE ONLY "public"."zip_references"
    ADD CONSTRAINT "zip_references_pkey" PRIMARY KEY ("zip_code", "county_fips");



ALTER TABLE ONLY "public"."zipcode_boundaries"
    ADD CONSTRAINT "zipcode_boundaries_pkey" PRIMARY KEY ("zip_code");



ALTER TABLE ONLY "sensitive"."pii_access_log"
    ADD CONSTRAINT "pii_access_log_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "sensitive"."repair_customer_locations"
    ADD CONSTRAINT "repair_customer_locations_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "sensitive"."repair_customer_locations"
    ADD CONSTRAINT "repair_customer_locations_repair_customer_id_key" UNIQUE ("repair_customer_id");



ALTER TABLE ONLY "sensitive"."repair_customers"
    ADD CONSTRAINT "repair_customers_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "sensitive"."survey_pii"
    ADD CONSTRAINT "survey_pii_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "vecs"."psg_knowledge"
    ADD CONSTRAINT "psg_knowledge_pkey" PRIMARY KEY ("id");



CREATE INDEX "idx_accidents_location" ON ONLY "public"."accidents" USING "gist" ("location");



CREATE INDEX "accidents_2016_location_idx" ON "public"."accidents_2016" USING "gist" ("location");



CREATE INDEX "idx_accidents_market_city_state_time" ON ONLY "public"."accidents" USING "btree" ("lower"("city"), "upper"("state"), "start_time");



CREATE INDEX "accidents_2016_lower_upper_start_time_idx" ON "public"."accidents_2016" USING "btree" ("lower"("city"), "upper"("state"), "start_time");



CREATE INDEX "idx_accidents_market_city_state_zip" ON ONLY "public"."accidents" USING "btree" ("lower"("city"), "upper"("state"), "zipcode");



CREATE INDEX "accidents_2016_lower_upper_zipcode_idx" ON "public"."accidents_2016" USING "btree" ("lower"("city"), "upper"("state"), "zipcode");



CREATE INDEX "idx_accidents_severity" ON ONLY "public"."accidents" USING "btree" ("severity");



CREATE INDEX "accidents_2016_severity_idx" ON "public"."accidents_2016" USING "btree" ("severity");



CREATE INDEX "idx_accidents_start_time" ON ONLY "public"."accidents" USING "btree" ("start_time");



CREATE INDEX "accidents_2016_start_time_idx" ON "public"."accidents_2016" USING "btree" ("start_time");



CREATE INDEX "idx_accidents_state" ON ONLY "public"."accidents" USING "btree" ("state");



CREATE INDEX "accidents_2016_state_idx" ON "public"."accidents_2016" USING "btree" ("state");



CREATE INDEX "idx_accidents_zip" ON ONLY "public"."accidents" USING "btree" ("zipcode");



CREATE INDEX "accidents_2016_zipcode_idx" ON "public"."accidents_2016" USING "btree" ("zipcode");



CREATE INDEX "accidents_2017_location_idx" ON "public"."accidents_2017" USING "gist" ("location");



CREATE INDEX "accidents_2017_lower_upper_start_time_idx" ON "public"."accidents_2017" USING "btree" ("lower"("city"), "upper"("state"), "start_time");



CREATE INDEX "accidents_2017_lower_upper_zipcode_idx" ON "public"."accidents_2017" USING "btree" ("lower"("city"), "upper"("state"), "zipcode");



CREATE INDEX "accidents_2017_severity_idx" ON "public"."accidents_2017" USING "btree" ("severity");



CREATE INDEX "accidents_2017_start_time_idx" ON "public"."accidents_2017" USING "btree" ("start_time");



CREATE INDEX "accidents_2017_state_idx" ON "public"."accidents_2017" USING "btree" ("state");



CREATE INDEX "accidents_2017_zipcode_idx" ON "public"."accidents_2017" USING "btree" ("zipcode");



CREATE INDEX "accidents_2018_location_idx" ON "public"."accidents_2018" USING "gist" ("location");



CREATE INDEX "accidents_2018_lower_upper_start_time_idx" ON "public"."accidents_2018" USING "btree" ("lower"("city"), "upper"("state"), "start_time");



CREATE INDEX "accidents_2018_lower_upper_zipcode_idx" ON "public"."accidents_2018" USING "btree" ("lower"("city"), "upper"("state"), "zipcode");



CREATE INDEX "accidents_2018_severity_idx" ON "public"."accidents_2018" USING "btree" ("severity");



CREATE INDEX "accidents_2018_start_time_idx" ON "public"."accidents_2018" USING "btree" ("start_time");



CREATE INDEX "accidents_2018_state_idx" ON "public"."accidents_2018" USING "btree" ("state");



CREATE INDEX "accidents_2018_zipcode_idx" ON "public"."accidents_2018" USING "btree" ("zipcode");



CREATE INDEX "accidents_2019_location_idx" ON "public"."accidents_2019" USING "gist" ("location");



CREATE INDEX "accidents_2019_lower_upper_start_time_idx" ON "public"."accidents_2019" USING "btree" ("lower"("city"), "upper"("state"), "start_time");



CREATE INDEX "accidents_2019_lower_upper_zipcode_idx" ON "public"."accidents_2019" USING "btree" ("lower"("city"), "upper"("state"), "zipcode");



CREATE INDEX "accidents_2019_severity_idx" ON "public"."accidents_2019" USING "btree" ("severity");



CREATE INDEX "accidents_2019_start_time_idx" ON "public"."accidents_2019" USING "btree" ("start_time");



CREATE INDEX "accidents_2019_state_idx" ON "public"."accidents_2019" USING "btree" ("state");



CREATE INDEX "accidents_2019_zipcode_idx" ON "public"."accidents_2019" USING "btree" ("zipcode");



CREATE INDEX "accidents_2020_location_idx" ON "public"."accidents_2020" USING "gist" ("location");



CREATE INDEX "accidents_2020_lower_upper_start_time_idx" ON "public"."accidents_2020" USING "btree" ("lower"("city"), "upper"("state"), "start_time");



CREATE INDEX "accidents_2020_lower_upper_zipcode_idx" ON "public"."accidents_2020" USING "btree" ("lower"("city"), "upper"("state"), "zipcode");



CREATE INDEX "accidents_2020_severity_idx" ON "public"."accidents_2020" USING "btree" ("severity");



CREATE INDEX "accidents_2020_start_time_idx" ON "public"."accidents_2020" USING "btree" ("start_time");



CREATE INDEX "accidents_2020_state_idx" ON "public"."accidents_2020" USING "btree" ("state");



CREATE INDEX "accidents_2020_zipcode_idx" ON "public"."accidents_2020" USING "btree" ("zipcode");



CREATE INDEX "accidents_2021_location_idx" ON "public"."accidents_2021" USING "gist" ("location");



CREATE INDEX "accidents_2021_lower_upper_start_time_idx" ON "public"."accidents_2021" USING "btree" ("lower"("city"), "upper"("state"), "start_time");



CREATE INDEX "accidents_2021_lower_upper_zipcode_idx" ON "public"."accidents_2021" USING "btree" ("lower"("city"), "upper"("state"), "zipcode");



CREATE INDEX "accidents_2021_severity_idx" ON "public"."accidents_2021" USING "btree" ("severity");



CREATE INDEX "accidents_2021_start_time_idx" ON "public"."accidents_2021" USING "btree" ("start_time");



CREATE INDEX "accidents_2021_state_idx" ON "public"."accidents_2021" USING "btree" ("state");



CREATE INDEX "accidents_2021_zipcode_idx" ON "public"."accidents_2021" USING "btree" ("zipcode");



CREATE INDEX "accidents_2022_location_idx" ON "public"."accidents_2022" USING "gist" ("location");



CREATE INDEX "accidents_2022_lower_upper_start_time_idx" ON "public"."accidents_2022" USING "btree" ("lower"("city"), "upper"("state"), "start_time");



CREATE INDEX "accidents_2022_lower_upper_zipcode_idx" ON "public"."accidents_2022" USING "btree" ("lower"("city"), "upper"("state"), "zipcode");



CREATE INDEX "accidents_2022_severity_idx" ON "public"."accidents_2022" USING "btree" ("severity");



CREATE INDEX "accidents_2022_start_time_idx" ON "public"."accidents_2022" USING "btree" ("start_time");



CREATE INDEX "accidents_2022_state_idx" ON "public"."accidents_2022" USING "btree" ("state");



CREATE INDEX "accidents_2022_zipcode_idx" ON "public"."accidents_2022" USING "btree" ("zipcode");



CREATE INDEX "accidents_2023_location_idx" ON "public"."accidents_2023" USING "gist" ("location");



CREATE INDEX "accidents_2023_lower_upper_start_time_idx" ON "public"."accidents_2023" USING "btree" ("lower"("city"), "upper"("state"), "start_time");



CREATE INDEX "accidents_2023_lower_upper_zipcode_idx" ON "public"."accidents_2023" USING "btree" ("lower"("city"), "upper"("state"), "zipcode");



CREATE INDEX "accidents_2023_severity_idx" ON "public"."accidents_2023" USING "btree" ("severity");



CREATE INDEX "accidents_2023_start_time_idx" ON "public"."accidents_2023" USING "btree" ("start_time");



CREATE INDEX "accidents_2023_state_idx" ON "public"."accidents_2023" USING "btree" ("state");



CREATE INDEX "accidents_2023_zipcode_idx" ON "public"."accidents_2023" USING "btree" ("zipcode");



CREATE INDEX "accidents_2024_location_idx" ON "public"."accidents_2024" USING "gist" ("location");



CREATE INDEX "accidents_2024_lower_upper_start_time_idx" ON "public"."accidents_2024" USING "btree" ("lower"("city"), "upper"("state"), "start_time");



CREATE INDEX "accidents_2024_lower_upper_zipcode_idx" ON "public"."accidents_2024" USING "btree" ("lower"("city"), "upper"("state"), "zipcode");



CREATE INDEX "accidents_2024_severity_idx" ON "public"."accidents_2024" USING "btree" ("severity");



CREATE INDEX "accidents_2024_start_time_idx" ON "public"."accidents_2024" USING "btree" ("start_time");



CREATE INDEX "accidents_2024_state_idx" ON "public"."accidents_2024" USING "btree" ("state");



CREATE INDEX "accidents_2024_zipcode_idx" ON "public"."accidents_2024" USING "btree" ("zipcode");



CREATE INDEX "accidents_2025_location_idx" ON "public"."accidents_2025" USING "gist" ("location");



CREATE INDEX "accidents_2025_lower_upper_start_time_idx" ON "public"."accidents_2025" USING "btree" ("lower"("city"), "upper"("state"), "start_time");



CREATE INDEX "accidents_2025_lower_upper_zipcode_idx" ON "public"."accidents_2025" USING "btree" ("lower"("city"), "upper"("state"), "zipcode");



CREATE INDEX "accidents_2025_severity_idx" ON "public"."accidents_2025" USING "btree" ("severity");



CREATE INDEX "accidents_2025_start_time_idx" ON "public"."accidents_2025" USING "btree" ("start_time");



CREATE INDEX "accidents_2025_state_idx" ON "public"."accidents_2025" USING "btree" ("state");



CREATE INDEX "accidents_2025_zipcode_idx" ON "public"."accidents_2025" USING "btree" ("zipcode");



CREATE INDEX "accidents_2026_location_idx" ON "public"."accidents_2026" USING "gist" ("location");



CREATE INDEX "accidents_2026_lower_upper_start_time_idx" ON "public"."accidents_2026" USING "btree" ("lower"("city"), "upper"("state"), "start_time");



CREATE INDEX "accidents_2026_lower_upper_zipcode_idx" ON "public"."accidents_2026" USING "btree" ("lower"("city"), "upper"("state"), "zipcode");



CREATE INDEX "accidents_2026_severity_idx" ON "public"."accidents_2026" USING "btree" ("severity");



CREATE INDEX "accidents_2026_start_time_idx" ON "public"."accidents_2026" USING "btree" ("start_time");



CREATE INDEX "accidents_2026_state_idx" ON "public"."accidents_2026" USING "btree" ("state");



CREATE INDEX "accidents_2026_zipcode_idx" ON "public"."accidents_2026" USING "btree" ("zipcode");



CREATE INDEX "accidents_2027_location_idx" ON "public"."accidents_2027" USING "gist" ("location");



CREATE INDEX "accidents_2027_lower_upper_start_time_idx" ON "public"."accidents_2027" USING "btree" ("lower"("city"), "upper"("state"), "start_time");



CREATE INDEX "accidents_2027_lower_upper_zipcode_idx" ON "public"."accidents_2027" USING "btree" ("lower"("city"), "upper"("state"), "zipcode");



CREATE INDEX "accidents_2027_severity_idx" ON "public"."accidents_2027" USING "btree" ("severity");



CREATE INDEX "accidents_2027_start_time_idx" ON "public"."accidents_2027" USING "btree" ("start_time");



CREATE INDEX "accidents_2027_state_idx" ON "public"."accidents_2027" USING "btree" ("state");



CREATE INDEX "accidents_2027_zipcode_idx" ON "public"."accidents_2027" USING "btree" ("zipcode");



CREATE INDEX "accidents_default_location_idx" ON "public"."accidents_default" USING "gist" ("location");



CREATE INDEX "accidents_default_lower_upper_start_time_idx" ON "public"."accidents_default" USING "btree" ("lower"("city"), "upper"("state"), "start_time");



CREATE INDEX "accidents_default_lower_upper_zipcode_idx" ON "public"."accidents_default" USING "btree" ("lower"("city"), "upper"("state"), "zipcode");



CREATE INDEX "accidents_default_severity_idx" ON "public"."accidents_default" USING "btree" ("severity");



CREATE INDEX "accidents_default_start_time_idx" ON "public"."accidents_default" USING "btree" ("start_time");



CREATE INDEX "accidents_default_state_idx" ON "public"."accidents_default" USING "btree" ("state");



CREATE INDEX "accidents_default_zipcode_idx" ON "public"."accidents_default" USING "btree" ("zipcode");



CREATE INDEX "county_veh_reg_state_idx" ON "public"."county_vehicle_registrations" USING "btree" ("state");



CREATE INDEX "email_events_email_idx" ON "public"."email_events" USING "btree" ("email");



CREATE INDEX "email_events_event_idx" ON "public"."email_events" USING "btree" ("event");



CREATE INDEX "email_events_occurred_at_idx" ON "public"."email_events" USING "btree" ("occurred_at" DESC);



CREATE INDEX "est_zip_veh_flag_idx" ON "public"."estimated_zip_vehicles" USING "btree" ("data_quality_flag");



CREATE INDEX "est_zip_veh_state_idx" ON "public"."estimated_zip_vehicles" USING "btree" ("state");



CREATE INDEX "est_zip_veh_year_idx" ON "public"."estimated_zip_vehicles" USING "btree" ("year");



CREATE INDEX "ev_registrations_source_idx" ON "public"."ev_registrations" USING "btree" ("source");



CREATE INDEX "ev_registrations_state_idx" ON "public"."ev_registrations" USING "btree" ("state");



CREATE UNIQUE INDEX "ev_registrations_zip_source_snapshot_idx" ON "public"."ev_registrations" USING "btree" ("zip", "source", "snapshot_date", COALESCE("make", ''::"text"), COALESCE("model", ''::"text"), COALESCE("powertrain_type", ''::"text"));



CREATE INDEX "idx_accident_density_state_total" ON "public"."accident_density" USING "btree" ("state", "total_count" DESC);



CREATE INDEX "idx_accident_import_sources_created_at" ON "public"."accident_import_sources" USING "btree" ("created_at" DESC);



CREATE INDEX "idx_accident_market_daypart_rollup_state" ON "public"."accident_market_daypart_rollup" USING "btree" ("state");



CREATE INDEX "idx_accident_market_rollup_state" ON "public"."accident_market_rollup" USING "btree" ("state");



CREATE INDEX "idx_accident_market_zip_rollup_state" ON "public"."accident_market_zip_rollup" USING "btree" ("state");



CREATE INDEX "idx_accident_market_zip_rollup_zip" ON "public"."accident_market_zip_rollup" USING "btree" ("zip");



CREATE INDEX "idx_activity_log_created_at" ON "public"."activity_log" USING "btree" ("created_at" DESC);



CREATE INDEX "idx_analytics_snapshots_shop_id" ON "public"."analytics_snapshots" USING "btree" ("shop_id");



CREATE INDEX "idx_api_cache_api_name" ON "public"."api_cache" USING "btree" ("api_name");



CREATE INDEX "idx_api_cache_expires" ON "public"."api_cache" USING "btree" ("expires_at");



CREATE INDEX "idx_api_cache_key" ON "public"."api_cache" USING "btree" ("cache_key");



CREATE INDEX "idx_body_shops_location" ON "public"."body_shops" USING "gist" ("location");



CREATE INDEX "idx_body_shops_location_geography" ON "public"."body_shops" USING "gist" ((("location")::"public"."geography"));



CREATE INDEX "idx_body_shops_name" ON "public"."body_shops" USING "btree" ("shop_name");



CREATE INDEX "idx_body_shops_normalized_name" ON "public"."body_shops" USING "btree" ("normalized_name");



CREATE INDEX "idx_boundaries_geo" ON "public"."zipcode_boundaries" USING "gist" ("boundary");



CREATE INDEX "idx_bsm_campaigns_location_id" ON "public"."bsm_campaigns" USING "btree" ("location_id");



CREATE INDEX "idx_bsm_campaigns_shop_id" ON "public"."bsm_campaigns" USING "btree" ("shop_id");



CREATE INDEX "idx_campaign_sends_campaign_id" ON "public"."campaign_sends" USING "btree" ("campaign_id");



CREATE INDEX "idx_campaigns_client_id" ON "public"."campaigns" USING "btree" ("client_id");



CREATE INDEX "idx_campaigns_created_at" ON "public"."campaigns" USING "btree" ("created_at" DESC);



CREATE INDEX "idx_campaigns_status" ON "public"."campaigns" USING "btree" ("status");



CREATE INDEX "idx_clients_created_at" ON "public"."clients" USING "btree" ("created_at" DESC);



CREATE INDEX "idx_competitors_cache_expires" ON "public"."competitors" USING "btree" ("cache_expires_at");



CREATE INDEX "idx_competitors_distance" ON "public"."competitors" USING "btree" ("shop_id", "distance_miles");



CREATE INDEX "idx_competitors_shop_id" ON "public"."competitors" USING "btree" ("shop_id");



CREATE INDEX "idx_content_items_location_id" ON "public"."content_items" USING "btree" ("location_id");



CREATE INDEX "idx_content_items_shop_id" ON "public"."content_items" USING "btree" ("shop_id");



CREATE INDEX "idx_content_items_status" ON "public"."content_items" USING "btree" ("status");



CREATE INDEX "idx_crash_event_sources_year" ON "public"."crash_event_sources" USING "btree" ("source_key", "source_year" DESC);



CREATE INDEX "idx_crash_events_location" ON "public"."crash_events" USING "gist" ("location") WHERE ("location" IS NOT NULL);



CREATE INDEX "idx_crash_events_severity" ON "public"."crash_events" USING "btree" ("severity");



CREATE INDEX "idx_crash_events_source_time" ON "public"."crash_events" USING "btree" ("source", "event_time");



CREATE INDEX "idx_crash_events_state_city" ON "public"."crash_events" USING "btree" ("state", "city");



CREATE INDEX "idx_crash_zip_annual_demand" ON "public"."crash_zip_annual" USING "btree" ("weighted_crash_demand_score" DESC);



CREATE INDEX "idx_crash_zip_annual_state_year" ON "public"."crash_zip_annual" USING "btree" ("state", "year");



CREATE INDEX "idx_customer_zip_report_monthly_month" ON "public"."customer_zip_report_monthly" USING "btree" ("month");



CREATE INDEX "idx_customer_zip_report_monthly_shop" ON "public"."customer_zip_report_monthly" USING "btree" ("shop_id");



CREATE INDEX "idx_customer_zip_report_monthly_zip" ON "public"."customer_zip_report_monthly" USING "btree" ("zip");



CREATE INDEX "idx_discovery_briefs_campaign_id" ON "public"."discovery_briefs" USING "btree" ("campaign_id");



CREATE INDEX "idx_dmv_veh_snapshot" ON "public"."dmv_vehicle_registrations" USING "btree" ("snapshot_date");



CREATE INDEX "idx_dmv_veh_zip" ON "public"."dmv_vehicle_registrations" USING "btree" ("zip");



CREATE INDEX "idx_integrations_shop_id" ON "public"."integrations" USING "btree" ("shop_id");



CREATE INDEX "idx_invoiced_customers_city_state" ON "public"."invoiced_customers" USING "btree" ("lower"("city"), "upper"("state"));



CREATE INDEX "idx_invoiced_customers_normalized_name" ON "public"."invoiced_customers" USING "btree" ("normalized_name");



CREATE UNIQUE INDEX "idx_invoiced_customers_psg_id" ON "public"."invoiced_customers" USING "btree" ("psg_id");



CREATE INDEX "idx_leads_location_id" ON "public"."leads" USING "btree" ("location_id");



CREATE INDEX "idx_leads_shop_id" ON "public"."leads" USING "btree" ("shop_id");



CREATE INDEX "idx_location_certifications_location_id" ON "public"."location_certifications" USING "btree" ("location_id");



CREATE INDEX "idx_location_services_location_id" ON "public"."location_services" USING "btree" ("location_id");



CREATE INDEX "idx_locations_shop_id" ON "public"."locations" USING "btree" ("shop_id");



CREATE INDEX "idx_lpm_location_id" ON "public"."location_paperclip_mapping" USING "btree" ("location_id");



CREATE INDEX "idx_lpm_paperclip_company_id" ON "public"."location_paperclip_mapping" USING "btree" ("paperclip_company_id");



CREATE INDEX "idx_lpm_shop_id" ON "public"."location_paperclip_mapping" USING "btree" ("shop_id");



CREATE INDEX "idx_lr_pages_location" ON "public"."localreach_pages" USING "btree" ("location_id");



CREATE INDEX "idx_lr_pages_shop" ON "public"."localreach_pages" USING "btree" ("shop_id");



CREATE INDEX "idx_lr_pages_slug" ON "public"."localreach_pages" USING "btree" ("location_id", "service_slug");



CREATE INDEX "idx_market_map_point_cache_layer_rating_name" ON "public"."market_map_point_cache" USING "btree" ("layer", "rating" DESC NULLS LAST, "shop_name");



CREATE INDEX "idx_market_map_point_cache_lng_lat" ON "public"."market_map_point_cache" USING "btree" ("longitude", "latitude");



CREATE INDEX "idx_market_map_point_cache_state_layer" ON "public"."market_map_point_cache" USING "btree" ("state", "layer");



CREATE INDEX "idx_market_zip_latest_signal_lng_lat" ON "public"."market_zip_latest_signal" USING "btree" ("longitude", "latitude");



CREATE INDEX "idx_market_zip_latest_signal_score" ON "public"."market_zip_latest_signal" USING "btree" ("targeting_score" DESC, "total_crashes" DESC, "storm_events" DESC);



CREATE INDEX "idx_pages_campaign_id" ON "public"."pages" USING "btree" ("campaign_id");



CREATE INDEX "idx_pages_review_status" ON "public"."pages" USING "btree" ("review_status");



CREATE INDEX "idx_pkc_doc_id" ON "public"."psg_knowledge_chunks" USING "btree" ("doc_id");



CREATE INDEX "idx_pkc_embedding" ON "public"."psg_knowledge_chunks" USING "hnsw" ("embedding" "extensions"."vector_cosine_ops") WITH ("m"='16', "ef_construction"='64');



CREATE INDEX "idx_reports_created_at" ON "public"."reports" USING "btree" ("created_at" DESC);



CREATE INDEX "idx_reports_shop_id" ON "public"."reports" USING "btree" ("shop_id");



CREATE INDEX "idx_reports_status" ON "public"."reports" USING "btree" ("status");



CREATE INDEX "idx_reports_type" ON "public"."reports" USING "btree" ("report_type");



CREATE INDEX "idx_reports_user_created" ON "public"."reports" USING "btree" ("user_id", "created_at" DESC);



CREATE INDEX "idx_reports_user_id" ON "public"."reports" USING "btree" ("user_id");



CREATE INDEX "idx_research_artifacts_campaign_id" ON "public"."research_artifacts" USING "btree" ("campaign_id");



CREATE INDEX "idx_review_items_location_id" ON "public"."review_items" USING "btree" ("location_id");



CREATE INDEX "idx_review_items_shop_id" ON "public"."review_items" USING "btree" ("shop_id");



CREATE INDEX "idx_reviews_page_id" ON "public"."reviews" USING "btree" ("page_id");



CREATE INDEX "idx_shop_users_shop_id" ON "public"."shop_users" USING "btree" ("shop_id");



CREATE INDEX "idx_shop_users_user_id" ON "public"."shop_users" USING "btree" ("user_id");



CREATE INDEX "idx_shops_client_id" ON "public"."shops" USING "btree" ("client_id");



CREATE INDEX "idx_storm_event_sources_imported_at" ON "public"."storm_event_sources" USING "btree" ("imported_at" DESC);



CREATE INDEX "idx_storm_event_sources_year" ON "public"."storm_event_sources" USING "btree" ("source_key", "source_year" DESC);



CREATE INDEX "idx_storm_events_begin_location" ON "public"."storm_events" USING "gist" ("begin_location") WHERE ("begin_location" IS NOT NULL);



CREATE INDEX "idx_storm_events_begin_time" ON "public"."storm_events" USING "btree" ("begin_time");



CREATE INDEX "idx_storm_events_source_event_id" ON "public"."storm_events" USING "btree" ("source", "source_event_id");



CREATE INDEX "idx_storm_events_state" ON "public"."storm_events" USING "btree" ("state");



CREATE INDEX "idx_storm_events_type" ON "public"."storm_events" USING "btree" ("event_type_normalized");



CREATE INDEX "idx_storm_zip_monthly_demand" ON "public"."storm_zip_monthly" USING "btree" ("weighted_storm_demand_score" DESC);



CREATE INDEX "idx_storm_zip_monthly_month" ON "public"."storm_zip_monthly" USING "btree" ("month");



CREATE INDEX "idx_storm_zip_monthly_state_month" ON "public"."storm_zip_monthly" USING "btree" ("state", "month");



CREATE INDEX "idx_storm_zip_monthly_zip_demand" ON "public"."storm_zip_monthly" USING "btree" ("zip", "weighted_storm_demand_score" DESC);



CREATE INDEX "idx_subscriptions_shop_id" ON "public"."subscriptions" USING "btree" ("shop_id");



CREATE INDEX "idx_subscriptions_stripe_subscription_id" ON "public"."subscriptions" USING "btree" ("stripe_subscription_id");



CREATE INDEX "idx_survey_comments_trgm" ON "public"."survey_responses" USING "gin" ("text_customer_comments" "public"."gin_trgm_ops") WHERE (("text_customer_comments" IS NOT NULL) AND ("text_customer_comments" <> ''::"text"));



CREATE INDEX "idx_survey_date" ON "public"."survey_responses" USING "btree" ("survey_date");



CREATE INDEX "idx_survey_match_key" ON "public"."survey_responses" USING "btree" ("match_key");



CREATE INDEX "idx_survey_response_id" ON "public"."survey_responses" USING "btree" ("response_id");



CREATE INDEX "idx_survey_shop_date" ON "public"."survey_responses" USING "btree" ("shop_name", "survey_date");



CREATE INDEX "idx_survey_shop_id" ON "public"."survey_responses" USING "btree" ("shop_id");



CREATE INDEX "idx_weather_cache_zip" ON "public"."weather_cache" USING "btree" ("zip_code");



CREATE INDEX "idx_weather_cache_zip_date" ON "public"."weather_cache" USING "btree" ("zip_code", "year", "month");



CREATE INDEX "idx_zcta_income_annual_mean_income" ON "public"."zcta_income_annual" USING "btree" ("mean_household_income");



CREATE INDEX "idx_zcta_income_annual_year" ON "public"."zcta_income_annual" USING "btree" ("year");



CREATE INDEX "idx_zcta_income_annual_zip" ON "public"."zcta_income_annual" USING "btree" ("zip");



CREATE INDEX "idx_zip_references_zip" ON "public"."zip_references" USING "btree" ("zip_code");



CREATE INDEX "psg_knowledge_embedding_idx" ON "public"."psg_knowledge_meta" USING "hnsw" ("embedding" "extensions"."vector_cosine_ops") WITH ("m"='16', "ef_construction"='64');



CREATE INDEX "state_veh_reg_state_idx" ON "public"."state_vehicle_registrations" USING "btree" ("state");



CREATE INDEX "zcta_veh_avail_year_idx" ON "public"."zcta_vehicle_availability" USING "btree" ("year");



CREATE INDEX "idx_sensitive_pii_access_log_accessed_at" ON "sensitive"."pii_access_log" USING "btree" ("accessed_at");



CREATE INDEX "idx_sensitive_pii_access_log_actor_user_id" ON "sensitive"."pii_access_log" USING "btree" ("actor_user_id");



CREATE INDEX "idx_sensitive_pii_access_log_target" ON "sensitive"."pii_access_log" USING "btree" ("target_table", "target_key");



CREATE INDEX "idx_sensitive_repair_customer_locations_address_hash" ON "sensitive"."repair_customer_locations" USING "btree" ("address_hash");



CREATE INDEX "idx_sensitive_repair_customer_locations_import_batch" ON "sensitive"."repair_customer_locations" USING "btree" ("import_batch_id");



CREATE INDEX "idx_sensitive_repair_customer_locations_location" ON "sensitive"."repair_customer_locations" USING "gist" ("location");



CREATE INDEX "idx_sensitive_repair_customer_locations_repair_customer_id" ON "sensitive"."repair_customer_locations" USING "btree" ("repair_customer_id");



CREATE INDEX "idx_sensitive_repair_customer_locations_repair_date" ON "sensitive"."repair_customer_locations" USING "btree" ("repair_date");



CREATE INDEX "idx_sensitive_repair_customer_locations_shop_id" ON "sensitive"."repair_customer_locations" USING "btree" ("shop_id");



CREATE INDEX "idx_sensitive_repair_customer_locations_status" ON "sensitive"."repair_customer_locations" USING "btree" ("geocode_status");



CREATE INDEX "idx_sensitive_repair_customers_match_key" ON "sensitive"."repair_customers" USING "btree" ("match_key");



CREATE INDEX "idx_sensitive_repair_customers_repair_id" ON "sensitive"."repair_customers" USING "btree" ("repair_id");



CREATE INDEX "idx_sensitive_repair_customers_shop_id" ON "sensitive"."repair_customers" USING "btree" ("shop_id");



CREATE INDEX "idx_sensitive_repair_customers_source_loaded_at" ON "sensitive"."repair_customers" USING "btree" ("source_loaded_at");



CREATE INDEX "idx_sensitive_survey_pii_match_key" ON "sensitive"."survey_pii" USING "btree" ("match_key");



CREATE INDEX "idx_sensitive_survey_pii_response_id" ON "sensitive"."survey_pii" USING "btree" ("response_id");



CREATE INDEX "idx_sensitive_survey_pii_source_loaded_at" ON "sensitive"."survey_pii" USING "btree" ("source_loaded_at");



CREATE INDEX "psg_knowledge_meta_idx" ON "vecs"."psg_knowledge" USING "gin" ("metadata");



CREATE INDEX "psg_knowledge_vec_idx" ON "vecs"."psg_knowledge" USING "hnsw" ("vec" "extensions"."vector_cosine_ops") WITH ("m"='16', "ef_construction"='64');



ALTER INDEX "public"."idx_accidents_location" ATTACH PARTITION "public"."accidents_2016_location_idx";



ALTER INDEX "public"."idx_accidents_market_city_state_time" ATTACH PARTITION "public"."accidents_2016_lower_upper_start_time_idx";



ALTER INDEX "public"."idx_accidents_market_city_state_zip" ATTACH PARTITION "public"."accidents_2016_lower_upper_zipcode_idx";



ALTER INDEX "public"."idx_accidents_severity" ATTACH PARTITION "public"."accidents_2016_severity_idx";



ALTER INDEX "public"."idx_accidents_start_time" ATTACH PARTITION "public"."accidents_2016_start_time_idx";



ALTER INDEX "public"."idx_accidents_state" ATTACH PARTITION "public"."accidents_2016_state_idx";



ALTER INDEX "public"."idx_accidents_zip" ATTACH PARTITION "public"."accidents_2016_zipcode_idx";



ALTER INDEX "public"."idx_accidents_location" ATTACH PARTITION "public"."accidents_2017_location_idx";



ALTER INDEX "public"."idx_accidents_market_city_state_time" ATTACH PARTITION "public"."accidents_2017_lower_upper_start_time_idx";



ALTER INDEX "public"."idx_accidents_market_city_state_zip" ATTACH PARTITION "public"."accidents_2017_lower_upper_zipcode_idx";



ALTER INDEX "public"."idx_accidents_severity" ATTACH PARTITION "public"."accidents_2017_severity_idx";



ALTER INDEX "public"."idx_accidents_start_time" ATTACH PARTITION "public"."accidents_2017_start_time_idx";



ALTER INDEX "public"."idx_accidents_state" ATTACH PARTITION "public"."accidents_2017_state_idx";



ALTER INDEX "public"."idx_accidents_zip" ATTACH PARTITION "public"."accidents_2017_zipcode_idx";



ALTER INDEX "public"."idx_accidents_location" ATTACH PARTITION "public"."accidents_2018_location_idx";



ALTER INDEX "public"."idx_accidents_market_city_state_time" ATTACH PARTITION "public"."accidents_2018_lower_upper_start_time_idx";



ALTER INDEX "public"."idx_accidents_market_city_state_zip" ATTACH PARTITION "public"."accidents_2018_lower_upper_zipcode_idx";



ALTER INDEX "public"."idx_accidents_severity" ATTACH PARTITION "public"."accidents_2018_severity_idx";



ALTER INDEX "public"."idx_accidents_start_time" ATTACH PARTITION "public"."accidents_2018_start_time_idx";



ALTER INDEX "public"."idx_accidents_state" ATTACH PARTITION "public"."accidents_2018_state_idx";



ALTER INDEX "public"."idx_accidents_zip" ATTACH PARTITION "public"."accidents_2018_zipcode_idx";



ALTER INDEX "public"."idx_accidents_location" ATTACH PARTITION "public"."accidents_2019_location_idx";



ALTER INDEX "public"."idx_accidents_market_city_state_time" ATTACH PARTITION "public"."accidents_2019_lower_upper_start_time_idx";



ALTER INDEX "public"."idx_accidents_market_city_state_zip" ATTACH PARTITION "public"."accidents_2019_lower_upper_zipcode_idx";



ALTER INDEX "public"."idx_accidents_severity" ATTACH PARTITION "public"."accidents_2019_severity_idx";



ALTER INDEX "public"."idx_accidents_start_time" ATTACH PARTITION "public"."accidents_2019_start_time_idx";



ALTER INDEX "public"."idx_accidents_state" ATTACH PARTITION "public"."accidents_2019_state_idx";



ALTER INDEX "public"."idx_accidents_zip" ATTACH PARTITION "public"."accidents_2019_zipcode_idx";



ALTER INDEX "public"."idx_accidents_location" ATTACH PARTITION "public"."accidents_2020_location_idx";



ALTER INDEX "public"."idx_accidents_market_city_state_time" ATTACH PARTITION "public"."accidents_2020_lower_upper_start_time_idx";



ALTER INDEX "public"."idx_accidents_market_city_state_zip" ATTACH PARTITION "public"."accidents_2020_lower_upper_zipcode_idx";



ALTER INDEX "public"."idx_accidents_severity" ATTACH PARTITION "public"."accidents_2020_severity_idx";



ALTER INDEX "public"."idx_accidents_start_time" ATTACH PARTITION "public"."accidents_2020_start_time_idx";



ALTER INDEX "public"."idx_accidents_state" ATTACH PARTITION "public"."accidents_2020_state_idx";



ALTER INDEX "public"."idx_accidents_zip" ATTACH PARTITION "public"."accidents_2020_zipcode_idx";



ALTER INDEX "public"."idx_accidents_location" ATTACH PARTITION "public"."accidents_2021_location_idx";



ALTER INDEX "public"."idx_accidents_market_city_state_time" ATTACH PARTITION "public"."accidents_2021_lower_upper_start_time_idx";



ALTER INDEX "public"."idx_accidents_market_city_state_zip" ATTACH PARTITION "public"."accidents_2021_lower_upper_zipcode_idx";



ALTER INDEX "public"."idx_accidents_severity" ATTACH PARTITION "public"."accidents_2021_severity_idx";



ALTER INDEX "public"."idx_accidents_start_time" ATTACH PARTITION "public"."accidents_2021_start_time_idx";



ALTER INDEX "public"."idx_accidents_state" ATTACH PARTITION "public"."accidents_2021_state_idx";



ALTER INDEX "public"."idx_accidents_zip" ATTACH PARTITION "public"."accidents_2021_zipcode_idx";



ALTER INDEX "public"."idx_accidents_location" ATTACH PARTITION "public"."accidents_2022_location_idx";



ALTER INDEX "public"."idx_accidents_market_city_state_time" ATTACH PARTITION "public"."accidents_2022_lower_upper_start_time_idx";



ALTER INDEX "public"."idx_accidents_market_city_state_zip" ATTACH PARTITION "public"."accidents_2022_lower_upper_zipcode_idx";



ALTER INDEX "public"."idx_accidents_severity" ATTACH PARTITION "public"."accidents_2022_severity_idx";



ALTER INDEX "public"."idx_accidents_start_time" ATTACH PARTITION "public"."accidents_2022_start_time_idx";



ALTER INDEX "public"."idx_accidents_state" ATTACH PARTITION "public"."accidents_2022_state_idx";



ALTER INDEX "public"."idx_accidents_zip" ATTACH PARTITION "public"."accidents_2022_zipcode_idx";



ALTER INDEX "public"."idx_accidents_location" ATTACH PARTITION "public"."accidents_2023_location_idx";



ALTER INDEX "public"."idx_accidents_market_city_state_time" ATTACH PARTITION "public"."accidents_2023_lower_upper_start_time_idx";



ALTER INDEX "public"."idx_accidents_market_city_state_zip" ATTACH PARTITION "public"."accidents_2023_lower_upper_zipcode_idx";



ALTER INDEX "public"."idx_accidents_severity" ATTACH PARTITION "public"."accidents_2023_severity_idx";



ALTER INDEX "public"."idx_accidents_start_time" ATTACH PARTITION "public"."accidents_2023_start_time_idx";



ALTER INDEX "public"."idx_accidents_state" ATTACH PARTITION "public"."accidents_2023_state_idx";



ALTER INDEX "public"."idx_accidents_zip" ATTACH PARTITION "public"."accidents_2023_zipcode_idx";



ALTER INDEX "public"."idx_accidents_location" ATTACH PARTITION "public"."accidents_2024_location_idx";



ALTER INDEX "public"."idx_accidents_market_city_state_time" ATTACH PARTITION "public"."accidents_2024_lower_upper_start_time_idx";



ALTER INDEX "public"."idx_accidents_market_city_state_zip" ATTACH PARTITION "public"."accidents_2024_lower_upper_zipcode_idx";



ALTER INDEX "public"."idx_accidents_severity" ATTACH PARTITION "public"."accidents_2024_severity_idx";



ALTER INDEX "public"."idx_accidents_start_time" ATTACH PARTITION "public"."accidents_2024_start_time_idx";



ALTER INDEX "public"."idx_accidents_state" ATTACH PARTITION "public"."accidents_2024_state_idx";



ALTER INDEX "public"."idx_accidents_zip" ATTACH PARTITION "public"."accidents_2024_zipcode_idx";



ALTER INDEX "public"."idx_accidents_location" ATTACH PARTITION "public"."accidents_2025_location_idx";



ALTER INDEX "public"."idx_accidents_market_city_state_time" ATTACH PARTITION "public"."accidents_2025_lower_upper_start_time_idx";



ALTER INDEX "public"."idx_accidents_market_city_state_zip" ATTACH PARTITION "public"."accidents_2025_lower_upper_zipcode_idx";



ALTER INDEX "public"."idx_accidents_severity" ATTACH PARTITION "public"."accidents_2025_severity_idx";



ALTER INDEX "public"."idx_accidents_start_time" ATTACH PARTITION "public"."accidents_2025_start_time_idx";



ALTER INDEX "public"."idx_accidents_state" ATTACH PARTITION "public"."accidents_2025_state_idx";



ALTER INDEX "public"."idx_accidents_zip" ATTACH PARTITION "public"."accidents_2025_zipcode_idx";



ALTER INDEX "public"."idx_accidents_location" ATTACH PARTITION "public"."accidents_2026_location_idx";



ALTER INDEX "public"."idx_accidents_market_city_state_time" ATTACH PARTITION "public"."accidents_2026_lower_upper_start_time_idx";



ALTER INDEX "public"."idx_accidents_market_city_state_zip" ATTACH PARTITION "public"."accidents_2026_lower_upper_zipcode_idx";



ALTER INDEX "public"."idx_accidents_severity" ATTACH PARTITION "public"."accidents_2026_severity_idx";



ALTER INDEX "public"."idx_accidents_start_time" ATTACH PARTITION "public"."accidents_2026_start_time_idx";



ALTER INDEX "public"."idx_accidents_state" ATTACH PARTITION "public"."accidents_2026_state_idx";



ALTER INDEX "public"."idx_accidents_zip" ATTACH PARTITION "public"."accidents_2026_zipcode_idx";



ALTER INDEX "public"."idx_accidents_location" ATTACH PARTITION "public"."accidents_2027_location_idx";



ALTER INDEX "public"."idx_accidents_market_city_state_time" ATTACH PARTITION "public"."accidents_2027_lower_upper_start_time_idx";



ALTER INDEX "public"."idx_accidents_market_city_state_zip" ATTACH PARTITION "public"."accidents_2027_lower_upper_zipcode_idx";



ALTER INDEX "public"."idx_accidents_severity" ATTACH PARTITION "public"."accidents_2027_severity_idx";



ALTER INDEX "public"."idx_accidents_start_time" ATTACH PARTITION "public"."accidents_2027_start_time_idx";



ALTER INDEX "public"."idx_accidents_state" ATTACH PARTITION "public"."accidents_2027_state_idx";



ALTER INDEX "public"."idx_accidents_zip" ATTACH PARTITION "public"."accidents_2027_zipcode_idx";



ALTER INDEX "public"."idx_accidents_location" ATTACH PARTITION "public"."accidents_default_location_idx";



ALTER INDEX "public"."idx_accidents_market_city_state_time" ATTACH PARTITION "public"."accidents_default_lower_upper_start_time_idx";



ALTER INDEX "public"."idx_accidents_market_city_state_zip" ATTACH PARTITION "public"."accidents_default_lower_upper_zipcode_idx";



ALTER INDEX "public"."idx_accidents_severity" ATTACH PARTITION "public"."accidents_default_severity_idx";



ALTER INDEX "public"."idx_accidents_start_time" ATTACH PARTITION "public"."accidents_default_start_time_idx";



ALTER INDEX "public"."idx_accidents_state" ATTACH PARTITION "public"."accidents_default_state_idx";



ALTER INDEX "public"."idx_accidents_zip" ATTACH PARTITION "public"."accidents_default_zipcode_idx";



CREATE OR REPLACE TRIGGER "bsm_campaigns_updated_at" BEFORE UPDATE ON "public"."bsm_campaigns" FOR EACH ROW EXECUTE FUNCTION "public"."update_updated_at"();



CREATE OR REPLACE TRIGGER "content_items_updated_at" BEFORE UPDATE ON "public"."content_items" FOR EACH ROW EXECUTE FUNCTION "public"."update_updated_at"();



CREATE OR REPLACE TRIGGER "integrations_updated_at" BEFORE UPDATE ON "public"."integrations" FOR EACH ROW EXECUTE FUNCTION "public"."update_updated_at"();



CREATE OR REPLACE TRIGGER "location_brand_updated_at" BEFORE UPDATE ON "public"."location_brand" FOR EACH ROW EXECUTE FUNCTION "public"."update_updated_at"();



CREATE OR REPLACE TRIGGER "location_insurance_updated_at" BEFORE UPDATE ON "public"."location_insurance" FOR EACH ROW EXECUTE FUNCTION "public"."update_updated_at"();



CREATE OR REPLACE TRIGGER "location_market_updated_at" BEFORE UPDATE ON "public"."location_market" FOR EACH ROW EXECUTE FUNCTION "public"."update_updated_at"();



CREATE OR REPLACE TRIGGER "location_profiles_updated_at" BEFORE UPDATE ON "public"."location_profiles" FOR EACH ROW EXECUTE FUNCTION "public"."update_updated_at"();



CREATE OR REPLACE TRIGGER "locations_updated_at" BEFORE UPDATE ON "public"."locations" FOR EACH ROW EXECUTE FUNCTION "public"."update_updated_at"();



CREATE OR REPLACE TRIGGER "lr_pages_updated_at" BEFORE UPDATE ON "public"."localreach_pages" FOR EACH ROW EXECUTE FUNCTION "public"."update_updated_at"();



CREATE OR REPLACE TRIGGER "review_responses_updated_at" BEFORE UPDATE ON "public"."review_responses" FOR EACH ROW EXECUTE FUNCTION "public"."update_updated_at"();



CREATE OR REPLACE TRIGGER "shop_users_updated_at" BEFORE UPDATE ON "public"."shop_users" FOR EACH ROW EXECUTE FUNCTION "public"."update_updated_at"();



CREATE OR REPLACE TRIGGER "shops_updated_at" BEFORE UPDATE ON "public"."shops" FOR EACH ROW EXECUTE FUNCTION "public"."update_updated_at"();



CREATE OR REPLACE TRIGGER "subscriptions_updated_at" BEFORE UPDATE ON "public"."subscriptions" FOR EACH ROW EXECUTE FUNCTION "public"."update_updated_at"();



CREATE OR REPLACE TRIGGER "trg_updated_at" BEFORE UPDATE ON "public"."campaigns" FOR EACH ROW EXECUTE FUNCTION "public"."set_updated_at"();



CREATE OR REPLACE TRIGGER "trg_updated_at" BEFORE UPDATE ON "public"."clients" FOR EACH ROW EXECUTE FUNCTION "public"."set_updated_at"();



CREATE OR REPLACE TRIGGER "trg_updated_at" BEFORE UPDATE ON "public"."configs" FOR EACH ROW EXECUTE FUNCTION "public"."set_updated_at"();



CREATE OR REPLACE TRIGGER "trg_updated_at" BEFORE UPDATE ON "public"."pages" FOR EACH ROW EXECUTE FUNCTION "public"."set_updated_at"();



ALTER TABLE ONLY "public"."activity_log"
    ADD CONSTRAINT "activity_log_actor_id_fkey" FOREIGN KEY ("actor_id") REFERENCES "public"."profiles"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."analytics_snapshots"
    ADD CONSTRAINT "analytics_snapshots_location_id_fkey" FOREIGN KEY ("location_id") REFERENCES "public"."locations"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."analytics_snapshots"
    ADD CONSTRAINT "analytics_snapshots_shop_id_fkey" FOREIGN KEY ("shop_id") REFERENCES "public"."shops"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."bsm_campaigns"
    ADD CONSTRAINT "bsm_campaigns_location_id_fkey" FOREIGN KEY ("location_id") REFERENCES "public"."locations"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."bsm_campaigns"
    ADD CONSTRAINT "bsm_campaigns_shop_id_fkey" FOREIGN KEY ("shop_id") REFERENCES "public"."shops"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."campaign_sends"
    ADD CONSTRAINT "campaign_sends_campaign_id_fkey" FOREIGN KEY ("campaign_id") REFERENCES "public"."bsm_campaigns"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."campaigns"
    ADD CONSTRAINT "campaigns_client_id_fkey" FOREIGN KEY ("client_id") REFERENCES "public"."clients"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."campaigns"
    ADD CONSTRAINT "campaigns_created_by_fkey" FOREIGN KEY ("created_by") REFERENCES "public"."profiles"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."clients"
    ADD CONSTRAINT "clients_created_by_fkey" FOREIGN KEY ("created_by") REFERENCES "public"."profiles"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."competitors"
    ADD CONSTRAINT "competitors_consolidator_id_fkey" FOREIGN KEY ("consolidator_id") REFERENCES "public"."consolidators"("id");



ALTER TABLE ONLY "public"."competitors"
    ADD CONSTRAINT "competitors_report_id_fkey" FOREIGN KEY ("report_id") REFERENCES "public"."reports"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."competitors"
    ADD CONSTRAINT "competitors_shop_id_fkey" FOREIGN KEY ("shop_id") REFERENCES "public"."shops"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."configs"
    ADD CONSTRAINT "configs_client_id_fkey" FOREIGN KEY ("client_id") REFERENCES "public"."clients"("id");



ALTER TABLE ONLY "public"."configs"
    ADD CONSTRAINT "configs_created_by_fkey" FOREIGN KEY ("created_by") REFERENCES "public"."profiles"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."content_items"
    ADD CONSTRAINT "content_items_location_id_fkey" FOREIGN KEY ("location_id") REFERENCES "public"."locations"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."content_items"
    ADD CONSTRAINT "content_items_shop_id_fkey" FOREIGN KEY ("shop_id") REFERENCES "public"."shops"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."county_references"
    ADD CONSTRAINT "county_references_state_fips_fkey" FOREIGN KEY ("state_fips") REFERENCES "public"."state_references"("state_fips");



ALTER TABLE ONLY "public"."discovery_briefs"
    ADD CONSTRAINT "discovery_briefs_campaign_id_fkey" FOREIGN KEY ("campaign_id") REFERENCES "public"."campaigns"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."elements"
    ADD CONSTRAINT "elements_campaign_id_fkey" FOREIGN KEY ("campaign_id") REFERENCES "public"."campaigns"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."integrations"
    ADD CONSTRAINT "integrations_location_id_fkey" FOREIGN KEY ("location_id") REFERENCES "public"."locations"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."integrations"
    ADD CONSTRAINT "integrations_shop_id_fkey" FOREIGN KEY ("shop_id") REFERENCES "public"."shops"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."leads"
    ADD CONSTRAINT "leads_location_id_fkey" FOREIGN KEY ("location_id") REFERENCES "public"."locations"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."leads"
    ADD CONSTRAINT "leads_shop_id_fkey" FOREIGN KEY ("shop_id") REFERENCES "public"."shops"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."localreach_pages"
    ADD CONSTRAINT "localreach_pages_location_id_fkey" FOREIGN KEY ("location_id") REFERENCES "public"."locations"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."localreach_pages"
    ADD CONSTRAINT "localreach_pages_shop_id_fkey" FOREIGN KEY ("shop_id") REFERENCES "public"."shops"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."location_brand"
    ADD CONSTRAINT "location_brand_location_id_fkey" FOREIGN KEY ("location_id") REFERENCES "public"."locations"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."location_certifications"
    ADD CONSTRAINT "location_certifications_location_id_fkey" FOREIGN KEY ("location_id") REFERENCES "public"."locations"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."location_insurance"
    ADD CONSTRAINT "location_insurance_location_id_fkey" FOREIGN KEY ("location_id") REFERENCES "public"."locations"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."location_market"
    ADD CONSTRAINT "location_market_location_id_fkey" FOREIGN KEY ("location_id") REFERENCES "public"."locations"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."location_profiles"
    ADD CONSTRAINT "location_profiles_location_id_fkey" FOREIGN KEY ("location_id") REFERENCES "public"."locations"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."location_services"
    ADD CONSTRAINT "location_services_location_id_fkey" FOREIGN KEY ("location_id") REFERENCES "public"."locations"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."locations"
    ADD CONSTRAINT "locations_shop_id_fkey" FOREIGN KEY ("shop_id") REFERENCES "public"."shops"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."pages"
    ADD CONSTRAINT "pages_campaign_id_fkey" FOREIGN KEY ("campaign_id") REFERENCES "public"."campaigns"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."portal_sessions_log"
    ADD CONSTRAINT "portal_sessions_log_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "public"."portal_users"("id");



ALTER TABLE ONLY "public"."profiles"
    ADD CONSTRAINT "profiles_id_fkey" FOREIGN KEY ("id") REFERENCES "auth"."users"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."reports"
    ADD CONSTRAINT "reports_shop_id_fkey" FOREIGN KEY ("shop_id") REFERENCES "public"."shops"("id");



ALTER TABLE ONLY "public"."research_artifacts"
    ADD CONSTRAINT "research_artifacts_campaign_id_fkey" FOREIGN KEY ("campaign_id") REFERENCES "public"."campaigns"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."review_items"
    ADD CONSTRAINT "review_items_location_id_fkey" FOREIGN KEY ("location_id") REFERENCES "public"."locations"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."review_items"
    ADD CONSTRAINT "review_items_shop_id_fkey" FOREIGN KEY ("shop_id") REFERENCES "public"."shops"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."review_responses"
    ADD CONSTRAINT "review_responses_review_item_id_fkey" FOREIGN KEY ("review_item_id") REFERENCES "public"."review_items"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."reviews"
    ADD CONSTRAINT "reviews_author_id_fkey" FOREIGN KEY ("author_id") REFERENCES "public"."profiles"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."reviews"
    ADD CONSTRAINT "reviews_page_id_fkey" FOREIGN KEY ("page_id") REFERENCES "public"."pages"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."reviews"
    ADD CONSTRAINT "reviews_resolved_by_fkey" FOREIGN KEY ("resolved_by") REFERENCES "public"."profiles"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."shop_users"
    ADD CONSTRAINT "shop_users_shop_id_fkey" FOREIGN KEY ("shop_id") REFERENCES "public"."shops"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."shop_users"
    ADD CONSTRAINT "shop_users_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "auth"."users"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."shops"
    ADD CONSTRAINT "shops_client_id_fkey" FOREIGN KEY ("client_id") REFERENCES "public"."clients"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."skills"
    ADD CONSTRAINT "skills_installed_by_fkey" FOREIGN KEY ("installed_by") REFERENCES "public"."profiles"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."subscriptions"
    ADD CONSTRAINT "subscriptions_shop_id_fkey" FOREIGN KEY ("shop_id") REFERENCES "public"."shops"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."zip_references"
    ADD CONSTRAINT "zip_references_county_fips_fkey" FOREIGN KEY ("county_fips") REFERENCES "public"."county_references"("county_fips");



ALTER TABLE ONLY "public"."zip_references"
    ADD CONSTRAINT "zip_references_state_fips_fkey" FOREIGN KEY ("state_fips") REFERENCES "public"."state_references"("state_fips");



CREATE POLICY "Allow all for anon" ON "public"."activity_log" TO "anon" USING (true) WITH CHECK (true);



CREATE POLICY "Allow all for anon" ON "public"."campaigns" TO "anon" USING (true) WITH CHECK (true);



CREATE POLICY "Allow all for anon" ON "public"."clients" TO "anon" USING (true) WITH CHECK (true);



CREATE POLICY "Allow all for anon" ON "public"."configs" TO "anon" USING (true) WITH CHECK (true);



CREATE POLICY "Allow all for anon" ON "public"."discovery_briefs" TO "anon" USING (true) WITH CHECK (true);



CREATE POLICY "Allow all for anon" ON "public"."elements" TO "anon" USING (true) WITH CHECK (true);



CREATE POLICY "Allow all for anon" ON "public"."pages" TO "anon" USING (true) WITH CHECK (true);



CREATE POLICY "Allow all for anon" ON "public"."profiles" TO "anon" USING (true) WITH CHECK (true);



CREATE POLICY "Allow all for anon" ON "public"."research_artifacts" TO "anon" USING (true) WITH CHECK (true);



CREATE POLICY "Allow all for anon" ON "public"."reviews" TO "anon" USING (true) WITH CHECK (true);



CREATE POLICY "Allow all for anon" ON "public"."shops" TO "anon" USING (true) WITH CHECK (true);



CREATE POLICY "Allow all for anon" ON "public"."skills" TO "anon" USING (true) WITH CHECK (true);



CREATE POLICY "Allow all for authenticated" ON "public"."activity_log" TO "authenticated" USING (true) WITH CHECK (true);



CREATE POLICY "Allow all for authenticated" ON "public"."campaigns" TO "authenticated" USING (true) WITH CHECK (true);



CREATE POLICY "Allow all for authenticated" ON "public"."clients" TO "authenticated" USING (true) WITH CHECK (true);



CREATE POLICY "Allow all for authenticated" ON "public"."configs" TO "authenticated" USING (true) WITH CHECK (true);



CREATE POLICY "Allow all for authenticated" ON "public"."discovery_briefs" TO "authenticated" USING (true) WITH CHECK (true);



CREATE POLICY "Allow all for authenticated" ON "public"."elements" TO "authenticated" USING (true) WITH CHECK (true);



CREATE POLICY "Allow all for authenticated" ON "public"."pages" TO "authenticated" USING (true) WITH CHECK (true);



CREATE POLICY "Allow all for authenticated" ON "public"."profiles" TO "authenticated" USING (true) WITH CHECK (true);



CREATE POLICY "Allow all for authenticated" ON "public"."research_artifacts" TO "authenticated" USING (true) WITH CHECK (true);



CREATE POLICY "Allow all for authenticated" ON "public"."reviews" TO "authenticated" USING (true) WITH CHECK (true);



CREATE POLICY "Allow all for authenticated" ON "public"."shops" TO "authenticated" USING (true) WITH CHECK (true);



CREATE POLICY "Allow all for authenticated" ON "public"."skills" TO "authenticated" USING (true) WITH CHECK (true);



CREATE POLICY "Anon users denied" ON "public"."reports" FOR SELECT TO "anon" USING (false);



CREATE POLICY "Service role full access" ON "public"."reports" TO "service_role" USING (true) WITH CHECK (true);



CREATE POLICY "Users can view own reports" ON "public"."reports" FOR SELECT TO "authenticated" USING (("auth"."uid"() = "user_id"));



ALTER TABLE "public"."accident_density" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."accident_import_sources" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."accident_market_daypart_rollup" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."accident_market_rollup" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."accident_market_zip_rollup" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."accidents" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."accidents_2016" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."accidents_2017" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."accidents_2018" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."accidents_2019" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."accidents_2020" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."accidents_2021" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."accidents_2022" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."accidents_2023" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."accidents_2024" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."accidents_2025" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."accidents_2026" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."accidents_2027" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."accidents_default" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."activity_log" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."ad_copy_events" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."ai_prompt_templates" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."analytics_snapshots" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "analytics_snapshots_insert" ON "public"."analytics_snapshots" FOR INSERT WITH CHECK ((("shop_id" IN ( SELECT "public"."user_shop_ids"() AS "user_shop_ids")) AND ("location_id" IN ( SELECT "public"."user_location_ids"() AS "user_location_ids"))));



CREATE POLICY "analytics_snapshots_select" ON "public"."analytics_snapshots" FOR SELECT USING (("shop_id" IN ( SELECT "public"."user_shop_ids"() AS "user_shop_ids")));



ALTER TABLE "public"."api_cache" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "api_cache_service_only" ON "public"."api_cache" TO "service_role" USING (true);



ALTER TABLE "public"."body_shops" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "body_shops_psg_admin_select" ON "public"."body_shops" FOR SELECT TO "authenticated" USING ((EXISTS ( SELECT 1
   FROM "public"."portal_users"
  WHERE (("portal_users"."id" = "auth"."uid"()) AND ("portal_users"."role" = 'psg_admin'::"text")))));



ALTER TABLE "public"."bsm_campaigns" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "bsm_campaigns_delete" ON "public"."bsm_campaigns" FOR DELETE USING (("shop_id" IN ( SELECT "public"."user_shop_ids"() AS "user_shop_ids")));



CREATE POLICY "bsm_campaigns_insert" ON "public"."bsm_campaigns" FOR INSERT WITH CHECK (("shop_id" IN ( SELECT "public"."user_shop_ids"() AS "user_shop_ids")));



CREATE POLICY "bsm_campaigns_select" ON "public"."bsm_campaigns" FOR SELECT USING (("shop_id" IN ( SELECT "public"."user_shop_ids"() AS "user_shop_ids")));



CREATE POLICY "bsm_campaigns_update" ON "public"."bsm_campaigns" FOR UPDATE USING (("shop_id" IN ( SELECT "public"."user_shop_ids"() AS "user_shop_ids"))) WITH CHECK (("shop_id" IN ( SELECT "public"."user_shop_ids"() AS "user_shop_ids")));



ALTER TABLE "public"."campaign_budget_snapshots" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."campaign_sends" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "campaign_sends_delete" ON "public"."campaign_sends" FOR DELETE USING (("campaign_id" IN ( SELECT "bsm_campaigns"."id"
   FROM "public"."bsm_campaigns"
  WHERE ("bsm_campaigns"."shop_id" IN ( SELECT "public"."user_shop_ids"() AS "user_shop_ids")))));



CREATE POLICY "campaign_sends_insert" ON "public"."campaign_sends" FOR INSERT WITH CHECK (("campaign_id" IN ( SELECT "bsm_campaigns"."id"
   FROM "public"."bsm_campaigns"
  WHERE ("bsm_campaigns"."shop_id" IN ( SELECT "public"."user_shop_ids"() AS "user_shop_ids")))));



CREATE POLICY "campaign_sends_select" ON "public"."campaign_sends" FOR SELECT USING (("campaign_id" IN ( SELECT "bsm_campaigns"."id"
   FROM "public"."bsm_campaigns"
  WHERE ("bsm_campaigns"."shop_id" IN ( SELECT "public"."user_shop_ids"() AS "user_shop_ids")))));



ALTER TABLE "public"."campaigns" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."clients" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."competitors" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "competitors_auth_insert" ON "public"."competitors" FOR INSERT TO "authenticated" WITH CHECK (true);



CREATE POLICY "competitors_auth_select" ON "public"."competitors" FOR SELECT TO "authenticated" USING (true);



CREATE POLICY "competitors_auth_update" ON "public"."competitors" FOR UPDATE TO "authenticated" USING (true);



ALTER TABLE "public"."configs" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."consolidators" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "consolidators_auth_select" ON "public"."consolidators" FOR SELECT TO "authenticated" USING (true);



ALTER TABLE "public"."content_items" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "content_items_delete" ON "public"."content_items" FOR DELETE USING (("shop_id" IN ( SELECT "public"."user_shop_ids"() AS "user_shop_ids")));



CREATE POLICY "content_items_insert" ON "public"."content_items" FOR INSERT WITH CHECK ((("shop_id" IN ( SELECT "public"."user_shop_ids"() AS "user_shop_ids")) AND ("location_id" IN ( SELECT "public"."user_location_ids"() AS "user_location_ids"))));



CREATE POLICY "content_items_select" ON "public"."content_items" FOR SELECT USING (("shop_id" IN ( SELECT "public"."user_shop_ids"() AS "user_shop_ids")));



CREATE POLICY "content_items_update" ON "public"."content_items" FOR UPDATE USING (("shop_id" IN ( SELECT "public"."user_shop_ids"() AS "user_shop_ids"))) WITH CHECK (("shop_id" IN ( SELECT "public"."user_shop_ids"() AS "user_shop_ids")));



ALTER TABLE "public"."county_references" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."county_vehicle_registrations" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."crash_event_sources" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."crash_events" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."crash_zip_annual" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."customer_zip_report_monthly" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."discovery_briefs" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."dmv_vehicle_registrations" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."elements" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."email_events" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."estimated_zip_vehicles" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."ev_registrations" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."integrations" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "integrations_delete" ON "public"."integrations" FOR DELETE USING (("shop_id" IN ( SELECT "public"."user_shop_ids"() AS "user_shop_ids")));



CREATE POLICY "integrations_insert" ON "public"."integrations" FOR INSERT WITH CHECK (("shop_id" IN ( SELECT "public"."user_shop_ids"() AS "user_shop_ids")));



CREATE POLICY "integrations_select" ON "public"."integrations" FOR SELECT USING (("shop_id" IN ( SELECT "public"."user_shop_ids"() AS "user_shop_ids")));



CREATE POLICY "integrations_update" ON "public"."integrations" FOR UPDATE USING (("shop_id" IN ( SELECT "public"."user_shop_ids"() AS "user_shop_ids"))) WITH CHECK (("shop_id" IN ( SELECT "public"."user_shop_ids"() AS "user_shop_ids")));



ALTER TABLE "public"."invoiced_customers" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "invoiced_customers_psg_admin_select" ON "public"."invoiced_customers" FOR SELECT TO "authenticated" USING ((EXISTS ( SELECT 1
   FROM "public"."portal_users"
  WHERE (("portal_users"."id" = "auth"."uid"()) AND ("portal_users"."role" = 'psg_admin'::"text")))));



ALTER TABLE "public"."leads" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "leads_delete" ON "public"."leads" FOR DELETE USING (("shop_id" IN ( SELECT "public"."user_shop_ids"() AS "user_shop_ids")));



CREATE POLICY "leads_insert" ON "public"."leads" FOR INSERT WITH CHECK ((("shop_id" IN ( SELECT "public"."user_shop_ids"() AS "user_shop_ids")) AND ("location_id" IN ( SELECT "public"."user_location_ids"() AS "user_location_ids"))));



CREATE POLICY "leads_select" ON "public"."leads" FOR SELECT USING (("shop_id" IN ( SELECT "public"."user_shop_ids"() AS "user_shop_ids")));



ALTER TABLE "public"."localreach_pages" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."location_brand" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "location_brand_delete" ON "public"."location_brand" FOR DELETE USING (("location_id" IN ( SELECT "public"."user_location_ids"() AS "user_location_ids")));



CREATE POLICY "location_brand_insert" ON "public"."location_brand" FOR INSERT WITH CHECK (("location_id" IN ( SELECT "public"."user_location_ids"() AS "user_location_ids")));



CREATE POLICY "location_brand_select" ON "public"."location_brand" FOR SELECT USING (("location_id" IN ( SELECT "public"."user_location_ids"() AS "user_location_ids")));



CREATE POLICY "location_brand_update" ON "public"."location_brand" FOR UPDATE USING (("location_id" IN ( SELECT "public"."user_location_ids"() AS "user_location_ids"))) WITH CHECK (("location_id" IN ( SELECT "public"."user_location_ids"() AS "user_location_ids")));



ALTER TABLE "public"."location_certifications" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "location_certifications_delete" ON "public"."location_certifications" FOR DELETE USING (("location_id" IN ( SELECT "public"."user_location_ids"() AS "user_location_ids")));



CREATE POLICY "location_certifications_insert" ON "public"."location_certifications" FOR INSERT WITH CHECK (("location_id" IN ( SELECT "public"."user_location_ids"() AS "user_location_ids")));



CREATE POLICY "location_certifications_select" ON "public"."location_certifications" FOR SELECT USING (("location_id" IN ( SELECT "public"."user_location_ids"() AS "user_location_ids")));



CREATE POLICY "location_certifications_update" ON "public"."location_certifications" FOR UPDATE USING (("location_id" IN ( SELECT "public"."user_location_ids"() AS "user_location_ids"))) WITH CHECK (("location_id" IN ( SELECT "public"."user_location_ids"() AS "user_location_ids")));



ALTER TABLE "public"."location_insurance" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "location_insurance_delete" ON "public"."location_insurance" FOR DELETE USING (("location_id" IN ( SELECT "public"."user_location_ids"() AS "user_location_ids")));



CREATE POLICY "location_insurance_insert" ON "public"."location_insurance" FOR INSERT WITH CHECK (("location_id" IN ( SELECT "public"."user_location_ids"() AS "user_location_ids")));



CREATE POLICY "location_insurance_select" ON "public"."location_insurance" FOR SELECT USING (("location_id" IN ( SELECT "public"."user_location_ids"() AS "user_location_ids")));



CREATE POLICY "location_insurance_update" ON "public"."location_insurance" FOR UPDATE USING (("location_id" IN ( SELECT "public"."user_location_ids"() AS "user_location_ids"))) WITH CHECK (("location_id" IN ( SELECT "public"."user_location_ids"() AS "user_location_ids")));



ALTER TABLE "public"."location_market" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "location_market_delete" ON "public"."location_market" FOR DELETE USING (("location_id" IN ( SELECT "public"."user_location_ids"() AS "user_location_ids")));



CREATE POLICY "location_market_insert" ON "public"."location_market" FOR INSERT WITH CHECK (("location_id" IN ( SELECT "public"."user_location_ids"() AS "user_location_ids")));



CREATE POLICY "location_market_select" ON "public"."location_market" FOR SELECT USING (("location_id" IN ( SELECT "public"."user_location_ids"() AS "user_location_ids")));



CREATE POLICY "location_market_update" ON "public"."location_market" FOR UPDATE USING (("location_id" IN ( SELECT "public"."user_location_ids"() AS "user_location_ids"))) WITH CHECK (("location_id" IN ( SELECT "public"."user_location_ids"() AS "user_location_ids")));



ALTER TABLE "public"."location_paperclip_mapping" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."location_profiles" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "location_profiles_delete" ON "public"."location_profiles" FOR DELETE USING (("location_id" IN ( SELECT "public"."user_location_ids"() AS "user_location_ids")));



CREATE POLICY "location_profiles_insert" ON "public"."location_profiles" FOR INSERT WITH CHECK (("location_id" IN ( SELECT "public"."user_location_ids"() AS "user_location_ids")));



CREATE POLICY "location_profiles_select" ON "public"."location_profiles" FOR SELECT USING (("location_id" IN ( SELECT "public"."user_location_ids"() AS "user_location_ids")));



CREATE POLICY "location_profiles_update" ON "public"."location_profiles" FOR UPDATE USING (("location_id" IN ( SELECT "public"."user_location_ids"() AS "user_location_ids"))) WITH CHECK (("location_id" IN ( SELECT "public"."user_location_ids"() AS "user_location_ids")));



ALTER TABLE "public"."location_services" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "location_services_delete" ON "public"."location_services" FOR DELETE USING (("location_id" IN ( SELECT "public"."user_location_ids"() AS "user_location_ids")));



CREATE POLICY "location_services_insert" ON "public"."location_services" FOR INSERT WITH CHECK (("location_id" IN ( SELECT "public"."user_location_ids"() AS "user_location_ids")));



CREATE POLICY "location_services_select" ON "public"."location_services" FOR SELECT USING (("location_id" IN ( SELECT "public"."user_location_ids"() AS "user_location_ids")));



CREATE POLICY "location_services_update" ON "public"."location_services" FOR UPDATE USING (("location_id" IN ( SELECT "public"."user_location_ids"() AS "user_location_ids"))) WITH CHECK (("location_id" IN ( SELECT "public"."user_location_ids"() AS "user_location_ids")));



ALTER TABLE "public"."locations" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "locations_delete" ON "public"."locations" FOR DELETE USING (("shop_id" IN ( SELECT "public"."user_shop_ids"() AS "user_shop_ids")));



CREATE POLICY "locations_insert" ON "public"."locations" FOR INSERT WITH CHECK (("shop_id" IN ( SELECT "public"."user_shop_ids"() AS "user_shop_ids")));



CREATE POLICY "locations_select" ON "public"."locations" FOR SELECT USING (("shop_id" IN ( SELECT "public"."user_shop_ids"() AS "user_shop_ids")));



CREATE POLICY "locations_update" ON "public"."locations" FOR UPDATE USING (("shop_id" IN ( SELECT "public"."user_shop_ids"() AS "user_shop_ids"))) WITH CHECK (("shop_id" IN ( SELECT "public"."user_shop_ids"() AS "user_shop_ids")));



CREATE POLICY "lpm_insert" ON "public"."location_paperclip_mapping" FOR INSERT WITH CHECK (("shop_id" IN ( SELECT "public"."user_shop_ids"() AS "user_shop_ids")));



CREATE POLICY "lpm_select" ON "public"."location_paperclip_mapping" FOR SELECT USING (("shop_id" IN ( SELECT "public"."user_shop_ids"() AS "user_shop_ids")));



CREATE POLICY "lr_pages_delete" ON "public"."localreach_pages" FOR DELETE USING (("shop_id" IN ( SELECT "public"."user_shop_ids"() AS "user_shop_ids")));



CREATE POLICY "lr_pages_insert" ON "public"."localreach_pages" FOR INSERT WITH CHECK (("shop_id" IN ( SELECT "public"."user_shop_ids"() AS "user_shop_ids")));



CREATE POLICY "lr_pages_public_read" ON "public"."localreach_pages" FOR SELECT TO "anon" USING (("is_active" = true));



CREATE POLICY "lr_pages_select" ON "public"."localreach_pages" FOR SELECT USING (("shop_id" IN ( SELECT "public"."user_shop_ids"() AS "user_shop_ids")));



CREATE POLICY "lr_pages_update" ON "public"."localreach_pages" FOR UPDATE USING (("shop_id" IN ( SELECT "public"."user_shop_ids"() AS "user_shop_ids"))) WITH CHECK (("shop_id" IN ( SELECT "public"."user_shop_ids"() AS "user_shop_ids")));



ALTER TABLE "public"."market_map_point_cache" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."market_zip_latest_signal" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."pages" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "pkc_auth_select" ON "public"."psg_knowledge_chunks" FOR SELECT TO "authenticated" USING (true);



CREATE POLICY "pkc_service_write" ON "public"."psg_knowledge_chunks" TO "service_role" USING (true);



ALTER TABLE "public"."portal_sessions_log" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."portal_users" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "portal_users_self_select" ON "public"."portal_users" FOR SELECT TO "authenticated" USING (("id" = "auth"."uid"()));



ALTER TABLE "public"."profiles" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."psg_knowledge_chunks" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."psg_knowledge_meta" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "psg_knowledge_meta_auth_select" ON "public"."psg_knowledge_meta" FOR SELECT TO "authenticated" USING (true);



CREATE POLICY "psg_knowledge_meta_service_write" ON "public"."psg_knowledge_meta" TO "service_role" USING (true);



ALTER TABLE "public"."reports" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."research_artifacts" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."review_items" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "review_items_delete" ON "public"."review_items" FOR DELETE USING (("shop_id" IN ( SELECT "public"."user_shop_ids"() AS "user_shop_ids")));



CREATE POLICY "review_items_insert" ON "public"."review_items" FOR INSERT WITH CHECK ((("shop_id" IN ( SELECT "public"."user_shop_ids"() AS "user_shop_ids")) AND ("location_id" IN ( SELECT "public"."user_location_ids"() AS "user_location_ids"))));



CREATE POLICY "review_items_select" ON "public"."review_items" FOR SELECT USING (("shop_id" IN ( SELECT "public"."user_shop_ids"() AS "user_shop_ids")));



CREATE POLICY "review_items_update" ON "public"."review_items" FOR UPDATE USING (("shop_id" IN ( SELECT "public"."user_shop_ids"() AS "user_shop_ids"))) WITH CHECK (("shop_id" IN ( SELECT "public"."user_shop_ids"() AS "user_shop_ids")));



ALTER TABLE "public"."review_responses" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "review_responses_delete" ON "public"."review_responses" FOR DELETE USING (("review_item_id" IN ( SELECT "review_items"."id"
   FROM "public"."review_items"
  WHERE ("review_items"."shop_id" IN ( SELECT "public"."user_shop_ids"() AS "user_shop_ids")))));



CREATE POLICY "review_responses_insert" ON "public"."review_responses" FOR INSERT WITH CHECK (("review_item_id" IN ( SELECT "review_items"."id"
   FROM "public"."review_items"
  WHERE ("review_items"."shop_id" IN ( SELECT "public"."user_shop_ids"() AS "user_shop_ids")))));



CREATE POLICY "review_responses_select" ON "public"."review_responses" FOR SELECT USING (("review_item_id" IN ( SELECT "review_items"."id"
   FROM "public"."review_items"
  WHERE ("review_items"."shop_id" IN ( SELECT "public"."user_shop_ids"() AS "user_shop_ids")))));



CREATE POLICY "review_responses_update" ON "public"."review_responses" FOR UPDATE USING (("review_item_id" IN ( SELECT "review_items"."id"
   FROM "public"."review_items"
  WHERE ("review_items"."shop_id" IN ( SELECT "public"."user_shop_ids"() AS "user_shop_ids"))))) WITH CHECK (("review_item_id" IN ( SELECT "review_items"."id"
   FROM "public"."review_items"
  WHERE ("review_items"."shop_id" IN ( SELECT "public"."user_shop_ids"() AS "user_shop_ids")))));



ALTER TABLE "public"."reviews" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."shop_users" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "shop_users_delete" ON "public"."shop_users" FOR DELETE USING (("public"."user_is_shop_owner"("shop_id") AND ("user_id" <> "auth"."uid"())));



CREATE POLICY "shop_users_insert" ON "public"."shop_users" FOR INSERT WITH CHECK ("public"."user_is_shop_owner"("shop_id"));



CREATE POLICY "shop_users_select" ON "public"."shop_users" FOR SELECT USING (("shop_id" IN ( SELECT "public"."user_shop_ids"() AS "user_shop_ids")));



CREATE POLICY "shop_users_update" ON "public"."shop_users" FOR UPDATE USING ("public"."user_is_shop_owner"("shop_id")) WITH CHECK ("public"."user_is_shop_owner"("shop_id"));



ALTER TABLE "public"."shops" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "shops_select" ON "public"."shops" FOR SELECT USING (("id" IN ( SELECT "public"."user_shop_ids"() AS "user_shop_ids")));



CREATE POLICY "shops_update" ON "public"."shops" FOR UPDATE USING (("id" IN ( SELECT "public"."user_shop_ids"() AS "user_shop_ids"))) WITH CHECK (("id" IN ( SELECT "public"."user_shop_ids"() AS "user_shop_ids")));



ALTER TABLE "public"."skills" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."sms_events" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."state_references" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."state_vehicle_registrations" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."storm_event_sources" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."storm_events" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."storm_zip_monthly" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."subscriptions" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "subscriptions_select" ON "public"."subscriptions" FOR SELECT USING (("shop_id" IN ( SELECT "public"."user_shop_ids"() AS "user_shop_ids")));



ALTER TABLE "public"."survey_responses" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "survey_responses_admin_all" ON "public"."survey_responses" USING ((EXISTS ( SELECT 1
   FROM "public"."portal_users"
  WHERE (("portal_users"."id" = "auth"."uid"()) AND ("portal_users"."role" = 'psg_admin'::"text")))));



CREATE POLICY "survey_responses_shop_owner_select" ON "public"."survey_responses" FOR SELECT USING (("shop_name" = ( SELECT "portal_users"."shop_id"
   FROM "public"."portal_users"
  WHERE ("portal_users"."id" = "auth"."uid"()))));



ALTER TABLE "public"."utm_exports" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."weather_cache" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "weather_cache_auth_select" ON "public"."weather_cache" FOR SELECT TO "authenticated" USING (true);



CREATE POLICY "weather_cache_service_update" ON "public"."weather_cache" FOR UPDATE TO "service_role" USING (true);



CREATE POLICY "weather_cache_service_write" ON "public"."weather_cache" FOR INSERT TO "service_role" WITH CHECK (true);



ALTER TABLE "public"."zcta_income_annual" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."zcta_vehicle_availability" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."zcta_zip_mapping" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."zip_references" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."zipcode_boundaries" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "sensitive"."pii_access_log" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "sensitive"."repair_customer_locations" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "sensitive"."repair_customers" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "sensitive"."survey_pii" ENABLE ROW LEVEL SECURITY;




ALTER PUBLICATION "supabase_realtime" OWNER TO "postgres";






GRANT USAGE ON SCHEMA "public" TO "postgres";
GRANT USAGE ON SCHEMA "public" TO "anon";
GRANT USAGE ON SCHEMA "public" TO "authenticated";
GRANT USAGE ON SCHEMA "public" TO "service_role";



GRANT USAGE ON SCHEMA "sensitive" TO "service_role";






















































GRANT ALL ON FUNCTION "public"."box2d_in"("cstring") TO "postgres";
GRANT ALL ON FUNCTION "public"."box2d_in"("cstring") TO "anon";
GRANT ALL ON FUNCTION "public"."box2d_in"("cstring") TO "authenticated";
GRANT ALL ON FUNCTION "public"."box2d_in"("cstring") TO "service_role";



GRANT ALL ON FUNCTION "public"."box2d_out"("public"."box2d") TO "postgres";
GRANT ALL ON FUNCTION "public"."box2d_out"("public"."box2d") TO "anon";
GRANT ALL ON FUNCTION "public"."box2d_out"("public"."box2d") TO "authenticated";
GRANT ALL ON FUNCTION "public"."box2d_out"("public"."box2d") TO "service_role";



GRANT ALL ON FUNCTION "public"."box2df_in"("cstring") TO "postgres";
GRANT ALL ON FUNCTION "public"."box2df_in"("cstring") TO "anon";
GRANT ALL ON FUNCTION "public"."box2df_in"("cstring") TO "authenticated";
GRANT ALL ON FUNCTION "public"."box2df_in"("cstring") TO "service_role";



GRANT ALL ON FUNCTION "public"."box2df_out"("public"."box2df") TO "postgres";
GRANT ALL ON FUNCTION "public"."box2df_out"("public"."box2df") TO "anon";
GRANT ALL ON FUNCTION "public"."box2df_out"("public"."box2df") TO "authenticated";
GRANT ALL ON FUNCTION "public"."box2df_out"("public"."box2df") TO "service_role";



GRANT ALL ON FUNCTION "public"."box3d_in"("cstring") TO "postgres";
GRANT ALL ON FUNCTION "public"."box3d_in"("cstring") TO "anon";
GRANT ALL ON FUNCTION "public"."box3d_in"("cstring") TO "authenticated";
GRANT ALL ON FUNCTION "public"."box3d_in"("cstring") TO "service_role";



GRANT ALL ON FUNCTION "public"."box3d_out"("public"."box3d") TO "postgres";
GRANT ALL ON FUNCTION "public"."box3d_out"("public"."box3d") TO "anon";
GRANT ALL ON FUNCTION "public"."box3d_out"("public"."box3d") TO "authenticated";
GRANT ALL ON FUNCTION "public"."box3d_out"("public"."box3d") TO "service_role";



GRANT ALL ON FUNCTION "public"."geography_analyze"("internal") TO "postgres";
GRANT ALL ON FUNCTION "public"."geography_analyze"("internal") TO "anon";
GRANT ALL ON FUNCTION "public"."geography_analyze"("internal") TO "authenticated";
GRANT ALL ON FUNCTION "public"."geography_analyze"("internal") TO "service_role";



GRANT ALL ON FUNCTION "public"."geography_in"("cstring", "oid", integer) TO "postgres";
GRANT ALL ON FUNCTION "public"."geography_in"("cstring", "oid", integer) TO "anon";
GRANT ALL ON FUNCTION "public"."geography_in"("cstring", "oid", integer) TO "authenticated";
GRANT ALL ON FUNCTION "public"."geography_in"("cstring", "oid", integer) TO "service_role";



GRANT ALL ON FUNCTION "public"."geography_out"("public"."geography") TO "postgres";
GRANT ALL ON FUNCTION "public"."geography_out"("public"."geography") TO "anon";
GRANT ALL ON FUNCTION "public"."geography_out"("public"."geography") TO "authenticated";
GRANT ALL ON FUNCTION "public"."geography_out"("public"."geography") TO "service_role";



GRANT ALL ON FUNCTION "public"."geography_recv"("internal", "oid", integer) TO "postgres";
GRANT ALL ON FUNCTION "public"."geography_recv"("internal", "oid", integer) TO "anon";
GRANT ALL ON FUNCTION "public"."geography_recv"("internal", "oid", integer) TO "authenticated";
GRANT ALL ON FUNCTION "public"."geography_recv"("internal", "oid", integer) TO "service_role";



GRANT ALL ON FUNCTION "public"."geography_send"("public"."geography") TO "postgres";
GRANT ALL ON FUNCTION "public"."geography_send"("public"."geography") TO "anon";
GRANT ALL ON FUNCTION "public"."geography_send"("public"."geography") TO "authenticated";
GRANT ALL ON FUNCTION "public"."geography_send"("public"."geography") TO "service_role";



GRANT ALL ON FUNCTION "public"."geography_typmod_in"("cstring"[]) TO "postgres";
GRANT ALL ON FUNCTION "public"."geography_typmod_in"("cstring"[]) TO "anon";
GRANT ALL ON FUNCTION "public"."geography_typmod_in"("cstring"[]) TO "authenticated";
GRANT ALL ON FUNCTION "public"."geography_typmod_in"("cstring"[]) TO "service_role";



GRANT ALL ON FUNCTION "public"."geography_typmod_out"(integer) TO "postgres";
GRANT ALL ON FUNCTION "public"."geography_typmod_out"(integer) TO "anon";
GRANT ALL ON FUNCTION "public"."geography_typmod_out"(integer) TO "authenticated";
GRANT ALL ON FUNCTION "public"."geography_typmod_out"(integer) TO "service_role";



GRANT ALL ON FUNCTION "public"."geometry_analyze"("internal") TO "postgres";
GRANT ALL ON FUNCTION "public"."geometry_analyze"("internal") TO "anon";
GRANT ALL ON FUNCTION "public"."geometry_analyze"("internal") TO "authenticated";
GRANT ALL ON FUNCTION "public"."geometry_analyze"("internal") TO "service_role";



GRANT ALL ON FUNCTION "public"."geometry_in"("cstring") TO "postgres";
GRANT ALL ON FUNCTION "public"."geometry_in"("cstring") TO "anon";
GRANT ALL ON FUNCTION "public"."geometry_in"("cstring") TO "authenticated";
GRANT ALL ON FUNCTION "public"."geometry_in"("cstring") TO "service_role";



GRANT ALL ON FUNCTION "public"."geometry_out"("public"."geometry") TO "postgres";
GRANT ALL ON FUNCTION "public"."geometry_out"("public"."geometry") TO "anon";
GRANT ALL ON FUNCTION "public"."geometry_out"("public"."geometry") TO "authenticated";
GRANT ALL ON FUNCTION "public"."geometry_out"("public"."geometry") TO "service_role";



GRANT ALL ON FUNCTION "public"."geometry_recv"("internal") TO "postgres";
GRANT ALL ON FUNCTION "public"."geometry_recv"("internal") TO "anon";
GRANT ALL ON FUNCTION "public"."geometry_recv"("internal") TO "authenticated";
GRANT ALL ON FUNCTION "public"."geometry_recv"("internal") TO "service_role";



GRANT ALL ON FUNCTION "public"."geometry_send"("public"."geometry") TO "postgres";
GRANT ALL ON FUNCTION "public"."geometry_send"("public"."geometry") TO "anon";
GRANT ALL ON FUNCTION "public"."geometry_send"("public"."geometry") TO "authenticated";
GRANT ALL ON FUNCTION "public"."geometry_send"("public"."geometry") TO "service_role";



GRANT ALL ON FUNCTION "public"."geometry_typmod_in"("cstring"[]) TO "postgres";
GRANT ALL ON FUNCTION "public"."geometry_typmod_in"("cstring"[]) TO "anon";
GRANT ALL ON FUNCTION "public"."geometry_typmod_in"("cstring"[]) TO "authenticated";
GRANT ALL ON FUNCTION "public"."geometry_typmod_in"("cstring"[]) TO "service_role";



GRANT ALL ON FUNCTION "public"."geometry_typmod_out"(integer) TO "postgres";
GRANT ALL ON FUNCTION "public"."geometry_typmod_out"(integer) TO "anon";
GRANT ALL ON FUNCTION "public"."geometry_typmod_out"(integer) TO "authenticated";
GRANT ALL ON FUNCTION "public"."geometry_typmod_out"(integer) TO "service_role";



GRANT ALL ON FUNCTION "public"."gidx_in"("cstring") TO "postgres";
GRANT ALL ON FUNCTION "public"."gidx_in"("cstring") TO "anon";
GRANT ALL ON FUNCTION "public"."gidx_in"("cstring") TO "authenticated";
GRANT ALL ON FUNCTION "public"."gidx_in"("cstring") TO "service_role";



GRANT ALL ON FUNCTION "public"."gidx_out"("public"."gidx") TO "postgres";
GRANT ALL ON FUNCTION "public"."gidx_out"("public"."gidx") TO "anon";
GRANT ALL ON FUNCTION "public"."gidx_out"("public"."gidx") TO "authenticated";
GRANT ALL ON FUNCTION "public"."gidx_out"("public"."gidx") TO "service_role";



GRANT ALL ON FUNCTION "public"."gtrgm_in"("cstring") TO "postgres";
GRANT ALL ON FUNCTION "public"."gtrgm_in"("cstring") TO "anon";
GRANT ALL ON FUNCTION "public"."gtrgm_in"("cstring") TO "authenticated";
GRANT ALL ON FUNCTION "public"."gtrgm_in"("cstring") TO "service_role";



GRANT ALL ON FUNCTION "public"."gtrgm_out"("public"."gtrgm") TO "postgres";
GRANT ALL ON FUNCTION "public"."gtrgm_out"("public"."gtrgm") TO "anon";
GRANT ALL ON FUNCTION "public"."gtrgm_out"("public"."gtrgm") TO "authenticated";
GRANT ALL ON FUNCTION "public"."gtrgm_out"("public"."gtrgm") TO "service_role";



GRANT ALL ON FUNCTION "public"."spheroid_in"("cstring") TO "postgres";
GRANT ALL ON FUNCTION "public"."spheroid_in"("cstring") TO "anon";
GRANT ALL ON FUNCTION "public"."spheroid_in"("cstring") TO "authenticated";
GRANT ALL ON FUNCTION "public"."spheroid_in"("cstring") TO "service_role";



GRANT ALL ON FUNCTION "public"."spheroid_out"("public"."spheroid") TO "postgres";
GRANT ALL ON FUNCTION "public"."spheroid_out"("public"."spheroid") TO "anon";
GRANT ALL ON FUNCTION "public"."spheroid_out"("public"."spheroid") TO "authenticated";
GRANT ALL ON FUNCTION "public"."spheroid_out"("public"."spheroid") TO "service_role";







































GRANT ALL ON FUNCTION "public"."box3d"("public"."box2d") TO "postgres";
GRANT ALL ON FUNCTION "public"."box3d"("public"."box2d") TO "anon";
GRANT ALL ON FUNCTION "public"."box3d"("public"."box2d") TO "authenticated";
GRANT ALL ON FUNCTION "public"."box3d"("public"."box2d") TO "service_role";



GRANT ALL ON FUNCTION "public"."geometry"("public"."box2d") TO "postgres";
GRANT ALL ON FUNCTION "public"."geometry"("public"."box2d") TO "anon";
GRANT ALL ON FUNCTION "public"."geometry"("public"."box2d") TO "authenticated";
GRANT ALL ON FUNCTION "public"."geometry"("public"."box2d") TO "service_role";



GRANT ALL ON FUNCTION "public"."box"("public"."box3d") TO "postgres";
GRANT ALL ON FUNCTION "public"."box"("public"."box3d") TO "anon";
GRANT ALL ON FUNCTION "public"."box"("public"."box3d") TO "authenticated";
GRANT ALL ON FUNCTION "public"."box"("public"."box3d") TO "service_role";



GRANT ALL ON FUNCTION "public"."box2d"("public"."box3d") TO "postgres";
GRANT ALL ON FUNCTION "public"."box2d"("public"."box3d") TO "anon";
GRANT ALL ON FUNCTION "public"."box2d"("public"."box3d") TO "authenticated";
GRANT ALL ON FUNCTION "public"."box2d"("public"."box3d") TO "service_role";



GRANT ALL ON FUNCTION "public"."geometry"("public"."box3d") TO "postgres";
GRANT ALL ON FUNCTION "public"."geometry"("public"."box3d") TO "anon";
GRANT ALL ON FUNCTION "public"."geometry"("public"."box3d") TO "authenticated";
GRANT ALL ON FUNCTION "public"."geometry"("public"."box3d") TO "service_role";



GRANT ALL ON FUNCTION "public"."geography"("bytea") TO "postgres";
GRANT ALL ON FUNCTION "public"."geography"("bytea") TO "anon";
GRANT ALL ON FUNCTION "public"."geography"("bytea") TO "authenticated";
GRANT ALL ON FUNCTION "public"."geography"("bytea") TO "service_role";



GRANT ALL ON FUNCTION "public"."geometry"("bytea") TO "postgres";
GRANT ALL ON FUNCTION "public"."geometry"("bytea") TO "anon";
GRANT ALL ON FUNCTION "public"."geometry"("bytea") TO "authenticated";
GRANT ALL ON FUNCTION "public"."geometry"("bytea") TO "service_role";



GRANT ALL ON FUNCTION "public"."bytea"("public"."geography") TO "postgres";
GRANT ALL ON FUNCTION "public"."bytea"("public"."geography") TO "anon";
GRANT ALL ON FUNCTION "public"."bytea"("public"."geography") TO "authenticated";
GRANT ALL ON FUNCTION "public"."bytea"("public"."geography") TO "service_role";



GRANT ALL ON FUNCTION "public"."geography"("public"."geography", integer, boolean) TO "postgres";
GRANT ALL ON FUNCTION "public"."geography"("public"."geography", integer, boolean) TO "anon";
GRANT ALL ON FUNCTION "public"."geography"("public"."geography", integer, boolean) TO "authenticated";
GRANT ALL ON FUNCTION "public"."geography"("public"."geography", integer, boolean) TO "service_role";



GRANT ALL ON FUNCTION "public"."geometry"("public"."geography") TO "postgres";
GRANT ALL ON FUNCTION "public"."geometry"("public"."geography") TO "anon";
GRANT ALL ON FUNCTION "public"."geometry"("public"."geography") TO "authenticated";
GRANT ALL ON FUNCTION "public"."geometry"("public"."geography") TO "service_role";



GRANT ALL ON FUNCTION "public"."box"("public"."geometry") TO "postgres";
GRANT ALL ON FUNCTION "public"."box"("public"."geometry") TO "anon";
GRANT ALL ON FUNCTION "public"."box"("public"."geometry") TO "authenticated";
GRANT ALL ON FUNCTION "public"."box"("public"."geometry") TO "service_role";



GRANT ALL ON FUNCTION "public"."box2d"("public"."geometry") TO "postgres";
GRANT ALL ON FUNCTION "public"."box2d"("public"."geometry") TO "anon";
GRANT ALL ON FUNCTION "public"."box2d"("public"."geometry") TO "authenticated";
GRANT ALL ON FUNCTION "public"."box2d"("public"."geometry") TO "service_role";



GRANT ALL ON FUNCTION "public"."box3d"("public"."geometry") TO "postgres";
GRANT ALL ON FUNCTION "public"."box3d"("public"."geometry") TO "anon";
GRANT ALL ON FUNCTION "public"."box3d"("public"."geometry") TO "authenticated";
GRANT ALL ON FUNCTION "public"."box3d"("public"."geometry") TO "service_role";



GRANT ALL ON FUNCTION "public"."bytea"("public"."geometry") TO "postgres";
GRANT ALL ON FUNCTION "public"."bytea"("public"."geometry") TO "anon";
GRANT ALL ON FUNCTION "public"."bytea"("public"."geometry") TO "authenticated";
GRANT ALL ON FUNCTION "public"."bytea"("public"."geometry") TO "service_role";



GRANT ALL ON FUNCTION "public"."geography"("public"."geometry") TO "postgres";
GRANT ALL ON FUNCTION "public"."geography"("public"."geometry") TO "anon";
GRANT ALL ON FUNCTION "public"."geography"("public"."geometry") TO "authenticated";
GRANT ALL ON FUNCTION "public"."geography"("public"."geometry") TO "service_role";



GRANT ALL ON FUNCTION "public"."geometry"("public"."geometry", integer, boolean) TO "postgres";
GRANT ALL ON FUNCTION "public"."geometry"("public"."geometry", integer, boolean) TO "anon";
GRANT ALL ON FUNCTION "public"."geometry"("public"."geometry", integer, boolean) TO "authenticated";
GRANT ALL ON FUNCTION "public"."geometry"("public"."geometry", integer, boolean) TO "service_role";



GRANT ALL ON FUNCTION "public"."json"("public"."geometry") TO "postgres";
GRANT ALL ON FUNCTION "public"."json"("public"."geometry") TO "anon";
GRANT ALL ON FUNCTION "public"."json"("public"."geometry") TO "authenticated";
GRANT ALL ON FUNCTION "public"."json"("public"."geometry") TO "service_role";



GRANT ALL ON FUNCTION "public"."jsonb"("public"."geometry") TO "postgres";
GRANT ALL ON FUNCTION "public"."jsonb"("public"."geometry") TO "anon";
GRANT ALL ON FUNCTION "public"."jsonb"("public"."geometry") TO "authenticated";
GRANT ALL ON FUNCTION "public"."jsonb"("public"."geometry") TO "service_role";



GRANT ALL ON FUNCTION "public"."path"("public"."geometry") TO "postgres";
GRANT ALL ON FUNCTION "public"."path"("public"."geometry") TO "anon";
GRANT ALL ON FUNCTION "public"."path"("public"."geometry") TO "authenticated";
GRANT ALL ON FUNCTION "public"."path"("public"."geometry") TO "service_role";



GRANT ALL ON FUNCTION "public"."point"("public"."geometry") TO "postgres";
GRANT ALL ON FUNCTION "public"."point"("public"."geometry") TO "anon";
GRANT ALL ON FUNCTION "public"."point"("public"."geometry") TO "authenticated";
GRANT ALL ON FUNCTION "public"."point"("public"."geometry") TO "service_role";



GRANT ALL ON FUNCTION "public"."polygon"("public"."geometry") TO "postgres";
GRANT ALL ON FUNCTION "public"."polygon"("public"."geometry") TO "anon";
GRANT ALL ON FUNCTION "public"."polygon"("public"."geometry") TO "authenticated";
GRANT ALL ON FUNCTION "public"."polygon"("public"."geometry") TO "service_role";



GRANT ALL ON FUNCTION "public"."text"("public"."geometry") TO "postgres";
GRANT ALL ON FUNCTION "public"."text"("public"."geometry") TO "anon";
GRANT ALL ON FUNCTION "public"."text"("public"."geometry") TO "authenticated";
GRANT ALL ON FUNCTION "public"."text"("public"."geometry") TO "service_role";















GRANT ALL ON FUNCTION "public"."geometry"("path") TO "postgres";
GRANT ALL ON FUNCTION "public"."geometry"("path") TO "anon";
GRANT ALL ON FUNCTION "public"."geometry"("path") TO "authenticated";
GRANT ALL ON FUNCTION "public"."geometry"("path") TO "service_role";



GRANT ALL ON FUNCTION "public"."geometry"("point") TO "postgres";
GRANT ALL ON FUNCTION "public"."geometry"("point") TO "anon";
GRANT ALL ON FUNCTION "public"."geometry"("point") TO "authenticated";
GRANT ALL ON FUNCTION "public"."geometry"("point") TO "service_role";



GRANT ALL ON FUNCTION "public"."geometry"("polygon") TO "postgres";
GRANT ALL ON FUNCTION "public"."geometry"("polygon") TO "anon";
GRANT ALL ON FUNCTION "public"."geometry"("polygon") TO "authenticated";
GRANT ALL ON FUNCTION "public"."geometry"("polygon") TO "service_role";












GRANT ALL ON FUNCTION "public"."geometry"("text") TO "postgres";
GRANT ALL ON FUNCTION "public"."geometry"("text") TO "anon";
GRANT ALL ON FUNCTION "public"."geometry"("text") TO "authenticated";
GRANT ALL ON FUNCTION "public"."geometry"("text") TO "service_role";































































































































































































































































































































































































































































































































































GRANT ALL ON FUNCTION "public"."_postgis_deprecate"("oldname" "text", "newname" "text", "version" "text") TO "postgres";
GRANT ALL ON FUNCTION "public"."_postgis_deprecate"("oldname" "text", "newname" "text", "version" "text") TO "anon";
GRANT ALL ON FUNCTION "public"."_postgis_deprecate"("oldname" "text", "newname" "text", "version" "text") TO "authenticated";
GRANT ALL ON FUNCTION "public"."_postgis_deprecate"("oldname" "text", "newname" "text", "version" "text") TO "service_role";



GRANT ALL ON FUNCTION "public"."_postgis_index_extent"("tbl" "regclass", "col" "text") TO "postgres";
GRANT ALL ON FUNCTION "public"."_postgis_index_extent"("tbl" "regclass", "col" "text") TO "anon";
GRANT ALL ON FUNCTION "public"."_postgis_index_extent"("tbl" "regclass", "col" "text") TO "authenticated";
GRANT ALL ON FUNCTION "public"."_postgis_index_extent"("tbl" "regclass", "col" "text") TO "service_role";



GRANT ALL ON FUNCTION "public"."_postgis_join_selectivity"("regclass", "text", "regclass", "text", "text") TO "postgres";
GRANT ALL ON FUNCTION "public"."_postgis_join_selectivity"("regclass", "text", "regclass", "text", "text") TO "anon";
GRANT ALL ON FUNCTION "public"."_postgis_join_selectivity"("regclass", "text", "regclass", "text", "text") TO "authenticated";
GRANT ALL ON FUNCTION "public"."_postgis_join_selectivity"("regclass", "text", "regclass", "text", "text") TO "service_role";



GRANT ALL ON FUNCTION "public"."_postgis_pgsql_version"() TO "postgres";
GRANT ALL ON FUNCTION "public"."_postgis_pgsql_version"() TO "anon";
GRANT ALL ON FUNCTION "public"."_postgis_pgsql_version"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."_postgis_pgsql_version"() TO "service_role";



GRANT ALL ON FUNCTION "public"."_postgis_scripts_pgsql_version"() TO "postgres";
GRANT ALL ON FUNCTION "public"."_postgis_scripts_pgsql_version"() TO "anon";
GRANT ALL ON FUNCTION "public"."_postgis_scripts_pgsql_version"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."_postgis_scripts_pgsql_version"() TO "service_role";



GRANT ALL ON FUNCTION "public"."_postgis_selectivity"("tbl" "regclass", "att_name" "text", "geom" "public"."geometry", "mode" "text") TO "postgres";
GRANT ALL ON FUNCTION "public"."_postgis_selectivity"("tbl" "regclass", "att_name" "text", "geom" "public"."geometry", "mode" "text") TO "anon";
GRANT ALL ON FUNCTION "public"."_postgis_selectivity"("tbl" "regclass", "att_name" "text", "geom" "public"."geometry", "mode" "text") TO "authenticated";
GRANT ALL ON FUNCTION "public"."_postgis_selectivity"("tbl" "regclass", "att_name" "text", "geom" "public"."geometry", "mode" "text") TO "service_role";



GRANT ALL ON FUNCTION "public"."_postgis_stats"("tbl" "regclass", "att_name" "text", "text") TO "postgres";
GRANT ALL ON FUNCTION "public"."_postgis_stats"("tbl" "regclass", "att_name" "text", "text") TO "anon";
GRANT ALL ON FUNCTION "public"."_postgis_stats"("tbl" "regclass", "att_name" "text", "text") TO "authenticated";
GRANT ALL ON FUNCTION "public"."_postgis_stats"("tbl" "regclass", "att_name" "text", "text") TO "service_role";



GRANT ALL ON FUNCTION "public"."_st_3ddfullywithin"("geom1" "public"."geometry", "geom2" "public"."geometry", double precision) TO "postgres";
GRANT ALL ON FUNCTION "public"."_st_3ddfullywithin"("geom1" "public"."geometry", "geom2" "public"."geometry", double precision) TO "anon";
GRANT ALL ON FUNCTION "public"."_st_3ddfullywithin"("geom1" "public"."geometry", "geom2" "public"."geometry", double precision) TO "authenticated";
GRANT ALL ON FUNCTION "public"."_st_3ddfullywithin"("geom1" "public"."geometry", "geom2" "public"."geometry", double precision) TO "service_role";



GRANT ALL ON FUNCTION "public"."_st_3ddwithin"("geom1" "public"."geometry", "geom2" "public"."geometry", double precision) TO "postgres";
GRANT ALL ON FUNCTION "public"."_st_3ddwithin"("geom1" "public"."geometry", "geom2" "public"."geometry", double precision) TO "anon";
GRANT ALL ON FUNCTION "public"."_st_3ddwithin"("geom1" "public"."geometry", "geom2" "public"."geometry", double precision) TO "authenticated";
GRANT ALL ON FUNCTION "public"."_st_3ddwithin"("geom1" "public"."geometry", "geom2" "public"."geometry", double precision) TO "service_role";



GRANT ALL ON FUNCTION "public"."_st_3dintersects"("geom1" "public"."geometry", "geom2" "public"."geometry") TO "postgres";
GRANT ALL ON FUNCTION "public"."_st_3dintersects"("geom1" "public"."geometry", "geom2" "public"."geometry") TO "anon";
GRANT ALL ON FUNCTION "public"."_st_3dintersects"("geom1" "public"."geometry", "geom2" "public"."geometry") TO "authenticated";
GRANT ALL ON FUNCTION "public"."_st_3dintersects"("geom1" "public"."geometry", "geom2" "public"."geometry") TO "service_role";



GRANT ALL ON FUNCTION "public"."_st_asgml"(integer, "public"."geometry", integer, integer, "text", "text") TO "postgres";
GRANT ALL ON FUNCTION "public"."_st_asgml"(integer, "public"."geometry", integer, integer, "text", "text") TO "anon";
GRANT ALL ON FUNCTION "public"."_st_asgml"(integer, "public"."geometry", integer, integer, "text", "text") TO "authenticated";
GRANT ALL ON FUNCTION "public"."_st_asgml"(integer, "public"."geometry", integer, integer, "text", "text") TO "service_role";



GRANT ALL ON FUNCTION "public"."_st_asx3d"(integer, "public"."geometry", integer, integer, "text") TO "postgres";
GRANT ALL ON FUNCTION "public"."_st_asx3d"(integer, "public"."geometry", integer, integer, "text") TO "anon";
GRANT ALL ON FUNCTION "public"."_st_asx3d"(integer, "public"."geometry", integer, integer, "text") TO "authenticated";
GRANT ALL ON FUNCTION "public"."_st_asx3d"(integer, "public"."geometry", integer, integer, "text") TO "service_role";



GRANT ALL ON FUNCTION "public"."_st_bestsrid"("public"."geography") TO "postgres";
GRANT ALL ON FUNCTION "public"."_st_bestsrid"("public"."geography") TO "anon";
GRANT ALL ON FUNCTION "public"."_st_bestsrid"("public"."geography") TO "authenticated";
GRANT ALL ON FUNCTION "public"."_st_bestsrid"("public"."geography") TO "service_role";



GRANT ALL ON FUNCTION "public"."_st_bestsrid"("public"."geography", "public"."geography") TO "postgres";
GRANT ALL ON FUNCTION "public"."_st_bestsrid"("public"."geography", "public"."geography") TO "anon";
GRANT ALL ON FUNCTION "public"."_st_bestsrid"("public"."geography", "public"."geography") TO "authenticated";
GRANT ALL ON FUNCTION "public"."_st_bestsrid"("public"."geography", "public"."geography") TO "service_role";



GRANT ALL ON FUNCTION "public"."_st_contains"("geom1" "public"."geometry", "geom2" "public"."geometry") TO "postgres";
GRANT ALL ON FUNCTION "public"."_st_contains"("geom1" "public"."geometry", "geom2" "public"."geometry") TO "anon";
GRANT ALL ON FUNCTION "public"."_st_contains"("geom1" "public"."geometry", "geom2" "public"."geometry") TO "authenticated";
GRANT ALL ON FUNCTION "public"."_st_contains"("geom1" "public"."geometry", "geom2" "public"."geometry") TO "service_role";



GRANT ALL ON FUNCTION "public"."_st_containsproperly"("geom1" "public"."geometry", "geom2" "public"."geometry") TO "postgres";
GRANT ALL ON FUNCTION "public"."_st_containsproperly"("geom1" "public"."geometry", "geom2" "public"."geometry") TO "anon";
GRANT ALL ON FUNCTION "public"."_st_containsproperly"("geom1" "public"."geometry", "geom2" "public"."geometry") TO "authenticated";
GRANT ALL ON FUNCTION "public"."_st_containsproperly"("geom1" "public"."geometry", "geom2" "public"."geometry") TO "service_role";



GRANT ALL ON FUNCTION "public"."_st_coveredby"("geog1" "public"."geography", "geog2" "public"."geography") TO "postgres";
GRANT ALL ON FUNCTION "public"."_st_coveredby"("geog1" "public"."geography", "geog2" "public"."geography") TO "anon";
GRANT ALL ON FUNCTION "public"."_st_coveredby"("geog1" "public"."geography", "geog2" "public"."geography") TO "authenticated";
GRANT ALL ON FUNCTION "public"."_st_coveredby"("geog1" "public"."geography", "geog2" "public"."geography") TO "service_role";



GRANT ALL ON FUNCTION "public"."_st_coveredby"("geom1" "public"."geometry", "geom2" "public"."geometry") TO "postgres";
GRANT ALL ON FUNCTION "public"."_st_coveredby"("geom1" "public"."geometry", "geom2" "public"."geometry") TO "anon";
GRANT ALL ON FUNCTION "public"."_st_coveredby"("geom1" "public"."geometry", "geom2" "public"."geometry") TO "authenticated";
GRANT ALL ON FUNCTION "public"."_st_coveredby"("geom1" "public"."geometry", "geom2" "public"."geometry") TO "service_role";



GRANT ALL ON FUNCTION "public"."_st_covers"("geog1" "public"."geography", "geog2" "public"."geography") TO "postgres";
GRANT ALL ON FUNCTION "public"."_st_covers"("geog1" "public"."geography", "geog2" "public"."geography") TO "anon";
GRANT ALL ON FUNCTION "public"."_st_covers"("geog1" "public"."geography", "geog2" "public"."geography") TO "authenticated";
GRANT ALL ON FUNCTION "public"."_st_covers"("geog1" "public"."geography", "geog2" "public"."geography") TO "service_role";



GRANT ALL ON FUNCTION "public"."_st_covers"("geom1" "public"."geometry", "geom2" "public"."geometry") TO "postgres";
GRANT ALL ON FUNCTION "public"."_st_covers"("geom1" "public"."geometry", "geom2" "public"."geometry") TO "anon";
GRANT ALL ON FUNCTION "public"."_st_covers"("geom1" "public"."geometry", "geom2" "public"."geometry") TO "authenticated";
GRANT ALL ON FUNCTION "public"."_st_covers"("geom1" "public"."geometry", "geom2" "public"."geometry") TO "service_role";



GRANT ALL ON FUNCTION "public"."_st_crosses"("geom1" "public"."geometry", "geom2" "public"."geometry") TO "postgres";
GRANT ALL ON FUNCTION "public"."_st_crosses"("geom1" "public"."geometry", "geom2" "public"."geometry") TO "anon";
GRANT ALL ON FUNCTION "public"."_st_crosses"("geom1" "public"."geometry", "geom2" "public"."geometry") TO "authenticated";
GRANT ALL ON FUNCTION "public"."_st_crosses"("geom1" "public"."geometry", "geom2" "public"."geometry") TO "service_role";



GRANT ALL ON FUNCTION "public"."_st_dfullywithin"("geom1" "public"."geometry", "geom2" "public"."geometry", double precision) TO "postgres";
GRANT ALL ON FUNCTION "public"."_st_dfullywithin"("geom1" "public"."geometry", "geom2" "public"."geometry", double precision) TO "anon";
GRANT ALL ON FUNCTION "public"."_st_dfullywithin"("geom1" "public"."geometry", "geom2" "public"."geometry", double precision) TO "authenticated";
GRANT ALL ON FUNCTION "public"."_st_dfullywithin"("geom1" "public"."geometry", "geom2" "public"."geometry", double precision) TO "service_role";



GRANT ALL ON FUNCTION "public"."_st_distancetree"("public"."geography", "public"."geography") TO "postgres";
GRANT ALL ON FUNCTION "public"."_st_distancetree"("public"."geography", "public"."geography") TO "anon";
GRANT ALL ON FUNCTION "public"."_st_distancetree"("public"."geography", "public"."geography") TO "authenticated";
GRANT ALL ON FUNCTION "public"."_st_distancetree"("public"."geography", "public"."geography") TO "service_role";



GRANT ALL ON FUNCTION "public"."_st_distancetree"("public"."geography", "public"."geography", double precision, boolean) TO "postgres";
GRANT ALL ON FUNCTION "public"."_st_distancetree"("public"."geography", "public"."geography", double precision, boolean) TO "anon";
GRANT ALL ON FUNCTION "public"."_st_distancetree"("public"."geography", "public"."geography", double precision, boolean) TO "authenticated";
GRANT ALL ON FUNCTION "public"."_st_distancetree"("public"."geography", "public"."geography", double precision, boolean) TO "service_role";



GRANT ALL ON FUNCTION "public"."_st_distanceuncached"("public"."geography", "public"."geography") TO "postgres";
GRANT ALL ON FUNCTION "public"."_st_distanceuncached"("public"."geography", "public"."geography") TO "anon";
GRANT ALL ON FUNCTION "public"."_st_distanceuncached"("public"."geography", "public"."geography") TO "authenticated";
GRANT ALL ON FUNCTION "public"."_st_distanceuncached"("public"."geography", "public"."geography") TO "service_role";



GRANT ALL ON FUNCTION "public"."_st_distanceuncached"("public"."geography", "public"."geography", boolean) TO "postgres";
GRANT ALL ON FUNCTION "public"."_st_distanceuncached"("public"."geography", "public"."geography", boolean) TO "anon";
GRANT ALL ON FUNCTION "public"."_st_distanceuncached"("public"."geography", "public"."geography", boolean) TO "authenticated";
GRANT ALL ON FUNCTION "public"."_st_distanceuncached"("public"."geography", "public"."geography", boolean) TO "service_role";



GRANT ALL ON FUNCTION "public"."_st_distanceuncached"("public"."geography", "public"."geography", double precision, boolean) TO "postgres";
GRANT ALL ON FUNCTION "public"."_st_distanceuncached"("public"."geography", "public"."geography", double precision, boolean) TO "anon";
GRANT ALL ON FUNCTION "public"."_st_distanceuncached"("public"."geography", "public"."geography", double precision, boolean) TO "authenticated";
GRANT ALL ON FUNCTION "public"."_st_distanceuncached"("public"."geography", "public"."geography", double precision, boolean) TO "service_role";



GRANT ALL ON FUNCTION "public"."_st_dwithin"("geom1" "public"."geometry", "geom2" "public"."geometry", double precision) TO "postgres";
GRANT ALL ON FUNCTION "public"."_st_dwithin"("geom1" "public"."geometry", "geom2" "public"."geometry", double precision) TO "anon";
GRANT ALL ON FUNCTION "public"."_st_dwithin"("geom1" "public"."geometry", "geom2" "public"."geometry", double precision) TO "authenticated";
GRANT ALL ON FUNCTION "public"."_st_dwithin"("geom1" "public"."geometry", "geom2" "public"."geometry", double precision) TO "service_role";



GRANT ALL ON FUNCTION "public"."_st_dwithin"("geog1" "public"."geography", "geog2" "public"."geography", "tolerance" double precision, "use_spheroid" boolean) TO "postgres";
GRANT ALL ON FUNCTION "public"."_st_dwithin"("geog1" "public"."geography", "geog2" "public"."geography", "tolerance" double precision, "use_spheroid" boolean) TO "anon";
GRANT ALL ON FUNCTION "public"."_st_dwithin"("geog1" "public"."geography", "geog2" "public"."geography", "tolerance" double precision, "use_spheroid" boolean) TO "authenticated";
GRANT ALL ON FUNCTION "public"."_st_dwithin"("geog1" "public"."geography", "geog2" "public"."geography", "tolerance" double precision, "use_spheroid" boolean) TO "service_role";



GRANT ALL ON FUNCTION "public"."_st_dwithinuncached"("public"."geography", "public"."geography", double precision) TO "postgres";
GRANT ALL ON FUNCTION "public"."_st_dwithinuncached"("public"."geography", "public"."geography", double precision) TO "anon";
GRANT ALL ON FUNCTION "public"."_st_dwithinuncached"("public"."geography", "public"."geography", double precision) TO "authenticated";
GRANT ALL ON FUNCTION "public"."_st_dwithinuncached"("public"."geography", "public"."geography", double precision) TO "service_role";



GRANT ALL ON FUNCTION "public"."_st_dwithinuncached"("public"."geography", "public"."geography", double precision, boolean) TO "postgres";
GRANT ALL ON FUNCTION "public"."_st_dwithinuncached"("public"."geography", "public"."geography", double precision, boolean) TO "anon";
GRANT ALL ON FUNCTION "public"."_st_dwithinuncached"("public"."geography", "public"."geography", double precision, boolean) TO "authenticated";
GRANT ALL ON FUNCTION "public"."_st_dwithinuncached"("public"."geography", "public"."geography", double precision, boolean) TO "service_role";



GRANT ALL ON FUNCTION "public"."_st_equals"("geom1" "public"."geometry", "geom2" "public"."geometry") TO "postgres";
GRANT ALL ON FUNCTION "public"."_st_equals"("geom1" "public"."geometry", "geom2" "public"."geometry") TO "anon";
GRANT ALL ON FUNCTION "public"."_st_equals"("geom1" "public"."geometry", "geom2" "public"."geometry") TO "authenticated";
GRANT ALL ON FUNCTION "public"."_st_equals"("geom1" "public"."geometry", "geom2" "public"."geometry") TO "service_role";



GRANT ALL ON FUNCTION "public"."_st_expand"("public"."geography", double precision) TO "postgres";
GRANT ALL ON FUNCTION "public"."_st_expand"("public"."geography", double precision) TO "anon";
GRANT ALL ON FUNCTION "public"."_st_expand"("public"."geography", double precision) TO "authenticated";
GRANT ALL ON FUNCTION "public"."_st_expand"("public"."geography", double precision) TO "service_role";



GRANT ALL ON FUNCTION "public"."_st_geomfromgml"("text", integer) TO "postgres";
GRANT ALL ON FUNCTION "public"."_st_geomfromgml"("text", integer) TO "anon";
GRANT ALL ON FUNCTION "public"."_st_geomfromgml"("text", integer) TO "authenticated";
GRANT ALL ON FUNCTION "public"."_st_geomfromgml"("text", integer) TO "service_role";



GRANT ALL ON FUNCTION "public"."_st_intersects"("geom1" "public"."geometry", "geom2" "public"."geometry") TO "postgres";
GRANT ALL ON FUNCTION "public"."_st_intersects"("geom1" "public"."geometry", "geom2" "public"."geometry") TO "anon";
GRANT ALL ON FUNCTION "public"."_st_intersects"("geom1" "public"."geometry", "geom2" "public"."geometry") TO "authenticated";
GRANT ALL ON FUNCTION "public"."_st_intersects"("geom1" "public"."geometry", "geom2" "public"."geometry") TO "service_role";



GRANT ALL ON FUNCTION "public"."_st_linecrossingdirection"("line1" "public"."geometry", "line2" "public"."geometry") TO "postgres";
GRANT ALL ON FUNCTION "public"."_st_linecrossingdirection"("line1" "public"."geometry", "line2" "public"."geometry") TO "anon";
GRANT ALL ON FUNCTION "public"."_st_linecrossingdirection"("line1" "public"."geometry", "line2" "public"."geometry") TO "authenticated";
GRANT ALL ON FUNCTION "public"."_st_linecrossingdirection"("line1" "public"."geometry", "line2" "public"."geometry") TO "service_role";



GRANT ALL ON FUNCTION "public"."_st_longestline"("geom1" "public"."geometry", "geom2" "public"."geometry") TO "postgres";
GRANT ALL ON FUNCTION "public"."_st_longestline"("geom1" "public"."geometry", "geom2" "public"."geometry") TO "anon";
GRANT ALL ON FUNCTION "public"."_st_longestline"("geom1" "public"."geometry", "geom2" "public"."geometry") TO "authenticated";
GRANT ALL ON FUNCTION "public"."_st_longestline"("geom1" "public"."geometry", "geom2" "public"."geometry") TO "service_role";



GRANT ALL ON FUNCTION "public"."_st_maxdistance"("geom1" "public"."geometry", "geom2" "public"."geometry") TO "postgres";
GRANT ALL ON FUNCTION "public"."_st_maxdistance"("geom1" "public"."geometry", "geom2" "public"."geometry") TO "anon";
GRANT ALL ON FUNCTION "public"."_st_maxdistance"("geom1" "public"."geometry", "geom2" "public"."geometry") TO "authenticated";
GRANT ALL ON FUNCTION "public"."_st_maxdistance"("geom1" "public"."geometry", "geom2" "public"."geometry") TO "service_role";



GRANT ALL ON FUNCTION "public"."_st_orderingequals"("geom1" "public"."geometry", "geom2" "public"."geometry") TO "postgres";
GRANT ALL ON FUNCTION "public"."_st_orderingequals"("geom1" "public"."geometry", "geom2" "public"."geometry") TO "anon";
GRANT ALL ON FUNCTION "public"."_st_orderingequals"("geom1" "public"."geometry", "geom2" "public"."geometry") TO "authenticated";
GRANT ALL ON FUNCTION "public"."_st_orderingequals"("geom1" "public"."geometry", "geom2" "public"."geometry") TO "service_role";



GRANT ALL ON FUNCTION "public"."_st_overlaps"("geom1" "public"."geometry", "geom2" "public"."geometry") TO "postgres";
GRANT ALL ON FUNCTION "public"."_st_overlaps"("geom1" "public"."geometry", "geom2" "public"."geometry") TO "anon";
GRANT ALL ON FUNCTION "public"."_st_overlaps"("geom1" "public"."geometry", "geom2" "public"."geometry") TO "authenticated";
GRANT ALL ON FUNCTION "public"."_st_overlaps"("geom1" "public"."geometry", "geom2" "public"."geometry") TO "service_role";



GRANT ALL ON FUNCTION "public"."_st_pointoutside"("public"."geography") TO "postgres";
GRANT ALL ON FUNCTION "public"."_st_pointoutside"("public"."geography") TO "anon";
GRANT ALL ON FUNCTION "public"."_st_pointoutside"("public"."geography") TO "authenticated";
GRANT ALL ON FUNCTION "public"."_st_pointoutside"("public"."geography") TO "service_role";



GRANT ALL ON FUNCTION "public"."_st_sortablehash"("geom" "public"."geometry") TO "postgres";
GRANT ALL ON FUNCTION "public"."_st_sortablehash"("geom" "public"."geometry") TO "anon";
GRANT ALL ON FUNCTION "public"."_st_sortablehash"("geom" "public"."geometry") TO "authenticated";
GRANT ALL ON FUNCTION "public"."_st_sortablehash"("geom" "public"."geometry") TO "service_role";



GRANT ALL ON FUNCTION "public"."_st_touches"("geom1" "public"."geometry", "geom2" "public"."geometry") TO "postgres";
GRANT ALL ON FUNCTION "public"."_st_touches"("geom1" "public"."geometry", "geom2" "public"."geometry") TO "anon";
GRANT ALL ON FUNCTION "public"."_st_touches"("geom1" "public"."geometry", "geom2" "public"."geometry") TO "authenticated";
GRANT ALL ON FUNCTION "public"."_st_touches"("geom1" "public"."geometry", "geom2" "public"."geometry") TO "service_role";



GRANT ALL ON FUNCTION "public"."_st_voronoi"("g1" "public"."geometry", "clip" "public"."geometry", "tolerance" double precision, "return_polygons" boolean) TO "postgres";
GRANT ALL ON FUNCTION "public"."_st_voronoi"("g1" "public"."geometry", "clip" "public"."geometry", "tolerance" double precision, "return_polygons" boolean) TO "anon";
GRANT ALL ON FUNCTION "public"."_st_voronoi"("g1" "public"."geometry", "clip" "public"."geometry", "tolerance" double precision, "return_polygons" boolean) TO "authenticated";
GRANT ALL ON FUNCTION "public"."_st_voronoi"("g1" "public"."geometry", "clip" "public"."geometry", "tolerance" double precision, "return_polygons" boolean) TO "service_role";



GRANT ALL ON FUNCTION "public"."_st_within"("geom1" "public"."geometry", "geom2" "public"."geometry") TO "postgres";
GRANT ALL ON FUNCTION "public"."_st_within"("geom1" "public"."geometry", "geom2" "public"."geometry") TO "anon";
GRANT ALL ON FUNCTION "public"."_st_within"("geom1" "public"."geometry", "geom2" "public"."geometry") TO "authenticated";
GRANT ALL ON FUNCTION "public"."_st_within"("geom1" "public"."geometry", "geom2" "public"."geometry") TO "service_role";



GRANT ALL ON FUNCTION "public"."addauth"("text") TO "postgres";
GRANT ALL ON FUNCTION "public"."addauth"("text") TO "anon";
GRANT ALL ON FUNCTION "public"."addauth"("text") TO "authenticated";
GRANT ALL ON FUNCTION "public"."addauth"("text") TO "service_role";



GRANT ALL ON FUNCTION "public"."addgeometrycolumn"("table_name" character varying, "column_name" character varying, "new_srid" integer, "new_type" character varying, "new_dim" integer, "use_typmod" boolean) TO "postgres";
GRANT ALL ON FUNCTION "public"."addgeometrycolumn"("table_name" character varying, "column_name" character varying, "new_srid" integer, "new_type" character varying, "new_dim" integer, "use_typmod" boolean) TO "anon";
GRANT ALL ON FUNCTION "public"."addgeometrycolumn"("table_name" character varying, "column_name" character varying, "new_srid" integer, "new_type" character varying, "new_dim" integer, "use_typmod" boolean) TO "authenticated";
GRANT ALL ON FUNCTION "public"."addgeometrycolumn"("table_name" character varying, "column_name" character varying, "new_srid" integer, "new_type" character varying, "new_dim" integer, "use_typmod" boolean) TO "service_role";



GRANT ALL ON FUNCTION "public"."addgeometrycolumn"("schema_name" character varying, "table_name" character varying, "column_name" character varying, "new_srid" integer, "new_type" character varying, "new_dim" integer, "use_typmod" boolean) TO "postgres";
GRANT ALL ON FUNCTION "public"."addgeometrycolumn"("schema_name" character varying, "table_name" character varying, "column_name" character varying, "new_srid" integer, "new_type" character varying, "new_dim" integer, "use_typmod" boolean) TO "anon";
GRANT ALL ON FUNCTION "public"."addgeometrycolumn"("schema_name" character varying, "table_name" character varying, "column_name" character varying, "new_srid" integer, "new_type" character varying, "new_dim" integer, "use_typmod" boolean) TO "authenticated";
GRANT ALL ON FUNCTION "public"."addgeometrycolumn"("schema_name" character varying, "table_name" character varying, "column_name" character varying, "new_srid" integer, "new_type" character varying, "new_dim" integer, "use_typmod" boolean) TO "service_role";



GRANT ALL ON FUNCTION "public"."addgeometrycolumn"("catalog_name" character varying, "schema_name" character varying, "table_name" character varying, "column_name" character varying, "new_srid_in" integer, "new_type" character varying, "new_dim" integer, "use_typmod" boolean) TO "postgres";
GRANT ALL ON FUNCTION "public"."addgeometrycolumn"("catalog_name" character varying, "schema_name" character varying, "table_name" character varying, "column_name" character varying, "new_srid_in" integer, "new_type" character varying, "new_dim" integer, "use_typmod" boolean) TO "anon";
GRANT ALL ON FUNCTION "public"."addgeometrycolumn"("catalog_name" character varying, "schema_name" character varying, "table_name" character varying, "column_name" character varying, "new_srid_in" integer, "new_type" character varying, "new_dim" integer, "use_typmod" boolean) TO "authenticated";
GRANT ALL ON FUNCTION "public"."addgeometrycolumn"("catalog_name" character varying, "schema_name" character varying, "table_name" character varying, "column_name" character varying, "new_srid_in" integer, "new_type" character varying, "new_dim" integer, "use_typmod" boolean) TO "service_role";



GRANT ALL ON FUNCTION "public"."box3dtobox"("public"."box3d") TO "postgres";
GRANT ALL ON FUNCTION "public"."box3dtobox"("public"."box3d") TO "anon";
GRANT ALL ON FUNCTION "public"."box3dtobox"("public"."box3d") TO "authenticated";
GRANT ALL ON FUNCTION "public"."box3dtobox"("public"."box3d") TO "service_role";



GRANT ALL ON FUNCTION "public"."checkauth"("text", "text") TO "postgres";
GRANT ALL ON FUNCTION "public"."checkauth"("text", "text") TO "anon";
GRANT ALL ON FUNCTION "public"."checkauth"("text", "text") TO "authenticated";
GRANT ALL ON FUNCTION "public"."checkauth"("text", "text") TO "service_role";



GRANT ALL ON FUNCTION "public"."checkauth"("text", "text", "text") TO "postgres";
GRANT ALL ON FUNCTION "public"."checkauth"("text", "text", "text") TO "anon";
GRANT ALL ON FUNCTION "public"."checkauth"("text", "text", "text") TO "authenticated";
GRANT ALL ON FUNCTION "public"."checkauth"("text", "text", "text") TO "service_role";



GRANT ALL ON FUNCTION "public"."checkauthtrigger"() TO "postgres";
GRANT ALL ON FUNCTION "public"."checkauthtrigger"() TO "anon";
GRANT ALL ON FUNCTION "public"."checkauthtrigger"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."checkauthtrigger"() TO "service_role";



GRANT ALL ON FUNCTION "public"."collision_targeting_examples"("p_state" "text", "p_year" integer, "result_limit" integer) TO "anon";
GRANT ALL ON FUNCTION "public"."collision_targeting_examples"("p_state" "text", "p_year" integer, "result_limit" integer) TO "authenticated";
GRANT ALL ON FUNCTION "public"."collision_targeting_examples"("p_state" "text", "p_year" integer, "result_limit" integer) TO "service_role";



GRANT ALL ON FUNCTION "public"."contains_2d"("public"."box2df", "public"."box2df") TO "postgres";
GRANT ALL ON FUNCTION "public"."contains_2d"("public"."box2df", "public"."box2df") TO "anon";
GRANT ALL ON FUNCTION "public"."contains_2d"("public"."box2df", "public"."box2df") TO "authenticated";
GRANT ALL ON FUNCTION "public"."contains_2d"("public"."box2df", "public"."box2df") TO "service_role";



GRANT ALL ON FUNCTION "public"."contains_2d"("public"."box2df", "public"."geometry") TO "postgres";
GRANT ALL ON FUNCTION "public"."contains_2d"("public"."box2df", "public"."geometry") TO "anon";
GRANT ALL ON FUNCTION "public"."contains_2d"("public"."box2df", "public"."geometry") TO "authenticated";
GRANT ALL ON FUNCTION "public"."contains_2d"("public"."box2df", "public"."geometry") TO "service_role";



GRANT ALL ON FUNCTION "public"."contains_2d"("public"."geometry", "public"."box2df") TO "postgres";
GRANT ALL ON FUNCTION "public"."contains_2d"("public"."geometry", "public"."box2df") TO "anon";
GRANT ALL ON FUNCTION "public"."contains_2d"("public"."geometry", "public"."box2df") TO "authenticated";
GRANT ALL ON FUNCTION "public"."contains_2d"("public"."geometry", "public"."box2df") TO "service_role";



GRANT ALL ON FUNCTION "public"."disablelongtransactions"() TO "postgres";
GRANT ALL ON FUNCTION "public"."disablelongtransactions"() TO "anon";
GRANT ALL ON FUNCTION "public"."disablelongtransactions"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."disablelongtransactions"() TO "service_role";



GRANT ALL ON FUNCTION "public"."dropgeometrycolumn"("table_name" character varying, "column_name" character varying) TO "postgres";
GRANT ALL ON FUNCTION "public"."dropgeometrycolumn"("table_name" character varying, "column_name" character varying) TO "anon";
GRANT ALL ON FUNCTION "public"."dropgeometrycolumn"("table_name" character varying, "column_name" character varying) TO "authenticated";
GRANT ALL ON FUNCTION "public"."dropgeometrycolumn"("table_name" character varying, "column_name" character varying) TO "service_role";



GRANT ALL ON FUNCTION "public"."dropgeometrycolumn"("schema_name" character varying, "table_name" character varying, "column_name" character varying) TO "postgres";
GRANT ALL ON FUNCTION "public"."dropgeometrycolumn"("schema_name" character varying, "table_name" character varying, "column_name" character varying) TO "anon";
GRANT ALL ON FUNCTION "public"."dropgeometrycolumn"("schema_name" character varying, "table_name" character varying, "column_name" character varying) TO "authenticated";
GRANT ALL ON FUNCTION "public"."dropgeometrycolumn"("schema_name" character varying, "table_name" character varying, "column_name" character varying) TO "service_role";



GRANT ALL ON FUNCTION "public"."dropgeometrycolumn"("catalog_name" character varying, "schema_name" character varying, "table_name" character varying, "column_name" character varying) TO "postgres";
GRANT ALL ON FUNCTION "public"."dropgeometrycolumn"("catalog_name" character varying, "schema_name" character varying, "table_name" character varying, "column_name" character varying) TO "anon";
GRANT ALL ON FUNCTION "public"."dropgeometrycolumn"("catalog_name" character varying, "schema_name" character varying, "table_name" character varying, "column_name" character varying) TO "authenticated";
GRANT ALL ON FUNCTION "public"."dropgeometrycolumn"("catalog_name" character varying, "schema_name" character varying, "table_name" character varying, "column_name" character varying) TO "service_role";



GRANT ALL ON FUNCTION "public"."dropgeometrytable"("table_name" character varying) TO "postgres";
GRANT ALL ON FUNCTION "public"."dropgeometrytable"("table_name" character varying) TO "anon";
GRANT ALL ON FUNCTION "public"."dropgeometrytable"("table_name" character varying) TO "authenticated";
GRANT ALL ON FUNCTION "public"."dropgeometrytable"("table_name" character varying) TO "service_role";



GRANT ALL ON FUNCTION "public"."dropgeometrytable"("schema_name" character varying, "table_name" character varying) TO "postgres";
GRANT ALL ON FUNCTION "public"."dropgeometrytable"("schema_name" character varying, "table_name" character varying) TO "anon";
GRANT ALL ON FUNCTION "public"."dropgeometrytable"("schema_name" character varying, "table_name" character varying) TO "authenticated";
GRANT ALL ON FUNCTION "public"."dropgeometrytable"("schema_name" character varying, "table_name" character varying) TO "service_role";



GRANT ALL ON FUNCTION "public"."dropgeometrytable"("catalog_name" character varying, "schema_name" character varying, "table_name" character varying) TO "postgres";
GRANT ALL ON FUNCTION "public"."dropgeometrytable"("catalog_name" character varying, "schema_name" character varying, "table_name" character varying) TO "anon";
GRANT ALL ON FUNCTION "public"."dropgeometrytable"("catalog_name" character varying, "schema_name" character varying, "table_name" character varying) TO "authenticated";
GRANT ALL ON FUNCTION "public"."dropgeometrytable"("catalog_name" character varying, "schema_name" character varying, "table_name" character varying) TO "service_role";



GRANT ALL ON FUNCTION "public"."enablelongtransactions"() TO "postgres";
GRANT ALL ON FUNCTION "public"."enablelongtransactions"() TO "anon";
GRANT ALL ON FUNCTION "public"."enablelongtransactions"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."enablelongtransactions"() TO "service_role";



GRANT ALL ON FUNCTION "public"."equals"("geom1" "public"."geometry", "geom2" "public"."geometry") TO "postgres";
GRANT ALL ON FUNCTION "public"."equals"("geom1" "public"."geometry", "geom2" "public"."geometry") TO "anon";
GRANT ALL ON FUNCTION "public"."equals"("geom1" "public"."geometry", "geom2" "public"."geometry") TO "authenticated";
GRANT ALL ON FUNCTION "public"."equals"("geom1" "public"."geometry", "geom2" "public"."geometry") TO "service_role";



GRANT ALL ON FUNCTION "public"."find_srid"(character varying, character varying, character varying) TO "postgres";
GRANT ALL ON FUNCTION "public"."find_srid"(character varying, character varying, character varying) TO "anon";
GRANT ALL ON FUNCTION "public"."find_srid"(character varying, character varying, character varying) TO "authenticated";
GRANT ALL ON FUNCTION "public"."find_srid"(character varying, character varying, character varying) TO "service_role";



GRANT ALL ON FUNCTION "public"."geog_brin_inclusion_add_value"("internal", "internal", "internal", "internal") TO "postgres";
GRANT ALL ON FUNCTION "public"."geog_brin_inclusion_add_value"("internal", "internal", "internal", "internal") TO "anon";
GRANT ALL ON FUNCTION "public"."geog_brin_inclusion_add_value"("internal", "internal", "internal", "internal") TO "authenticated";
GRANT ALL ON FUNCTION "public"."geog_brin_inclusion_add_value"("internal", "internal", "internal", "internal") TO "service_role";



GRANT ALL ON FUNCTION "public"."geography_cmp"("public"."geography", "public"."geography") TO "postgres";
GRANT ALL ON FUNCTION "public"."geography_cmp"("public"."geography", "public"."geography") TO "anon";
GRANT ALL ON FUNCTION "public"."geography_cmp"("public"."geography", "public"."geography") TO "authenticated";
GRANT ALL ON FUNCTION "public"."geography_cmp"("public"."geography", "public"."geography") TO "service_role";



GRANT ALL ON FUNCTION "public"."geography_distance_knn"("public"."geography", "public"."geography") TO "postgres";
GRANT ALL ON FUNCTION "public"."geography_distance_knn"("public"."geography", "public"."geography") TO "anon";
GRANT ALL ON FUNCTION "public"."geography_distance_knn"("public"."geography", "public"."geography") TO "authenticated";
GRANT ALL ON FUNCTION "public"."geography_distance_knn"("public"."geography", "public"."geography") TO "service_role";



GRANT ALL ON FUNCTION "public"."geography_eq"("public"."geography", "public"."geography") TO "postgres";
GRANT ALL ON FUNCTION "public"."geography_eq"("public"."geography", "public"."geography") TO "anon";
GRANT ALL ON FUNCTION "public"."geography_eq"("public"."geography", "public"."geography") TO "authenticated";
GRANT ALL ON FUNCTION "public"."geography_eq"("public"."geography", "public"."geography") TO "service_role";



GRANT ALL ON FUNCTION "public"."geography_ge"("public"."geography", "public"."geography") TO "postgres";
GRANT ALL ON FUNCTION "public"."geography_ge"("public"."geography", "public"."geography") TO "anon";
GRANT ALL ON FUNCTION "public"."geography_ge"("public"."geography", "public"."geography") TO "authenticated";
GRANT ALL ON FUNCTION "public"."geography_ge"("public"."geography", "public"."geography") TO "service_role";



GRANT ALL ON FUNCTION "public"."geography_gist_compress"("internal") TO "postgres";
GRANT ALL ON FUNCTION "public"."geography_gist_compress"("internal") TO "anon";
GRANT ALL ON FUNCTION "public"."geography_gist_compress"("internal") TO "authenticated";
GRANT ALL ON FUNCTION "public"."geography_gist_compress"("internal") TO "service_role";



GRANT ALL ON FUNCTION "public"."geography_gist_consistent"("internal", "public"."geography", integer) TO "postgres";
GRANT ALL ON FUNCTION "public"."geography_gist_consistent"("internal", "public"."geography", integer) TO "anon";
GRANT ALL ON FUNCTION "public"."geography_gist_consistent"("internal", "public"."geography", integer) TO "authenticated";
GRANT ALL ON FUNCTION "public"."geography_gist_consistent"("internal", "public"."geography", integer) TO "service_role";



GRANT ALL ON FUNCTION "public"."geography_gist_decompress"("internal") TO "postgres";
GRANT ALL ON FUNCTION "public"."geography_gist_decompress"("internal") TO "anon";
GRANT ALL ON FUNCTION "public"."geography_gist_decompress"("internal") TO "authenticated";
GRANT ALL ON FUNCTION "public"."geography_gist_decompress"("internal") TO "service_role";



GRANT ALL ON FUNCTION "public"."geography_gist_distance"("internal", "public"."geography", integer) TO "postgres";
GRANT ALL ON FUNCTION "public"."geography_gist_distance"("internal", "public"."geography", integer) TO "anon";
GRANT ALL ON FUNCTION "public"."geography_gist_distance"("internal", "public"."geography", integer) TO "authenticated";
GRANT ALL ON FUNCTION "public"."geography_gist_distance"("internal", "public"."geography", integer) TO "service_role";



GRANT ALL ON FUNCTION "public"."geography_gist_penalty"("internal", "internal", "internal") TO "postgres";
GRANT ALL ON FUNCTION "public"."geography_gist_penalty"("internal", "internal", "internal") TO "anon";
GRANT ALL ON FUNCTION "public"."geography_gist_penalty"("internal", "internal", "internal") TO "authenticated";
GRANT ALL ON FUNCTION "public"."geography_gist_penalty"("internal", "internal", "internal") TO "service_role";



GRANT ALL ON FUNCTION "public"."geography_gist_picksplit"("internal", "internal") TO "postgres";
GRANT ALL ON FUNCTION "public"."geography_gist_picksplit"("internal", "internal") TO "anon";
GRANT ALL ON FUNCTION "public"."geography_gist_picksplit"("internal", "internal") TO "authenticated";
GRANT ALL ON FUNCTION "public"."geography_gist_picksplit"("internal", "internal") TO "service_role";



GRANT ALL ON FUNCTION "public"."geography_gist_same"("public"."box2d", "public"."box2d", "internal") TO "postgres";
GRANT ALL ON FUNCTION "public"."geography_gist_same"("public"."box2d", "public"."box2d", "internal") TO "anon";
GRANT ALL ON FUNCTION "public"."geography_gist_same"("public"."box2d", "public"."box2d", "internal") TO "authenticated";
GRANT ALL ON FUNCTION "public"."geography_gist_same"("public"."box2d", "public"."box2d", "internal") TO "service_role";



GRANT ALL ON FUNCTION "public"."geography_gist_union"("bytea", "internal") TO "postgres";
GRANT ALL ON FUNCTION "public"."geography_gist_union"("bytea", "internal") TO "anon";
GRANT ALL ON FUNCTION "public"."geography_gist_union"("bytea", "internal") TO "authenticated";
GRANT ALL ON FUNCTION "public"."geography_gist_union"("bytea", "internal") TO "service_role";



GRANT ALL ON FUNCTION "public"."geography_gt"("public"."geography", "public"."geography") TO "postgres";
GRANT ALL ON FUNCTION "public"."geography_gt"("public"."geography", "public"."geography") TO "anon";
GRANT ALL ON FUNCTION "public"."geography_gt"("public"."geography", "public"."geography") TO "authenticated";
GRANT ALL ON FUNCTION "public"."geography_gt"("public"."geography", "public"."geography") TO "service_role";



GRANT ALL ON FUNCTION "public"."geography_le"("public"."geography", "public"."geography") TO "postgres";
GRANT ALL ON FUNCTION "public"."geography_le"("public"."geography", "public"."geography") TO "anon";
GRANT ALL ON FUNCTION "public"."geography_le"("public"."geography", "public"."geography") TO "authenticated";
GRANT ALL ON FUNCTION "public"."geography_le"("public"."geography", "public"."geography") TO "service_role";



GRANT ALL ON FUNCTION "public"."geography_lt"("public"."geography", "public"."geography") TO "postgres";
GRANT ALL ON FUNCTION "public"."geography_lt"("public"."geography", "public"."geography") TO "anon";
GRANT ALL ON FUNCTION "public"."geography_lt"("public"."geography", "public"."geography") TO "authenticated";
GRANT ALL ON FUNCTION "public"."geography_lt"("public"."geography", "public"."geography") TO "service_role";



GRANT ALL ON FUNCTION "public"."geography_overlaps"("public"."geography", "public"."geography") TO "postgres";
GRANT ALL ON FUNCTION "public"."geography_overlaps"("public"."geography", "public"."geography") TO "anon";
GRANT ALL ON FUNCTION "public"."geography_overlaps"("public"."geography", "public"."geography") TO "authenticated";
GRANT ALL ON FUNCTION "public"."geography_overlaps"("public"."geography", "public"."geography") TO "service_role";



GRANT ALL ON FUNCTION "public"."geography_spgist_choose_nd"("internal", "internal") TO "postgres";
GRANT ALL ON FUNCTION "public"."geography_spgist_choose_nd"("internal", "internal") TO "anon";
GRANT ALL ON FUNCTION "public"."geography_spgist_choose_nd"("internal", "internal") TO "authenticated";
GRANT ALL ON FUNCTION "public"."geography_spgist_choose_nd"("internal", "internal") TO "service_role";



GRANT ALL ON FUNCTION "public"."geography_spgist_compress_nd"("internal") TO "postgres";
GRANT ALL ON FUNCTION "public"."geography_spgist_compress_nd"("internal") TO "anon";
GRANT ALL ON FUNCTION "public"."geography_spgist_compress_nd"("internal") TO "authenticated";
GRANT ALL ON FUNCTION "public"."geography_spgist_compress_nd"("internal") TO "service_role";



GRANT ALL ON FUNCTION "public"."geography_spgist_config_nd"("internal", "internal") TO "postgres";
GRANT ALL ON FUNCTION "public"."geography_spgist_config_nd"("internal", "internal") TO "anon";
GRANT ALL ON FUNCTION "public"."geography_spgist_config_nd"("internal", "internal") TO "authenticated";
GRANT ALL ON FUNCTION "public"."geography_spgist_config_nd"("internal", "internal") TO "service_role";



GRANT ALL ON FUNCTION "public"."geography_spgist_inner_consistent_nd"("internal", "internal") TO "postgres";
GRANT ALL ON FUNCTION "public"."geography_spgist_inner_consistent_nd"("internal", "internal") TO "anon";
GRANT ALL ON FUNCTION "public"."geography_spgist_inner_consistent_nd"("internal", "internal") TO "authenticated";
GRANT ALL ON FUNCTION "public"."geography_spgist_inner_consistent_nd"("internal", "internal") TO "service_role";



GRANT ALL ON FUNCTION "public"."geography_spgist_leaf_consistent_nd"("internal", "internal") TO "postgres";
GRANT ALL ON FUNCTION "public"."geography_spgist_leaf_consistent_nd"("internal", "internal") TO "anon";
GRANT ALL ON FUNCTION "public"."geography_spgist_leaf_consistent_nd"("internal", "internal") TO "authenticated";
GRANT ALL ON FUNCTION "public"."geography_spgist_leaf_consistent_nd"("internal", "internal") TO "service_role";



GRANT ALL ON FUNCTION "public"."geography_spgist_picksplit_nd"("internal", "internal") TO "postgres";
GRANT ALL ON FUNCTION "public"."geography_spgist_picksplit_nd"("internal", "internal") TO "anon";
GRANT ALL ON FUNCTION "public"."geography_spgist_picksplit_nd"("internal", "internal") TO "authenticated";
GRANT ALL ON FUNCTION "public"."geography_spgist_picksplit_nd"("internal", "internal") TO "service_role";



GRANT ALL ON FUNCTION "public"."geom2d_brin_inclusion_add_value"("internal", "internal", "internal", "internal") TO "postgres";
GRANT ALL ON FUNCTION "public"."geom2d_brin_inclusion_add_value"("internal", "internal", "internal", "internal") TO "anon";
GRANT ALL ON FUNCTION "public"."geom2d_brin_inclusion_add_value"("internal", "internal", "internal", "internal") TO "authenticated";
GRANT ALL ON FUNCTION "public"."geom2d_brin_inclusion_add_value"("internal", "internal", "internal", "internal") TO "service_role";



GRANT ALL ON FUNCTION "public"."geom3d_brin_inclusion_add_value"("internal", "internal", "internal", "internal") TO "postgres";
GRANT ALL ON FUNCTION "public"."geom3d_brin_inclusion_add_value"("internal", "internal", "internal", "internal") TO "anon";
GRANT ALL ON FUNCTION "public"."geom3d_brin_inclusion_add_value"("internal", "internal", "internal", "internal") TO "authenticated";
GRANT ALL ON FUNCTION "public"."geom3d_brin_inclusion_add_value"("internal", "internal", "internal", "internal") TO "service_role";



GRANT ALL ON FUNCTION "public"."geom4d_brin_inclusion_add_value"("internal", "internal", "internal", "internal") TO "postgres";
GRANT ALL ON FUNCTION "public"."geom4d_brin_inclusion_add_value"("internal", "internal", "internal", "internal") TO "anon";
GRANT ALL ON FUNCTION "public"."geom4d_brin_inclusion_add_value"("internal", "internal", "internal", "internal") TO "authenticated";
GRANT ALL ON FUNCTION "public"."geom4d_brin_inclusion_add_value"("internal", "internal", "internal", "internal") TO "service_role";



GRANT ALL ON FUNCTION "public"."geometry_above"("geom1" "public"."geometry", "geom2" "public"."geometry") TO "postgres";
GRANT ALL ON FUNCTION "public"."geometry_above"("geom1" "public"."geometry", "geom2" "public"."geometry") TO "anon";
GRANT ALL ON FUNCTION "public"."geometry_above"("geom1" "public"."geometry", "geom2" "public"."geometry") TO "authenticated";
GRANT ALL ON FUNCTION "public"."geometry_above"("geom1" "public"."geometry", "geom2" "public"."geometry") TO "service_role";



GRANT ALL ON FUNCTION "public"."geometry_below"("geom1" "public"."geometry", "geom2" "public"."geometry") TO "postgres";
GRANT ALL ON FUNCTION "public"."geometry_below"("geom1" "public"."geometry", "geom2" "public"."geometry") TO "anon";
GRANT ALL ON FUNCTION "public"."geometry_below"("geom1" "public"."geometry", "geom2" "public"."geometry") TO "authenticated";
GRANT ALL ON FUNCTION "public"."geometry_below"("geom1" "public"."geometry", "geom2" "public"."geometry") TO "service_role";



GRANT ALL ON FUNCTION "public"."geometry_cmp"("geom1" "public"."geometry", "geom2" "public"."geometry") TO "postgres";
GRANT ALL ON FUNCTION "public"."geometry_cmp"("geom1" "public"."geometry", "geom2" "public"."geometry") TO "anon";
GRANT ALL ON FUNCTION "public"."geometry_cmp"("geom1" "public"."geometry", "geom2" "public"."geometry") TO "authenticated";
GRANT ALL ON FUNCTION "public"."geometry_cmp"("geom1" "public"."geometry", "geom2" "public"."geometry") TO "service_role";



GRANT ALL ON FUNCTION "public"."geometry_contained_3d"("geom1" "public"."geometry", "geom2" "public"."geometry") TO "postgres";
GRANT ALL ON FUNCTION "public"."geometry_contained_3d"("geom1" "public"."geometry", "geom2" "public"."geometry") TO "anon";
GRANT ALL ON FUNCTION "public"."geometry_contained_3d"("geom1" "public"."geometry", "geom2" "public"."geometry") TO "authenticated";
GRANT ALL ON FUNCTION "public"."geometry_contained_3d"("geom1" "public"."geometry", "geom2" "public"."geometry") TO "service_role";



GRANT ALL ON FUNCTION "public"."geometry_contains"("geom1" "public"."geometry", "geom2" "public"."geometry") TO "postgres";
GRANT ALL ON FUNCTION "public"."geometry_contains"("geom1" "public"."geometry", "geom2" "public"."geometry") TO "anon";
GRANT ALL ON FUNCTION "public"."geometry_contains"("geom1" "public"."geometry", "geom2" "public"."geometry") TO "authenticated";
GRANT ALL ON FUNCTION "public"."geometry_contains"("geom1" "public"."geometry", "geom2" "public"."geometry") TO "service_role";



GRANT ALL ON FUNCTION "public"."geometry_contains_3d"("geom1" "public"."geometry", "geom2" "public"."geometry") TO "postgres";
GRANT ALL ON FUNCTION "public"."geometry_contains_3d"("geom1" "public"."geometry", "geom2" "public"."geometry") TO "anon";
GRANT ALL ON FUNCTION "public"."geometry_contains_3d"("geom1" "public"."geometry", "geom2" "public"."geometry") TO "authenticated";
GRANT ALL ON FUNCTION "public"."geometry_contains_3d"("geom1" "public"."geometry", "geom2" "public"."geometry") TO "service_role";



GRANT ALL ON FUNCTION "public"."geometry_contains_nd"("public"."geometry", "public"."geometry") TO "postgres";
GRANT ALL ON FUNCTION "public"."geometry_contains_nd"("public"."geometry", "public"."geometry") TO "anon";
GRANT ALL ON FUNCTION "public"."geometry_contains_nd"("public"."geometry", "public"."geometry") TO "authenticated";
GRANT ALL ON FUNCTION "public"."geometry_contains_nd"("public"."geometry", "public"."geometry") TO "service_role";



GRANT ALL ON FUNCTION "public"."geometry_distance_box"("geom1" "public"."geometry", "geom2" "public"."geometry") TO "postgres";
GRANT ALL ON FUNCTION "public"."geometry_distance_box"("geom1" "public"."geometry", "geom2" "public"."geometry") TO "anon";
GRANT ALL ON FUNCTION "public"."geometry_distance_box"("geom1" "public"."geometry", "geom2" "public"."geometry") TO "authenticated";
GRANT ALL ON FUNCTION "public"."geometry_distance_box"("geom1" "public"."geometry", "geom2" "public"."geometry") TO "service_role";



GRANT ALL ON FUNCTION "public"."geometry_distance_centroid"("geom1" "public"."geometry", "geom2" "public"."geometry") TO "postgres";
GRANT ALL ON FUNCTION "public"."geometry_distance_centroid"("geom1" "public"."geometry", "geom2" "public"."geometry") TO "anon";
GRANT ALL ON FUNCTION "public"."geometry_distance_centroid"("geom1" "public"."geometry", "geom2" "public"."geometry") TO "authenticated";
GRANT ALL ON FUNCTION "public"."geometry_distance_centroid"("geom1" "public"."geometry", "geom2" "public"."geometry") TO "service_role";



GRANT ALL ON FUNCTION "public"."geometry_distance_centroid_nd"("public"."geometry", "public"."geometry") TO "postgres";
GRANT ALL ON FUNCTION "public"."geometry_distance_centroid_nd"("public"."geometry", "public"."geometry") TO "anon";
GRANT ALL ON FUNCTION "public"."geometry_distance_centroid_nd"("public"."geometry", "public"."geometry") TO "authenticated";
GRANT ALL ON FUNCTION "public"."geometry_distance_centroid_nd"("public"."geometry", "public"."geometry") TO "service_role";



GRANT ALL ON FUNCTION "public"."geometry_distance_cpa"("public"."geometry", "public"."geometry") TO "postgres";
GRANT ALL ON FUNCTION "public"."geometry_distance_cpa"("public"."geometry", "public"."geometry") TO "anon";
GRANT ALL ON FUNCTION "public"."geometry_distance_cpa"("public"."geometry", "public"."geometry") TO "authenticated";
GRANT ALL ON FUNCTION "public"."geometry_distance_cpa"("public"."geometry", "public"."geometry") TO "service_role";



GRANT ALL ON FUNCTION "public"."geometry_eq"("geom1" "public"."geometry", "geom2" "public"."geometry") TO "postgres";
GRANT ALL ON FUNCTION "public"."geometry_eq"("geom1" "public"."geometry", "geom2" "public"."geometry") TO "anon";
GRANT ALL ON FUNCTION "public"."geometry_eq"("geom1" "public"."geometry", "geom2" "public"."geometry") TO "authenticated";
GRANT ALL ON FUNCTION "public"."geometry_eq"("geom1" "public"."geometry", "geom2" "public"."geometry") TO "service_role";



GRANT ALL ON FUNCTION "public"."geometry_ge"("geom1" "public"."geometry", "geom2" "public"."geometry") TO "postgres";
GRANT ALL ON FUNCTION "public"."geometry_ge"("geom1" "public"."geometry", "geom2" "public"."geometry") TO "anon";
GRANT ALL ON FUNCTION "public"."geometry_ge"("geom1" "public"."geometry", "geom2" "public"."geometry") TO "authenticated";
GRANT ALL ON FUNCTION "public"."geometry_ge"("geom1" "public"."geometry", "geom2" "public"."geometry") TO "service_role";



GRANT ALL ON FUNCTION "public"."geometry_gist_compress_2d"("internal") TO "postgres";
GRANT ALL ON FUNCTION "public"."geometry_gist_compress_2d"("internal") TO "anon";
GRANT ALL ON FUNCTION "public"."geometry_gist_compress_2d"("internal") TO "authenticated";
GRANT ALL ON FUNCTION "public"."geometry_gist_compress_2d"("internal") TO "service_role";



GRANT ALL ON FUNCTION "public"."geometry_gist_compress_nd"("internal") TO "postgres";
GRANT ALL ON FUNCTION "public"."geometry_gist_compress_nd"("internal") TO "anon";
GRANT ALL ON FUNCTION "public"."geometry_gist_compress_nd"("internal") TO "authenticated";
GRANT ALL ON FUNCTION "public"."geometry_gist_compress_nd"("internal") TO "service_role";



GRANT ALL ON FUNCTION "public"."geometry_gist_consistent_2d"("internal", "public"."geometry", integer) TO "postgres";
GRANT ALL ON FUNCTION "public"."geometry_gist_consistent_2d"("internal", "public"."geometry", integer) TO "anon";
GRANT ALL ON FUNCTION "public"."geometry_gist_consistent_2d"("internal", "public"."geometry", integer) TO "authenticated";
GRANT ALL ON FUNCTION "public"."geometry_gist_consistent_2d"("internal", "public"."geometry", integer) TO "service_role";



GRANT ALL ON FUNCTION "public"."geometry_gist_consistent_nd"("internal", "public"."geometry", integer) TO "postgres";
GRANT ALL ON FUNCTION "public"."geometry_gist_consistent_nd"("internal", "public"."geometry", integer) TO "anon";
GRANT ALL ON FUNCTION "public"."geometry_gist_consistent_nd"("internal", "public"."geometry", integer) TO "authenticated";
GRANT ALL ON FUNCTION "public"."geometry_gist_consistent_nd"("internal", "public"."geometry", integer) TO "service_role";



GRANT ALL ON FUNCTION "public"."geometry_gist_decompress_2d"("internal") TO "postgres";
GRANT ALL ON FUNCTION "public"."geometry_gist_decompress_2d"("internal") TO "anon";
GRANT ALL ON FUNCTION "public"."geometry_gist_decompress_2d"("internal") TO "authenticated";
GRANT ALL ON FUNCTION "public"."geometry_gist_decompress_2d"("internal") TO "service_role";



GRANT ALL ON FUNCTION "public"."geometry_gist_decompress_nd"("internal") TO "postgres";
GRANT ALL ON FUNCTION "public"."geometry_gist_decompress_nd"("internal") TO "anon";
GRANT ALL ON FUNCTION "public"."geometry_gist_decompress_nd"("internal") TO "authenticated";
GRANT ALL ON FUNCTION "public"."geometry_gist_decompress_nd"("internal") TO "service_role";



GRANT ALL ON FUNCTION "public"."geometry_gist_distance_2d"("internal", "public"."geometry", integer) TO "postgres";
GRANT ALL ON FUNCTION "public"."geometry_gist_distance_2d"("internal", "public"."geometry", integer) TO "anon";
GRANT ALL ON FUNCTION "public"."geometry_gist_distance_2d"("internal", "public"."geometry", integer) TO "authenticated";
GRANT ALL ON FUNCTION "public"."geometry_gist_distance_2d"("internal", "public"."geometry", integer) TO "service_role";



GRANT ALL ON FUNCTION "public"."geometry_gist_distance_nd"("internal", "public"."geometry", integer) TO "postgres";
GRANT ALL ON FUNCTION "public"."geometry_gist_distance_nd"("internal", "public"."geometry", integer) TO "anon";
GRANT ALL ON FUNCTION "public"."geometry_gist_distance_nd"("internal", "public"."geometry", integer) TO "authenticated";
GRANT ALL ON FUNCTION "public"."geometry_gist_distance_nd"("internal", "public"."geometry", integer) TO "service_role";



GRANT ALL ON FUNCTION "public"."geometry_gist_penalty_2d"("internal", "internal", "internal") TO "postgres";
GRANT ALL ON FUNCTION "public"."geometry_gist_penalty_2d"("internal", "internal", "internal") TO "anon";
GRANT ALL ON FUNCTION "public"."geometry_gist_penalty_2d"("internal", "internal", "internal") TO "authenticated";
GRANT ALL ON FUNCTION "public"."geometry_gist_penalty_2d"("internal", "internal", "internal") TO "service_role";



GRANT ALL ON FUNCTION "public"."geometry_gist_penalty_nd"("internal", "internal", "internal") TO "postgres";
GRANT ALL ON FUNCTION "public"."geometry_gist_penalty_nd"("internal", "internal", "internal") TO "anon";
GRANT ALL ON FUNCTION "public"."geometry_gist_penalty_nd"("internal", "internal", "internal") TO "authenticated";
GRANT ALL ON FUNCTION "public"."geometry_gist_penalty_nd"("internal", "internal", "internal") TO "service_role";



GRANT ALL ON FUNCTION "public"."geometry_gist_picksplit_2d"("internal", "internal") TO "postgres";
GRANT ALL ON FUNCTION "public"."geometry_gist_picksplit_2d"("internal", "internal") TO "anon";
GRANT ALL ON FUNCTION "public"."geometry_gist_picksplit_2d"("internal", "internal") TO "authenticated";
GRANT ALL ON FUNCTION "public"."geometry_gist_picksplit_2d"("internal", "internal") TO "service_role";



GRANT ALL ON FUNCTION "public"."geometry_gist_picksplit_nd"("internal", "internal") TO "postgres";
GRANT ALL ON FUNCTION "public"."geometry_gist_picksplit_nd"("internal", "internal") TO "anon";
GRANT ALL ON FUNCTION "public"."geometry_gist_picksplit_nd"("internal", "internal") TO "authenticated";
GRANT ALL ON FUNCTION "public"."geometry_gist_picksplit_nd"("internal", "internal") TO "service_role";



GRANT ALL ON FUNCTION "public"."geometry_gist_same_2d"("geom1" "public"."geometry", "geom2" "public"."geometry", "internal") TO "postgres";
GRANT ALL ON FUNCTION "public"."geometry_gist_same_2d"("geom1" "public"."geometry", "geom2" "public"."geometry", "internal") TO "anon";
GRANT ALL ON FUNCTION "public"."geometry_gist_same_2d"("geom1" "public"."geometry", "geom2" "public"."geometry", "internal") TO "authenticated";
GRANT ALL ON FUNCTION "public"."geometry_gist_same_2d"("geom1" "public"."geometry", "geom2" "public"."geometry", "internal") TO "service_role";



GRANT ALL ON FUNCTION "public"."geometry_gist_same_nd"("public"."geometry", "public"."geometry", "internal") TO "postgres";
GRANT ALL ON FUNCTION "public"."geometry_gist_same_nd"("public"."geometry", "public"."geometry", "internal") TO "anon";
GRANT ALL ON FUNCTION "public"."geometry_gist_same_nd"("public"."geometry", "public"."geometry", "internal") TO "authenticated";
GRANT ALL ON FUNCTION "public"."geometry_gist_same_nd"("public"."geometry", "public"."geometry", "internal") TO "service_role";



GRANT ALL ON FUNCTION "public"."geometry_gist_sortsupport_2d"("internal") TO "postgres";
GRANT ALL ON FUNCTION "public"."geometry_gist_sortsupport_2d"("internal") TO "anon";
GRANT ALL ON FUNCTION "public"."geometry_gist_sortsupport_2d"("internal") TO "authenticated";
GRANT ALL ON FUNCTION "public"."geometry_gist_sortsupport_2d"("internal") TO "service_role";



GRANT ALL ON FUNCTION "public"."geometry_gist_union_2d"("bytea", "internal") TO "postgres";
GRANT ALL ON FUNCTION "public"."geometry_gist_union_2d"("bytea", "internal") TO "anon";
GRANT ALL ON FUNCTION "public"."geometry_gist_union_2d"("bytea", "internal") TO "authenticated";
GRANT ALL ON FUNCTION "public"."geometry_gist_union_2d"("bytea", "internal") TO "service_role";



GRANT ALL ON FUNCTION "public"."geometry_gist_union_nd"("bytea", "internal") TO "postgres";
GRANT ALL ON FUNCTION "public"."geometry_gist_union_nd"("bytea", "internal") TO "anon";
GRANT ALL ON FUNCTION "public"."geometry_gist_union_nd"("bytea", "internal") TO "authenticated";
GRANT ALL ON FUNCTION "public"."geometry_gist_union_nd"("bytea", "internal") TO "service_role";



GRANT ALL ON FUNCTION "public"."geometry_gt"("geom1" "public"."geometry", "geom2" "public"."geometry") TO "postgres";
GRANT ALL ON FUNCTION "public"."geometry_gt"("geom1" "public"."geometry", "geom2" "public"."geometry") TO "anon";
GRANT ALL ON FUNCTION "public"."geometry_gt"("geom1" "public"."geometry", "geom2" "public"."geometry") TO "authenticated";
GRANT ALL ON FUNCTION "public"."geometry_gt"("geom1" "public"."geometry", "geom2" "public"."geometry") TO "service_role";



GRANT ALL ON FUNCTION "public"."geometry_hash"("public"."geometry") TO "postgres";
GRANT ALL ON FUNCTION "public"."geometry_hash"("public"."geometry") TO "anon";
GRANT ALL ON FUNCTION "public"."geometry_hash"("public"."geometry") TO "authenticated";
GRANT ALL ON FUNCTION "public"."geometry_hash"("public"."geometry") TO "service_role";



GRANT ALL ON FUNCTION "public"."geometry_le"("geom1" "public"."geometry", "geom2" "public"."geometry") TO "postgres";
GRANT ALL ON FUNCTION "public"."geometry_le"("geom1" "public"."geometry", "geom2" "public"."geometry") TO "anon";
GRANT ALL ON FUNCTION "public"."geometry_le"("geom1" "public"."geometry", "geom2" "public"."geometry") TO "authenticated";
GRANT ALL ON FUNCTION "public"."geometry_le"("geom1" "public"."geometry", "geom2" "public"."geometry") TO "service_role";



GRANT ALL ON FUNCTION "public"."geometry_left"("geom1" "public"."geometry", "geom2" "public"."geometry") TO "postgres";
GRANT ALL ON FUNCTION "public"."geometry_left"("geom1" "public"."geometry", "geom2" "public"."geometry") TO "anon";
GRANT ALL ON FUNCTION "public"."geometry_left"("geom1" "public"."geometry", "geom2" "public"."geometry") TO "authenticated";
GRANT ALL ON FUNCTION "public"."geometry_left"("geom1" "public"."geometry", "geom2" "public"."geometry") TO "service_role";



GRANT ALL ON FUNCTION "public"."geometry_lt"("geom1" "public"."geometry", "geom2" "public"."geometry") TO "postgres";
GRANT ALL ON FUNCTION "public"."geometry_lt"("geom1" "public"."geometry", "geom2" "public"."geometry") TO "anon";
GRANT ALL ON FUNCTION "public"."geometry_lt"("geom1" "public"."geometry", "geom2" "public"."geometry") TO "authenticated";
GRANT ALL ON FUNCTION "public"."geometry_lt"("geom1" "public"."geometry", "geom2" "public"."geometry") TO "service_role";



GRANT ALL ON FUNCTION "public"."geometry_overabove"("geom1" "public"."geometry", "geom2" "public"."geometry") TO "postgres";
GRANT ALL ON FUNCTION "public"."geometry_overabove"("geom1" "public"."geometry", "geom2" "public"."geometry") TO "anon";
GRANT ALL ON FUNCTION "public"."geometry_overabove"("geom1" "public"."geometry", "geom2" "public"."geometry") TO "authenticated";
GRANT ALL ON FUNCTION "public"."geometry_overabove"("geom1" "public"."geometry", "geom2" "public"."geometry") TO "service_role";



GRANT ALL ON FUNCTION "public"."geometry_overbelow"("geom1" "public"."geometry", "geom2" "public"."geometry") TO "postgres";
GRANT ALL ON FUNCTION "public"."geometry_overbelow"("geom1" "public"."geometry", "geom2" "public"."geometry") TO "anon";
GRANT ALL ON FUNCTION "public"."geometry_overbelow"("geom1" "public"."geometry", "geom2" "public"."geometry") TO "authenticated";
GRANT ALL ON FUNCTION "public"."geometry_overbelow"("geom1" "public"."geometry", "geom2" "public"."geometry") TO "service_role";



GRANT ALL ON FUNCTION "public"."geometry_overlaps"("geom1" "public"."geometry", "geom2" "public"."geometry") TO "postgres";
GRANT ALL ON FUNCTION "public"."geometry_overlaps"("geom1" "public"."geometry", "geom2" "public"."geometry") TO "anon";
GRANT ALL ON FUNCTION "public"."geometry_overlaps"("geom1" "public"."geometry", "geom2" "public"."geometry") TO "authenticated";
GRANT ALL ON FUNCTION "public"."geometry_overlaps"("geom1" "public"."geometry", "geom2" "public"."geometry") TO "service_role";



GRANT ALL ON FUNCTION "public"."geometry_overlaps_3d"("geom1" "public"."geometry", "geom2" "public"."geometry") TO "postgres";
GRANT ALL ON FUNCTION "public"."geometry_overlaps_3d"("geom1" "public"."geometry", "geom2" "public"."geometry") TO "anon";
GRANT ALL ON FUNCTION "public"."geometry_overlaps_3d"("geom1" "public"."geometry", "geom2" "public"."geometry") TO "authenticated";
GRANT ALL ON FUNCTION "public"."geometry_overlaps_3d"("geom1" "public"."geometry", "geom2" "public"."geometry") TO "service_role";



GRANT ALL ON FUNCTION "public"."geometry_overlaps_nd"("public"."geometry", "public"."geometry") TO "postgres";
GRANT ALL ON FUNCTION "public"."geometry_overlaps_nd"("public"."geometry", "public"."geometry") TO "anon";
GRANT ALL ON FUNCTION "public"."geometry_overlaps_nd"("public"."geometry", "public"."geometry") TO "authenticated";
GRANT ALL ON FUNCTION "public"."geometry_overlaps_nd"("public"."geometry", "public"."geometry") TO "service_role";



GRANT ALL ON FUNCTION "public"."geometry_overleft"("geom1" "public"."geometry", "geom2" "public"."geometry") TO "postgres";
GRANT ALL ON FUNCTION "public"."geometry_overleft"("geom1" "public"."geometry", "geom2" "public"."geometry") TO "anon";
GRANT ALL ON FUNCTION "public"."geometry_overleft"("geom1" "public"."geometry", "geom2" "public"."geometry") TO "authenticated";
GRANT ALL ON FUNCTION "public"."geometry_overleft"("geom1" "public"."geometry", "geom2" "public"."geometry") TO "service_role";



GRANT ALL ON FUNCTION "public"."geometry_overright"("geom1" "public"."geometry", "geom2" "public"."geometry") TO "postgres";
GRANT ALL ON FUNCTION "public"."geometry_overright"("geom1" "public"."geometry", "geom2" "public"."geometry") TO "anon";
GRANT ALL ON FUNCTION "public"."geometry_overright"("geom1" "public"."geometry", "geom2" "public"."geometry") TO "authenticated";
GRANT ALL ON FUNCTION "public"."geometry_overright"("geom1" "public"."geometry", "geom2" "public"."geometry") TO "service_role";



GRANT ALL ON FUNCTION "public"."geometry_right"("geom1" "public"."geometry", "geom2" "public"."geometry") TO "postgres";
GRANT ALL ON FUNCTION "public"."geometry_right"("geom1" "public"."geometry", "geom2" "public"."geometry") TO "anon";
GRANT ALL ON FUNCTION "public"."geometry_right"("geom1" "public"."geometry", "geom2" "public"."geometry") TO "authenticated";
GRANT ALL ON FUNCTION "public"."geometry_right"("geom1" "public"."geometry", "geom2" "public"."geometry") TO "service_role";



GRANT ALL ON FUNCTION "public"."geometry_same"("geom1" "public"."geometry", "geom2" "public"."geometry") TO "postgres";
GRANT ALL ON FUNCTION "public"."geometry_same"("geom1" "public"."geometry", "geom2" "public"."geometry") TO "anon";
GRANT ALL ON FUNCTION "public"."geometry_same"("geom1" "public"."geometry", "geom2" "public"."geometry") TO "authenticated";
GRANT ALL ON FUNCTION "public"."geometry_same"("geom1" "public"."geometry", "geom2" "public"."geometry") TO "service_role";



GRANT ALL ON FUNCTION "public"."geometry_same_3d"("geom1" "public"."geometry", "geom2" "public"."geometry") TO "postgres";
GRANT ALL ON FUNCTION "public"."geometry_same_3d"("geom1" "public"."geometry", "geom2" "public"."geometry") TO "anon";
GRANT ALL ON FUNCTION "public"."geometry_same_3d"("geom1" "public"."geometry", "geom2" "public"."geometry") TO "authenticated";
GRANT ALL ON FUNCTION "public"."geometry_same_3d"("geom1" "public"."geometry", "geom2" "public"."geometry") TO "service_role";



GRANT ALL ON FUNCTION "public"."geometry_same_nd"("public"."geometry", "public"."geometry") TO "postgres";
GRANT ALL ON FUNCTION "public"."geometry_same_nd"("public"."geometry", "public"."geometry") TO "anon";
GRANT ALL ON FUNCTION "public"."geometry_same_nd"("public"."geometry", "public"."geometry") TO "authenticated";
GRANT ALL ON FUNCTION "public"."geometry_same_nd"("public"."geometry", "public"."geometry") TO "service_role";



GRANT ALL ON FUNCTION "public"."geometry_sortsupport"("internal") TO "postgres";
GRANT ALL ON FUNCTION "public"."geometry_sortsupport"("internal") TO "anon";
GRANT ALL ON FUNCTION "public"."geometry_sortsupport"("internal") TO "authenticated";
GRANT ALL ON FUNCTION "public"."geometry_sortsupport"("internal") TO "service_role";



GRANT ALL ON FUNCTION "public"."geometry_spgist_choose_2d"("internal", "internal") TO "postgres";
GRANT ALL ON FUNCTION "public"."geometry_spgist_choose_2d"("internal", "internal") TO "anon";
GRANT ALL ON FUNCTION "public"."geometry_spgist_choose_2d"("internal", "internal") TO "authenticated";
GRANT ALL ON FUNCTION "public"."geometry_spgist_choose_2d"("internal", "internal") TO "service_role";



GRANT ALL ON FUNCTION "public"."geometry_spgist_choose_3d"("internal", "internal") TO "postgres";
GRANT ALL ON FUNCTION "public"."geometry_spgist_choose_3d"("internal", "internal") TO "anon";
GRANT ALL ON FUNCTION "public"."geometry_spgist_choose_3d"("internal", "internal") TO "authenticated";
GRANT ALL ON FUNCTION "public"."geometry_spgist_choose_3d"("internal", "internal") TO "service_role";



GRANT ALL ON FUNCTION "public"."geometry_spgist_choose_nd"("internal", "internal") TO "postgres";
GRANT ALL ON FUNCTION "public"."geometry_spgist_choose_nd"("internal", "internal") TO "anon";
GRANT ALL ON FUNCTION "public"."geometry_spgist_choose_nd"("internal", "internal") TO "authenticated";
GRANT ALL ON FUNCTION "public"."geometry_spgist_choose_nd"("internal", "internal") TO "service_role";



GRANT ALL ON FUNCTION "public"."geometry_spgist_compress_2d"("internal") TO "postgres";
GRANT ALL ON FUNCTION "public"."geometry_spgist_compress_2d"("internal") TO "anon";
GRANT ALL ON FUNCTION "public"."geometry_spgist_compress_2d"("internal") TO "authenticated";
GRANT ALL ON FUNCTION "public"."geometry_spgist_compress_2d"("internal") TO "service_role";



GRANT ALL ON FUNCTION "public"."geometry_spgist_compress_3d"("internal") TO "postgres";
GRANT ALL ON FUNCTION "public"."geometry_spgist_compress_3d"("internal") TO "anon";
GRANT ALL ON FUNCTION "public"."geometry_spgist_compress_3d"("internal") TO "authenticated";
GRANT ALL ON FUNCTION "public"."geometry_spgist_compress_3d"("internal") TO "service_role";



GRANT ALL ON FUNCTION "public"."geometry_spgist_compress_nd"("internal") TO "postgres";
GRANT ALL ON FUNCTION "public"."geometry_spgist_compress_nd"("internal") TO "anon";
GRANT ALL ON FUNCTION "public"."geometry_spgist_compress_nd"("internal") TO "authenticated";
GRANT ALL ON FUNCTION "public"."geometry_spgist_compress_nd"("internal") TO "service_role";



GRANT ALL ON FUNCTION "public"."geometry_spgist_config_2d"("internal", "internal") TO "postgres";
GRANT ALL ON FUNCTION "public"."geometry_spgist_config_2d"("internal", "internal") TO "anon";
GRANT ALL ON FUNCTION "public"."geometry_spgist_config_2d"("internal", "internal") TO "authenticated";
GRANT ALL ON FUNCTION "public"."geometry_spgist_config_2d"("internal", "internal") TO "service_role";



GRANT ALL ON FUNCTION "public"."geometry_spgist_config_3d"("internal", "internal") TO "postgres";
GRANT ALL ON FUNCTION "public"."geometry_spgist_config_3d"("internal", "internal") TO "anon";
GRANT ALL ON FUNCTION "public"."geometry_spgist_config_3d"("internal", "internal") TO "authenticated";
GRANT ALL ON FUNCTION "public"."geometry_spgist_config_3d"("internal", "internal") TO "service_role";



GRANT ALL ON FUNCTION "public"."geometry_spgist_config_nd"("internal", "internal") TO "postgres";
GRANT ALL ON FUNCTION "public"."geometry_spgist_config_nd"("internal", "internal") TO "anon";
GRANT ALL ON FUNCTION "public"."geometry_spgist_config_nd"("internal", "internal") TO "authenticated";
GRANT ALL ON FUNCTION "public"."geometry_spgist_config_nd"("internal", "internal") TO "service_role";



GRANT ALL ON FUNCTION "public"."geometry_spgist_inner_consistent_2d"("internal", "internal") TO "postgres";
GRANT ALL ON FUNCTION "public"."geometry_spgist_inner_consistent_2d"("internal", "internal") TO "anon";
GRANT ALL ON FUNCTION "public"."geometry_spgist_inner_consistent_2d"("internal", "internal") TO "authenticated";
GRANT ALL ON FUNCTION "public"."geometry_spgist_inner_consistent_2d"("internal", "internal") TO "service_role";



GRANT ALL ON FUNCTION "public"."geometry_spgist_inner_consistent_3d"("internal", "internal") TO "postgres";
GRANT ALL ON FUNCTION "public"."geometry_spgist_inner_consistent_3d"("internal", "internal") TO "anon";
GRANT ALL ON FUNCTION "public"."geometry_spgist_inner_consistent_3d"("internal", "internal") TO "authenticated";
GRANT ALL ON FUNCTION "public"."geometry_spgist_inner_consistent_3d"("internal", "internal") TO "service_role";



GRANT ALL ON FUNCTION "public"."geometry_spgist_inner_consistent_nd"("internal", "internal") TO "postgres";
GRANT ALL ON FUNCTION "public"."geometry_spgist_inner_consistent_nd"("internal", "internal") TO "anon";
GRANT ALL ON FUNCTION "public"."geometry_spgist_inner_consistent_nd"("internal", "internal") TO "authenticated";
GRANT ALL ON FUNCTION "public"."geometry_spgist_inner_consistent_nd"("internal", "internal") TO "service_role";



GRANT ALL ON FUNCTION "public"."geometry_spgist_leaf_consistent_2d"("internal", "internal") TO "postgres";
GRANT ALL ON FUNCTION "public"."geometry_spgist_leaf_consistent_2d"("internal", "internal") TO "anon";
GRANT ALL ON FUNCTION "public"."geometry_spgist_leaf_consistent_2d"("internal", "internal") TO "authenticated";
GRANT ALL ON FUNCTION "public"."geometry_spgist_leaf_consistent_2d"("internal", "internal") TO "service_role";



GRANT ALL ON FUNCTION "public"."geometry_spgist_leaf_consistent_3d"("internal", "internal") TO "postgres";
GRANT ALL ON FUNCTION "public"."geometry_spgist_leaf_consistent_3d"("internal", "internal") TO "anon";
GRANT ALL ON FUNCTION "public"."geometry_spgist_leaf_consistent_3d"("internal", "internal") TO "authenticated";
GRANT ALL ON FUNCTION "public"."geometry_spgist_leaf_consistent_3d"("internal", "internal") TO "service_role";



GRANT ALL ON FUNCTION "public"."geometry_spgist_leaf_consistent_nd"("internal", "internal") TO "postgres";
GRANT ALL ON FUNCTION "public"."geometry_spgist_leaf_consistent_nd"("internal", "internal") TO "anon";
GRANT ALL ON FUNCTION "public"."geometry_spgist_leaf_consistent_nd"("internal", "internal") TO "authenticated";
GRANT ALL ON FUNCTION "public"."geometry_spgist_leaf_consistent_nd"("internal", "internal") TO "service_role";



GRANT ALL ON FUNCTION "public"."geometry_spgist_picksplit_2d"("internal", "internal") TO "postgres";
GRANT ALL ON FUNCTION "public"."geometry_spgist_picksplit_2d"("internal", "internal") TO "anon";
GRANT ALL ON FUNCTION "public"."geometry_spgist_picksplit_2d"("internal", "internal") TO "authenticated";
GRANT ALL ON FUNCTION "public"."geometry_spgist_picksplit_2d"("internal", "internal") TO "service_role";



GRANT ALL ON FUNCTION "public"."geometry_spgist_picksplit_3d"("internal", "internal") TO "postgres";
GRANT ALL ON FUNCTION "public"."geometry_spgist_picksplit_3d"("internal", "internal") TO "anon";
GRANT ALL ON FUNCTION "public"."geometry_spgist_picksplit_3d"("internal", "internal") TO "authenticated";
GRANT ALL ON FUNCTION "public"."geometry_spgist_picksplit_3d"("internal", "internal") TO "service_role";



GRANT ALL ON FUNCTION "public"."geometry_spgist_picksplit_nd"("internal", "internal") TO "postgres";
GRANT ALL ON FUNCTION "public"."geometry_spgist_picksplit_nd"("internal", "internal") TO "anon";
GRANT ALL ON FUNCTION "public"."geometry_spgist_picksplit_nd"("internal", "internal") TO "authenticated";
GRANT ALL ON FUNCTION "public"."geometry_spgist_picksplit_nd"("internal", "internal") TO "service_role";



GRANT ALL ON FUNCTION "public"."geometry_within"("geom1" "public"."geometry", "geom2" "public"."geometry") TO "postgres";
GRANT ALL ON FUNCTION "public"."geometry_within"("geom1" "public"."geometry", "geom2" "public"."geometry") TO "anon";
GRANT ALL ON FUNCTION "public"."geometry_within"("geom1" "public"."geometry", "geom2" "public"."geometry") TO "authenticated";
GRANT ALL ON FUNCTION "public"."geometry_within"("geom1" "public"."geometry", "geom2" "public"."geometry") TO "service_role";



GRANT ALL ON FUNCTION "public"."geometry_within_nd"("public"."geometry", "public"."geometry") TO "postgres";
GRANT ALL ON FUNCTION "public"."geometry_within_nd"("public"."geometry", "public"."geometry") TO "anon";
GRANT ALL ON FUNCTION "public"."geometry_within_nd"("public"."geometry", "public"."geometry") TO "authenticated";
GRANT ALL ON FUNCTION "public"."geometry_within_nd"("public"."geometry", "public"."geometry") TO "service_role";



GRANT ALL ON FUNCTION "public"."geometrytype"("public"."geography") TO "postgres";
GRANT ALL ON FUNCTION "public"."geometrytype"("public"."geography") TO "anon";
GRANT ALL ON FUNCTION "public"."geometrytype"("public"."geography") TO "authenticated";
GRANT ALL ON FUNCTION "public"."geometrytype"("public"."geography") TO "service_role";



GRANT ALL ON FUNCTION "public"."geometrytype"("public"."geometry") TO "postgres";
GRANT ALL ON FUNCTION "public"."geometrytype"("public"."geometry") TO "anon";
GRANT ALL ON FUNCTION "public"."geometrytype"("public"."geometry") TO "authenticated";
GRANT ALL ON FUNCTION "public"."geometrytype"("public"."geometry") TO "service_role";



GRANT ALL ON FUNCTION "public"."geomfromewkb"("bytea") TO "postgres";
GRANT ALL ON FUNCTION "public"."geomfromewkb"("bytea") TO "anon";
GRANT ALL ON FUNCTION "public"."geomfromewkb"("bytea") TO "authenticated";
GRANT ALL ON FUNCTION "public"."geomfromewkb"("bytea") TO "service_role";



GRANT ALL ON FUNCTION "public"."geomfromewkt"("text") TO "postgres";
GRANT ALL ON FUNCTION "public"."geomfromewkt"("text") TO "anon";
GRANT ALL ON FUNCTION "public"."geomfromewkt"("text") TO "authenticated";
GRANT ALL ON FUNCTION "public"."geomfromewkt"("text") TO "service_role";



GRANT ALL ON FUNCTION "public"."get_proj4_from_srid"(integer) TO "postgres";
GRANT ALL ON FUNCTION "public"."get_proj4_from_srid"(integer) TO "anon";
GRANT ALL ON FUNCTION "public"."get_proj4_from_srid"(integer) TO "authenticated";
GRANT ALL ON FUNCTION "public"."get_proj4_from_srid"(integer) TO "service_role";



GRANT ALL ON FUNCTION "public"."gettransactionid"() TO "postgres";
GRANT ALL ON FUNCTION "public"."gettransactionid"() TO "anon";
GRANT ALL ON FUNCTION "public"."gettransactionid"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."gettransactionid"() TO "service_role";



GRANT ALL ON FUNCTION "public"."gin_extract_query_trgm"("text", "internal", smallint, "internal", "internal", "internal", "internal") TO "postgres";
GRANT ALL ON FUNCTION "public"."gin_extract_query_trgm"("text", "internal", smallint, "internal", "internal", "internal", "internal") TO "anon";
GRANT ALL ON FUNCTION "public"."gin_extract_query_trgm"("text", "internal", smallint, "internal", "internal", "internal", "internal") TO "authenticated";
GRANT ALL ON FUNCTION "public"."gin_extract_query_trgm"("text", "internal", smallint, "internal", "internal", "internal", "internal") TO "service_role";



GRANT ALL ON FUNCTION "public"."gin_extract_value_trgm"("text", "internal") TO "postgres";
GRANT ALL ON FUNCTION "public"."gin_extract_value_trgm"("text", "internal") TO "anon";
GRANT ALL ON FUNCTION "public"."gin_extract_value_trgm"("text", "internal") TO "authenticated";
GRANT ALL ON FUNCTION "public"."gin_extract_value_trgm"("text", "internal") TO "service_role";



GRANT ALL ON FUNCTION "public"."gin_trgm_consistent"("internal", smallint, "text", integer, "internal", "internal", "internal", "internal") TO "postgres";
GRANT ALL ON FUNCTION "public"."gin_trgm_consistent"("internal", smallint, "text", integer, "internal", "internal", "internal", "internal") TO "anon";
GRANT ALL ON FUNCTION "public"."gin_trgm_consistent"("internal", smallint, "text", integer, "internal", "internal", "internal", "internal") TO "authenticated";
GRANT ALL ON FUNCTION "public"."gin_trgm_consistent"("internal", smallint, "text", integer, "internal", "internal", "internal", "internal") TO "service_role";



GRANT ALL ON FUNCTION "public"."gin_trgm_triconsistent"("internal", smallint, "text", integer, "internal", "internal", "internal") TO "postgres";
GRANT ALL ON FUNCTION "public"."gin_trgm_triconsistent"("internal", smallint, "text", integer, "internal", "internal", "internal") TO "anon";
GRANT ALL ON FUNCTION "public"."gin_trgm_triconsistent"("internal", smallint, "text", integer, "internal", "internal", "internal") TO "authenticated";
GRANT ALL ON FUNCTION "public"."gin_trgm_triconsistent"("internal", smallint, "text", integer, "internal", "internal", "internal") TO "service_role";



GRANT ALL ON FUNCTION "public"."google_profile_shop_name_key"("p_name" "text") TO "anon";
GRANT ALL ON FUNCTION "public"."google_profile_shop_name_key"("p_name" "text") TO "authenticated";
GRANT ALL ON FUNCTION "public"."google_profile_shop_name_key"("p_name" "text") TO "service_role";



GRANT ALL ON FUNCTION "public"."gserialized_gist_joinsel_2d"("internal", "oid", "internal", smallint) TO "postgres";
GRANT ALL ON FUNCTION "public"."gserialized_gist_joinsel_2d"("internal", "oid", "internal", smallint) TO "anon";
GRANT ALL ON FUNCTION "public"."gserialized_gist_joinsel_2d"("internal", "oid", "internal", smallint) TO "authenticated";
GRANT ALL ON FUNCTION "public"."gserialized_gist_joinsel_2d"("internal", "oid", "internal", smallint) TO "service_role";



GRANT ALL ON FUNCTION "public"."gserialized_gist_joinsel_nd"("internal", "oid", "internal", smallint) TO "postgres";
GRANT ALL ON FUNCTION "public"."gserialized_gist_joinsel_nd"("internal", "oid", "internal", smallint) TO "anon";
GRANT ALL ON FUNCTION "public"."gserialized_gist_joinsel_nd"("internal", "oid", "internal", smallint) TO "authenticated";
GRANT ALL ON FUNCTION "public"."gserialized_gist_joinsel_nd"("internal", "oid", "internal", smallint) TO "service_role";



GRANT ALL ON FUNCTION "public"."gserialized_gist_sel_2d"("internal", "oid", "internal", integer) TO "postgres";
GRANT ALL ON FUNCTION "public"."gserialized_gist_sel_2d"("internal", "oid", "internal", integer) TO "anon";
GRANT ALL ON FUNCTION "public"."gserialized_gist_sel_2d"("internal", "oid", "internal", integer) TO "authenticated";
GRANT ALL ON FUNCTION "public"."gserialized_gist_sel_2d"("internal", "oid", "internal", integer) TO "service_role";



GRANT ALL ON FUNCTION "public"."gserialized_gist_sel_nd"("internal", "oid", "internal", integer) TO "postgres";
GRANT ALL ON FUNCTION "public"."gserialized_gist_sel_nd"("internal", "oid", "internal", integer) TO "anon";
GRANT ALL ON FUNCTION "public"."gserialized_gist_sel_nd"("internal", "oid", "internal", integer) TO "authenticated";
GRANT ALL ON FUNCTION "public"."gserialized_gist_sel_nd"("internal", "oid", "internal", integer) TO "service_role";



GRANT ALL ON FUNCTION "public"."gtrgm_compress"("internal") TO "postgres";
GRANT ALL ON FUNCTION "public"."gtrgm_compress"("internal") TO "anon";
GRANT ALL ON FUNCTION "public"."gtrgm_compress"("internal") TO "authenticated";
GRANT ALL ON FUNCTION "public"."gtrgm_compress"("internal") TO "service_role";



GRANT ALL ON FUNCTION "public"."gtrgm_consistent"("internal", "text", smallint, "oid", "internal") TO "postgres";
GRANT ALL ON FUNCTION "public"."gtrgm_consistent"("internal", "text", smallint, "oid", "internal") TO "anon";
GRANT ALL ON FUNCTION "public"."gtrgm_consistent"("internal", "text", smallint, "oid", "internal") TO "authenticated";
GRANT ALL ON FUNCTION "public"."gtrgm_consistent"("internal", "text", smallint, "oid", "internal") TO "service_role";



GRANT ALL ON FUNCTION "public"."gtrgm_decompress"("internal") TO "postgres";
GRANT ALL ON FUNCTION "public"."gtrgm_decompress"("internal") TO "anon";
GRANT ALL ON FUNCTION "public"."gtrgm_decompress"("internal") TO "authenticated";
GRANT ALL ON FUNCTION "public"."gtrgm_decompress"("internal") TO "service_role";



GRANT ALL ON FUNCTION "public"."gtrgm_distance"("internal", "text", smallint, "oid", "internal") TO "postgres";
GRANT ALL ON FUNCTION "public"."gtrgm_distance"("internal", "text", smallint, "oid", "internal") TO "anon";
GRANT ALL ON FUNCTION "public"."gtrgm_distance"("internal", "text", smallint, "oid", "internal") TO "authenticated";
GRANT ALL ON FUNCTION "public"."gtrgm_distance"("internal", "text", smallint, "oid", "internal") TO "service_role";



GRANT ALL ON FUNCTION "public"."gtrgm_options"("internal") TO "postgres";
GRANT ALL ON FUNCTION "public"."gtrgm_options"("internal") TO "anon";
GRANT ALL ON FUNCTION "public"."gtrgm_options"("internal") TO "authenticated";
GRANT ALL ON FUNCTION "public"."gtrgm_options"("internal") TO "service_role";



GRANT ALL ON FUNCTION "public"."gtrgm_penalty"("internal", "internal", "internal") TO "postgres";
GRANT ALL ON FUNCTION "public"."gtrgm_penalty"("internal", "internal", "internal") TO "anon";
GRANT ALL ON FUNCTION "public"."gtrgm_penalty"("internal", "internal", "internal") TO "authenticated";
GRANT ALL ON FUNCTION "public"."gtrgm_penalty"("internal", "internal", "internal") TO "service_role";



GRANT ALL ON FUNCTION "public"."gtrgm_picksplit"("internal", "internal") TO "postgres";
GRANT ALL ON FUNCTION "public"."gtrgm_picksplit"("internal", "internal") TO "anon";
GRANT ALL ON FUNCTION "public"."gtrgm_picksplit"("internal", "internal") TO "authenticated";
GRANT ALL ON FUNCTION "public"."gtrgm_picksplit"("internal", "internal") TO "service_role";



GRANT ALL ON FUNCTION "public"."gtrgm_same"("public"."gtrgm", "public"."gtrgm", "internal") TO "postgres";
GRANT ALL ON FUNCTION "public"."gtrgm_same"("public"."gtrgm", "public"."gtrgm", "internal") TO "anon";
GRANT ALL ON FUNCTION "public"."gtrgm_same"("public"."gtrgm", "public"."gtrgm", "internal") TO "authenticated";
GRANT ALL ON FUNCTION "public"."gtrgm_same"("public"."gtrgm", "public"."gtrgm", "internal") TO "service_role";



GRANT ALL ON FUNCTION "public"."gtrgm_union"("internal", "internal") TO "postgres";
GRANT ALL ON FUNCTION "public"."gtrgm_union"("internal", "internal") TO "anon";
GRANT ALL ON FUNCTION "public"."gtrgm_union"("internal", "internal") TO "authenticated";
GRANT ALL ON FUNCTION "public"."gtrgm_union"("internal", "internal") TO "service_role";



GRANT ALL ON FUNCTION "public"."handle_new_user"() TO "anon";
GRANT ALL ON FUNCTION "public"."handle_new_user"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."handle_new_user"() TO "service_role";



GRANT ALL ON FUNCTION "public"."health_check"() TO "anon";
GRANT ALL ON FUNCTION "public"."health_check"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."health_check"() TO "service_role";



GRANT ALL ON FUNCTION "public"."is_contained_2d"("public"."box2df", "public"."box2df") TO "postgres";
GRANT ALL ON FUNCTION "public"."is_contained_2d"("public"."box2df", "public"."box2df") TO "anon";
GRANT ALL ON FUNCTION "public"."is_contained_2d"("public"."box2df", "public"."box2df") TO "authenticated";
GRANT ALL ON FUNCTION "public"."is_contained_2d"("public"."box2df", "public"."box2df") TO "service_role";



GRANT ALL ON FUNCTION "public"."is_contained_2d"("public"."box2df", "public"."geometry") TO "postgres";
GRANT ALL ON FUNCTION "public"."is_contained_2d"("public"."box2df", "public"."geometry") TO "anon";
GRANT ALL ON FUNCTION "public"."is_contained_2d"("public"."box2df", "public"."geometry") TO "authenticated";
GRANT ALL ON FUNCTION "public"."is_contained_2d"("public"."box2df", "public"."geometry") TO "service_role";



GRANT ALL ON FUNCTION "public"."is_contained_2d"("public"."geometry", "public"."box2df") TO "postgres";
GRANT ALL ON FUNCTION "public"."is_contained_2d"("public"."geometry", "public"."box2df") TO "anon";
GRANT ALL ON FUNCTION "public"."is_contained_2d"("public"."geometry", "public"."box2df") TO "authenticated";
GRANT ALL ON FUNCTION "public"."is_contained_2d"("public"."geometry", "public"."box2df") TO "service_role";



GRANT ALL ON FUNCTION "public"."lockrow"("text", "text", "text") TO "postgres";
GRANT ALL ON FUNCTION "public"."lockrow"("text", "text", "text") TO "anon";
GRANT ALL ON FUNCTION "public"."lockrow"("text", "text", "text") TO "authenticated";
GRANT ALL ON FUNCTION "public"."lockrow"("text", "text", "text") TO "service_role";



GRANT ALL ON FUNCTION "public"."lockrow"("text", "text", "text", "text") TO "postgres";
GRANT ALL ON FUNCTION "public"."lockrow"("text", "text", "text", "text") TO "anon";
GRANT ALL ON FUNCTION "public"."lockrow"("text", "text", "text", "text") TO "authenticated";
GRANT ALL ON FUNCTION "public"."lockrow"("text", "text", "text", "text") TO "service_role";



GRANT ALL ON FUNCTION "public"."lockrow"("text", "text", "text", timestamp without time zone) TO "postgres";
GRANT ALL ON FUNCTION "public"."lockrow"("text", "text", "text", timestamp without time zone) TO "anon";
GRANT ALL ON FUNCTION "public"."lockrow"("text", "text", "text", timestamp without time zone) TO "authenticated";
GRANT ALL ON FUNCTION "public"."lockrow"("text", "text", "text", timestamp without time zone) TO "service_role";



GRANT ALL ON FUNCTION "public"."lockrow"("text", "text", "text", "text", timestamp without time zone) TO "postgres";
GRANT ALL ON FUNCTION "public"."lockrow"("text", "text", "text", "text", timestamp without time zone) TO "anon";
GRANT ALL ON FUNCTION "public"."lockrow"("text", "text", "text", "text", timestamp without time zone) TO "authenticated";
GRANT ALL ON FUNCTION "public"."lockrow"("text", "text", "text", "text", timestamp without time zone) TO "service_role";



GRANT ALL ON FUNCTION "public"."longtransactionsenabled"() TO "postgres";
GRANT ALL ON FUNCTION "public"."longtransactionsenabled"() TO "anon";
GRANT ALL ON FUNCTION "public"."longtransactionsenabled"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."longtransactionsenabled"() TO "service_role";



GRANT ALL ON FUNCTION "public"."market_map_payload"("p_state" "text", "p_directory_limit" integer) TO "anon";
GRANT ALL ON FUNCTION "public"."market_map_payload"("p_state" "text", "p_directory_limit" integer) TO "authenticated";
GRANT ALL ON FUNCTION "public"."market_map_payload"("p_state" "text", "p_directory_limit" integer) TO "service_role";



GRANT ALL ON FUNCTION "public"."market_map_points"("p_state" "text", "p_directory_limit" integer) TO "anon";
GRANT ALL ON FUNCTION "public"."market_map_points"("p_state" "text", "p_directory_limit" integer) TO "authenticated";
GRANT ALL ON FUNCTION "public"."market_map_points"("p_state" "text", "p_directory_limit" integer) TO "service_role";



GRANT ALL ON FUNCTION "public"."market_map_search"("p_query" "text", "p_limit" integer) TO "anon";
GRANT ALL ON FUNCTION "public"."market_map_search"("p_query" "text", "p_limit" integer) TO "authenticated";
GRANT ALL ON FUNCTION "public"."market_map_search"("p_query" "text", "p_limit" integer) TO "service_role";



GRANT ALL ON FUNCTION "public"."market_state_rollup"() TO "anon";
GRANT ALL ON FUNCTION "public"."market_state_rollup"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."market_state_rollup"() TO "service_role";



GRANT ALL ON FUNCTION "public"."market_viewport_intelligence"("p_west" double precision, "p_south" double precision, "p_east" double precision, "p_north" double precision, "p_zoom" double precision, "result_limit" integer) TO "anon";
GRANT ALL ON FUNCTION "public"."market_viewport_intelligence"("p_west" double precision, "p_south" double precision, "p_east" double precision, "p_north" double precision, "p_zoom" double precision, "result_limit" integer) TO "authenticated";
GRANT ALL ON FUNCTION "public"."market_viewport_intelligence"("p_west" double precision, "p_south" double precision, "p_east" double precision, "p_north" double precision, "p_zoom" double precision, "result_limit" integer) TO "service_role";



GRANT ALL ON FUNCTION "public"."marketing_daypart"("city" "text", "state" "text") TO "anon";
GRANT ALL ON FUNCTION "public"."marketing_daypart"("city" "text", "state" "text") TO "authenticated";
GRANT ALL ON FUNCTION "public"."marketing_daypart"("city" "text", "state" "text") TO "service_role";



GRANT ALL ON FUNCTION "public"."marketing_metadata"("city" "text", "state" "text") TO "anon";
GRANT ALL ON FUNCTION "public"."marketing_metadata"("city" "text", "state" "text") TO "authenticated";
GRANT ALL ON FUNCTION "public"."marketing_metadata"("city" "text", "state" "text") TO "service_role";



GRANT ALL ON FUNCTION "public"."marketing_top_zips"("city" "text", "state" "text") TO "anon";
GRANT ALL ON FUNCTION "public"."marketing_top_zips"("city" "text", "state" "text") TO "authenticated";
GRANT ALL ON FUNCTION "public"."marketing_top_zips"("city" "text", "state" "text") TO "service_role";






GRANT ALL ON FUNCTION "public"."network_alerts"("threshold" numeric, "months" integer) TO "anon";
GRANT ALL ON FUNCTION "public"."network_alerts"("threshold" numeric, "months" integer) TO "authenticated";
GRANT ALL ON FUNCTION "public"."network_alerts"("threshold" numeric, "months" integer) TO "service_role";



GRANT ALL ON FUNCTION "public"."network_summary"("start_date" "date", "end_date" "date") TO "anon";
GRANT ALL ON FUNCTION "public"."network_summary"("start_date" "date", "end_date" "date") TO "authenticated";
GRANT ALL ON FUNCTION "public"."network_summary"("start_date" "date", "end_date" "date") TO "service_role";



GRANT ALL ON FUNCTION "public"."network_trend"("months" integer) TO "anon";
GRANT ALL ON FUNCTION "public"."network_trend"("months" integer) TO "authenticated";
GRANT ALL ON FUNCTION "public"."network_trend"("months" integer) TO "service_role";



GRANT ALL ON FUNCTION "public"."normalize_shop_name_key"("p_name" "text") TO "anon";
GRANT ALL ON FUNCTION "public"."normalize_shop_name_key"("p_name" "text") TO "authenticated";
GRANT ALL ON FUNCTION "public"."normalize_shop_name_key"("p_name" "text") TO "service_role";



GRANT ALL ON FUNCTION "public"."overlaps_2d"("public"."box2df", "public"."box2df") TO "postgres";
GRANT ALL ON FUNCTION "public"."overlaps_2d"("public"."box2df", "public"."box2df") TO "anon";
GRANT ALL ON FUNCTION "public"."overlaps_2d"("public"."box2df", "public"."box2df") TO "authenticated";
GRANT ALL ON FUNCTION "public"."overlaps_2d"("public"."box2df", "public"."box2df") TO "service_role";



GRANT ALL ON FUNCTION "public"."overlaps_2d"("public"."box2df", "public"."geometry") TO "postgres";
GRANT ALL ON FUNCTION "public"."overlaps_2d"("public"."box2df", "public"."geometry") TO "anon";
GRANT ALL ON FUNCTION "public"."overlaps_2d"("public"."box2df", "public"."geometry") TO "authenticated";
GRANT ALL ON FUNCTION "public"."overlaps_2d"("public"."box2df", "public"."geometry") TO "service_role";



GRANT ALL ON FUNCTION "public"."overlaps_2d"("public"."geometry", "public"."box2df") TO "postgres";
GRANT ALL ON FUNCTION "public"."overlaps_2d"("public"."geometry", "public"."box2df") TO "anon";
GRANT ALL ON FUNCTION "public"."overlaps_2d"("public"."geometry", "public"."box2df") TO "authenticated";
GRANT ALL ON FUNCTION "public"."overlaps_2d"("public"."geometry", "public"."box2df") TO "service_role";



GRANT ALL ON FUNCTION "public"."overlaps_geog"("public"."geography", "public"."gidx") TO "postgres";
GRANT ALL ON FUNCTION "public"."overlaps_geog"("public"."geography", "public"."gidx") TO "anon";
GRANT ALL ON FUNCTION "public"."overlaps_geog"("public"."geography", "public"."gidx") TO "authenticated";
GRANT ALL ON FUNCTION "public"."overlaps_geog"("public"."geography", "public"."gidx") TO "service_role";



GRANT ALL ON FUNCTION "public"."overlaps_geog"("public"."gidx", "public"."geography") TO "postgres";
GRANT ALL ON FUNCTION "public"."overlaps_geog"("public"."gidx", "public"."geography") TO "anon";
GRANT ALL ON FUNCTION "public"."overlaps_geog"("public"."gidx", "public"."geography") TO "authenticated";
GRANT ALL ON FUNCTION "public"."overlaps_geog"("public"."gidx", "public"."geography") TO "service_role";



GRANT ALL ON FUNCTION "public"."overlaps_geog"("public"."gidx", "public"."gidx") TO "postgres";
GRANT ALL ON FUNCTION "public"."overlaps_geog"("public"."gidx", "public"."gidx") TO "anon";
GRANT ALL ON FUNCTION "public"."overlaps_geog"("public"."gidx", "public"."gidx") TO "authenticated";
GRANT ALL ON FUNCTION "public"."overlaps_geog"("public"."gidx", "public"."gidx") TO "service_role";



GRANT ALL ON FUNCTION "public"."overlaps_nd"("public"."geometry", "public"."gidx") TO "postgres";
GRANT ALL ON FUNCTION "public"."overlaps_nd"("public"."geometry", "public"."gidx") TO "anon";
GRANT ALL ON FUNCTION "public"."overlaps_nd"("public"."geometry", "public"."gidx") TO "authenticated";
GRANT ALL ON FUNCTION "public"."overlaps_nd"("public"."geometry", "public"."gidx") TO "service_role";



GRANT ALL ON FUNCTION "public"."overlaps_nd"("public"."gidx", "public"."geometry") TO "postgres";
GRANT ALL ON FUNCTION "public"."overlaps_nd"("public"."gidx", "public"."geometry") TO "anon";
GRANT ALL ON FUNCTION "public"."overlaps_nd"("public"."gidx", "public"."geometry") TO "authenticated";
GRANT ALL ON FUNCTION "public"."overlaps_nd"("public"."gidx", "public"."geometry") TO "service_role";



GRANT ALL ON FUNCTION "public"."overlaps_nd"("public"."gidx", "public"."gidx") TO "postgres";
GRANT ALL ON FUNCTION "public"."overlaps_nd"("public"."gidx", "public"."gidx") TO "anon";
GRANT ALL ON FUNCTION "public"."overlaps_nd"("public"."gidx", "public"."gidx") TO "authenticated";
GRANT ALL ON FUNCTION "public"."overlaps_nd"("public"."gidx", "public"."gidx") TO "service_role";



GRANT ALL ON FUNCTION "public"."pgis_asflatgeobuf_finalfn"("internal") TO "postgres";
GRANT ALL ON FUNCTION "public"."pgis_asflatgeobuf_finalfn"("internal") TO "anon";
GRANT ALL ON FUNCTION "public"."pgis_asflatgeobuf_finalfn"("internal") TO "authenticated";
GRANT ALL ON FUNCTION "public"."pgis_asflatgeobuf_finalfn"("internal") TO "service_role";



GRANT ALL ON FUNCTION "public"."pgis_asflatgeobuf_transfn"("internal", "anyelement") TO "postgres";
GRANT ALL ON FUNCTION "public"."pgis_asflatgeobuf_transfn"("internal", "anyelement") TO "anon";
GRANT ALL ON FUNCTION "public"."pgis_asflatgeobuf_transfn"("internal", "anyelement") TO "authenticated";
GRANT ALL ON FUNCTION "public"."pgis_asflatgeobuf_transfn"("internal", "anyelement") TO "service_role";



GRANT ALL ON FUNCTION "public"."pgis_asflatgeobuf_transfn"("internal", "anyelement", boolean) TO "postgres";
GRANT ALL ON FUNCTION "public"."pgis_asflatgeobuf_transfn"("internal", "anyelement", boolean) TO "anon";
GRANT ALL ON FUNCTION "public"."pgis_asflatgeobuf_transfn"("internal", "anyelement", boolean) TO "authenticated";
GRANT ALL ON FUNCTION "public"."pgis_asflatgeobuf_transfn"("internal", "anyelement", boolean) TO "service_role";



GRANT ALL ON FUNCTION "public"."pgis_asflatgeobuf_transfn"("internal", "anyelement", boolean, "text") TO "postgres";
GRANT ALL ON FUNCTION "public"."pgis_asflatgeobuf_transfn"("internal", "anyelement", boolean, "text") TO "anon";
GRANT ALL ON FUNCTION "public"."pgis_asflatgeobuf_transfn"("internal", "anyelement", boolean, "text") TO "authenticated";
GRANT ALL ON FUNCTION "public"."pgis_asflatgeobuf_transfn"("internal", "anyelement", boolean, "text") TO "service_role";



GRANT ALL ON FUNCTION "public"."pgis_asgeobuf_finalfn"("internal") TO "postgres";
GRANT ALL ON FUNCTION "public"."pgis_asgeobuf_finalfn"("internal") TO "anon";
GRANT ALL ON FUNCTION "public"."pgis_asgeobuf_finalfn"("internal") TO "authenticated";
GRANT ALL ON FUNCTION "public"."pgis_asgeobuf_finalfn"("internal") TO "service_role";



GRANT ALL ON FUNCTION "public"."pgis_asgeobuf_transfn"("internal", "anyelement") TO "postgres";
GRANT ALL ON FUNCTION "public"."pgis_asgeobuf_transfn"("internal", "anyelement") TO "anon";
GRANT ALL ON FUNCTION "public"."pgis_asgeobuf_transfn"("internal", "anyelement") TO "authenticated";
GRANT ALL ON FUNCTION "public"."pgis_asgeobuf_transfn"("internal", "anyelement") TO "service_role";



GRANT ALL ON FUNCTION "public"."pgis_asgeobuf_transfn"("internal", "anyelement", "text") TO "postgres";
GRANT ALL ON FUNCTION "public"."pgis_asgeobuf_transfn"("internal", "anyelement", "text") TO "anon";
GRANT ALL ON FUNCTION "public"."pgis_asgeobuf_transfn"("internal", "anyelement", "text") TO "authenticated";
GRANT ALL ON FUNCTION "public"."pgis_asgeobuf_transfn"("internal", "anyelement", "text") TO "service_role";



GRANT ALL ON FUNCTION "public"."pgis_asmvt_combinefn"("internal", "internal") TO "postgres";
GRANT ALL ON FUNCTION "public"."pgis_asmvt_combinefn"("internal", "internal") TO "anon";
GRANT ALL ON FUNCTION "public"."pgis_asmvt_combinefn"("internal", "internal") TO "authenticated";
GRANT ALL ON FUNCTION "public"."pgis_asmvt_combinefn"("internal", "internal") TO "service_role";



GRANT ALL ON FUNCTION "public"."pgis_asmvt_deserialfn"("bytea", "internal") TO "postgres";
GRANT ALL ON FUNCTION "public"."pgis_asmvt_deserialfn"("bytea", "internal") TO "anon";
GRANT ALL ON FUNCTION "public"."pgis_asmvt_deserialfn"("bytea", "internal") TO "authenticated";
GRANT ALL ON FUNCTION "public"."pgis_asmvt_deserialfn"("bytea", "internal") TO "service_role";



GRANT ALL ON FUNCTION "public"."pgis_asmvt_finalfn"("internal") TO "postgres";
GRANT ALL ON FUNCTION "public"."pgis_asmvt_finalfn"("internal") TO "anon";
GRANT ALL ON FUNCTION "public"."pgis_asmvt_finalfn"("internal") TO "authenticated";
GRANT ALL ON FUNCTION "public"."pgis_asmvt_finalfn"("internal") TO "service_role";



GRANT ALL ON FUNCTION "public"."pgis_asmvt_serialfn"("internal") TO "postgres";
GRANT ALL ON FUNCTION "public"."pgis_asmvt_serialfn"("internal") TO "anon";
GRANT ALL ON FUNCTION "public"."pgis_asmvt_serialfn"("internal") TO "authenticated";
GRANT ALL ON FUNCTION "public"."pgis_asmvt_serialfn"("internal") TO "service_role";



GRANT ALL ON FUNCTION "public"."pgis_asmvt_transfn"("internal", "anyelement") TO "postgres";
GRANT ALL ON FUNCTION "public"."pgis_asmvt_transfn"("internal", "anyelement") TO "anon";
GRANT ALL ON FUNCTION "public"."pgis_asmvt_transfn"("internal", "anyelement") TO "authenticated";
GRANT ALL ON FUNCTION "public"."pgis_asmvt_transfn"("internal", "anyelement") TO "service_role";



GRANT ALL ON FUNCTION "public"."pgis_asmvt_transfn"("internal", "anyelement", "text") TO "postgres";
GRANT ALL ON FUNCTION "public"."pgis_asmvt_transfn"("internal", "anyelement", "text") TO "anon";
GRANT ALL ON FUNCTION "public"."pgis_asmvt_transfn"("internal", "anyelement", "text") TO "authenticated";
GRANT ALL ON FUNCTION "public"."pgis_asmvt_transfn"("internal", "anyelement", "text") TO "service_role";



GRANT ALL ON FUNCTION "public"."pgis_asmvt_transfn"("internal", "anyelement", "text", integer) TO "postgres";
GRANT ALL ON FUNCTION "public"."pgis_asmvt_transfn"("internal", "anyelement", "text", integer) TO "anon";
GRANT ALL ON FUNCTION "public"."pgis_asmvt_transfn"("internal", "anyelement", "text", integer) TO "authenticated";
GRANT ALL ON FUNCTION "public"."pgis_asmvt_transfn"("internal", "anyelement", "text", integer) TO "service_role";



GRANT ALL ON FUNCTION "public"."pgis_asmvt_transfn"("internal", "anyelement", "text", integer, "text") TO "postgres";
GRANT ALL ON FUNCTION "public"."pgis_asmvt_transfn"("internal", "anyelement", "text", integer, "text") TO "anon";
GRANT ALL ON FUNCTION "public"."pgis_asmvt_transfn"("internal", "anyelement", "text", integer, "text") TO "authenticated";
GRANT ALL ON FUNCTION "public"."pgis_asmvt_transfn"("internal", "anyelement", "text", integer, "text") TO "service_role";



GRANT ALL ON FUNCTION "public"."pgis_asmvt_transfn"("internal", "anyelement", "text", integer, "text", "text") TO "postgres";
GRANT ALL ON FUNCTION "public"."pgis_asmvt_transfn"("internal", "anyelement", "text", integer, "text", "text") TO "anon";
GRANT ALL ON FUNCTION "public"."pgis_asmvt_transfn"("internal", "anyelement", "text", integer, "text", "text") TO "authenticated";
GRANT ALL ON FUNCTION "public"."pgis_asmvt_transfn"("internal", "anyelement", "text", integer, "text", "text") TO "service_role";



GRANT ALL ON FUNCTION "public"."pgis_geometry_accum_transfn"("internal", "public"."geometry") TO "postgres";
GRANT ALL ON FUNCTION "public"."pgis_geometry_accum_transfn"("internal", "public"."geometry") TO "anon";
GRANT ALL ON FUNCTION "public"."pgis_geometry_accum_transfn"("internal", "public"."geometry") TO "authenticated";
GRANT ALL ON FUNCTION "public"."pgis_geometry_accum_transfn"("internal", "public"."geometry") TO "service_role";



GRANT ALL ON FUNCTION "public"."pgis_geometry_accum_transfn"("internal", "public"."geometry", double precision) TO "postgres";
GRANT ALL ON FUNCTION "public"."pgis_geometry_accum_transfn"("internal", "public"."geometry", double precision) TO "anon";
GRANT ALL ON FUNCTION "public"."pgis_geometry_accum_transfn"("internal", "public"."geometry", double precision) TO "authenticated";
GRANT ALL ON FUNCTION "public"."pgis_geometry_accum_transfn"("internal", "public"."geometry", double precision) TO "service_role";



GRANT ALL ON FUNCTION "public"."pgis_geometry_accum_transfn"("internal", "public"."geometry", double precision, integer) TO "postgres";
GRANT ALL ON FUNCTION "public"."pgis_geometry_accum_transfn"("internal", "public"."geometry", double precision, integer) TO "anon";
GRANT ALL ON FUNCTION "public"."pgis_geometry_accum_transfn"("internal", "public"."geometry", double precision, integer) TO "authenticated";
GRANT ALL ON FUNCTION "public"."pgis_geometry_accum_transfn"("internal", "public"."geometry", double precision, integer) TO "service_role";



GRANT ALL ON FUNCTION "public"."pgis_geometry_clusterintersecting_finalfn"("internal") TO "postgres";
GRANT ALL ON FUNCTION "public"."pgis_geometry_clusterintersecting_finalfn"("internal") TO "anon";
GRANT ALL ON FUNCTION "public"."pgis_geometry_clusterintersecting_finalfn"("internal") TO "authenticated";
GRANT ALL ON FUNCTION "public"."pgis_geometry_clusterintersecting_finalfn"("internal") TO "service_role";



GRANT ALL ON FUNCTION "public"."pgis_geometry_clusterwithin_finalfn"("internal") TO "postgres";
GRANT ALL ON FUNCTION "public"."pgis_geometry_clusterwithin_finalfn"("internal") TO "anon";
GRANT ALL ON FUNCTION "public"."pgis_geometry_clusterwithin_finalfn"("internal") TO "authenticated";
GRANT ALL ON FUNCTION "public"."pgis_geometry_clusterwithin_finalfn"("internal") TO "service_role";



GRANT ALL ON FUNCTION "public"."pgis_geometry_collect_finalfn"("internal") TO "postgres";
GRANT ALL ON FUNCTION "public"."pgis_geometry_collect_finalfn"("internal") TO "anon";
GRANT ALL ON FUNCTION "public"."pgis_geometry_collect_finalfn"("internal") TO "authenticated";
GRANT ALL ON FUNCTION "public"."pgis_geometry_collect_finalfn"("internal") TO "service_role";



GRANT ALL ON FUNCTION "public"."pgis_geometry_makeline_finalfn"("internal") TO "postgres";
GRANT ALL ON FUNCTION "public"."pgis_geometry_makeline_finalfn"("internal") TO "anon";
GRANT ALL ON FUNCTION "public"."pgis_geometry_makeline_finalfn"("internal") TO "authenticated";
GRANT ALL ON FUNCTION "public"."pgis_geometry_makeline_finalfn"("internal") TO "service_role";



GRANT ALL ON FUNCTION "public"."pgis_geometry_polygonize_finalfn"("internal") TO "postgres";
GRANT ALL ON FUNCTION "public"."pgis_geometry_polygonize_finalfn"("internal") TO "anon";
GRANT ALL ON FUNCTION "public"."pgis_geometry_polygonize_finalfn"("internal") TO "authenticated";
GRANT ALL ON FUNCTION "public"."pgis_geometry_polygonize_finalfn"("internal") TO "service_role";



GRANT ALL ON FUNCTION "public"."pgis_geometry_union_parallel_combinefn"("internal", "internal") TO "postgres";
GRANT ALL ON FUNCTION "public"."pgis_geometry_union_parallel_combinefn"("internal", "internal") TO "anon";
GRANT ALL ON FUNCTION "public"."pgis_geometry_union_parallel_combinefn"("internal", "internal") TO "authenticated";
GRANT ALL ON FUNCTION "public"."pgis_geometry_union_parallel_combinefn"("internal", "internal") TO "service_role";



GRANT ALL ON FUNCTION "public"."pgis_geometry_union_parallel_deserialfn"("bytea", "internal") TO "postgres";
GRANT ALL ON FUNCTION "public"."pgis_geometry_union_parallel_deserialfn"("bytea", "internal") TO "anon";
GRANT ALL ON FUNCTION "public"."pgis_geometry_union_parallel_deserialfn"("bytea", "internal") TO "authenticated";
GRANT ALL ON FUNCTION "public"."pgis_geometry_union_parallel_deserialfn"("bytea", "internal") TO "service_role";



GRANT ALL ON FUNCTION "public"."pgis_geometry_union_parallel_finalfn"("internal") TO "postgres";
GRANT ALL ON FUNCTION "public"."pgis_geometry_union_parallel_finalfn"("internal") TO "anon";
GRANT ALL ON FUNCTION "public"."pgis_geometry_union_parallel_finalfn"("internal") TO "authenticated";
GRANT ALL ON FUNCTION "public"."pgis_geometry_union_parallel_finalfn"("internal") TO "service_role";



GRANT ALL ON FUNCTION "public"."pgis_geometry_union_parallel_serialfn"("internal") TO "postgres";
GRANT ALL ON FUNCTION "public"."pgis_geometry_union_parallel_serialfn"("internal") TO "anon";
GRANT ALL ON FUNCTION "public"."pgis_geometry_union_parallel_serialfn"("internal") TO "authenticated";
GRANT ALL ON FUNCTION "public"."pgis_geometry_union_parallel_serialfn"("internal") TO "service_role";



GRANT ALL ON FUNCTION "public"."pgis_geometry_union_parallel_transfn"("internal", "public"."geometry") TO "postgres";
GRANT ALL ON FUNCTION "public"."pgis_geometry_union_parallel_transfn"("internal", "public"."geometry") TO "anon";
GRANT ALL ON FUNCTION "public"."pgis_geometry_union_parallel_transfn"("internal", "public"."geometry") TO "authenticated";
GRANT ALL ON FUNCTION "public"."pgis_geometry_union_parallel_transfn"("internal", "public"."geometry") TO "service_role";



GRANT ALL ON FUNCTION "public"."pgis_geometry_union_parallel_transfn"("internal", "public"."geometry", double precision) TO "postgres";
GRANT ALL ON FUNCTION "public"."pgis_geometry_union_parallel_transfn"("internal", "public"."geometry", double precision) TO "anon";
GRANT ALL ON FUNCTION "public"."pgis_geometry_union_parallel_transfn"("internal", "public"."geometry", double precision) TO "authenticated";
GRANT ALL ON FUNCTION "public"."pgis_geometry_union_parallel_transfn"("internal", "public"."geometry", double precision) TO "service_role";



GRANT ALL ON FUNCTION "public"."populate_geometry_columns"("use_typmod" boolean) TO "postgres";
GRANT ALL ON FUNCTION "public"."populate_geometry_columns"("use_typmod" boolean) TO "anon";
GRANT ALL ON FUNCTION "public"."populate_geometry_columns"("use_typmod" boolean) TO "authenticated";
GRANT ALL ON FUNCTION "public"."populate_geometry_columns"("use_typmod" boolean) TO "service_role";



GRANT ALL ON FUNCTION "public"."populate_geometry_columns"("tbl_oid" "oid", "use_typmod" boolean) TO "postgres";
GRANT ALL ON FUNCTION "public"."populate_geometry_columns"("tbl_oid" "oid", "use_typmod" boolean) TO "anon";
GRANT ALL ON FUNCTION "public"."populate_geometry_columns"("tbl_oid" "oid", "use_typmod" boolean) TO "authenticated";
GRANT ALL ON FUNCTION "public"."populate_geometry_columns"("tbl_oid" "oid", "use_typmod" boolean) TO "service_role";



GRANT ALL ON FUNCTION "public"."postgis_addbbox"("public"."geometry") TO "postgres";
GRANT ALL ON FUNCTION "public"."postgis_addbbox"("public"."geometry") TO "anon";
GRANT ALL ON FUNCTION "public"."postgis_addbbox"("public"."geometry") TO "authenticated";
GRANT ALL ON FUNCTION "public"."postgis_addbbox"("public"."geometry") TO "service_role";



GRANT ALL ON FUNCTION "public"."postgis_cache_bbox"() TO "postgres";
GRANT ALL ON FUNCTION "public"."postgis_cache_bbox"() TO "anon";
GRANT ALL ON FUNCTION "public"."postgis_cache_bbox"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."postgis_cache_bbox"() TO "service_role";



GRANT ALL ON FUNCTION "public"."postgis_constraint_dims"("geomschema" "text", "geomtable" "text", "geomcolumn" "text") TO "postgres";
GRANT ALL ON FUNCTION "public"."postgis_constraint_dims"("geomschema" "text", "geomtable" "text", "geomcolumn" "text") TO "anon";
GRANT ALL ON FUNCTION "public"."postgis_constraint_dims"("geomschema" "text", "geomtable" "text", "geomcolumn" "text") TO "authenticated";
GRANT ALL ON FUNCTION "public"."postgis_constraint_dims"("geomschema" "text", "geomtable" "text", "geomcolumn" "text") TO "service_role";



GRANT ALL ON FUNCTION "public"."postgis_constraint_srid"("geomschema" "text", "geomtable" "text", "geomcolumn" "text") TO "postgres";
GRANT ALL ON FUNCTION "public"."postgis_constraint_srid"("geomschema" "text", "geomtable" "text", "geomcolumn" "text") TO "anon";
GRANT ALL ON FUNCTION "public"."postgis_constraint_srid"("geomschema" "text", "geomtable" "text", "geomcolumn" "text") TO "authenticated";
GRANT ALL ON FUNCTION "public"."postgis_constraint_srid"("geomschema" "text", "geomtable" "text", "geomcolumn" "text") TO "service_role";



GRANT ALL ON FUNCTION "public"."postgis_constraint_type"("geomschema" "text", "geomtable" "text", "geomcolumn" "text") TO "postgres";
GRANT ALL ON FUNCTION "public"."postgis_constraint_type"("geomschema" "text", "geomtable" "text", "geomcolumn" "text") TO "anon";
GRANT ALL ON FUNCTION "public"."postgis_constraint_type"("geomschema" "text", "geomtable" "text", "geomcolumn" "text") TO "authenticated";
GRANT ALL ON FUNCTION "public"."postgis_constraint_type"("geomschema" "text", "geomtable" "text", "geomcolumn" "text") TO "service_role";



GRANT ALL ON FUNCTION "public"."postgis_dropbbox"("public"."geometry") TO "postgres";
GRANT ALL ON FUNCTION "public"."postgis_dropbbox"("public"."geometry") TO "anon";
GRANT ALL ON FUNCTION "public"."postgis_dropbbox"("public"."geometry") TO "authenticated";
GRANT ALL ON FUNCTION "public"."postgis_dropbbox"("public"."geometry") TO "service_role";



GRANT ALL ON FUNCTION "public"."postgis_extensions_upgrade"() TO "postgres";
GRANT ALL ON FUNCTION "public"."postgis_extensions_upgrade"() TO "anon";
GRANT ALL ON FUNCTION "public"."postgis_extensions_upgrade"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."postgis_extensions_upgrade"() TO "service_role";



GRANT ALL ON FUNCTION "public"."postgis_full_version"() TO "postgres";
GRANT ALL ON FUNCTION "public"."postgis_full_version"() TO "anon";
GRANT ALL ON FUNCTION "public"."postgis_full_version"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."postgis_full_version"() TO "service_role";



GRANT ALL ON FUNCTION "public"."postgis_geos_noop"("public"."geometry") TO "postgres";
GRANT ALL ON FUNCTION "public"."postgis_geos_noop"("public"."geometry") TO "anon";
GRANT ALL ON FUNCTION "public"."postgis_geos_noop"("public"."geometry") TO "authenticated";
GRANT ALL ON FUNCTION "public"."postgis_geos_noop"("public"."geometry") TO "service_role";



GRANT ALL ON FUNCTION "public"."postgis_geos_version"() TO "postgres";
GRANT ALL ON FUNCTION "public"."postgis_geos_version"() TO "anon";
GRANT ALL ON FUNCTION "public"."postgis_geos_version"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."postgis_geos_version"() TO "service_role";



GRANT ALL ON FUNCTION "public"."postgis_getbbox"("public"."geometry") TO "postgres";
GRANT ALL ON FUNCTION "public"."postgis_getbbox"("public"."geometry") TO "anon";
GRANT ALL ON FUNCTION "public"."postgis_getbbox"("public"."geometry") TO "authenticated";
GRANT ALL ON FUNCTION "public"."postgis_getbbox"("public"."geometry") TO "service_role";



GRANT ALL ON FUNCTION "public"."postgis_hasbbox"("public"."geometry") TO "postgres";
GRANT ALL ON FUNCTION "public"."postgis_hasbbox"("public"."geometry") TO "anon";
GRANT ALL ON FUNCTION "public"."postgis_hasbbox"("public"."geometry") TO "authenticated";
GRANT ALL ON FUNCTION "public"."postgis_hasbbox"("public"."geometry") TO "service_role";



GRANT ALL ON FUNCTION "public"."postgis_index_supportfn"("internal") TO "postgres";
GRANT ALL ON FUNCTION "public"."postgis_index_supportfn"("internal") TO "anon";
GRANT ALL ON FUNCTION "public"."postgis_index_supportfn"("internal") TO "authenticated";
GRANT ALL ON FUNCTION "public"."postgis_index_supportfn"("internal") TO "service_role";



GRANT ALL ON FUNCTION "public"."postgis_lib_build_date"() TO "postgres";
GRANT ALL ON FUNCTION "public"."postgis_lib_build_date"() TO "anon";
GRANT ALL ON FUNCTION "public"."postgis_lib_build_date"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."postgis_lib_build_date"() TO "service_role";



GRANT ALL ON FUNCTION "public"."postgis_lib_revision"() TO "postgres";
GRANT ALL ON FUNCTION "public"."postgis_lib_revision"() TO "anon";
GRANT ALL ON FUNCTION "public"."postgis_lib_revision"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."postgis_lib_revision"() TO "service_role";



GRANT ALL ON FUNCTION "public"."postgis_lib_version"() TO "postgres";
GRANT ALL ON FUNCTION "public"."postgis_lib_version"() TO "anon";
GRANT ALL ON FUNCTION "public"."postgis_lib_version"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."postgis_lib_version"() TO "service_role";



GRANT ALL ON FUNCTION "public"."postgis_libjson_version"() TO "postgres";
GRANT ALL ON FUNCTION "public"."postgis_libjson_version"() TO "anon";
GRANT ALL ON FUNCTION "public"."postgis_libjson_version"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."postgis_libjson_version"() TO "service_role";



GRANT ALL ON FUNCTION "public"."postgis_liblwgeom_version"() TO "postgres";
GRANT ALL ON FUNCTION "public"."postgis_liblwgeom_version"() TO "anon";
GRANT ALL ON FUNCTION "public"."postgis_liblwgeom_version"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."postgis_liblwgeom_version"() TO "service_role";



GRANT ALL ON FUNCTION "public"."postgis_libprotobuf_version"() TO "postgres";
GRANT ALL ON FUNCTION "public"."postgis_libprotobuf_version"() TO "anon";
GRANT ALL ON FUNCTION "public"."postgis_libprotobuf_version"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."postgis_libprotobuf_version"() TO "service_role";



GRANT ALL ON FUNCTION "public"."postgis_libxml_version"() TO "postgres";
GRANT ALL ON FUNCTION "public"."postgis_libxml_version"() TO "anon";
GRANT ALL ON FUNCTION "public"."postgis_libxml_version"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."postgis_libxml_version"() TO "service_role";



GRANT ALL ON FUNCTION "public"."postgis_noop"("public"."geometry") TO "postgres";
GRANT ALL ON FUNCTION "public"."postgis_noop"("public"."geometry") TO "anon";
GRANT ALL ON FUNCTION "public"."postgis_noop"("public"."geometry") TO "authenticated";
GRANT ALL ON FUNCTION "public"."postgis_noop"("public"."geometry") TO "service_role";



GRANT ALL ON FUNCTION "public"."postgis_proj_version"() TO "postgres";
GRANT ALL ON FUNCTION "public"."postgis_proj_version"() TO "anon";
GRANT ALL ON FUNCTION "public"."postgis_proj_version"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."postgis_proj_version"() TO "service_role";



GRANT ALL ON FUNCTION "public"."postgis_scripts_build_date"() TO "postgres";
GRANT ALL ON FUNCTION "public"."postgis_scripts_build_date"() TO "anon";
GRANT ALL ON FUNCTION "public"."postgis_scripts_build_date"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."postgis_scripts_build_date"() TO "service_role";



GRANT ALL ON FUNCTION "public"."postgis_scripts_installed"() TO "postgres";
GRANT ALL ON FUNCTION "public"."postgis_scripts_installed"() TO "anon";
GRANT ALL ON FUNCTION "public"."postgis_scripts_installed"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."postgis_scripts_installed"() TO "service_role";



GRANT ALL ON FUNCTION "public"."postgis_scripts_released"() TO "postgres";
GRANT ALL ON FUNCTION "public"."postgis_scripts_released"() TO "anon";
GRANT ALL ON FUNCTION "public"."postgis_scripts_released"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."postgis_scripts_released"() TO "service_role";



GRANT ALL ON FUNCTION "public"."postgis_svn_version"() TO "postgres";
GRANT ALL ON FUNCTION "public"."postgis_svn_version"() TO "anon";
GRANT ALL ON FUNCTION "public"."postgis_svn_version"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."postgis_svn_version"() TO "service_role";



GRANT ALL ON FUNCTION "public"."postgis_transform_geometry"("geom" "public"."geometry", "text", "text", integer) TO "postgres";
GRANT ALL ON FUNCTION "public"."postgis_transform_geometry"("geom" "public"."geometry", "text", "text", integer) TO "anon";
GRANT ALL ON FUNCTION "public"."postgis_transform_geometry"("geom" "public"."geometry", "text", "text", integer) TO "authenticated";
GRANT ALL ON FUNCTION "public"."postgis_transform_geometry"("geom" "public"."geometry", "text", "text", integer) TO "service_role";



GRANT ALL ON FUNCTION "public"."postgis_type_name"("geomname" character varying, "coord_dimension" integer, "use_new_name" boolean) TO "postgres";
GRANT ALL ON FUNCTION "public"."postgis_type_name"("geomname" character varying, "coord_dimension" integer, "use_new_name" boolean) TO "anon";
GRANT ALL ON FUNCTION "public"."postgis_type_name"("geomname" character varying, "coord_dimension" integer, "use_new_name" boolean) TO "authenticated";
GRANT ALL ON FUNCTION "public"."postgis_type_name"("geomname" character varying, "coord_dimension" integer, "use_new_name" boolean) TO "service_role";



GRANT ALL ON FUNCTION "public"."postgis_typmod_dims"(integer) TO "postgres";
GRANT ALL ON FUNCTION "public"."postgis_typmod_dims"(integer) TO "anon";
GRANT ALL ON FUNCTION "public"."postgis_typmod_dims"(integer) TO "authenticated";
GRANT ALL ON FUNCTION "public"."postgis_typmod_dims"(integer) TO "service_role";



GRANT ALL ON FUNCTION "public"."postgis_typmod_srid"(integer) TO "postgres";
GRANT ALL ON FUNCTION "public"."postgis_typmod_srid"(integer) TO "anon";
GRANT ALL ON FUNCTION "public"."postgis_typmod_srid"(integer) TO "authenticated";
GRANT ALL ON FUNCTION "public"."postgis_typmod_srid"(integer) TO "service_role";



GRANT ALL ON FUNCTION "public"."postgis_typmod_type"(integer) TO "postgres";
GRANT ALL ON FUNCTION "public"."postgis_typmod_type"(integer) TO "anon";
GRANT ALL ON FUNCTION "public"."postgis_typmod_type"(integer) TO "authenticated";
GRANT ALL ON FUNCTION "public"."postgis_typmod_type"(integer) TO "service_role";



GRANT ALL ON FUNCTION "public"."postgis_version"() TO "postgres";
GRANT ALL ON FUNCTION "public"."postgis_version"() TO "anon";
GRANT ALL ON FUNCTION "public"."postgis_version"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."postgis_version"() TO "service_role";



GRANT ALL ON FUNCTION "public"."postgis_wagyu_version"() TO "postgres";
GRANT ALL ON FUNCTION "public"."postgis_wagyu_version"() TO "anon";
GRANT ALL ON FUNCTION "public"."postgis_wagyu_version"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."postgis_wagyu_version"() TO "service_role";



GRANT ALL ON FUNCTION "public"."refresh_accident_market_rollups"() TO "anon";
GRANT ALL ON FUNCTION "public"."refresh_accident_market_rollups"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."refresh_accident_market_rollups"() TO "service_role";



GRANT ALL ON FUNCTION "public"."refresh_market_map_point_cache"() TO "anon";
GRANT ALL ON FUNCTION "public"."refresh_market_map_point_cache"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."refresh_market_map_point_cache"() TO "service_role";



GRANT ALL ON FUNCTION "public"."refresh_market_zip_latest_signal"() TO "anon";
GRANT ALL ON FUNCTION "public"."refresh_market_zip_latest_signal"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."refresh_market_zip_latest_signal"() TO "service_role";



GRANT ALL ON FUNCTION "public"."rls_auto_enable"() TO "anon";
GRANT ALL ON FUNCTION "public"."rls_auto_enable"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."rls_auto_enable"() TO "service_role";



GRANT ALL ON FUNCTION "public"."set_limit"(real) TO "postgres";
GRANT ALL ON FUNCTION "public"."set_limit"(real) TO "anon";
GRANT ALL ON FUNCTION "public"."set_limit"(real) TO "authenticated";
GRANT ALL ON FUNCTION "public"."set_limit"(real) TO "service_role";



GRANT ALL ON FUNCTION "public"."set_updated_at"() TO "anon";
GRANT ALL ON FUNCTION "public"."set_updated_at"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."set_updated_at"() TO "service_role";



GRANT ALL ON FUNCTION "public"."shop_comments"("shop_name" "text", "search" "text", "result_limit" integer, "result_offset" integer) TO "anon";
GRANT ALL ON FUNCTION "public"."shop_comments"("shop_name" "text", "search" "text", "result_limit" integer, "result_offset" integer) TO "authenticated";
GRANT ALL ON FUNCTION "public"."shop_comments"("shop_name" "text", "search" "text", "result_limit" integer, "result_offset" integer) TO "service_role";



GRANT ALL ON FUNCTION "public"."shop_comments_count"("shop_name" "text", "search" "text") TO "anon";
GRANT ALL ON FUNCTION "public"."shop_comments_count"("shop_name" "text", "search" "text") TO "authenticated";
GRANT ALL ON FUNCTION "public"."shop_comments_count"("shop_name" "text", "search" "text") TO "service_role";



GRANT ALL ON FUNCTION "public"."shop_competitor_overlay"("p_shop_name" "text", "p_radius_miles" numeric, "p_limit" integer) TO "anon";
GRANT ALL ON FUNCTION "public"."shop_competitor_overlay"("p_shop_name" "text", "p_radius_miles" numeric, "p_limit" integer) TO "authenticated";
GRANT ALL ON FUNCTION "public"."shop_competitor_overlay"("p_shop_name" "text", "p_radius_miles" numeric, "p_limit" integer) TO "service_role";



GRANT ALL ON FUNCTION "public"."shop_competitor_overlay_by_place_id"("p_place_id" "text", "p_radius_miles" numeric, "p_limit" integer) TO "anon";
GRANT ALL ON FUNCTION "public"."shop_competitor_overlay_by_place_id"("p_place_id" "text", "p_radius_miles" numeric, "p_limit" integer) TO "authenticated";
GRANT ALL ON FUNCTION "public"."shop_competitor_overlay_by_place_id"("p_place_id" "text", "p_radius_miles" numeric, "p_limit" integer) TO "service_role";



GRANT ALL ON FUNCTION "public"."shop_detail"("p_shop_name" "text", "start_date" "date", "end_date" "date") TO "anon";
GRANT ALL ON FUNCTION "public"."shop_detail"("p_shop_name" "text", "start_date" "date", "end_date" "date") TO "authenticated";
GRANT ALL ON FUNCTION "public"."shop_detail"("p_shop_name" "text", "start_date" "date", "end_date" "date") TO "service_role";



GRANT ALL ON FUNCTION "public"."shop_list"("start_date" "date", "end_date" "date") TO "anon";
GRANT ALL ON FUNCTION "public"."shop_list"("start_date" "date", "end_date" "date") TO "authenticated";
GRANT ALL ON FUNCTION "public"."shop_list"("start_date" "date", "end_date" "date") TO "service_role";



GRANT ALL ON FUNCTION "public"."shop_trend"("shop_name" "text") TO "anon";
GRANT ALL ON FUNCTION "public"."shop_trend"("shop_name" "text") TO "authenticated";
GRANT ALL ON FUNCTION "public"."shop_trend"("shop_name" "text") TO "service_role";



GRANT ALL ON FUNCTION "public"."show_limit"() TO "postgres";
GRANT ALL ON FUNCTION "public"."show_limit"() TO "anon";
GRANT ALL ON FUNCTION "public"."show_limit"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."show_limit"() TO "service_role";



GRANT ALL ON FUNCTION "public"."show_trgm"("text") TO "postgres";
GRANT ALL ON FUNCTION "public"."show_trgm"("text") TO "anon";
GRANT ALL ON FUNCTION "public"."show_trgm"("text") TO "authenticated";
GRANT ALL ON FUNCTION "public"."show_trgm"("text") TO "service_role";



GRANT ALL ON FUNCTION "public"."similarity"("text", "text") TO "postgres";
GRANT ALL ON FUNCTION "public"."similarity"("text", "text") TO "anon";
GRANT ALL ON FUNCTION "public"."similarity"("text", "text") TO "authenticated";
GRANT ALL ON FUNCTION "public"."similarity"("text", "text") TO "service_role";



GRANT ALL ON FUNCTION "public"."similarity_dist"("text", "text") TO "postgres";
GRANT ALL ON FUNCTION "public"."similarity_dist"("text", "text") TO "anon";
GRANT ALL ON FUNCTION "public"."similarity_dist"("text", "text") TO "authenticated";
GRANT ALL ON FUNCTION "public"."similarity_dist"("text", "text") TO "service_role";



GRANT ALL ON FUNCTION "public"."similarity_op"("text", "text") TO "postgres";
GRANT ALL ON FUNCTION "public"."similarity_op"("text", "text") TO "anon";
GRANT ALL ON FUNCTION "public"."similarity_op"("text", "text") TO "authenticated";
GRANT ALL ON FUNCTION "public"."similarity_op"("text", "text") TO "service_role";



GRANT ALL ON FUNCTION "public"."st_3dclosestpoint"("geom1" "public"."geometry", "geom2" "public"."geometry") TO "postgres";
GRANT ALL ON FUNCTION "public"."st_3dclosestpoint"("geom1" "public"."geometry", "geom2" "public"."geometry") TO "anon";
GRANT ALL ON FUNCTION "public"."st_3dclosestpoint"("geom1" "public"."geometry", "geom2" "public"."geometry") TO "authenticated";
GRANT ALL ON FUNCTION "public"."st_3dclosestpoint"("geom1" "public"."geometry", "geom2" "public"."geometry") TO "service_role";



GRANT ALL ON FUNCTION "public"."st_3ddfullywithin"("geom1" "public"."geometry", "geom2" "public"."geometry", double precision) TO "postgres";
GRANT ALL ON FUNCTION "public"."st_3ddfullywithin"("geom1" "public"."geometry", "geom2" "public"."geometry", double precision) TO "anon";
GRANT ALL ON FUNCTION "public"."st_3ddfullywithin"("geom1" "public"."geometry", "geom2" "public"."geometry", double precision) TO "authenticated";
GRANT ALL ON FUNCTION "public"."st_3ddfullywithin"("geom1" "public"."geometry", "geom2" "public"."geometry", double precision) TO "service_role";



GRANT ALL ON FUNCTION "public"."st_3ddistance"("geom1" "public"."geometry", "geom2" "public"."geometry") TO "postgres";
GRANT ALL ON FUNCTION "public"."st_3ddistance"("geom1" "public"."geometry", "geom2" "public"."geometry") TO "anon";
GRANT ALL ON FUNCTION "public"."st_3ddistance"("geom1" "public"."geometry", "geom2" "public"."geometry") TO "authenticated";
GRANT ALL ON FUNCTION "public"."st_3ddistance"("geom1" "public"."geometry", "geom2" "public"."geometry") TO "service_role";



GRANT ALL ON FUNCTION "public"."st_3ddwithin"("geom1" "public"."geometry", "geom2" "public"."geometry", double precision) TO "postgres";
GRANT ALL ON FUNCTION "public"."st_3ddwithin"("geom1" "public"."geometry", "geom2" "public"."geometry", double precision) TO "anon";
GRANT ALL ON FUNCTION "public"."st_3ddwithin"("geom1" "public"."geometry", "geom2" "public"."geometry", double precision) TO "authenticated";
GRANT ALL ON FUNCTION "public"."st_3ddwithin"("geom1" "public"."geometry", "geom2" "public"."geometry", double precision) TO "service_role";



GRANT ALL ON FUNCTION "public"."st_3dintersects"("geom1" "public"."geometry", "geom2" "public"."geometry") TO "postgres";
GRANT ALL ON FUNCTION "public"."st_3dintersects"("geom1" "public"."geometry", "geom2" "public"."geometry") TO "anon";
GRANT ALL ON FUNCTION "public"."st_3dintersects"("geom1" "public"."geometry", "geom2" "public"."geometry") TO "authenticated";
GRANT ALL ON FUNCTION "public"."st_3dintersects"("geom1" "public"."geometry", "geom2" "public"."geometry") TO "service_role";



GRANT ALL ON FUNCTION "public"."st_3dlength"("public"."geometry") TO "postgres";
GRANT ALL ON FUNCTION "public"."st_3dlength"("public"."geometry") TO "anon";
GRANT ALL ON FUNCTION "public"."st_3dlength"("public"."geometry") TO "authenticated";
GRANT ALL ON FUNCTION "public"."st_3dlength"("public"."geometry") TO "service_role";



GRANT ALL ON FUNCTION "public"."st_3dlineinterpolatepoint"("public"."geometry", double precision) TO "postgres";
GRANT ALL ON FUNCTION "public"."st_3dlineinterpolatepoint"("public"."geometry", double precision) TO "anon";
GRANT ALL ON FUNCTION "public"."st_3dlineinterpolatepoint"("public"."geometry", double precision) TO "authenticated";
GRANT ALL ON FUNCTION "public"."st_3dlineinterpolatepoint"("public"."geometry", double precision) TO "service_role";



GRANT ALL ON FUNCTION "public"."st_3dlongestline"("geom1" "public"."geometry", "geom2" "public"."geometry") TO "postgres";
GRANT ALL ON FUNCTION "public"."st_3dlongestline"("geom1" "public"."geometry", "geom2" "public"."geometry") TO "anon";
GRANT ALL ON FUNCTION "public"."st_3dlongestline"("geom1" "public"."geometry", "geom2" "public"."geometry") TO "authenticated";
GRANT ALL ON FUNCTION "public"."st_3dlongestline"("geom1" "public"."geometry", "geom2" "public"."geometry") TO "service_role";



GRANT ALL ON FUNCTION "public"."st_3dmakebox"("geom1" "public"."geometry", "geom2" "public"."geometry") TO "postgres";
GRANT ALL ON FUNCTION "public"."st_3dmakebox"("geom1" "public"."geometry", "geom2" "public"."geometry") TO "anon";
GRANT ALL ON FUNCTION "public"."st_3dmakebox"("geom1" "public"."geometry", "geom2" "public"."geometry") TO "authenticated";
GRANT ALL ON FUNCTION "public"."st_3dmakebox"("geom1" "public"."geometry", "geom2" "public"."geometry") TO "service_role";



GRANT ALL ON FUNCTION "public"."st_3dmaxdistance"("geom1" "public"."geometry", "geom2" "public"."geometry") TO "postgres";
GRANT ALL ON FUNCTION "public"."st_3dmaxdistance"("geom1" "public"."geometry", "geom2" "public"."geometry") TO "anon";
GRANT ALL ON FUNCTION "public"."st_3dmaxdistance"("geom1" "public"."geometry", "geom2" "public"."geometry") TO "authenticated";
GRANT ALL ON FUNCTION "public"."st_3dmaxdistance"("geom1" "public"."geometry", "geom2" "public"."geometry") TO "service_role";



GRANT ALL ON FUNCTION "public"."st_3dperimeter"("public"."geometry") TO "postgres";
GRANT ALL ON FUNCTION "public"."st_3dperimeter"("public"."geometry") TO "anon";
GRANT ALL ON FUNCTION "public"."st_3dperimeter"("public"."geometry") TO "authenticated";
GRANT ALL ON FUNCTION "public"."st_3dperimeter"("public"."geometry") TO "service_role";



GRANT ALL ON FUNCTION "public"."st_3dshortestline"("geom1" "public"."geometry", "geom2" "public"."geometry") TO "postgres";
GRANT ALL ON FUNCTION "public"."st_3dshortestline"("geom1" "public"."geometry", "geom2" "public"."geometry") TO "anon";
GRANT ALL ON FUNCTION "public"."st_3dshortestline"("geom1" "public"."geometry", "geom2" "public"."geometry") TO "authenticated";
GRANT ALL ON FUNCTION "public"."st_3dshortestline"("geom1" "public"."geometry", "geom2" "public"."geometry") TO "service_role";



GRANT ALL ON FUNCTION "public"."st_addmeasure"("public"."geometry", double precision, double precision) TO "postgres";
GRANT ALL ON FUNCTION "public"."st_addmeasure"("public"."geometry", double precision, double precision) TO "anon";
GRANT ALL ON FUNCTION "public"."st_addmeasure"("public"."geometry", double precision, double precision) TO "authenticated";
GRANT ALL ON FUNCTION "public"."st_addmeasure"("public"."geometry", double precision, double precision) TO "service_role";



GRANT ALL ON FUNCTION "public"."st_addpoint"("geom1" "public"."geometry", "geom2" "public"."geometry") TO "postgres";
GRANT ALL ON FUNCTION "public"."st_addpoint"("geom1" "public"."geometry", "geom2" "public"."geometry") TO "anon";
GRANT ALL ON FUNCTION "public"."st_addpoint"("geom1" "public"."geometry", "geom2" "public"."geometry") TO "authenticated";
GRANT ALL ON FUNCTION "public"."st_addpoint"("geom1" "public"."geometry", "geom2" "public"."geometry") TO "service_role";



GRANT ALL ON FUNCTION "public"."st_addpoint"("geom1" "public"."geometry", "geom2" "public"."geometry", integer) TO "postgres";
GRANT ALL ON FUNCTION "public"."st_addpoint"("geom1" "public"."geometry", "geom2" "public"."geometry", integer) TO "anon";
GRANT ALL ON FUNCTION "public"."st_addpoint"("geom1" "public"."geometry", "geom2" "public"."geometry", integer) TO "authenticated";
GRANT ALL ON FUNCTION "public"."st_addpoint"("geom1" "public"."geometry", "geom2" "public"."geometry", integer) TO "service_role";



GRANT ALL ON FUNCTION "public"."st_affine"("public"."geometry", double precision, double precision, double precision, double precision, double precision, double precision) TO "postgres";
GRANT ALL ON FUNCTION "public"."st_affine"("public"."geometry", double precision, double precision, double precision, double precision, double precision, double precision) TO "anon";
GRANT ALL ON FUNCTION "public"."st_affine"("public"."geometry", double precision, double precision, double precision, double precision, double precision, double precision) TO "authenticated";
GRANT ALL ON FUNCTION "public"."st_affine"("public"."geometry", double precision, double precision, double precision, double precision, double precision, double precision) TO "service_role";



GRANT ALL ON FUNCTION "public"."st_affine"("public"."geometry", double precision, double precision, double precision, double precision, double precision, double precision, double precision, double precision, double precision, double precision, double precision, double precision) TO "postgres";
GRANT ALL ON FUNCTION "public"."st_affine"("public"."geometry", double precision, double precision, double precision, double precision, double precision, double precision, double precision, double precision, double precision, double precision, double precision, double precision) TO "anon";
GRANT ALL ON FUNCTION "public"."st_affine"("public"."geometry", double precision, double precision, double precision, double precision, double precision, double precision, double precision, double precision, double precision, double precision, double precision, double precision) TO "authenticated";
GRANT ALL ON FUNCTION "public"."st_affine"("public"."geometry", double precision, double precision, double precision, double precision, double precision, double precision, double precision, double precision, double precision, double precision, double precision, double precision) TO "service_role";



GRANT ALL ON FUNCTION "public"."st_angle"("line1" "public"."geometry", "line2" "public"."geometry") TO "postgres";
GRANT ALL ON FUNCTION "public"."st_angle"("line1" "public"."geometry", "line2" "public"."geometry") TO "anon";
GRANT ALL ON FUNCTION "public"."st_angle"("line1" "public"."geometry", "line2" "public"."geometry") TO "authenticated";
GRANT ALL ON FUNCTION "public"."st_angle"("line1" "public"."geometry", "line2" "public"."geometry") TO "service_role";



GRANT ALL ON FUNCTION "public"."st_angle"("pt1" "public"."geometry", "pt2" "public"."geometry", "pt3" "public"."geometry", "pt4" "public"."geometry") TO "postgres";
GRANT ALL ON FUNCTION "public"."st_angle"("pt1" "public"."geometry", "pt2" "public"."geometry", "pt3" "public"."geometry", "pt4" "public"."geometry") TO "anon";
GRANT ALL ON FUNCTION "public"."st_angle"("pt1" "public"."geometry", "pt2" "public"."geometry", "pt3" "public"."geometry", "pt4" "public"."geometry") TO "authenticated";
GRANT ALL ON FUNCTION "public"."st_angle"("pt1" "public"."geometry", "pt2" "public"."geometry", "pt3" "public"."geometry", "pt4" "public"."geometry") TO "service_role";



GRANT ALL ON FUNCTION "public"."st_area"("text") TO "postgres";
GRANT ALL ON FUNCTION "public"."st_area"("text") TO "anon";
GRANT ALL ON FUNCTION "public"."st_area"("text") TO "authenticated";
GRANT ALL ON FUNCTION "public"."st_area"("text") TO "service_role";



GRANT ALL ON FUNCTION "public"."st_area"("public"."geometry") TO "postgres";
GRANT ALL ON FUNCTION "public"."st_area"("public"."geometry") TO "anon";
GRANT ALL ON FUNCTION "public"."st_area"("public"."geometry") TO "authenticated";
GRANT ALL ON FUNCTION "public"."st_area"("public"."geometry") TO "service_role";



GRANT ALL ON FUNCTION "public"."st_area"("geog" "public"."geography", "use_spheroid" boolean) TO "postgres";
GRANT ALL ON FUNCTION "public"."st_area"("geog" "public"."geography", "use_spheroid" boolean) TO "anon";
GRANT ALL ON FUNCTION "public"."st_area"("geog" "public"."geography", "use_spheroid" boolean) TO "authenticated";
GRANT ALL ON FUNCTION "public"."st_area"("geog" "public"."geography", "use_spheroid" boolean) TO "service_role";



GRANT ALL ON FUNCTION "public"."st_area2d"("public"."geometry") TO "postgres";
GRANT ALL ON FUNCTION "public"."st_area2d"("public"."geometry") TO "anon";
GRANT ALL ON FUNCTION "public"."st_area2d"("public"."geometry") TO "authenticated";
GRANT ALL ON FUNCTION "public"."st_area2d"("public"."geometry") TO "service_role";



GRANT ALL ON FUNCTION "public"."st_asbinary"("public"."geography") TO "postgres";
GRANT ALL ON FUNCTION "public"."st_asbinary"("public"."geography") TO "anon";
GRANT ALL ON FUNCTION "public"."st_asbinary"("public"."geography") TO "authenticated";
GRANT ALL ON FUNCTION "public"."st_asbinary"("public"."geography") TO "service_role";



GRANT ALL ON FUNCTION "public"."st_asbinary"("public"."geometry") TO "postgres";
GRANT ALL ON FUNCTION "public"."st_asbinary"("public"."geometry") TO "anon";
GRANT ALL ON FUNCTION "public"."st_asbinary"("public"."geometry") TO "authenticated";
GRANT ALL ON FUNCTION "public"."st_asbinary"("public"."geometry") TO "service_role";



GRANT ALL ON FUNCTION "public"."st_asbinary"("public"."geography", "text") TO "postgres";
GRANT ALL ON FUNCTION "public"."st_asbinary"("public"."geography", "text") TO "anon";
GRANT ALL ON FUNCTION "public"."st_asbinary"("public"."geography", "text") TO "authenticated";
GRANT ALL ON FUNCTION "public"."st_asbinary"("public"."geography", "text") TO "service_role";



GRANT ALL ON FUNCTION "public"."st_asbinary"("public"."geometry", "text") TO "postgres";
GRANT ALL ON FUNCTION "public"."st_asbinary"("public"."geometry", "text") TO "anon";
GRANT ALL ON FUNCTION "public"."st_asbinary"("public"."geometry", "text") TO "authenticated";
GRANT ALL ON FUNCTION "public"."st_asbinary"("public"."geometry", "text") TO "service_role";



GRANT ALL ON FUNCTION "public"."st_asencodedpolyline"("geom" "public"."geometry", "nprecision" integer) TO "postgres";
GRANT ALL ON FUNCTION "public"."st_asencodedpolyline"("geom" "public"."geometry", "nprecision" integer) TO "anon";
GRANT ALL ON FUNCTION "public"."st_asencodedpolyline"("geom" "public"."geometry", "nprecision" integer) TO "authenticated";
GRANT ALL ON FUNCTION "public"."st_asencodedpolyline"("geom" "public"."geometry", "nprecision" integer) TO "service_role";



GRANT ALL ON FUNCTION "public"."st_asewkb"("public"."geometry") TO "postgres";
GRANT ALL ON FUNCTION "public"."st_asewkb"("public"."geometry") TO "anon";
GRANT ALL ON FUNCTION "public"."st_asewkb"("public"."geometry") TO "authenticated";
GRANT ALL ON FUNCTION "public"."st_asewkb"("public"."geometry") TO "service_role";



GRANT ALL ON FUNCTION "public"."st_asewkb"("public"."geometry", "text") TO "postgres";
GRANT ALL ON FUNCTION "public"."st_asewkb"("public"."geometry", "text") TO "anon";
GRANT ALL ON FUNCTION "public"."st_asewkb"("public"."geometry", "text") TO "authenticated";
GRANT ALL ON FUNCTION "public"."st_asewkb"("public"."geometry", "text") TO "service_role";



GRANT ALL ON FUNCTION "public"."st_asewkt"("text") TO "postgres";
GRANT ALL ON FUNCTION "public"."st_asewkt"("text") TO "anon";
GRANT ALL ON FUNCTION "public"."st_asewkt"("text") TO "authenticated";
GRANT ALL ON FUNCTION "public"."st_asewkt"("text") TO "service_role";



GRANT ALL ON FUNCTION "public"."st_asewkt"("public"."geography") TO "postgres";
GRANT ALL ON FUNCTION "public"."st_asewkt"("public"."geography") TO "anon";
GRANT ALL ON FUNCTION "public"."st_asewkt"("public"."geography") TO "authenticated";
GRANT ALL ON FUNCTION "public"."st_asewkt"("public"."geography") TO "service_role";



GRANT ALL ON FUNCTION "public"."st_asewkt"("public"."geometry") TO "postgres";
GRANT ALL ON FUNCTION "public"."st_asewkt"("public"."geometry") TO "anon";
GRANT ALL ON FUNCTION "public"."st_asewkt"("public"."geometry") TO "authenticated";
GRANT ALL ON FUNCTION "public"."st_asewkt"("public"."geometry") TO "service_role";



GRANT ALL ON FUNCTION "public"."st_asewkt"("public"."geography", integer) TO "postgres";
GRANT ALL ON FUNCTION "public"."st_asewkt"("public"."geography", integer) TO "anon";
GRANT ALL ON FUNCTION "public"."st_asewkt"("public"."geography", integer) TO "authenticated";
GRANT ALL ON FUNCTION "public"."st_asewkt"("public"."geography", integer) TO "service_role";



GRANT ALL ON FUNCTION "public"."st_asewkt"("public"."geometry", integer) TO "postgres";
GRANT ALL ON FUNCTION "public"."st_asewkt"("public"."geometry", integer) TO "anon";
GRANT ALL ON FUNCTION "public"."st_asewkt"("public"."geometry", integer) TO "authenticated";
GRANT ALL ON FUNCTION "public"."st_asewkt"("public"."geometry", integer) TO "service_role";



GRANT ALL ON FUNCTION "public"."st_asgeojson"("text") TO "postgres";
GRANT ALL ON FUNCTION "public"."st_asgeojson"("text") TO "anon";
GRANT ALL ON FUNCTION "public"."st_asgeojson"("text") TO "authenticated";
GRANT ALL ON FUNCTION "public"."st_asgeojson"("text") TO "service_role";



GRANT ALL ON FUNCTION "public"."st_asgeojson"("geog" "public"."geography", "maxdecimaldigits" integer, "options" integer) TO "postgres";
GRANT ALL ON FUNCTION "public"."st_asgeojson"("geog" "public"."geography", "maxdecimaldigits" integer, "options" integer) TO "anon";
GRANT ALL ON FUNCTION "public"."st_asgeojson"("geog" "public"."geography", "maxdecimaldigits" integer, "options" integer) TO "authenticated";
GRANT ALL ON FUNCTION "public"."st_asgeojson"("geog" "public"."geography", "maxdecimaldigits" integer, "options" integer) TO "service_role";



GRANT ALL ON FUNCTION "public"."st_asgeojson"("geom" "public"."geometry", "maxdecimaldigits" integer, "options" integer) TO "postgres";
GRANT ALL ON FUNCTION "public"."st_asgeojson"("geom" "public"."geometry", "maxdecimaldigits" integer, "options" integer) TO "anon";
GRANT ALL ON FUNCTION "public"."st_asgeojson"("geom" "public"."geometry", "maxdecimaldigits" integer, "options" integer) TO "authenticated";
GRANT ALL ON FUNCTION "public"."st_asgeojson"("geom" "public"."geometry", "maxdecimaldigits" integer, "options" integer) TO "service_role";



GRANT ALL ON FUNCTION "public"."st_asgeojson"("r" "record", "geom_column" "text", "maxdecimaldigits" integer, "pretty_bool" boolean) TO "postgres";
GRANT ALL ON FUNCTION "public"."st_asgeojson"("r" "record", "geom_column" "text", "maxdecimaldigits" integer, "pretty_bool" boolean) TO "anon";
GRANT ALL ON FUNCTION "public"."st_asgeojson"("r" "record", "geom_column" "text", "maxdecimaldigits" integer, "pretty_bool" boolean) TO "authenticated";
GRANT ALL ON FUNCTION "public"."st_asgeojson"("r" "record", "geom_column" "text", "maxdecimaldigits" integer, "pretty_bool" boolean) TO "service_role";



GRANT ALL ON FUNCTION "public"."st_asgml"("text") TO "postgres";
GRANT ALL ON FUNCTION "public"."st_asgml"("text") TO "anon";
GRANT ALL ON FUNCTION "public"."st_asgml"("text") TO "authenticated";
GRANT ALL ON FUNCTION "public"."st_asgml"("text") TO "service_role";



GRANT ALL ON FUNCTION "public"."st_asgml"("geom" "public"."geometry", "maxdecimaldigits" integer, "options" integer) TO "postgres";
GRANT ALL ON FUNCTION "public"."st_asgml"("geom" "public"."geometry", "maxdecimaldigits" integer, "options" integer) TO "anon";
GRANT ALL ON FUNCTION "public"."st_asgml"("geom" "public"."geometry", "maxdecimaldigits" integer, "options" integer) TO "authenticated";
GRANT ALL ON FUNCTION "public"."st_asgml"("geom" "public"."geometry", "maxdecimaldigits" integer, "options" integer) TO "service_role";



GRANT ALL ON FUNCTION "public"."st_asgml"("geog" "public"."geography", "maxdecimaldigits" integer, "options" integer, "nprefix" "text", "id" "text") TO "postgres";
GRANT ALL ON FUNCTION "public"."st_asgml"("geog" "public"."geography", "maxdecimaldigits" integer, "options" integer, "nprefix" "text", "id" "text") TO "anon";
GRANT ALL ON FUNCTION "public"."st_asgml"("geog" "public"."geography", "maxdecimaldigits" integer, "options" integer, "nprefix" "text", "id" "text") TO "authenticated";
GRANT ALL ON FUNCTION "public"."st_asgml"("geog" "public"."geography", "maxdecimaldigits" integer, "options" integer, "nprefix" "text", "id" "text") TO "service_role";



GRANT ALL ON FUNCTION "public"."st_asgml"("version" integer, "geog" "public"."geography", "maxdecimaldigits" integer, "options" integer, "nprefix" "text", "id" "text") TO "postgres";
GRANT ALL ON FUNCTION "public"."st_asgml"("version" integer, "geog" "public"."geography", "maxdecimaldigits" integer, "options" integer, "nprefix" "text", "id" "text") TO "anon";
GRANT ALL ON FUNCTION "public"."st_asgml"("version" integer, "geog" "public"."geography", "maxdecimaldigits" integer, "options" integer, "nprefix" "text", "id" "text") TO "authenticated";
GRANT ALL ON FUNCTION "public"."st_asgml"("version" integer, "geog" "public"."geography", "maxdecimaldigits" integer, "options" integer, "nprefix" "text", "id" "text") TO "service_role";



GRANT ALL ON FUNCTION "public"."st_asgml"("version" integer, "geom" "public"."geometry", "maxdecimaldigits" integer, "options" integer, "nprefix" "text", "id" "text") TO "postgres";
GRANT ALL ON FUNCTION "public"."st_asgml"("version" integer, "geom" "public"."geometry", "maxdecimaldigits" integer, "options" integer, "nprefix" "text", "id" "text") TO "anon";
GRANT ALL ON FUNCTION "public"."st_asgml"("version" integer, "geom" "public"."geometry", "maxdecimaldigits" integer, "options" integer, "nprefix" "text", "id" "text") TO "authenticated";
GRANT ALL ON FUNCTION "public"."st_asgml"("version" integer, "geom" "public"."geometry", "maxdecimaldigits" integer, "options" integer, "nprefix" "text", "id" "text") TO "service_role";



GRANT ALL ON FUNCTION "public"."st_ashexewkb"("public"."geometry") TO "postgres";
GRANT ALL ON FUNCTION "public"."st_ashexewkb"("public"."geometry") TO "anon";
GRANT ALL ON FUNCTION "public"."st_ashexewkb"("public"."geometry") TO "authenticated";
GRANT ALL ON FUNCTION "public"."st_ashexewkb"("public"."geometry") TO "service_role";



GRANT ALL ON FUNCTION "public"."st_ashexewkb"("public"."geometry", "text") TO "postgres";
GRANT ALL ON FUNCTION "public"."st_ashexewkb"("public"."geometry", "text") TO "anon";
GRANT ALL ON FUNCTION "public"."st_ashexewkb"("public"."geometry", "text") TO "authenticated";
GRANT ALL ON FUNCTION "public"."st_ashexewkb"("public"."geometry", "text") TO "service_role";



GRANT ALL ON FUNCTION "public"."st_askml"("text") TO "postgres";
GRANT ALL ON FUNCTION "public"."st_askml"("text") TO "anon";
GRANT ALL ON FUNCTION "public"."st_askml"("text") TO "authenticated";
GRANT ALL ON FUNCTION "public"."st_askml"("text") TO "service_role";



GRANT ALL ON FUNCTION "public"."st_askml"("geog" "public"."geography", "maxdecimaldigits" integer, "nprefix" "text") TO "postgres";
GRANT ALL ON FUNCTION "public"."st_askml"("geog" "public"."geography", "maxdecimaldigits" integer, "nprefix" "text") TO "anon";
GRANT ALL ON FUNCTION "public"."st_askml"("geog" "public"."geography", "maxdecimaldigits" integer, "nprefix" "text") TO "authenticated";
GRANT ALL ON FUNCTION "public"."st_askml"("geog" "public"."geography", "maxdecimaldigits" integer, "nprefix" "text") TO "service_role";



GRANT ALL ON FUNCTION "public"."st_askml"("geom" "public"."geometry", "maxdecimaldigits" integer, "nprefix" "text") TO "postgres";
GRANT ALL ON FUNCTION "public"."st_askml"("geom" "public"."geometry", "maxdecimaldigits" integer, "nprefix" "text") TO "anon";
GRANT ALL ON FUNCTION "public"."st_askml"("geom" "public"."geometry", "maxdecimaldigits" integer, "nprefix" "text") TO "authenticated";
GRANT ALL ON FUNCTION "public"."st_askml"("geom" "public"."geometry", "maxdecimaldigits" integer, "nprefix" "text") TO "service_role";



GRANT ALL ON FUNCTION "public"."st_aslatlontext"("geom" "public"."geometry", "tmpl" "text") TO "postgres";
GRANT ALL ON FUNCTION "public"."st_aslatlontext"("geom" "public"."geometry", "tmpl" "text") TO "anon";
GRANT ALL ON FUNCTION "public"."st_aslatlontext"("geom" "public"."geometry", "tmpl" "text") TO "authenticated";
GRANT ALL ON FUNCTION "public"."st_aslatlontext"("geom" "public"."geometry", "tmpl" "text") TO "service_role";



GRANT ALL ON FUNCTION "public"."st_asmarc21"("geom" "public"."geometry", "format" "text") TO "postgres";
GRANT ALL ON FUNCTION "public"."st_asmarc21"("geom" "public"."geometry", "format" "text") TO "anon";
GRANT ALL ON FUNCTION "public"."st_asmarc21"("geom" "public"."geometry", "format" "text") TO "authenticated";
GRANT ALL ON FUNCTION "public"."st_asmarc21"("geom" "public"."geometry", "format" "text") TO "service_role";



GRANT ALL ON FUNCTION "public"."st_asmvtgeom"("geom" "public"."geometry", "bounds" "public"."box2d", "extent" integer, "buffer" integer, "clip_geom" boolean) TO "postgres";
GRANT ALL ON FUNCTION "public"."st_asmvtgeom"("geom" "public"."geometry", "bounds" "public"."box2d", "extent" integer, "buffer" integer, "clip_geom" boolean) TO "anon";
GRANT ALL ON FUNCTION "public"."st_asmvtgeom"("geom" "public"."geometry", "bounds" "public"."box2d", "extent" integer, "buffer" integer, "clip_geom" boolean) TO "authenticated";
GRANT ALL ON FUNCTION "public"."st_asmvtgeom"("geom" "public"."geometry", "bounds" "public"."box2d", "extent" integer, "buffer" integer, "clip_geom" boolean) TO "service_role";



GRANT ALL ON FUNCTION "public"."st_assvg"("text") TO "postgres";
GRANT ALL ON FUNCTION "public"."st_assvg"("text") TO "anon";
GRANT ALL ON FUNCTION "public"."st_assvg"("text") TO "authenticated";
GRANT ALL ON FUNCTION "public"."st_assvg"("text") TO "service_role";



GRANT ALL ON FUNCTION "public"."st_assvg"("geog" "public"."geography", "rel" integer, "maxdecimaldigits" integer) TO "postgres";
GRANT ALL ON FUNCTION "public"."st_assvg"("geog" "public"."geography", "rel" integer, "maxdecimaldigits" integer) TO "anon";
GRANT ALL ON FUNCTION "public"."st_assvg"("geog" "public"."geography", "rel" integer, "maxdecimaldigits" integer) TO "authenticated";
GRANT ALL ON FUNCTION "public"."st_assvg"("geog" "public"."geography", "rel" integer, "maxdecimaldigits" integer) TO "service_role";



GRANT ALL ON FUNCTION "public"."st_assvg"("geom" "public"."geometry", "rel" integer, "maxdecimaldigits" integer) TO "postgres";
GRANT ALL ON FUNCTION "public"."st_assvg"("geom" "public"."geometry", "rel" integer, "maxdecimaldigits" integer) TO "anon";
GRANT ALL ON FUNCTION "public"."st_assvg"("geom" "public"."geometry", "rel" integer, "maxdecimaldigits" integer) TO "authenticated";
GRANT ALL ON FUNCTION "public"."st_assvg"("geom" "public"."geometry", "rel" integer, "maxdecimaldigits" integer) TO "service_role";



GRANT ALL ON FUNCTION "public"."st_astext"("text") TO "postgres";
GRANT ALL ON FUNCTION "public"."st_astext"("text") TO "anon";
GRANT ALL ON FUNCTION "public"."st_astext"("text") TO "authenticated";
GRANT ALL ON FUNCTION "public"."st_astext"("text") TO "service_role";



GRANT ALL ON FUNCTION "public"."st_astext"("public"."geography") TO "postgres";
GRANT ALL ON FUNCTION "public"."st_astext"("public"."geography") TO "anon";
GRANT ALL ON FUNCTION "public"."st_astext"("public"."geography") TO "authenticated";
GRANT ALL ON FUNCTION "public"."st_astext"("public"."geography") TO "service_role";



GRANT ALL ON FUNCTION "public"."st_astext"("public"."geometry") TO "postgres";
GRANT ALL ON FUNCTION "public"."st_astext"("public"."geometry") TO "anon";
GRANT ALL ON FUNCTION "public"."st_astext"("public"."geometry") TO "authenticated";
GRANT ALL ON FUNCTION "public"."st_astext"("public"."geometry") TO "service_role";



GRANT ALL ON FUNCTION "public"."st_astext"("public"."geography", integer) TO "postgres";
GRANT ALL ON FUNCTION "public"."st_astext"("public"."geography", integer) TO "anon";
GRANT ALL ON FUNCTION "public"."st_astext"("public"."geography", integer) TO "authenticated";
GRANT ALL ON FUNCTION "public"."st_astext"("public"."geography", integer) TO "service_role";



GRANT ALL ON FUNCTION "public"."st_astext"("public"."geometry", integer) TO "postgres";
GRANT ALL ON FUNCTION "public"."st_astext"("public"."geometry", integer) TO "anon";
GRANT ALL ON FUNCTION "public"."st_astext"("public"."geometry", integer) TO "authenticated";
GRANT ALL ON FUNCTION "public"."st_astext"("public"."geometry", integer) TO "service_role";



GRANT ALL ON FUNCTION "public"."st_astwkb"("geom" "public"."geometry", "prec" integer, "prec_z" integer, "prec_m" integer, "with_sizes" boolean, "with_boxes" boolean) TO "postgres";
GRANT ALL ON FUNCTION "public"."st_astwkb"("geom" "public"."geometry", "prec" integer, "prec_z" integer, "prec_m" integer, "with_sizes" boolean, "with_boxes" boolean) TO "anon";
GRANT ALL ON FUNCTION "public"."st_astwkb"("geom" "public"."geometry", "prec" integer, "prec_z" integer, "prec_m" integer, "with_sizes" boolean, "with_boxes" boolean) TO "authenticated";
GRANT ALL ON FUNCTION "public"."st_astwkb"("geom" "public"."geometry", "prec" integer, "prec_z" integer, "prec_m" integer, "with_sizes" boolean, "with_boxes" boolean) TO "service_role";



GRANT ALL ON FUNCTION "public"."st_astwkb"("geom" "public"."geometry"[], "ids" bigint[], "prec" integer, "prec_z" integer, "prec_m" integer, "with_sizes" boolean, "with_boxes" boolean) TO "postgres";
GRANT ALL ON FUNCTION "public"."st_astwkb"("geom" "public"."geometry"[], "ids" bigint[], "prec" integer, "prec_z" integer, "prec_m" integer, "with_sizes" boolean, "with_boxes" boolean) TO "anon";
GRANT ALL ON FUNCTION "public"."st_astwkb"("geom" "public"."geometry"[], "ids" bigint[], "prec" integer, "prec_z" integer, "prec_m" integer, "with_sizes" boolean, "with_boxes" boolean) TO "authenticated";
GRANT ALL ON FUNCTION "public"."st_astwkb"("geom" "public"."geometry"[], "ids" bigint[], "prec" integer, "prec_z" integer, "prec_m" integer, "with_sizes" boolean, "with_boxes" boolean) TO "service_role";



GRANT ALL ON FUNCTION "public"."st_asx3d"("geom" "public"."geometry", "maxdecimaldigits" integer, "options" integer) TO "postgres";
GRANT ALL ON FUNCTION "public"."st_asx3d"("geom" "public"."geometry", "maxdecimaldigits" integer, "options" integer) TO "anon";
GRANT ALL ON FUNCTION "public"."st_asx3d"("geom" "public"."geometry", "maxdecimaldigits" integer, "options" integer) TO "authenticated";
GRANT ALL ON FUNCTION "public"."st_asx3d"("geom" "public"."geometry", "maxdecimaldigits" integer, "options" integer) TO "service_role";



GRANT ALL ON FUNCTION "public"."st_azimuth"("geog1" "public"."geography", "geog2" "public"."geography") TO "postgres";
GRANT ALL ON FUNCTION "public"."st_azimuth"("geog1" "public"."geography", "geog2" "public"."geography") TO "anon";
GRANT ALL ON FUNCTION "public"."st_azimuth"("geog1" "public"."geography", "geog2" "public"."geography") TO "authenticated";
GRANT ALL ON FUNCTION "public"."st_azimuth"("geog1" "public"."geography", "geog2" "public"."geography") TO "service_role";



GRANT ALL ON FUNCTION "public"."st_azimuth"("geom1" "public"."geometry", "geom2" "public"."geometry") TO "postgres";
GRANT ALL ON FUNCTION "public"."st_azimuth"("geom1" "public"."geometry", "geom2" "public"."geometry") TO "anon";
GRANT ALL ON FUNCTION "public"."st_azimuth"("geom1" "public"."geometry", "geom2" "public"."geometry") TO "authenticated";
GRANT ALL ON FUNCTION "public"."st_azimuth"("geom1" "public"."geometry", "geom2" "public"."geometry") TO "service_role";



GRANT ALL ON FUNCTION "public"."st_bdmpolyfromtext"("text", integer) TO "postgres";
GRANT ALL ON FUNCTION "public"."st_bdmpolyfromtext"("text", integer) TO "anon";
GRANT ALL ON FUNCTION "public"."st_bdmpolyfromtext"("text", integer) TO "authenticated";
GRANT ALL ON FUNCTION "public"."st_bdmpolyfromtext"("text", integer) TO "service_role";



GRANT ALL ON FUNCTION "public"."st_bdpolyfromtext"("text", integer) TO "postgres";
GRANT ALL ON FUNCTION "public"."st_bdpolyfromtext"("text", integer) TO "anon";
GRANT ALL ON FUNCTION "public"."st_bdpolyfromtext"("text", integer) TO "authenticated";
GRANT ALL ON FUNCTION "public"."st_bdpolyfromtext"("text", integer) TO "service_role";



GRANT ALL ON FUNCTION "public"."st_boundary"("public"."geometry") TO "postgres";
GRANT ALL ON FUNCTION "public"."st_boundary"("public"."geometry") TO "anon";
GRANT ALL ON FUNCTION "public"."st_boundary"("public"."geometry") TO "authenticated";
GRANT ALL ON FUNCTION "public"."st_boundary"("public"."geometry") TO "service_role";



GRANT ALL ON FUNCTION "public"."st_boundingdiagonal"("geom" "public"."geometry", "fits" boolean) TO "postgres";
GRANT ALL ON FUNCTION "public"."st_boundingdiagonal"("geom" "public"."geometry", "fits" boolean) TO "anon";
GRANT ALL ON FUNCTION "public"."st_boundingdiagonal"("geom" "public"."geometry", "fits" boolean) TO "authenticated";
GRANT ALL ON FUNCTION "public"."st_boundingdiagonal"("geom" "public"."geometry", "fits" boolean) TO "service_role";



GRANT ALL ON FUNCTION "public"."st_box2dfromgeohash"("text", integer) TO "postgres";
GRANT ALL ON FUNCTION "public"."st_box2dfromgeohash"("text", integer) TO "anon";
GRANT ALL ON FUNCTION "public"."st_box2dfromgeohash"("text", integer) TO "authenticated";
GRANT ALL ON FUNCTION "public"."st_box2dfromgeohash"("text", integer) TO "service_role";



GRANT ALL ON FUNCTION "public"."st_buffer"("text", double precision) TO "postgres";
GRANT ALL ON FUNCTION "public"."st_buffer"("text", double precision) TO "anon";
GRANT ALL ON FUNCTION "public"."st_buffer"("text", double precision) TO "authenticated";
GRANT ALL ON FUNCTION "public"."st_buffer"("text", double precision) TO "service_role";



GRANT ALL ON FUNCTION "public"."st_buffer"("public"."geography", double precision) TO "postgres";
GRANT ALL ON FUNCTION "public"."st_buffer"("public"."geography", double precision) TO "anon";
GRANT ALL ON FUNCTION "public"."st_buffer"("public"."geography", double precision) TO "authenticated";
GRANT ALL ON FUNCTION "public"."st_buffer"("public"."geography", double precision) TO "service_role";



GRANT ALL ON FUNCTION "public"."st_buffer"("text", double precision, integer) TO "postgres";
GRANT ALL ON FUNCTION "public"."st_buffer"("text", double precision, integer) TO "anon";
GRANT ALL ON FUNCTION "public"."st_buffer"("text", double precision, integer) TO "authenticated";
GRANT ALL ON FUNCTION "public"."st_buffer"("text", double precision, integer) TO "service_role";



GRANT ALL ON FUNCTION "public"."st_buffer"("text", double precision, "text") TO "postgres";
GRANT ALL ON FUNCTION "public"."st_buffer"("text", double precision, "text") TO "anon";
GRANT ALL ON FUNCTION "public"."st_buffer"("text", double precision, "text") TO "authenticated";
GRANT ALL ON FUNCTION "public"."st_buffer"("text", double precision, "text") TO "service_role";



GRANT ALL ON FUNCTION "public"."st_buffer"("public"."geography", double precision, integer) TO "postgres";
GRANT ALL ON FUNCTION "public"."st_buffer"("public"."geography", double precision, integer) TO "anon";
GRANT ALL ON FUNCTION "public"."st_buffer"("public"."geography", double precision, integer) TO "authenticated";
GRANT ALL ON FUNCTION "public"."st_buffer"("public"."geography", double precision, integer) TO "service_role";



GRANT ALL ON FUNCTION "public"."st_buffer"("public"."geography", double precision, "text") TO "postgres";
GRANT ALL ON FUNCTION "public"."st_buffer"("public"."geography", double precision, "text") TO "anon";
GRANT ALL ON FUNCTION "public"."st_buffer"("public"."geography", double precision, "text") TO "authenticated";
GRANT ALL ON FUNCTION "public"."st_buffer"("public"."geography", double precision, "text") TO "service_role";



GRANT ALL ON FUNCTION "public"."st_buffer"("geom" "public"."geometry", "radius" double precision, "quadsegs" integer) TO "postgres";
GRANT ALL ON FUNCTION "public"."st_buffer"("geom" "public"."geometry", "radius" double precision, "quadsegs" integer) TO "anon";
GRANT ALL ON FUNCTION "public"."st_buffer"("geom" "public"."geometry", "radius" double precision, "quadsegs" integer) TO "authenticated";
GRANT ALL ON FUNCTION "public"."st_buffer"("geom" "public"."geometry", "radius" double precision, "quadsegs" integer) TO "service_role";



GRANT ALL ON FUNCTION "public"."st_buffer"("geom" "public"."geometry", "radius" double precision, "options" "text") TO "postgres";
GRANT ALL ON FUNCTION "public"."st_buffer"("geom" "public"."geometry", "radius" double precision, "options" "text") TO "anon";
GRANT ALL ON FUNCTION "public"."st_buffer"("geom" "public"."geometry", "radius" double precision, "options" "text") TO "authenticated";
GRANT ALL ON FUNCTION "public"."st_buffer"("geom" "public"."geometry", "radius" double precision, "options" "text") TO "service_role";



GRANT ALL ON FUNCTION "public"."st_buildarea"("public"."geometry") TO "postgres";
GRANT ALL ON FUNCTION "public"."st_buildarea"("public"."geometry") TO "anon";
GRANT ALL ON FUNCTION "public"."st_buildarea"("public"."geometry") TO "authenticated";
GRANT ALL ON FUNCTION "public"."st_buildarea"("public"."geometry") TO "service_role";



GRANT ALL ON FUNCTION "public"."st_centroid"("text") TO "postgres";
GRANT ALL ON FUNCTION "public"."st_centroid"("text") TO "anon";
GRANT ALL ON FUNCTION "public"."st_centroid"("text") TO "authenticated";
GRANT ALL ON FUNCTION "public"."st_centroid"("text") TO "service_role";



GRANT ALL ON FUNCTION "public"."st_centroid"("public"."geometry") TO "postgres";
GRANT ALL ON FUNCTION "public"."st_centroid"("public"."geometry") TO "anon";
GRANT ALL ON FUNCTION "public"."st_centroid"("public"."geometry") TO "authenticated";
GRANT ALL ON FUNCTION "public"."st_centroid"("public"."geometry") TO "service_role";



GRANT ALL ON FUNCTION "public"."st_centroid"("public"."geography", "use_spheroid" boolean) TO "postgres";
GRANT ALL ON FUNCTION "public"."st_centroid"("public"."geography", "use_spheroid" boolean) TO "anon";
GRANT ALL ON FUNCTION "public"."st_centroid"("public"."geography", "use_spheroid" boolean) TO "authenticated";
GRANT ALL ON FUNCTION "public"."st_centroid"("public"."geography", "use_spheroid" boolean) TO "service_role";



GRANT ALL ON FUNCTION "public"."st_chaikinsmoothing"("public"."geometry", integer, boolean) TO "postgres";
GRANT ALL ON FUNCTION "public"."st_chaikinsmoothing"("public"."geometry", integer, boolean) TO "anon";
GRANT ALL ON FUNCTION "public"."st_chaikinsmoothing"("public"."geometry", integer, boolean) TO "authenticated";
GRANT ALL ON FUNCTION "public"."st_chaikinsmoothing"("public"."geometry", integer, boolean) TO "service_role";



GRANT ALL ON FUNCTION "public"."st_cleangeometry"("public"."geometry") TO "postgres";
GRANT ALL ON FUNCTION "public"."st_cleangeometry"("public"."geometry") TO "anon";
GRANT ALL ON FUNCTION "public"."st_cleangeometry"("public"."geometry") TO "authenticated";
GRANT ALL ON FUNCTION "public"."st_cleangeometry"("public"."geometry") TO "service_role";



GRANT ALL ON FUNCTION "public"."st_clipbybox2d"("geom" "public"."geometry", "box" "public"."box2d") TO "postgres";
GRANT ALL ON FUNCTION "public"."st_clipbybox2d"("geom" "public"."geometry", "box" "public"."box2d") TO "anon";
GRANT ALL ON FUNCTION "public"."st_clipbybox2d"("geom" "public"."geometry", "box" "public"."box2d") TO "authenticated";
GRANT ALL ON FUNCTION "public"."st_clipbybox2d"("geom" "public"."geometry", "box" "public"."box2d") TO "service_role";



GRANT ALL ON FUNCTION "public"."st_closestpoint"("geom1" "public"."geometry", "geom2" "public"."geometry") TO "postgres";
GRANT ALL ON FUNCTION "public"."st_closestpoint"("geom1" "public"."geometry", "geom2" "public"."geometry") TO "anon";
GRANT ALL ON FUNCTION "public"."st_closestpoint"("geom1" "public"."geometry", "geom2" "public"."geometry") TO "authenticated";
GRANT ALL ON FUNCTION "public"."st_closestpoint"("geom1" "public"."geometry", "geom2" "public"."geometry") TO "service_role";



GRANT ALL ON FUNCTION "public"."st_closestpointofapproach"("public"."geometry", "public"."geometry") TO "postgres";
GRANT ALL ON FUNCTION "public"."st_closestpointofapproach"("public"."geometry", "public"."geometry") TO "anon";
GRANT ALL ON FUNCTION "public"."st_closestpointofapproach"("public"."geometry", "public"."geometry") TO "authenticated";
GRANT ALL ON FUNCTION "public"."st_closestpointofapproach"("public"."geometry", "public"."geometry") TO "service_role";



GRANT ALL ON FUNCTION "public"."st_clusterdbscan"("public"."geometry", "eps" double precision, "minpoints" integer) TO "postgres";
GRANT ALL ON FUNCTION "public"."st_clusterdbscan"("public"."geometry", "eps" double precision, "minpoints" integer) TO "anon";
GRANT ALL ON FUNCTION "public"."st_clusterdbscan"("public"."geometry", "eps" double precision, "minpoints" integer) TO "authenticated";
GRANT ALL ON FUNCTION "public"."st_clusterdbscan"("public"."geometry", "eps" double precision, "minpoints" integer) TO "service_role";



GRANT ALL ON FUNCTION "public"."st_clusterintersecting"("public"."geometry"[]) TO "postgres";
GRANT ALL ON FUNCTION "public"."st_clusterintersecting"("public"."geometry"[]) TO "anon";
GRANT ALL ON FUNCTION "public"."st_clusterintersecting"("public"."geometry"[]) TO "authenticated";
GRANT ALL ON FUNCTION "public"."st_clusterintersecting"("public"."geometry"[]) TO "service_role";



GRANT ALL ON FUNCTION "public"."st_clusterkmeans"("geom" "public"."geometry", "k" integer, "max_radius" double precision) TO "postgres";
GRANT ALL ON FUNCTION "public"."st_clusterkmeans"("geom" "public"."geometry", "k" integer, "max_radius" double precision) TO "anon";
GRANT ALL ON FUNCTION "public"."st_clusterkmeans"("geom" "public"."geometry", "k" integer, "max_radius" double precision) TO "authenticated";
GRANT ALL ON FUNCTION "public"."st_clusterkmeans"("geom" "public"."geometry", "k" integer, "max_radius" double precision) TO "service_role";



GRANT ALL ON FUNCTION "public"."st_clusterwithin"("public"."geometry"[], double precision) TO "postgres";
GRANT ALL ON FUNCTION "public"."st_clusterwithin"("public"."geometry"[], double precision) TO "anon";
GRANT ALL ON FUNCTION "public"."st_clusterwithin"("public"."geometry"[], double precision) TO "authenticated";
GRANT ALL ON FUNCTION "public"."st_clusterwithin"("public"."geometry"[], double precision) TO "service_role";



GRANT ALL ON FUNCTION "public"."st_collect"("public"."geometry"[]) TO "postgres";
GRANT ALL ON FUNCTION "public"."st_collect"("public"."geometry"[]) TO "anon";
GRANT ALL ON FUNCTION "public"."st_collect"("public"."geometry"[]) TO "authenticated";
GRANT ALL ON FUNCTION "public"."st_collect"("public"."geometry"[]) TO "service_role";



GRANT ALL ON FUNCTION "public"."st_collect"("geom1" "public"."geometry", "geom2" "public"."geometry") TO "postgres";
GRANT ALL ON FUNCTION "public"."st_collect"("geom1" "public"."geometry", "geom2" "public"."geometry") TO "anon";
GRANT ALL ON FUNCTION "public"."st_collect"("geom1" "public"."geometry", "geom2" "public"."geometry") TO "authenticated";
GRANT ALL ON FUNCTION "public"."st_collect"("geom1" "public"."geometry", "geom2" "public"."geometry") TO "service_role";



GRANT ALL ON FUNCTION "public"."st_collectionextract"("public"."geometry") TO "postgres";
GRANT ALL ON FUNCTION "public"."st_collectionextract"("public"."geometry") TO "anon";
GRANT ALL ON FUNCTION "public"."st_collectionextract"("public"."geometry") TO "authenticated";
GRANT ALL ON FUNCTION "public"."st_collectionextract"("public"."geometry") TO "service_role";



GRANT ALL ON FUNCTION "public"."st_collectionextract"("public"."geometry", integer) TO "postgres";
GRANT ALL ON FUNCTION "public"."st_collectionextract"("public"."geometry", integer) TO "anon";
GRANT ALL ON FUNCTION "public"."st_collectionextract"("public"."geometry", integer) TO "authenticated";
GRANT ALL ON FUNCTION "public"."st_collectionextract"("public"."geometry", integer) TO "service_role";



GRANT ALL ON FUNCTION "public"."st_collectionhomogenize"("public"."geometry") TO "postgres";
GRANT ALL ON FUNCTION "public"."st_collectionhomogenize"("public"."geometry") TO "anon";
GRANT ALL ON FUNCTION "public"."st_collectionhomogenize"("public"."geometry") TO "authenticated";
GRANT ALL ON FUNCTION "public"."st_collectionhomogenize"("public"."geometry") TO "service_role";



GRANT ALL ON FUNCTION "public"."st_combinebbox"("public"."box2d", "public"."geometry") TO "postgres";
GRANT ALL ON FUNCTION "public"."st_combinebbox"("public"."box2d", "public"."geometry") TO "anon";
GRANT ALL ON FUNCTION "public"."st_combinebbox"("public"."box2d", "public"."geometry") TO "authenticated";
GRANT ALL ON FUNCTION "public"."st_combinebbox"("public"."box2d", "public"."geometry") TO "service_role";



GRANT ALL ON FUNCTION "public"."st_combinebbox"("public"."box3d", "public"."box3d") TO "postgres";
GRANT ALL ON FUNCTION "public"."st_combinebbox"("public"."box3d", "public"."box3d") TO "anon";
GRANT ALL ON FUNCTION "public"."st_combinebbox"("public"."box3d", "public"."box3d") TO "authenticated";
GRANT ALL ON FUNCTION "public"."st_combinebbox"("public"."box3d", "public"."box3d") TO "service_role";



GRANT ALL ON FUNCTION "public"."st_combinebbox"("public"."box3d", "public"."geometry") TO "postgres";
GRANT ALL ON FUNCTION "public"."st_combinebbox"("public"."box3d", "public"."geometry") TO "anon";
GRANT ALL ON FUNCTION "public"."st_combinebbox"("public"."box3d", "public"."geometry") TO "authenticated";
GRANT ALL ON FUNCTION "public"."st_combinebbox"("public"."box3d", "public"."geometry") TO "service_role";



GRANT ALL ON FUNCTION "public"."st_concavehull"("param_geom" "public"."geometry", "param_pctconvex" double precision, "param_allow_holes" boolean) TO "postgres";
GRANT ALL ON FUNCTION "public"."st_concavehull"("param_geom" "public"."geometry", "param_pctconvex" double precision, "param_allow_holes" boolean) TO "anon";
GRANT ALL ON FUNCTION "public"."st_concavehull"("param_geom" "public"."geometry", "param_pctconvex" double precision, "param_allow_holes" boolean) TO "authenticated";
GRANT ALL ON FUNCTION "public"."st_concavehull"("param_geom" "public"."geometry", "param_pctconvex" double precision, "param_allow_holes" boolean) TO "service_role";



GRANT ALL ON FUNCTION "public"."st_contains"("geom1" "public"."geometry", "geom2" "public"."geometry") TO "postgres";
GRANT ALL ON FUNCTION "public"."st_contains"("geom1" "public"."geometry", "geom2" "public"."geometry") TO "anon";
GRANT ALL ON FUNCTION "public"."st_contains"("geom1" "public"."geometry", "geom2" "public"."geometry") TO "authenticated";
GRANT ALL ON FUNCTION "public"."st_contains"("geom1" "public"."geometry", "geom2" "public"."geometry") TO "service_role";



GRANT ALL ON FUNCTION "public"."st_containsproperly"("geom1" "public"."geometry", "geom2" "public"."geometry") TO "postgres";
GRANT ALL ON FUNCTION "public"."st_containsproperly"("geom1" "public"."geometry", "geom2" "public"."geometry") TO "anon";
GRANT ALL ON FUNCTION "public"."st_containsproperly"("geom1" "public"."geometry", "geom2" "public"."geometry") TO "authenticated";
GRANT ALL ON FUNCTION "public"."st_containsproperly"("geom1" "public"."geometry", "geom2" "public"."geometry") TO "service_role";



GRANT ALL ON FUNCTION "public"."st_convexhull"("public"."geometry") TO "postgres";
GRANT ALL ON FUNCTION "public"."st_convexhull"("public"."geometry") TO "anon";
GRANT ALL ON FUNCTION "public"."st_convexhull"("public"."geometry") TO "authenticated";
GRANT ALL ON FUNCTION "public"."st_convexhull"("public"."geometry") TO "service_role";



GRANT ALL ON FUNCTION "public"."st_coorddim"("geometry" "public"."geometry") TO "postgres";
GRANT ALL ON FUNCTION "public"."st_coorddim"("geometry" "public"."geometry") TO "anon";
GRANT ALL ON FUNCTION "public"."st_coorddim"("geometry" "public"."geometry") TO "authenticated";
GRANT ALL ON FUNCTION "public"."st_coorddim"("geometry" "public"."geometry") TO "service_role";



GRANT ALL ON FUNCTION "public"."st_coveredby"("text", "text") TO "postgres";
GRANT ALL ON FUNCTION "public"."st_coveredby"("text", "text") TO "anon";
GRANT ALL ON FUNCTION "public"."st_coveredby"("text", "text") TO "authenticated";
GRANT ALL ON FUNCTION "public"."st_coveredby"("text", "text") TO "service_role";



GRANT ALL ON FUNCTION "public"."st_coveredby"("geog1" "public"."geography", "geog2" "public"."geography") TO "postgres";
GRANT ALL ON FUNCTION "public"."st_coveredby"("geog1" "public"."geography", "geog2" "public"."geography") TO "anon";
GRANT ALL ON FUNCTION "public"."st_coveredby"("geog1" "public"."geography", "geog2" "public"."geography") TO "authenticated";
GRANT ALL ON FUNCTION "public"."st_coveredby"("geog1" "public"."geography", "geog2" "public"."geography") TO "service_role";



GRANT ALL ON FUNCTION "public"."st_coveredby"("geom1" "public"."geometry", "geom2" "public"."geometry") TO "postgres";
GRANT ALL ON FUNCTION "public"."st_coveredby"("geom1" "public"."geometry", "geom2" "public"."geometry") TO "anon";
GRANT ALL ON FUNCTION "public"."st_coveredby"("geom1" "public"."geometry", "geom2" "public"."geometry") TO "authenticated";
GRANT ALL ON FUNCTION "public"."st_coveredby"("geom1" "public"."geometry", "geom2" "public"."geometry") TO "service_role";



GRANT ALL ON FUNCTION "public"."st_covers"("text", "text") TO "postgres";
GRANT ALL ON FUNCTION "public"."st_covers"("text", "text") TO "anon";
GRANT ALL ON FUNCTION "public"."st_covers"("text", "text") TO "authenticated";
GRANT ALL ON FUNCTION "public"."st_covers"("text", "text") TO "service_role";



GRANT ALL ON FUNCTION "public"."st_covers"("geog1" "public"."geography", "geog2" "public"."geography") TO "postgres";
GRANT ALL ON FUNCTION "public"."st_covers"("geog1" "public"."geography", "geog2" "public"."geography") TO "anon";
GRANT ALL ON FUNCTION "public"."st_covers"("geog1" "public"."geography", "geog2" "public"."geography") TO "authenticated";
GRANT ALL ON FUNCTION "public"."st_covers"("geog1" "public"."geography", "geog2" "public"."geography") TO "service_role";



GRANT ALL ON FUNCTION "public"."st_covers"("geom1" "public"."geometry", "geom2" "public"."geometry") TO "postgres";
GRANT ALL ON FUNCTION "public"."st_covers"("geom1" "public"."geometry", "geom2" "public"."geometry") TO "anon";
GRANT ALL ON FUNCTION "public"."st_covers"("geom1" "public"."geometry", "geom2" "public"."geometry") TO "authenticated";
GRANT ALL ON FUNCTION "public"."st_covers"("geom1" "public"."geometry", "geom2" "public"."geometry") TO "service_role";



GRANT ALL ON FUNCTION "public"."st_cpawithin"("public"."geometry", "public"."geometry", double precision) TO "postgres";
GRANT ALL ON FUNCTION "public"."st_cpawithin"("public"."geometry", "public"."geometry", double precision) TO "anon";
GRANT ALL ON FUNCTION "public"."st_cpawithin"("public"."geometry", "public"."geometry", double precision) TO "authenticated";
GRANT ALL ON FUNCTION "public"."st_cpawithin"("public"."geometry", "public"."geometry", double precision) TO "service_role";



GRANT ALL ON FUNCTION "public"."st_crosses"("geom1" "public"."geometry", "geom2" "public"."geometry") TO "postgres";
GRANT ALL ON FUNCTION "public"."st_crosses"("geom1" "public"."geometry", "geom2" "public"."geometry") TO "anon";
GRANT ALL ON FUNCTION "public"."st_crosses"("geom1" "public"."geometry", "geom2" "public"."geometry") TO "authenticated";
GRANT ALL ON FUNCTION "public"."st_crosses"("geom1" "public"."geometry", "geom2" "public"."geometry") TO "service_role";



GRANT ALL ON FUNCTION "public"."st_curvetoline"("geom" "public"."geometry", "tol" double precision, "toltype" integer, "flags" integer) TO "postgres";
GRANT ALL ON FUNCTION "public"."st_curvetoline"("geom" "public"."geometry", "tol" double precision, "toltype" integer, "flags" integer) TO "anon";
GRANT ALL ON FUNCTION "public"."st_curvetoline"("geom" "public"."geometry", "tol" double precision, "toltype" integer, "flags" integer) TO "authenticated";
GRANT ALL ON FUNCTION "public"."st_curvetoline"("geom" "public"."geometry", "tol" double precision, "toltype" integer, "flags" integer) TO "service_role";



GRANT ALL ON FUNCTION "public"."st_delaunaytriangles"("g1" "public"."geometry", "tolerance" double precision, "flags" integer) TO "postgres";
GRANT ALL ON FUNCTION "public"."st_delaunaytriangles"("g1" "public"."geometry", "tolerance" double precision, "flags" integer) TO "anon";
GRANT ALL ON FUNCTION "public"."st_delaunaytriangles"("g1" "public"."geometry", "tolerance" double precision, "flags" integer) TO "authenticated";
GRANT ALL ON FUNCTION "public"."st_delaunaytriangles"("g1" "public"."geometry", "tolerance" double precision, "flags" integer) TO "service_role";



GRANT ALL ON FUNCTION "public"."st_dfullywithin"("geom1" "public"."geometry", "geom2" "public"."geometry", double precision) TO "postgres";
GRANT ALL ON FUNCTION "public"."st_dfullywithin"("geom1" "public"."geometry", "geom2" "public"."geometry", double precision) TO "anon";
GRANT ALL ON FUNCTION "public"."st_dfullywithin"("geom1" "public"."geometry", "geom2" "public"."geometry", double precision) TO "authenticated";
GRANT ALL ON FUNCTION "public"."st_dfullywithin"("geom1" "public"."geometry", "geom2" "public"."geometry", double precision) TO "service_role";



GRANT ALL ON FUNCTION "public"."st_difference"("geom1" "public"."geometry", "geom2" "public"."geometry", "gridsize" double precision) TO "postgres";
GRANT ALL ON FUNCTION "public"."st_difference"("geom1" "public"."geometry", "geom2" "public"."geometry", "gridsize" double precision) TO "anon";
GRANT ALL ON FUNCTION "public"."st_difference"("geom1" "public"."geometry", "geom2" "public"."geometry", "gridsize" double precision) TO "authenticated";
GRANT ALL ON FUNCTION "public"."st_difference"("geom1" "public"."geometry", "geom2" "public"."geometry", "gridsize" double precision) TO "service_role";



GRANT ALL ON FUNCTION "public"."st_dimension"("public"."geometry") TO "postgres";
GRANT ALL ON FUNCTION "public"."st_dimension"("public"."geometry") TO "anon";
GRANT ALL ON FUNCTION "public"."st_dimension"("public"."geometry") TO "authenticated";
GRANT ALL ON FUNCTION "public"."st_dimension"("public"."geometry") TO "service_role";



GRANT ALL ON FUNCTION "public"."st_disjoint"("geom1" "public"."geometry", "geom2" "public"."geometry") TO "postgres";
GRANT ALL ON FUNCTION "public"."st_disjoint"("geom1" "public"."geometry", "geom2" "public"."geometry") TO "anon";
GRANT ALL ON FUNCTION "public"."st_disjoint"("geom1" "public"."geometry", "geom2" "public"."geometry") TO "authenticated";
GRANT ALL ON FUNCTION "public"."st_disjoint"("geom1" "public"."geometry", "geom2" "public"."geometry") TO "service_role";



GRANT ALL ON FUNCTION "public"."st_distance"("text", "text") TO "postgres";
GRANT ALL ON FUNCTION "public"."st_distance"("text", "text") TO "anon";
GRANT ALL ON FUNCTION "public"."st_distance"("text", "text") TO "authenticated";
GRANT ALL ON FUNCTION "public"."st_distance"("text", "text") TO "service_role";



GRANT ALL ON FUNCTION "public"."st_distance"("geom1" "public"."geometry", "geom2" "public"."geometry") TO "postgres";
GRANT ALL ON FUNCTION "public"."st_distance"("geom1" "public"."geometry", "geom2" "public"."geometry") TO "anon";
GRANT ALL ON FUNCTION "public"."st_distance"("geom1" "public"."geometry", "geom2" "public"."geometry") TO "authenticated";
GRANT ALL ON FUNCTION "public"."st_distance"("geom1" "public"."geometry", "geom2" "public"."geometry") TO "service_role";



GRANT ALL ON FUNCTION "public"."st_distance"("geog1" "public"."geography", "geog2" "public"."geography", "use_spheroid" boolean) TO "postgres";
GRANT ALL ON FUNCTION "public"."st_distance"("geog1" "public"."geography", "geog2" "public"."geography", "use_spheroid" boolean) TO "anon";
GRANT ALL ON FUNCTION "public"."st_distance"("geog1" "public"."geography", "geog2" "public"."geography", "use_spheroid" boolean) TO "authenticated";
GRANT ALL ON FUNCTION "public"."st_distance"("geog1" "public"."geography", "geog2" "public"."geography", "use_spheroid" boolean) TO "service_role";



GRANT ALL ON FUNCTION "public"."st_distancecpa"("public"."geometry", "public"."geometry") TO "postgres";
GRANT ALL ON FUNCTION "public"."st_distancecpa"("public"."geometry", "public"."geometry") TO "anon";
GRANT ALL ON FUNCTION "public"."st_distancecpa"("public"."geometry", "public"."geometry") TO "authenticated";
GRANT ALL ON FUNCTION "public"."st_distancecpa"("public"."geometry", "public"."geometry") TO "service_role";



GRANT ALL ON FUNCTION "public"."st_distancesphere"("geom1" "public"."geometry", "geom2" "public"."geometry") TO "postgres";
GRANT ALL ON FUNCTION "public"."st_distancesphere"("geom1" "public"."geometry", "geom2" "public"."geometry") TO "anon";
GRANT ALL ON FUNCTION "public"."st_distancesphere"("geom1" "public"."geometry", "geom2" "public"."geometry") TO "authenticated";
GRANT ALL ON FUNCTION "public"."st_distancesphere"("geom1" "public"."geometry", "geom2" "public"."geometry") TO "service_role";



GRANT ALL ON FUNCTION "public"."st_distancesphere"("geom1" "public"."geometry", "geom2" "public"."geometry", "radius" double precision) TO "postgres";
GRANT ALL ON FUNCTION "public"."st_distancesphere"("geom1" "public"."geometry", "geom2" "public"."geometry", "radius" double precision) TO "anon";
GRANT ALL ON FUNCTION "public"."st_distancesphere"("geom1" "public"."geometry", "geom2" "public"."geometry", "radius" double precision) TO "authenticated";
GRANT ALL ON FUNCTION "public"."st_distancesphere"("geom1" "public"."geometry", "geom2" "public"."geometry", "radius" double precision) TO "service_role";



GRANT ALL ON FUNCTION "public"."st_distancespheroid"("geom1" "public"."geometry", "geom2" "public"."geometry") TO "postgres";
GRANT ALL ON FUNCTION "public"."st_distancespheroid"("geom1" "public"."geometry", "geom2" "public"."geometry") TO "anon";
GRANT ALL ON FUNCTION "public"."st_distancespheroid"("geom1" "public"."geometry", "geom2" "public"."geometry") TO "authenticated";
GRANT ALL ON FUNCTION "public"."st_distancespheroid"("geom1" "public"."geometry", "geom2" "public"."geometry") TO "service_role";



GRANT ALL ON FUNCTION "public"."st_distancespheroid"("geom1" "public"."geometry", "geom2" "public"."geometry", "public"."spheroid") TO "postgres";
GRANT ALL ON FUNCTION "public"."st_distancespheroid"("geom1" "public"."geometry", "geom2" "public"."geometry", "public"."spheroid") TO "anon";
GRANT ALL ON FUNCTION "public"."st_distancespheroid"("geom1" "public"."geometry", "geom2" "public"."geometry", "public"."spheroid") TO "authenticated";
GRANT ALL ON FUNCTION "public"."st_distancespheroid"("geom1" "public"."geometry", "geom2" "public"."geometry", "public"."spheroid") TO "service_role";



GRANT ALL ON FUNCTION "public"."st_dump"("public"."geometry") TO "postgres";
GRANT ALL ON FUNCTION "public"."st_dump"("public"."geometry") TO "anon";
GRANT ALL ON FUNCTION "public"."st_dump"("public"."geometry") TO "authenticated";
GRANT ALL ON FUNCTION "public"."st_dump"("public"."geometry") TO "service_role";



GRANT ALL ON FUNCTION "public"."st_dumppoints"("public"."geometry") TO "postgres";
GRANT ALL ON FUNCTION "public"."st_dumppoints"("public"."geometry") TO "anon";
GRANT ALL ON FUNCTION "public"."st_dumppoints"("public"."geometry") TO "authenticated";
GRANT ALL ON FUNCTION "public"."st_dumppoints"("public"."geometry") TO "service_role";



GRANT ALL ON FUNCTION "public"."st_dumprings"("public"."geometry") TO "postgres";
GRANT ALL ON FUNCTION "public"."st_dumprings"("public"."geometry") TO "anon";
GRANT ALL ON FUNCTION "public"."st_dumprings"("public"."geometry") TO "authenticated";
GRANT ALL ON FUNCTION "public"."st_dumprings"("public"."geometry") TO "service_role";



GRANT ALL ON FUNCTION "public"."st_dumpsegments"("public"."geometry") TO "postgres";
GRANT ALL ON FUNCTION "public"."st_dumpsegments"("public"."geometry") TO "anon";
GRANT ALL ON FUNCTION "public"."st_dumpsegments"("public"."geometry") TO "authenticated";
GRANT ALL ON FUNCTION "public"."st_dumpsegments"("public"."geometry") TO "service_role";



GRANT ALL ON FUNCTION "public"."st_dwithin"("text", "text", double precision) TO "postgres";
GRANT ALL ON FUNCTION "public"."st_dwithin"("text", "text", double precision) TO "anon";
GRANT ALL ON FUNCTION "public"."st_dwithin"("text", "text", double precision) TO "authenticated";
GRANT ALL ON FUNCTION "public"."st_dwithin"("text", "text", double precision) TO "service_role";



GRANT ALL ON FUNCTION "public"."st_dwithin"("geom1" "public"."geometry", "geom2" "public"."geometry", double precision) TO "postgres";
GRANT ALL ON FUNCTION "public"."st_dwithin"("geom1" "public"."geometry", "geom2" "public"."geometry", double precision) TO "anon";
GRANT ALL ON FUNCTION "public"."st_dwithin"("geom1" "public"."geometry", "geom2" "public"."geometry", double precision) TO "authenticated";
GRANT ALL ON FUNCTION "public"."st_dwithin"("geom1" "public"."geometry", "geom2" "public"."geometry", double precision) TO "service_role";



GRANT ALL ON FUNCTION "public"."st_dwithin"("geog1" "public"."geography", "geog2" "public"."geography", "tolerance" double precision, "use_spheroid" boolean) TO "postgres";
GRANT ALL ON FUNCTION "public"."st_dwithin"("geog1" "public"."geography", "geog2" "public"."geography", "tolerance" double precision, "use_spheroid" boolean) TO "anon";
GRANT ALL ON FUNCTION "public"."st_dwithin"("geog1" "public"."geography", "geog2" "public"."geography", "tolerance" double precision, "use_spheroid" boolean) TO "authenticated";
GRANT ALL ON FUNCTION "public"."st_dwithin"("geog1" "public"."geography", "geog2" "public"."geography", "tolerance" double precision, "use_spheroid" boolean) TO "service_role";



GRANT ALL ON FUNCTION "public"."st_endpoint"("public"."geometry") TO "postgres";
GRANT ALL ON FUNCTION "public"."st_endpoint"("public"."geometry") TO "anon";
GRANT ALL ON FUNCTION "public"."st_endpoint"("public"."geometry") TO "authenticated";
GRANT ALL ON FUNCTION "public"."st_endpoint"("public"."geometry") TO "service_role";



GRANT ALL ON FUNCTION "public"."st_envelope"("public"."geometry") TO "postgres";
GRANT ALL ON FUNCTION "public"."st_envelope"("public"."geometry") TO "anon";
GRANT ALL ON FUNCTION "public"."st_envelope"("public"."geometry") TO "authenticated";
GRANT ALL ON FUNCTION "public"."st_envelope"("public"."geometry") TO "service_role";



GRANT ALL ON FUNCTION "public"."st_equals"("geom1" "public"."geometry", "geom2" "public"."geometry") TO "postgres";
GRANT ALL ON FUNCTION "public"."st_equals"("geom1" "public"."geometry", "geom2" "public"."geometry") TO "anon";
GRANT ALL ON FUNCTION "public"."st_equals"("geom1" "public"."geometry", "geom2" "public"."geometry") TO "authenticated";
GRANT ALL ON FUNCTION "public"."st_equals"("geom1" "public"."geometry", "geom2" "public"."geometry") TO "service_role";



GRANT ALL ON FUNCTION "public"."st_estimatedextent"("text", "text") TO "postgres";
GRANT ALL ON FUNCTION "public"."st_estimatedextent"("text", "text") TO "anon";
GRANT ALL ON FUNCTION "public"."st_estimatedextent"("text", "text") TO "authenticated";
GRANT ALL ON FUNCTION "public"."st_estimatedextent"("text", "text") TO "service_role";



GRANT ALL ON FUNCTION "public"."st_estimatedextent"("text", "text", "text") TO "postgres";
GRANT ALL ON FUNCTION "public"."st_estimatedextent"("text", "text", "text") TO "anon";
GRANT ALL ON FUNCTION "public"."st_estimatedextent"("text", "text", "text") TO "authenticated";
GRANT ALL ON FUNCTION "public"."st_estimatedextent"("text", "text", "text") TO "service_role";



GRANT ALL ON FUNCTION "public"."st_estimatedextent"("text", "text", "text", boolean) TO "postgres";
GRANT ALL ON FUNCTION "public"."st_estimatedextent"("text", "text", "text", boolean) TO "anon";
GRANT ALL ON FUNCTION "public"."st_estimatedextent"("text", "text", "text", boolean) TO "authenticated";
GRANT ALL ON FUNCTION "public"."st_estimatedextent"("text", "text", "text", boolean) TO "service_role";



GRANT ALL ON FUNCTION "public"."st_expand"("public"."box2d", double precision) TO "postgres";
GRANT ALL ON FUNCTION "public"."st_expand"("public"."box2d", double precision) TO "anon";
GRANT ALL ON FUNCTION "public"."st_expand"("public"."box2d", double precision) TO "authenticated";
GRANT ALL ON FUNCTION "public"."st_expand"("public"."box2d", double precision) TO "service_role";



GRANT ALL ON FUNCTION "public"."st_expand"("public"."box3d", double precision) TO "postgres";
GRANT ALL ON FUNCTION "public"."st_expand"("public"."box3d", double precision) TO "anon";
GRANT ALL ON FUNCTION "public"."st_expand"("public"."box3d", double precision) TO "authenticated";
GRANT ALL ON FUNCTION "public"."st_expand"("public"."box3d", double precision) TO "service_role";



GRANT ALL ON FUNCTION "public"."st_expand"("public"."geometry", double precision) TO "postgres";
GRANT ALL ON FUNCTION "public"."st_expand"("public"."geometry", double precision) TO "anon";
GRANT ALL ON FUNCTION "public"."st_expand"("public"."geometry", double precision) TO "authenticated";
GRANT ALL ON FUNCTION "public"."st_expand"("public"."geometry", double precision) TO "service_role";



GRANT ALL ON FUNCTION "public"."st_expand"("box" "public"."box2d", "dx" double precision, "dy" double precision) TO "postgres";
GRANT ALL ON FUNCTION "public"."st_expand"("box" "public"."box2d", "dx" double precision, "dy" double precision) TO "anon";
GRANT ALL ON FUNCTION "public"."st_expand"("box" "public"."box2d", "dx" double precision, "dy" double precision) TO "authenticated";
GRANT ALL ON FUNCTION "public"."st_expand"("box" "public"."box2d", "dx" double precision, "dy" double precision) TO "service_role";



GRANT ALL ON FUNCTION "public"."st_expand"("box" "public"."box3d", "dx" double precision, "dy" double precision, "dz" double precision) TO "postgres";
GRANT ALL ON FUNCTION "public"."st_expand"("box" "public"."box3d", "dx" double precision, "dy" double precision, "dz" double precision) TO "anon";
GRANT ALL ON FUNCTION "public"."st_expand"("box" "public"."box3d", "dx" double precision, "dy" double precision, "dz" double precision) TO "authenticated";
GRANT ALL ON FUNCTION "public"."st_expand"("box" "public"."box3d", "dx" double precision, "dy" double precision, "dz" double precision) TO "service_role";



GRANT ALL ON FUNCTION "public"."st_expand"("geom" "public"."geometry", "dx" double precision, "dy" double precision, "dz" double precision, "dm" double precision) TO "postgres";
GRANT ALL ON FUNCTION "public"."st_expand"("geom" "public"."geometry", "dx" double precision, "dy" double precision, "dz" double precision, "dm" double precision) TO "anon";
GRANT ALL ON FUNCTION "public"."st_expand"("geom" "public"."geometry", "dx" double precision, "dy" double precision, "dz" double precision, "dm" double precision) TO "authenticated";
GRANT ALL ON FUNCTION "public"."st_expand"("geom" "public"."geometry", "dx" double precision, "dy" double precision, "dz" double precision, "dm" double precision) TO "service_role";



GRANT ALL ON FUNCTION "public"."st_exteriorring"("public"."geometry") TO "postgres";
GRANT ALL ON FUNCTION "public"."st_exteriorring"("public"."geometry") TO "anon";
GRANT ALL ON FUNCTION "public"."st_exteriorring"("public"."geometry") TO "authenticated";
GRANT ALL ON FUNCTION "public"."st_exteriorring"("public"."geometry") TO "service_role";



GRANT ALL ON FUNCTION "public"."st_filterbym"("public"."geometry", double precision, double precision, boolean) TO "postgres";
GRANT ALL ON FUNCTION "public"."st_filterbym"("public"."geometry", double precision, double precision, boolean) TO "anon";
GRANT ALL ON FUNCTION "public"."st_filterbym"("public"."geometry", double precision, double precision, boolean) TO "authenticated";
GRANT ALL ON FUNCTION "public"."st_filterbym"("public"."geometry", double precision, double precision, boolean) TO "service_role";



GRANT ALL ON FUNCTION "public"."st_findextent"("text", "text") TO "postgres";
GRANT ALL ON FUNCTION "public"."st_findextent"("text", "text") TO "anon";
GRANT ALL ON FUNCTION "public"."st_findextent"("text", "text") TO "authenticated";
GRANT ALL ON FUNCTION "public"."st_findextent"("text", "text") TO "service_role";



GRANT ALL ON FUNCTION "public"."st_findextent"("text", "text", "text") TO "postgres";
GRANT ALL ON FUNCTION "public"."st_findextent"("text", "text", "text") TO "anon";
GRANT ALL ON FUNCTION "public"."st_findextent"("text", "text", "text") TO "authenticated";
GRANT ALL ON FUNCTION "public"."st_findextent"("text", "text", "text") TO "service_role";



GRANT ALL ON FUNCTION "public"."st_flipcoordinates"("public"."geometry") TO "postgres";
GRANT ALL ON FUNCTION "public"."st_flipcoordinates"("public"."geometry") TO "anon";
GRANT ALL ON FUNCTION "public"."st_flipcoordinates"("public"."geometry") TO "authenticated";
GRANT ALL ON FUNCTION "public"."st_flipcoordinates"("public"."geometry") TO "service_role";



GRANT ALL ON FUNCTION "public"."st_force2d"("public"."geometry") TO "postgres";
GRANT ALL ON FUNCTION "public"."st_force2d"("public"."geometry") TO "anon";
GRANT ALL ON FUNCTION "public"."st_force2d"("public"."geometry") TO "authenticated";
GRANT ALL ON FUNCTION "public"."st_force2d"("public"."geometry") TO "service_role";



GRANT ALL ON FUNCTION "public"."st_force3d"("geom" "public"."geometry", "zvalue" double precision) TO "postgres";
GRANT ALL ON FUNCTION "public"."st_force3d"("geom" "public"."geometry", "zvalue" double precision) TO "anon";
GRANT ALL ON FUNCTION "public"."st_force3d"("geom" "public"."geometry", "zvalue" double precision) TO "authenticated";
GRANT ALL ON FUNCTION "public"."st_force3d"("geom" "public"."geometry", "zvalue" double precision) TO "service_role";



GRANT ALL ON FUNCTION "public"."st_force3dm"("geom" "public"."geometry", "mvalue" double precision) TO "postgres";
GRANT ALL ON FUNCTION "public"."st_force3dm"("geom" "public"."geometry", "mvalue" double precision) TO "anon";
GRANT ALL ON FUNCTION "public"."st_force3dm"("geom" "public"."geometry", "mvalue" double precision) TO "authenticated";
GRANT ALL ON FUNCTION "public"."st_force3dm"("geom" "public"."geometry", "mvalue" double precision) TO "service_role";



GRANT ALL ON FUNCTION "public"."st_force3dz"("geom" "public"."geometry", "zvalue" double precision) TO "postgres";
GRANT ALL ON FUNCTION "public"."st_force3dz"("geom" "public"."geometry", "zvalue" double precision) TO "anon";
GRANT ALL ON FUNCTION "public"."st_force3dz"("geom" "public"."geometry", "zvalue" double precision) TO "authenticated";
GRANT ALL ON FUNCTION "public"."st_force3dz"("geom" "public"."geometry", "zvalue" double precision) TO "service_role";



GRANT ALL ON FUNCTION "public"."st_force4d"("geom" "public"."geometry", "zvalue" double precision, "mvalue" double precision) TO "postgres";
GRANT ALL ON FUNCTION "public"."st_force4d"("geom" "public"."geometry", "zvalue" double precision, "mvalue" double precision) TO "anon";
GRANT ALL ON FUNCTION "public"."st_force4d"("geom" "public"."geometry", "zvalue" double precision, "mvalue" double precision) TO "authenticated";
GRANT ALL ON FUNCTION "public"."st_force4d"("geom" "public"."geometry", "zvalue" double precision, "mvalue" double precision) TO "service_role";



GRANT ALL ON FUNCTION "public"."st_forcecollection"("public"."geometry") TO "postgres";
GRANT ALL ON FUNCTION "public"."st_forcecollection"("public"."geometry") TO "anon";
GRANT ALL ON FUNCTION "public"."st_forcecollection"("public"."geometry") TO "authenticated";
GRANT ALL ON FUNCTION "public"."st_forcecollection"("public"."geometry") TO "service_role";



GRANT ALL ON FUNCTION "public"."st_forcecurve"("public"."geometry") TO "postgres";
GRANT ALL ON FUNCTION "public"."st_forcecurve"("public"."geometry") TO "anon";
GRANT ALL ON FUNCTION "public"."st_forcecurve"("public"."geometry") TO "authenticated";
GRANT ALL ON FUNCTION "public"."st_forcecurve"("public"."geometry") TO "service_role";



GRANT ALL ON FUNCTION "public"."st_forcepolygonccw"("public"."geometry") TO "postgres";
GRANT ALL ON FUNCTION "public"."st_forcepolygonccw"("public"."geometry") TO "anon";
GRANT ALL ON FUNCTION "public"."st_forcepolygonccw"("public"."geometry") TO "authenticated";
GRANT ALL ON FUNCTION "public"."st_forcepolygonccw"("public"."geometry") TO "service_role";



GRANT ALL ON FUNCTION "public"."st_forcepolygoncw"("public"."geometry") TO "postgres";
GRANT ALL ON FUNCTION "public"."st_forcepolygoncw"("public"."geometry") TO "anon";
GRANT ALL ON FUNCTION "public"."st_forcepolygoncw"("public"."geometry") TO "authenticated";
GRANT ALL ON FUNCTION "public"."st_forcepolygoncw"("public"."geometry") TO "service_role";



GRANT ALL ON FUNCTION "public"."st_forcerhr"("public"."geometry") TO "postgres";
GRANT ALL ON FUNCTION "public"."st_forcerhr"("public"."geometry") TO "anon";
GRANT ALL ON FUNCTION "public"."st_forcerhr"("public"."geometry") TO "authenticated";
GRANT ALL ON FUNCTION "public"."st_forcerhr"("public"."geometry") TO "service_role";



GRANT ALL ON FUNCTION "public"."st_forcesfs"("public"."geometry") TO "postgres";
GRANT ALL ON FUNCTION "public"."st_forcesfs"("public"."geometry") TO "anon";
GRANT ALL ON FUNCTION "public"."st_forcesfs"("public"."geometry") TO "authenticated";
GRANT ALL ON FUNCTION "public"."st_forcesfs"("public"."geometry") TO "service_role";



GRANT ALL ON FUNCTION "public"."st_forcesfs"("public"."geometry", "version" "text") TO "postgres";
GRANT ALL ON FUNCTION "public"."st_forcesfs"("public"."geometry", "version" "text") TO "anon";
GRANT ALL ON FUNCTION "public"."st_forcesfs"("public"."geometry", "version" "text") TO "authenticated";
GRANT ALL ON FUNCTION "public"."st_forcesfs"("public"."geometry", "version" "text") TO "service_role";



GRANT ALL ON FUNCTION "public"."st_frechetdistance"("geom1" "public"."geometry", "geom2" "public"."geometry", double precision) TO "postgres";
GRANT ALL ON FUNCTION "public"."st_frechetdistance"("geom1" "public"."geometry", "geom2" "public"."geometry", double precision) TO "anon";
GRANT ALL ON FUNCTION "public"."st_frechetdistance"("geom1" "public"."geometry", "geom2" "public"."geometry", double precision) TO "authenticated";
GRANT ALL ON FUNCTION "public"."st_frechetdistance"("geom1" "public"."geometry", "geom2" "public"."geometry", double precision) TO "service_role";



GRANT ALL ON FUNCTION "public"."st_fromflatgeobuf"("anyelement", "bytea") TO "postgres";
GRANT ALL ON FUNCTION "public"."st_fromflatgeobuf"("anyelement", "bytea") TO "anon";
GRANT ALL ON FUNCTION "public"."st_fromflatgeobuf"("anyelement", "bytea") TO "authenticated";
GRANT ALL ON FUNCTION "public"."st_fromflatgeobuf"("anyelement", "bytea") TO "service_role";



GRANT ALL ON FUNCTION "public"."st_fromflatgeobuftotable"("text", "text", "bytea") TO "postgres";
GRANT ALL ON FUNCTION "public"."st_fromflatgeobuftotable"("text", "text", "bytea") TO "anon";
GRANT ALL ON FUNCTION "public"."st_fromflatgeobuftotable"("text", "text", "bytea") TO "authenticated";
GRANT ALL ON FUNCTION "public"."st_fromflatgeobuftotable"("text", "text", "bytea") TO "service_role";



GRANT ALL ON FUNCTION "public"."st_generatepoints"("area" "public"."geometry", "npoints" integer) TO "postgres";
GRANT ALL ON FUNCTION "public"."st_generatepoints"("area" "public"."geometry", "npoints" integer) TO "anon";
GRANT ALL ON FUNCTION "public"."st_generatepoints"("area" "public"."geometry", "npoints" integer) TO "authenticated";
GRANT ALL ON FUNCTION "public"."st_generatepoints"("area" "public"."geometry", "npoints" integer) TO "service_role";



GRANT ALL ON FUNCTION "public"."st_generatepoints"("area" "public"."geometry", "npoints" integer, "seed" integer) TO "postgres";
GRANT ALL ON FUNCTION "public"."st_generatepoints"("area" "public"."geometry", "npoints" integer, "seed" integer) TO "anon";
GRANT ALL ON FUNCTION "public"."st_generatepoints"("area" "public"."geometry", "npoints" integer, "seed" integer) TO "authenticated";
GRANT ALL ON FUNCTION "public"."st_generatepoints"("area" "public"."geometry", "npoints" integer, "seed" integer) TO "service_role";



GRANT ALL ON FUNCTION "public"."st_geogfromtext"("text") TO "postgres";
GRANT ALL ON FUNCTION "public"."st_geogfromtext"("text") TO "anon";
GRANT ALL ON FUNCTION "public"."st_geogfromtext"("text") TO "authenticated";
GRANT ALL ON FUNCTION "public"."st_geogfromtext"("text") TO "service_role";



GRANT ALL ON FUNCTION "public"."st_geogfromwkb"("bytea") TO "postgres";
GRANT ALL ON FUNCTION "public"."st_geogfromwkb"("bytea") TO "anon";
GRANT ALL ON FUNCTION "public"."st_geogfromwkb"("bytea") TO "authenticated";
GRANT ALL ON FUNCTION "public"."st_geogfromwkb"("bytea") TO "service_role";



GRANT ALL ON FUNCTION "public"."st_geographyfromtext"("text") TO "postgres";
GRANT ALL ON FUNCTION "public"."st_geographyfromtext"("text") TO "anon";
GRANT ALL ON FUNCTION "public"."st_geographyfromtext"("text") TO "authenticated";
GRANT ALL ON FUNCTION "public"."st_geographyfromtext"("text") TO "service_role";



GRANT ALL ON FUNCTION "public"."st_geohash"("geog" "public"."geography", "maxchars" integer) TO "postgres";
GRANT ALL ON FUNCTION "public"."st_geohash"("geog" "public"."geography", "maxchars" integer) TO "anon";
GRANT ALL ON FUNCTION "public"."st_geohash"("geog" "public"."geography", "maxchars" integer) TO "authenticated";
GRANT ALL ON FUNCTION "public"."st_geohash"("geog" "public"."geography", "maxchars" integer) TO "service_role";



GRANT ALL ON FUNCTION "public"."st_geohash"("geom" "public"."geometry", "maxchars" integer) TO "postgres";
GRANT ALL ON FUNCTION "public"."st_geohash"("geom" "public"."geometry", "maxchars" integer) TO "anon";
GRANT ALL ON FUNCTION "public"."st_geohash"("geom" "public"."geometry", "maxchars" integer) TO "authenticated";
GRANT ALL ON FUNCTION "public"."st_geohash"("geom" "public"."geometry", "maxchars" integer) TO "service_role";



GRANT ALL ON FUNCTION "public"."st_geomcollfromtext"("text") TO "postgres";
GRANT ALL ON FUNCTION "public"."st_geomcollfromtext"("text") TO "anon";
GRANT ALL ON FUNCTION "public"."st_geomcollfromtext"("text") TO "authenticated";
GRANT ALL ON FUNCTION "public"."st_geomcollfromtext"("text") TO "service_role";



GRANT ALL ON FUNCTION "public"."st_geomcollfromtext"("text", integer) TO "postgres";
GRANT ALL ON FUNCTION "public"."st_geomcollfromtext"("text", integer) TO "anon";
GRANT ALL ON FUNCTION "public"."st_geomcollfromtext"("text", integer) TO "authenticated";
GRANT ALL ON FUNCTION "public"."st_geomcollfromtext"("text", integer) TO "service_role";



GRANT ALL ON FUNCTION "public"."st_geomcollfromwkb"("bytea") TO "postgres";
GRANT ALL ON FUNCTION "public"."st_geomcollfromwkb"("bytea") TO "anon";
GRANT ALL ON FUNCTION "public"."st_geomcollfromwkb"("bytea") TO "authenticated";
GRANT ALL ON FUNCTION "public"."st_geomcollfromwkb"("bytea") TO "service_role";



GRANT ALL ON FUNCTION "public"."st_geomcollfromwkb"("bytea", integer) TO "postgres";
GRANT ALL ON FUNCTION "public"."st_geomcollfromwkb"("bytea", integer) TO "anon";
GRANT ALL ON FUNCTION "public"."st_geomcollfromwkb"("bytea", integer) TO "authenticated";
GRANT ALL ON FUNCTION "public"."st_geomcollfromwkb"("bytea", integer) TO "service_role";



GRANT ALL ON FUNCTION "public"."st_geometricmedian"("g" "public"."geometry", "tolerance" double precision, "max_iter" integer, "fail_if_not_converged" boolean) TO "postgres";
GRANT ALL ON FUNCTION "public"."st_geometricmedian"("g" "public"."geometry", "tolerance" double precision, "max_iter" integer, "fail_if_not_converged" boolean) TO "anon";
GRANT ALL ON FUNCTION "public"."st_geometricmedian"("g" "public"."geometry", "tolerance" double precision, "max_iter" integer, "fail_if_not_converged" boolean) TO "authenticated";
GRANT ALL ON FUNCTION "public"."st_geometricmedian"("g" "public"."geometry", "tolerance" double precision, "max_iter" integer, "fail_if_not_converged" boolean) TO "service_role";



GRANT ALL ON FUNCTION "public"."st_geometryfromtext"("text") TO "postgres";
GRANT ALL ON FUNCTION "public"."st_geometryfromtext"("text") TO "anon";
GRANT ALL ON FUNCTION "public"."st_geometryfromtext"("text") TO "authenticated";
GRANT ALL ON FUNCTION "public"."st_geometryfromtext"("text") TO "service_role";



GRANT ALL ON FUNCTION "public"."st_geometryfromtext"("text", integer) TO "postgres";
GRANT ALL ON FUNCTION "public"."st_geometryfromtext"("text", integer) TO "anon";
GRANT ALL ON FUNCTION "public"."st_geometryfromtext"("text", integer) TO "authenticated";
GRANT ALL ON FUNCTION "public"."st_geometryfromtext"("text", integer) TO "service_role";



GRANT ALL ON FUNCTION "public"."st_geometryn"("public"."geometry", integer) TO "postgres";
GRANT ALL ON FUNCTION "public"."st_geometryn"("public"."geometry", integer) TO "anon";
GRANT ALL ON FUNCTION "public"."st_geometryn"("public"."geometry", integer) TO "authenticated";
GRANT ALL ON FUNCTION "public"."st_geometryn"("public"."geometry", integer) TO "service_role";



GRANT ALL ON FUNCTION "public"."st_geometrytype"("public"."geometry") TO "postgres";
GRANT ALL ON FUNCTION "public"."st_geometrytype"("public"."geometry") TO "anon";
GRANT ALL ON FUNCTION "public"."st_geometrytype"("public"."geometry") TO "authenticated";
GRANT ALL ON FUNCTION "public"."st_geometrytype"("public"."geometry") TO "service_role";



GRANT ALL ON FUNCTION "public"."st_geomfromewkb"("bytea") TO "postgres";
GRANT ALL ON FUNCTION "public"."st_geomfromewkb"("bytea") TO "anon";
GRANT ALL ON FUNCTION "public"."st_geomfromewkb"("bytea") TO "authenticated";
GRANT ALL ON FUNCTION "public"."st_geomfromewkb"("bytea") TO "service_role";



GRANT ALL ON FUNCTION "public"."st_geomfromewkt"("text") TO "postgres";
GRANT ALL ON FUNCTION "public"."st_geomfromewkt"("text") TO "anon";
GRANT ALL ON FUNCTION "public"."st_geomfromewkt"("text") TO "authenticated";
GRANT ALL ON FUNCTION "public"."st_geomfromewkt"("text") TO "service_role";



GRANT ALL ON FUNCTION "public"."st_geomfromgeohash"("text", integer) TO "postgres";
GRANT ALL ON FUNCTION "public"."st_geomfromgeohash"("text", integer) TO "anon";
GRANT ALL ON FUNCTION "public"."st_geomfromgeohash"("text", integer) TO "authenticated";
GRANT ALL ON FUNCTION "public"."st_geomfromgeohash"("text", integer) TO "service_role";



GRANT ALL ON FUNCTION "public"."st_geomfromgeojson"(json) TO "postgres";
GRANT ALL ON FUNCTION "public"."st_geomfromgeojson"(json) TO "anon";
GRANT ALL ON FUNCTION "public"."st_geomfromgeojson"(json) TO "authenticated";
GRANT ALL ON FUNCTION "public"."st_geomfromgeojson"(json) TO "service_role";



GRANT ALL ON FUNCTION "public"."st_geomfromgeojson"("jsonb") TO "postgres";
GRANT ALL ON FUNCTION "public"."st_geomfromgeojson"("jsonb") TO "anon";
GRANT ALL ON FUNCTION "public"."st_geomfromgeojson"("jsonb") TO "authenticated";
GRANT ALL ON FUNCTION "public"."st_geomfromgeojson"("jsonb") TO "service_role";



GRANT ALL ON FUNCTION "public"."st_geomfromgeojson"("text") TO "postgres";
GRANT ALL ON FUNCTION "public"."st_geomfromgeojson"("text") TO "anon";
GRANT ALL ON FUNCTION "public"."st_geomfromgeojson"("text") TO "authenticated";
GRANT ALL ON FUNCTION "public"."st_geomfromgeojson"("text") TO "service_role";



GRANT ALL ON FUNCTION "public"."st_geomfromgml"("text") TO "postgres";
GRANT ALL ON FUNCTION "public"."st_geomfromgml"("text") TO "anon";
GRANT ALL ON FUNCTION "public"."st_geomfromgml"("text") TO "authenticated";
GRANT ALL ON FUNCTION "public"."st_geomfromgml"("text") TO "service_role";



GRANT ALL ON FUNCTION "public"."st_geomfromgml"("text", integer) TO "postgres";
GRANT ALL ON FUNCTION "public"."st_geomfromgml"("text", integer) TO "anon";
GRANT ALL ON FUNCTION "public"."st_geomfromgml"("text", integer) TO "authenticated";
GRANT ALL ON FUNCTION "public"."st_geomfromgml"("text", integer) TO "service_role";



GRANT ALL ON FUNCTION "public"."st_geomfromkml"("text") TO "postgres";
GRANT ALL ON FUNCTION "public"."st_geomfromkml"("text") TO "anon";
GRANT ALL ON FUNCTION "public"."st_geomfromkml"("text") TO "authenticated";
GRANT ALL ON FUNCTION "public"."st_geomfromkml"("text") TO "service_role";



GRANT ALL ON FUNCTION "public"."st_geomfrommarc21"("marc21xml" "text") TO "postgres";
GRANT ALL ON FUNCTION "public"."st_geomfrommarc21"("marc21xml" "text") TO "anon";
GRANT ALL ON FUNCTION "public"."st_geomfrommarc21"("marc21xml" "text") TO "authenticated";
GRANT ALL ON FUNCTION "public"."st_geomfrommarc21"("marc21xml" "text") TO "service_role";



GRANT ALL ON FUNCTION "public"."st_geomfromtext"("text") TO "postgres";
GRANT ALL ON FUNCTION "public"."st_geomfromtext"("text") TO "anon";
GRANT ALL ON FUNCTION "public"."st_geomfromtext"("text") TO "authenticated";
GRANT ALL ON FUNCTION "public"."st_geomfromtext"("text") TO "service_role";



GRANT ALL ON FUNCTION "public"."st_geomfromtext"("text", integer) TO "postgres";
GRANT ALL ON FUNCTION "public"."st_geomfromtext"("text", integer) TO "anon";
GRANT ALL ON FUNCTION "public"."st_geomfromtext"("text", integer) TO "authenticated";
GRANT ALL ON FUNCTION "public"."st_geomfromtext"("text", integer) TO "service_role";



GRANT ALL ON FUNCTION "public"."st_geomfromtwkb"("bytea") TO "postgres";
GRANT ALL ON FUNCTION "public"."st_geomfromtwkb"("bytea") TO "anon";
GRANT ALL ON FUNCTION "public"."st_geomfromtwkb"("bytea") TO "authenticated";
GRANT ALL ON FUNCTION "public"."st_geomfromtwkb"("bytea") TO "service_role";



GRANT ALL ON FUNCTION "public"."st_geomfromwkb"("bytea") TO "postgres";
GRANT ALL ON FUNCTION "public"."st_geomfromwkb"("bytea") TO "anon";
GRANT ALL ON FUNCTION "public"."st_geomfromwkb"("bytea") TO "authenticated";
GRANT ALL ON FUNCTION "public"."st_geomfromwkb"("bytea") TO "service_role";



GRANT ALL ON FUNCTION "public"."st_geomfromwkb"("bytea", integer) TO "postgres";
GRANT ALL ON FUNCTION "public"."st_geomfromwkb"("bytea", integer) TO "anon";
GRANT ALL ON FUNCTION "public"."st_geomfromwkb"("bytea", integer) TO "authenticated";
GRANT ALL ON FUNCTION "public"."st_geomfromwkb"("bytea", integer) TO "service_role";



GRANT ALL ON FUNCTION "public"."st_gmltosql"("text") TO "postgres";
GRANT ALL ON FUNCTION "public"."st_gmltosql"("text") TO "anon";
GRANT ALL ON FUNCTION "public"."st_gmltosql"("text") TO "authenticated";
GRANT ALL ON FUNCTION "public"."st_gmltosql"("text") TO "service_role";



GRANT ALL ON FUNCTION "public"."st_gmltosql"("text", integer) TO "postgres";
GRANT ALL ON FUNCTION "public"."st_gmltosql"("text", integer) TO "anon";
GRANT ALL ON FUNCTION "public"."st_gmltosql"("text", integer) TO "authenticated";
GRANT ALL ON FUNCTION "public"."st_gmltosql"("text", integer) TO "service_role";



GRANT ALL ON FUNCTION "public"."st_hasarc"("geometry" "public"."geometry") TO "postgres";
GRANT ALL ON FUNCTION "public"."st_hasarc"("geometry" "public"."geometry") TO "anon";
GRANT ALL ON FUNCTION "public"."st_hasarc"("geometry" "public"."geometry") TO "authenticated";
GRANT ALL ON FUNCTION "public"."st_hasarc"("geometry" "public"."geometry") TO "service_role";



GRANT ALL ON FUNCTION "public"."st_hausdorffdistance"("geom1" "public"."geometry", "geom2" "public"."geometry") TO "postgres";
GRANT ALL ON FUNCTION "public"."st_hausdorffdistance"("geom1" "public"."geometry", "geom2" "public"."geometry") TO "anon";
GRANT ALL ON FUNCTION "public"."st_hausdorffdistance"("geom1" "public"."geometry", "geom2" "public"."geometry") TO "authenticated";
GRANT ALL ON FUNCTION "public"."st_hausdorffdistance"("geom1" "public"."geometry", "geom2" "public"."geometry") TO "service_role";



GRANT ALL ON FUNCTION "public"."st_hausdorffdistance"("geom1" "public"."geometry", "geom2" "public"."geometry", double precision) TO "postgres";
GRANT ALL ON FUNCTION "public"."st_hausdorffdistance"("geom1" "public"."geometry", "geom2" "public"."geometry", double precision) TO "anon";
GRANT ALL ON FUNCTION "public"."st_hausdorffdistance"("geom1" "public"."geometry", "geom2" "public"."geometry", double precision) TO "authenticated";
GRANT ALL ON FUNCTION "public"."st_hausdorffdistance"("geom1" "public"."geometry", "geom2" "public"."geometry", double precision) TO "service_role";



GRANT ALL ON FUNCTION "public"."st_hexagon"("size" double precision, "cell_i" integer, "cell_j" integer, "origin" "public"."geometry") TO "postgres";
GRANT ALL ON FUNCTION "public"."st_hexagon"("size" double precision, "cell_i" integer, "cell_j" integer, "origin" "public"."geometry") TO "anon";
GRANT ALL ON FUNCTION "public"."st_hexagon"("size" double precision, "cell_i" integer, "cell_j" integer, "origin" "public"."geometry") TO "authenticated";
GRANT ALL ON FUNCTION "public"."st_hexagon"("size" double precision, "cell_i" integer, "cell_j" integer, "origin" "public"."geometry") TO "service_role";



GRANT ALL ON FUNCTION "public"."st_hexagongrid"("size" double precision, "bounds" "public"."geometry", OUT "geom" "public"."geometry", OUT "i" integer, OUT "j" integer) TO "postgres";
GRANT ALL ON FUNCTION "public"."st_hexagongrid"("size" double precision, "bounds" "public"."geometry", OUT "geom" "public"."geometry", OUT "i" integer, OUT "j" integer) TO "anon";
GRANT ALL ON FUNCTION "public"."st_hexagongrid"("size" double precision, "bounds" "public"."geometry", OUT "geom" "public"."geometry", OUT "i" integer, OUT "j" integer) TO "authenticated";
GRANT ALL ON FUNCTION "public"."st_hexagongrid"("size" double precision, "bounds" "public"."geometry", OUT "geom" "public"."geometry", OUT "i" integer, OUT "j" integer) TO "service_role";



GRANT ALL ON FUNCTION "public"."st_interiorringn"("public"."geometry", integer) TO "postgres";
GRANT ALL ON FUNCTION "public"."st_interiorringn"("public"."geometry", integer) TO "anon";
GRANT ALL ON FUNCTION "public"."st_interiorringn"("public"."geometry", integer) TO "authenticated";
GRANT ALL ON FUNCTION "public"."st_interiorringn"("public"."geometry", integer) TO "service_role";



GRANT ALL ON FUNCTION "public"."st_interpolatepoint"("line" "public"."geometry", "point" "public"."geometry") TO "postgres";
GRANT ALL ON FUNCTION "public"."st_interpolatepoint"("line" "public"."geometry", "point" "public"."geometry") TO "anon";
GRANT ALL ON FUNCTION "public"."st_interpolatepoint"("line" "public"."geometry", "point" "public"."geometry") TO "authenticated";
GRANT ALL ON FUNCTION "public"."st_interpolatepoint"("line" "public"."geometry", "point" "public"."geometry") TO "service_role";



GRANT ALL ON FUNCTION "public"."st_intersection"("text", "text") TO "postgres";
GRANT ALL ON FUNCTION "public"."st_intersection"("text", "text") TO "anon";
GRANT ALL ON FUNCTION "public"."st_intersection"("text", "text") TO "authenticated";
GRANT ALL ON FUNCTION "public"."st_intersection"("text", "text") TO "service_role";



GRANT ALL ON FUNCTION "public"."st_intersection"("public"."geography", "public"."geography") TO "postgres";
GRANT ALL ON FUNCTION "public"."st_intersection"("public"."geography", "public"."geography") TO "anon";
GRANT ALL ON FUNCTION "public"."st_intersection"("public"."geography", "public"."geography") TO "authenticated";
GRANT ALL ON FUNCTION "public"."st_intersection"("public"."geography", "public"."geography") TO "service_role";



GRANT ALL ON FUNCTION "public"."st_intersection"("geom1" "public"."geometry", "geom2" "public"."geometry", "gridsize" double precision) TO "postgres";
GRANT ALL ON FUNCTION "public"."st_intersection"("geom1" "public"."geometry", "geom2" "public"."geometry", "gridsize" double precision) TO "anon";
GRANT ALL ON FUNCTION "public"."st_intersection"("geom1" "public"."geometry", "geom2" "public"."geometry", "gridsize" double precision) TO "authenticated";
GRANT ALL ON FUNCTION "public"."st_intersection"("geom1" "public"."geometry", "geom2" "public"."geometry", "gridsize" double precision) TO "service_role";



GRANT ALL ON FUNCTION "public"."st_intersects"("text", "text") TO "postgres";
GRANT ALL ON FUNCTION "public"."st_intersects"("text", "text") TO "anon";
GRANT ALL ON FUNCTION "public"."st_intersects"("text", "text") TO "authenticated";
GRANT ALL ON FUNCTION "public"."st_intersects"("text", "text") TO "service_role";



GRANT ALL ON FUNCTION "public"."st_intersects"("geog1" "public"."geography", "geog2" "public"."geography") TO "postgres";
GRANT ALL ON FUNCTION "public"."st_intersects"("geog1" "public"."geography", "geog2" "public"."geography") TO "anon";
GRANT ALL ON FUNCTION "public"."st_intersects"("geog1" "public"."geography", "geog2" "public"."geography") TO "authenticated";
GRANT ALL ON FUNCTION "public"."st_intersects"("geog1" "public"."geography", "geog2" "public"."geography") TO "service_role";



GRANT ALL ON FUNCTION "public"."st_intersects"("geom1" "public"."geometry", "geom2" "public"."geometry") TO "postgres";
GRANT ALL ON FUNCTION "public"."st_intersects"("geom1" "public"."geometry", "geom2" "public"."geometry") TO "anon";
GRANT ALL ON FUNCTION "public"."st_intersects"("geom1" "public"."geometry", "geom2" "public"."geometry") TO "authenticated";
GRANT ALL ON FUNCTION "public"."st_intersects"("geom1" "public"."geometry", "geom2" "public"."geometry") TO "service_role";



GRANT ALL ON FUNCTION "public"."st_isclosed"("public"."geometry") TO "postgres";
GRANT ALL ON FUNCTION "public"."st_isclosed"("public"."geometry") TO "anon";
GRANT ALL ON FUNCTION "public"."st_isclosed"("public"."geometry") TO "authenticated";
GRANT ALL ON FUNCTION "public"."st_isclosed"("public"."geometry") TO "service_role";



GRANT ALL ON FUNCTION "public"."st_iscollection"("public"."geometry") TO "postgres";
GRANT ALL ON FUNCTION "public"."st_iscollection"("public"."geometry") TO "anon";
GRANT ALL ON FUNCTION "public"."st_iscollection"("public"."geometry") TO "authenticated";
GRANT ALL ON FUNCTION "public"."st_iscollection"("public"."geometry") TO "service_role";



GRANT ALL ON FUNCTION "public"."st_isempty"("public"."geometry") TO "postgres";
GRANT ALL ON FUNCTION "public"."st_isempty"("public"."geometry") TO "anon";
GRANT ALL ON FUNCTION "public"."st_isempty"("public"."geometry") TO "authenticated";
GRANT ALL ON FUNCTION "public"."st_isempty"("public"."geometry") TO "service_role";



GRANT ALL ON FUNCTION "public"."st_ispolygonccw"("public"."geometry") TO "postgres";
GRANT ALL ON FUNCTION "public"."st_ispolygonccw"("public"."geometry") TO "anon";
GRANT ALL ON FUNCTION "public"."st_ispolygonccw"("public"."geometry") TO "authenticated";
GRANT ALL ON FUNCTION "public"."st_ispolygonccw"("public"."geometry") TO "service_role";



GRANT ALL ON FUNCTION "public"."st_ispolygoncw"("public"."geometry") TO "postgres";
GRANT ALL ON FUNCTION "public"."st_ispolygoncw"("public"."geometry") TO "anon";
GRANT ALL ON FUNCTION "public"."st_ispolygoncw"("public"."geometry") TO "authenticated";
GRANT ALL ON FUNCTION "public"."st_ispolygoncw"("public"."geometry") TO "service_role";



GRANT ALL ON FUNCTION "public"."st_isring"("public"."geometry") TO "postgres";
GRANT ALL ON FUNCTION "public"."st_isring"("public"."geometry") TO "anon";
GRANT ALL ON FUNCTION "public"."st_isring"("public"."geometry") TO "authenticated";
GRANT ALL ON FUNCTION "public"."st_isring"("public"."geometry") TO "service_role";



GRANT ALL ON FUNCTION "public"."st_issimple"("public"."geometry") TO "postgres";
GRANT ALL ON FUNCTION "public"."st_issimple"("public"."geometry") TO "anon";
GRANT ALL ON FUNCTION "public"."st_issimple"("public"."geometry") TO "authenticated";
GRANT ALL ON FUNCTION "public"."st_issimple"("public"."geometry") TO "service_role";



GRANT ALL ON FUNCTION "public"."st_isvalid"("public"."geometry") TO "postgres";
GRANT ALL ON FUNCTION "public"."st_isvalid"("public"."geometry") TO "anon";
GRANT ALL ON FUNCTION "public"."st_isvalid"("public"."geometry") TO "authenticated";
GRANT ALL ON FUNCTION "public"."st_isvalid"("public"."geometry") TO "service_role";



GRANT ALL ON FUNCTION "public"."st_isvalid"("public"."geometry", integer) TO "postgres";
GRANT ALL ON FUNCTION "public"."st_isvalid"("public"."geometry", integer) TO "anon";
GRANT ALL ON FUNCTION "public"."st_isvalid"("public"."geometry", integer) TO "authenticated";
GRANT ALL ON FUNCTION "public"."st_isvalid"("public"."geometry", integer) TO "service_role";



GRANT ALL ON FUNCTION "public"."st_isvaliddetail"("geom" "public"."geometry", "flags" integer) TO "postgres";
GRANT ALL ON FUNCTION "public"."st_isvaliddetail"("geom" "public"."geometry", "flags" integer) TO "anon";
GRANT ALL ON FUNCTION "public"."st_isvaliddetail"("geom" "public"."geometry", "flags" integer) TO "authenticated";
GRANT ALL ON FUNCTION "public"."st_isvaliddetail"("geom" "public"."geometry", "flags" integer) TO "service_role";



GRANT ALL ON FUNCTION "public"."st_isvalidreason"("public"."geometry") TO "postgres";
GRANT ALL ON FUNCTION "public"."st_isvalidreason"("public"."geometry") TO "anon";
GRANT ALL ON FUNCTION "public"."st_isvalidreason"("public"."geometry") TO "authenticated";
GRANT ALL ON FUNCTION "public"."st_isvalidreason"("public"."geometry") TO "service_role";



GRANT ALL ON FUNCTION "public"."st_isvalidreason"("public"."geometry", integer) TO "postgres";
GRANT ALL ON FUNCTION "public"."st_isvalidreason"("public"."geometry", integer) TO "anon";
GRANT ALL ON FUNCTION "public"."st_isvalidreason"("public"."geometry", integer) TO "authenticated";
GRANT ALL ON FUNCTION "public"."st_isvalidreason"("public"."geometry", integer) TO "service_role";



GRANT ALL ON FUNCTION "public"."st_isvalidtrajectory"("public"."geometry") TO "postgres";
GRANT ALL ON FUNCTION "public"."st_isvalidtrajectory"("public"."geometry") TO "anon";
GRANT ALL ON FUNCTION "public"."st_isvalidtrajectory"("public"."geometry") TO "authenticated";
GRANT ALL ON FUNCTION "public"."st_isvalidtrajectory"("public"."geometry") TO "service_role";



GRANT ALL ON FUNCTION "public"."st_length"("text") TO "postgres";
GRANT ALL ON FUNCTION "public"."st_length"("text") TO "anon";
GRANT ALL ON FUNCTION "public"."st_length"("text") TO "authenticated";
GRANT ALL ON FUNCTION "public"."st_length"("text") TO "service_role";



GRANT ALL ON FUNCTION "public"."st_length"("public"."geometry") TO "postgres";
GRANT ALL ON FUNCTION "public"."st_length"("public"."geometry") TO "anon";
GRANT ALL ON FUNCTION "public"."st_length"("public"."geometry") TO "authenticated";
GRANT ALL ON FUNCTION "public"."st_length"("public"."geometry") TO "service_role";



GRANT ALL ON FUNCTION "public"."st_length"("geog" "public"."geography", "use_spheroid" boolean) TO "postgres";
GRANT ALL ON FUNCTION "public"."st_length"("geog" "public"."geography", "use_spheroid" boolean) TO "anon";
GRANT ALL ON FUNCTION "public"."st_length"("geog" "public"."geography", "use_spheroid" boolean) TO "authenticated";
GRANT ALL ON FUNCTION "public"."st_length"("geog" "public"."geography", "use_spheroid" boolean) TO "service_role";



GRANT ALL ON FUNCTION "public"."st_length2d"("public"."geometry") TO "postgres";
GRANT ALL ON FUNCTION "public"."st_length2d"("public"."geometry") TO "anon";
GRANT ALL ON FUNCTION "public"."st_length2d"("public"."geometry") TO "authenticated";
GRANT ALL ON FUNCTION "public"."st_length2d"("public"."geometry") TO "service_role";



GRANT ALL ON FUNCTION "public"."st_length2dspheroid"("public"."geometry", "public"."spheroid") TO "postgres";
GRANT ALL ON FUNCTION "public"."st_length2dspheroid"("public"."geometry", "public"."spheroid") TO "anon";
GRANT ALL ON FUNCTION "public"."st_length2dspheroid"("public"."geometry", "public"."spheroid") TO "authenticated";
GRANT ALL ON FUNCTION "public"."st_length2dspheroid"("public"."geometry", "public"."spheroid") TO "service_role";



GRANT ALL ON FUNCTION "public"."st_lengthspheroid"("public"."geometry", "public"."spheroid") TO "postgres";
GRANT ALL ON FUNCTION "public"."st_lengthspheroid"("public"."geometry", "public"."spheroid") TO "anon";
GRANT ALL ON FUNCTION "public"."st_lengthspheroid"("public"."geometry", "public"."spheroid") TO "authenticated";
GRANT ALL ON FUNCTION "public"."st_lengthspheroid"("public"."geometry", "public"."spheroid") TO "service_role";



GRANT ALL ON FUNCTION "public"."st_letters"("letters" "text", "font" json) TO "postgres";
GRANT ALL ON FUNCTION "public"."st_letters"("letters" "text", "font" json) TO "anon";
GRANT ALL ON FUNCTION "public"."st_letters"("letters" "text", "font" json) TO "authenticated";
GRANT ALL ON FUNCTION "public"."st_letters"("letters" "text", "font" json) TO "service_role";



GRANT ALL ON FUNCTION "public"."st_linecrossingdirection"("line1" "public"."geometry", "line2" "public"."geometry") TO "postgres";
GRANT ALL ON FUNCTION "public"."st_linecrossingdirection"("line1" "public"."geometry", "line2" "public"."geometry") TO "anon";
GRANT ALL ON FUNCTION "public"."st_linecrossingdirection"("line1" "public"."geometry", "line2" "public"."geometry") TO "authenticated";
GRANT ALL ON FUNCTION "public"."st_linecrossingdirection"("line1" "public"."geometry", "line2" "public"."geometry") TO "service_role";



GRANT ALL ON FUNCTION "public"."st_linefromencodedpolyline"("txtin" "text", "nprecision" integer) TO "postgres";
GRANT ALL ON FUNCTION "public"."st_linefromencodedpolyline"("txtin" "text", "nprecision" integer) TO "anon";
GRANT ALL ON FUNCTION "public"."st_linefromencodedpolyline"("txtin" "text", "nprecision" integer) TO "authenticated";
GRANT ALL ON FUNCTION "public"."st_linefromencodedpolyline"("txtin" "text", "nprecision" integer) TO "service_role";



GRANT ALL ON FUNCTION "public"."st_linefrommultipoint"("public"."geometry") TO "postgres";
GRANT ALL ON FUNCTION "public"."st_linefrommultipoint"("public"."geometry") TO "anon";
GRANT ALL ON FUNCTION "public"."st_linefrommultipoint"("public"."geometry") TO "authenticated";
GRANT ALL ON FUNCTION "public"."st_linefrommultipoint"("public"."geometry") TO "service_role";



GRANT ALL ON FUNCTION "public"."st_linefromtext"("text") TO "postgres";
GRANT ALL ON FUNCTION "public"."st_linefromtext"("text") TO "anon";
GRANT ALL ON FUNCTION "public"."st_linefromtext"("text") TO "authenticated";
GRANT ALL ON FUNCTION "public"."st_linefromtext"("text") TO "service_role";



GRANT ALL ON FUNCTION "public"."st_linefromtext"("text", integer) TO "postgres";
GRANT ALL ON FUNCTION "public"."st_linefromtext"("text", integer) TO "anon";
GRANT ALL ON FUNCTION "public"."st_linefromtext"("text", integer) TO "authenticated";
GRANT ALL ON FUNCTION "public"."st_linefromtext"("text", integer) TO "service_role";



GRANT ALL ON FUNCTION "public"."st_linefromwkb"("bytea") TO "postgres";
GRANT ALL ON FUNCTION "public"."st_linefromwkb"("bytea") TO "anon";
GRANT ALL ON FUNCTION "public"."st_linefromwkb"("bytea") TO "authenticated";
GRANT ALL ON FUNCTION "public"."st_linefromwkb"("bytea") TO "service_role";



GRANT ALL ON FUNCTION "public"."st_linefromwkb"("bytea", integer) TO "postgres";
GRANT ALL ON FUNCTION "public"."st_linefromwkb"("bytea", integer) TO "anon";
GRANT ALL ON FUNCTION "public"."st_linefromwkb"("bytea", integer) TO "authenticated";
GRANT ALL ON FUNCTION "public"."st_linefromwkb"("bytea", integer) TO "service_role";



GRANT ALL ON FUNCTION "public"."st_lineinterpolatepoint"("public"."geometry", double precision) TO "postgres";
GRANT ALL ON FUNCTION "public"."st_lineinterpolatepoint"("public"."geometry", double precision) TO "anon";
GRANT ALL ON FUNCTION "public"."st_lineinterpolatepoint"("public"."geometry", double precision) TO "authenticated";
GRANT ALL ON FUNCTION "public"."st_lineinterpolatepoint"("public"."geometry", double precision) TO "service_role";



GRANT ALL ON FUNCTION "public"."st_lineinterpolatepoints"("public"."geometry", double precision, "repeat" boolean) TO "postgres";
GRANT ALL ON FUNCTION "public"."st_lineinterpolatepoints"("public"."geometry", double precision, "repeat" boolean) TO "anon";
GRANT ALL ON FUNCTION "public"."st_lineinterpolatepoints"("public"."geometry", double precision, "repeat" boolean) TO "authenticated";
GRANT ALL ON FUNCTION "public"."st_lineinterpolatepoints"("public"."geometry", double precision, "repeat" boolean) TO "service_role";



GRANT ALL ON FUNCTION "public"."st_linelocatepoint"("geom1" "public"."geometry", "geom2" "public"."geometry") TO "postgres";
GRANT ALL ON FUNCTION "public"."st_linelocatepoint"("geom1" "public"."geometry", "geom2" "public"."geometry") TO "anon";
GRANT ALL ON FUNCTION "public"."st_linelocatepoint"("geom1" "public"."geometry", "geom2" "public"."geometry") TO "authenticated";
GRANT ALL ON FUNCTION "public"."st_linelocatepoint"("geom1" "public"."geometry", "geom2" "public"."geometry") TO "service_role";



GRANT ALL ON FUNCTION "public"."st_linemerge"("public"."geometry") TO "postgres";
GRANT ALL ON FUNCTION "public"."st_linemerge"("public"."geometry") TO "anon";
GRANT ALL ON FUNCTION "public"."st_linemerge"("public"."geometry") TO "authenticated";
GRANT ALL ON FUNCTION "public"."st_linemerge"("public"."geometry") TO "service_role";



GRANT ALL ON FUNCTION "public"."st_linemerge"("public"."geometry", boolean) TO "postgres";
GRANT ALL ON FUNCTION "public"."st_linemerge"("public"."geometry", boolean) TO "anon";
GRANT ALL ON FUNCTION "public"."st_linemerge"("public"."geometry", boolean) TO "authenticated";
GRANT ALL ON FUNCTION "public"."st_linemerge"("public"."geometry", boolean) TO "service_role";



GRANT ALL ON FUNCTION "public"."st_linestringfromwkb"("bytea") TO "postgres";
GRANT ALL ON FUNCTION "public"."st_linestringfromwkb"("bytea") TO "anon";
GRANT ALL ON FUNCTION "public"."st_linestringfromwkb"("bytea") TO "authenticated";
GRANT ALL ON FUNCTION "public"."st_linestringfromwkb"("bytea") TO "service_role";



GRANT ALL ON FUNCTION "public"."st_linestringfromwkb"("bytea", integer) TO "postgres";
GRANT ALL ON FUNCTION "public"."st_linestringfromwkb"("bytea", integer) TO "anon";
GRANT ALL ON FUNCTION "public"."st_linestringfromwkb"("bytea", integer) TO "authenticated";
GRANT ALL ON FUNCTION "public"."st_linestringfromwkb"("bytea", integer) TO "service_role";



GRANT ALL ON FUNCTION "public"."st_linesubstring"("public"."geometry", double precision, double precision) TO "postgres";
GRANT ALL ON FUNCTION "public"."st_linesubstring"("public"."geometry", double precision, double precision) TO "anon";
GRANT ALL ON FUNCTION "public"."st_linesubstring"("public"."geometry", double precision, double precision) TO "authenticated";
GRANT ALL ON FUNCTION "public"."st_linesubstring"("public"."geometry", double precision, double precision) TO "service_role";



GRANT ALL ON FUNCTION "public"."st_linetocurve"("geometry" "public"."geometry") TO "postgres";
GRANT ALL ON FUNCTION "public"."st_linetocurve"("geometry" "public"."geometry") TO "anon";
GRANT ALL ON FUNCTION "public"."st_linetocurve"("geometry" "public"."geometry") TO "authenticated";
GRANT ALL ON FUNCTION "public"."st_linetocurve"("geometry" "public"."geometry") TO "service_role";



GRANT ALL ON FUNCTION "public"."st_locatealong"("geometry" "public"."geometry", "measure" double precision, "leftrightoffset" double precision) TO "postgres";
GRANT ALL ON FUNCTION "public"."st_locatealong"("geometry" "public"."geometry", "measure" double precision, "leftrightoffset" double precision) TO "anon";
GRANT ALL ON FUNCTION "public"."st_locatealong"("geometry" "public"."geometry", "measure" double precision, "leftrightoffset" double precision) TO "authenticated";
GRANT ALL ON FUNCTION "public"."st_locatealong"("geometry" "public"."geometry", "measure" double precision, "leftrightoffset" double precision) TO "service_role";



GRANT ALL ON FUNCTION "public"."st_locatebetween"("geometry" "public"."geometry", "frommeasure" double precision, "tomeasure" double precision, "leftrightoffset" double precision) TO "postgres";
GRANT ALL ON FUNCTION "public"."st_locatebetween"("geometry" "public"."geometry", "frommeasure" double precision, "tomeasure" double precision, "leftrightoffset" double precision) TO "anon";
GRANT ALL ON FUNCTION "public"."st_locatebetween"("geometry" "public"."geometry", "frommeasure" double precision, "tomeasure" double precision, "leftrightoffset" double precision) TO "authenticated";
GRANT ALL ON FUNCTION "public"."st_locatebetween"("geometry" "public"."geometry", "frommeasure" double precision, "tomeasure" double precision, "leftrightoffset" double precision) TO "service_role";



GRANT ALL ON FUNCTION "public"."st_locatebetweenelevations"("geometry" "public"."geometry", "fromelevation" double precision, "toelevation" double precision) TO "postgres";
GRANT ALL ON FUNCTION "public"."st_locatebetweenelevations"("geometry" "public"."geometry", "fromelevation" double precision, "toelevation" double precision) TO "anon";
GRANT ALL ON FUNCTION "public"."st_locatebetweenelevations"("geometry" "public"."geometry", "fromelevation" double precision, "toelevation" double precision) TO "authenticated";
GRANT ALL ON FUNCTION "public"."st_locatebetweenelevations"("geometry" "public"."geometry", "fromelevation" double precision, "toelevation" double precision) TO "service_role";



GRANT ALL ON FUNCTION "public"."st_longestline"("geom1" "public"."geometry", "geom2" "public"."geometry") TO "postgres";
GRANT ALL ON FUNCTION "public"."st_longestline"("geom1" "public"."geometry", "geom2" "public"."geometry") TO "anon";
GRANT ALL ON FUNCTION "public"."st_longestline"("geom1" "public"."geometry", "geom2" "public"."geometry") TO "authenticated";
GRANT ALL ON FUNCTION "public"."st_longestline"("geom1" "public"."geometry", "geom2" "public"."geometry") TO "service_role";



GRANT ALL ON FUNCTION "public"."st_m"("public"."geometry") TO "postgres";
GRANT ALL ON FUNCTION "public"."st_m"("public"."geometry") TO "anon";
GRANT ALL ON FUNCTION "public"."st_m"("public"."geometry") TO "authenticated";
GRANT ALL ON FUNCTION "public"."st_m"("public"."geometry") TO "service_role";



GRANT ALL ON FUNCTION "public"."st_makebox2d"("geom1" "public"."geometry", "geom2" "public"."geometry") TO "postgres";
GRANT ALL ON FUNCTION "public"."st_makebox2d"("geom1" "public"."geometry", "geom2" "public"."geometry") TO "anon";
GRANT ALL ON FUNCTION "public"."st_makebox2d"("geom1" "public"."geometry", "geom2" "public"."geometry") TO "authenticated";
GRANT ALL ON FUNCTION "public"."st_makebox2d"("geom1" "public"."geometry", "geom2" "public"."geometry") TO "service_role";



GRANT ALL ON FUNCTION "public"."st_makeenvelope"(double precision, double precision, double precision, double precision, integer) TO "postgres";
GRANT ALL ON FUNCTION "public"."st_makeenvelope"(double precision, double precision, double precision, double precision, integer) TO "anon";
GRANT ALL ON FUNCTION "public"."st_makeenvelope"(double precision, double precision, double precision, double precision, integer) TO "authenticated";
GRANT ALL ON FUNCTION "public"."st_makeenvelope"(double precision, double precision, double precision, double precision, integer) TO "service_role";



GRANT ALL ON FUNCTION "public"."st_makeline"("public"."geometry"[]) TO "postgres";
GRANT ALL ON FUNCTION "public"."st_makeline"("public"."geometry"[]) TO "anon";
GRANT ALL ON FUNCTION "public"."st_makeline"("public"."geometry"[]) TO "authenticated";
GRANT ALL ON FUNCTION "public"."st_makeline"("public"."geometry"[]) TO "service_role";



GRANT ALL ON FUNCTION "public"."st_makeline"("geom1" "public"."geometry", "geom2" "public"."geometry") TO "postgres";
GRANT ALL ON FUNCTION "public"."st_makeline"("geom1" "public"."geometry", "geom2" "public"."geometry") TO "anon";
GRANT ALL ON FUNCTION "public"."st_makeline"("geom1" "public"."geometry", "geom2" "public"."geometry") TO "authenticated";
GRANT ALL ON FUNCTION "public"."st_makeline"("geom1" "public"."geometry", "geom2" "public"."geometry") TO "service_role";



GRANT ALL ON FUNCTION "public"."st_makepoint"(double precision, double precision) TO "postgres";
GRANT ALL ON FUNCTION "public"."st_makepoint"(double precision, double precision) TO "anon";
GRANT ALL ON FUNCTION "public"."st_makepoint"(double precision, double precision) TO "authenticated";
GRANT ALL ON FUNCTION "public"."st_makepoint"(double precision, double precision) TO "service_role";



GRANT ALL ON FUNCTION "public"."st_makepoint"(double precision, double precision, double precision) TO "postgres";
GRANT ALL ON FUNCTION "public"."st_makepoint"(double precision, double precision, double precision) TO "anon";
GRANT ALL ON FUNCTION "public"."st_makepoint"(double precision, double precision, double precision) TO "authenticated";
GRANT ALL ON FUNCTION "public"."st_makepoint"(double precision, double precision, double precision) TO "service_role";



GRANT ALL ON FUNCTION "public"."st_makepoint"(double precision, double precision, double precision, double precision) TO "postgres";
GRANT ALL ON FUNCTION "public"."st_makepoint"(double precision, double precision, double precision, double precision) TO "anon";
GRANT ALL ON FUNCTION "public"."st_makepoint"(double precision, double precision, double precision, double precision) TO "authenticated";
GRANT ALL ON FUNCTION "public"."st_makepoint"(double precision, double precision, double precision, double precision) TO "service_role";



GRANT ALL ON FUNCTION "public"."st_makepointm"(double precision, double precision, double precision) TO "postgres";
GRANT ALL ON FUNCTION "public"."st_makepointm"(double precision, double precision, double precision) TO "anon";
GRANT ALL ON FUNCTION "public"."st_makepointm"(double precision, double precision, double precision) TO "authenticated";
GRANT ALL ON FUNCTION "public"."st_makepointm"(double precision, double precision, double precision) TO "service_role";



GRANT ALL ON FUNCTION "public"."st_makepolygon"("public"."geometry") TO "postgres";
GRANT ALL ON FUNCTION "public"."st_makepolygon"("public"."geometry") TO "anon";
GRANT ALL ON FUNCTION "public"."st_makepolygon"("public"."geometry") TO "authenticated";
GRANT ALL ON FUNCTION "public"."st_makepolygon"("public"."geometry") TO "service_role";



GRANT ALL ON FUNCTION "public"."st_makepolygon"("public"."geometry", "public"."geometry"[]) TO "postgres";
GRANT ALL ON FUNCTION "public"."st_makepolygon"("public"."geometry", "public"."geometry"[]) TO "anon";
GRANT ALL ON FUNCTION "public"."st_makepolygon"("public"."geometry", "public"."geometry"[]) TO "authenticated";
GRANT ALL ON FUNCTION "public"."st_makepolygon"("public"."geometry", "public"."geometry"[]) TO "service_role";



GRANT ALL ON FUNCTION "public"."st_makevalid"("public"."geometry") TO "postgres";
GRANT ALL ON FUNCTION "public"."st_makevalid"("public"."geometry") TO "anon";
GRANT ALL ON FUNCTION "public"."st_makevalid"("public"."geometry") TO "authenticated";
GRANT ALL ON FUNCTION "public"."st_makevalid"("public"."geometry") TO "service_role";



GRANT ALL ON FUNCTION "public"."st_makevalid"("geom" "public"."geometry", "params" "text") TO "postgres";
GRANT ALL ON FUNCTION "public"."st_makevalid"("geom" "public"."geometry", "params" "text") TO "anon";
GRANT ALL ON FUNCTION "public"."st_makevalid"("geom" "public"."geometry", "params" "text") TO "authenticated";
GRANT ALL ON FUNCTION "public"."st_makevalid"("geom" "public"."geometry", "params" "text") TO "service_role";



GRANT ALL ON FUNCTION "public"."st_maxdistance"("geom1" "public"."geometry", "geom2" "public"."geometry") TO "postgres";
GRANT ALL ON FUNCTION "public"."st_maxdistance"("geom1" "public"."geometry", "geom2" "public"."geometry") TO "anon";
GRANT ALL ON FUNCTION "public"."st_maxdistance"("geom1" "public"."geometry", "geom2" "public"."geometry") TO "authenticated";
GRANT ALL ON FUNCTION "public"."st_maxdistance"("geom1" "public"."geometry", "geom2" "public"."geometry") TO "service_role";



GRANT ALL ON FUNCTION "public"."st_maximuminscribedcircle"("public"."geometry", OUT "center" "public"."geometry", OUT "nearest" "public"."geometry", OUT "radius" double precision) TO "postgres";
GRANT ALL ON FUNCTION "public"."st_maximuminscribedcircle"("public"."geometry", OUT "center" "public"."geometry", OUT "nearest" "public"."geometry", OUT "radius" double precision) TO "anon";
GRANT ALL ON FUNCTION "public"."st_maximuminscribedcircle"("public"."geometry", OUT "center" "public"."geometry", OUT "nearest" "public"."geometry", OUT "radius" double precision) TO "authenticated";
GRANT ALL ON FUNCTION "public"."st_maximuminscribedcircle"("public"."geometry", OUT "center" "public"."geometry", OUT "nearest" "public"."geometry", OUT "radius" double precision) TO "service_role";



GRANT ALL ON FUNCTION "public"."st_memsize"("public"."geometry") TO "postgres";
GRANT ALL ON FUNCTION "public"."st_memsize"("public"."geometry") TO "anon";
GRANT ALL ON FUNCTION "public"."st_memsize"("public"."geometry") TO "authenticated";
GRANT ALL ON FUNCTION "public"."st_memsize"("public"."geometry") TO "service_role";



GRANT ALL ON FUNCTION "public"."st_minimumboundingcircle"("inputgeom" "public"."geometry", "segs_per_quarter" integer) TO "postgres";
GRANT ALL ON FUNCTION "public"."st_minimumboundingcircle"("inputgeom" "public"."geometry", "segs_per_quarter" integer) TO "anon";
GRANT ALL ON FUNCTION "public"."st_minimumboundingcircle"("inputgeom" "public"."geometry", "segs_per_quarter" integer) TO "authenticated";
GRANT ALL ON FUNCTION "public"."st_minimumboundingcircle"("inputgeom" "public"."geometry", "segs_per_quarter" integer) TO "service_role";



GRANT ALL ON FUNCTION "public"."st_minimumboundingradius"("public"."geometry", OUT "center" "public"."geometry", OUT "radius" double precision) TO "postgres";
GRANT ALL ON FUNCTION "public"."st_minimumboundingradius"("public"."geometry", OUT "center" "public"."geometry", OUT "radius" double precision) TO "anon";
GRANT ALL ON FUNCTION "public"."st_minimumboundingradius"("public"."geometry", OUT "center" "public"."geometry", OUT "radius" double precision) TO "authenticated";
GRANT ALL ON FUNCTION "public"."st_minimumboundingradius"("public"."geometry", OUT "center" "public"."geometry", OUT "radius" double precision) TO "service_role";



GRANT ALL ON FUNCTION "public"."st_minimumclearance"("public"."geometry") TO "postgres";
GRANT ALL ON FUNCTION "public"."st_minimumclearance"("public"."geometry") TO "anon";
GRANT ALL ON FUNCTION "public"."st_minimumclearance"("public"."geometry") TO "authenticated";
GRANT ALL ON FUNCTION "public"."st_minimumclearance"("public"."geometry") TO "service_role";



GRANT ALL ON FUNCTION "public"."st_minimumclearanceline"("public"."geometry") TO "postgres";
GRANT ALL ON FUNCTION "public"."st_minimumclearanceline"("public"."geometry") TO "anon";
GRANT ALL ON FUNCTION "public"."st_minimumclearanceline"("public"."geometry") TO "authenticated";
GRANT ALL ON FUNCTION "public"."st_minimumclearanceline"("public"."geometry") TO "service_role";



GRANT ALL ON FUNCTION "public"."st_mlinefromtext"("text") TO "postgres";
GRANT ALL ON FUNCTION "public"."st_mlinefromtext"("text") TO "anon";
GRANT ALL ON FUNCTION "public"."st_mlinefromtext"("text") TO "authenticated";
GRANT ALL ON FUNCTION "public"."st_mlinefromtext"("text") TO "service_role";



GRANT ALL ON FUNCTION "public"."st_mlinefromtext"("text", integer) TO "postgres";
GRANT ALL ON FUNCTION "public"."st_mlinefromtext"("text", integer) TO "anon";
GRANT ALL ON FUNCTION "public"."st_mlinefromtext"("text", integer) TO "authenticated";
GRANT ALL ON FUNCTION "public"."st_mlinefromtext"("text", integer) TO "service_role";



GRANT ALL ON FUNCTION "public"."st_mlinefromwkb"("bytea") TO "postgres";
GRANT ALL ON FUNCTION "public"."st_mlinefromwkb"("bytea") TO "anon";
GRANT ALL ON FUNCTION "public"."st_mlinefromwkb"("bytea") TO "authenticated";
GRANT ALL ON FUNCTION "public"."st_mlinefromwkb"("bytea") TO "service_role";



GRANT ALL ON FUNCTION "public"."st_mlinefromwkb"("bytea", integer) TO "postgres";
GRANT ALL ON FUNCTION "public"."st_mlinefromwkb"("bytea", integer) TO "anon";
GRANT ALL ON FUNCTION "public"."st_mlinefromwkb"("bytea", integer) TO "authenticated";
GRANT ALL ON FUNCTION "public"."st_mlinefromwkb"("bytea", integer) TO "service_role";



GRANT ALL ON FUNCTION "public"."st_mpointfromtext"("text") TO "postgres";
GRANT ALL ON FUNCTION "public"."st_mpointfromtext"("text") TO "anon";
GRANT ALL ON FUNCTION "public"."st_mpointfromtext"("text") TO "authenticated";
GRANT ALL ON FUNCTION "public"."st_mpointfromtext"("text") TO "service_role";



GRANT ALL ON FUNCTION "public"."st_mpointfromtext"("text", integer) TO "postgres";
GRANT ALL ON FUNCTION "public"."st_mpointfromtext"("text", integer) TO "anon";
GRANT ALL ON FUNCTION "public"."st_mpointfromtext"("text", integer) TO "authenticated";
GRANT ALL ON FUNCTION "public"."st_mpointfromtext"("text", integer) TO "service_role";



GRANT ALL ON FUNCTION "public"."st_mpointfromwkb"("bytea") TO "postgres";
GRANT ALL ON FUNCTION "public"."st_mpointfromwkb"("bytea") TO "anon";
GRANT ALL ON FUNCTION "public"."st_mpointfromwkb"("bytea") TO "authenticated";
GRANT ALL ON FUNCTION "public"."st_mpointfromwkb"("bytea") TO "service_role";



GRANT ALL ON FUNCTION "public"."st_mpointfromwkb"("bytea", integer) TO "postgres";
GRANT ALL ON FUNCTION "public"."st_mpointfromwkb"("bytea", integer) TO "anon";
GRANT ALL ON FUNCTION "public"."st_mpointfromwkb"("bytea", integer) TO "authenticated";
GRANT ALL ON FUNCTION "public"."st_mpointfromwkb"("bytea", integer) TO "service_role";



GRANT ALL ON FUNCTION "public"."st_mpolyfromtext"("text") TO "postgres";
GRANT ALL ON FUNCTION "public"."st_mpolyfromtext"("text") TO "anon";
GRANT ALL ON FUNCTION "public"."st_mpolyfromtext"("text") TO "authenticated";
GRANT ALL ON FUNCTION "public"."st_mpolyfromtext"("text") TO "service_role";



GRANT ALL ON FUNCTION "public"."st_mpolyfromtext"("text", integer) TO "postgres";
GRANT ALL ON FUNCTION "public"."st_mpolyfromtext"("text", integer) TO "anon";
GRANT ALL ON FUNCTION "public"."st_mpolyfromtext"("text", integer) TO "authenticated";
GRANT ALL ON FUNCTION "public"."st_mpolyfromtext"("text", integer) TO "service_role";



GRANT ALL ON FUNCTION "public"."st_mpolyfromwkb"("bytea") TO "postgres";
GRANT ALL ON FUNCTION "public"."st_mpolyfromwkb"("bytea") TO "anon";
GRANT ALL ON FUNCTION "public"."st_mpolyfromwkb"("bytea") TO "authenticated";
GRANT ALL ON FUNCTION "public"."st_mpolyfromwkb"("bytea") TO "service_role";



GRANT ALL ON FUNCTION "public"."st_mpolyfromwkb"("bytea", integer) TO "postgres";
GRANT ALL ON FUNCTION "public"."st_mpolyfromwkb"("bytea", integer) TO "anon";
GRANT ALL ON FUNCTION "public"."st_mpolyfromwkb"("bytea", integer) TO "authenticated";
GRANT ALL ON FUNCTION "public"."st_mpolyfromwkb"("bytea", integer) TO "service_role";



GRANT ALL ON FUNCTION "public"."st_multi"("public"."geometry") TO "postgres";
GRANT ALL ON FUNCTION "public"."st_multi"("public"."geometry") TO "anon";
GRANT ALL ON FUNCTION "public"."st_multi"("public"."geometry") TO "authenticated";
GRANT ALL ON FUNCTION "public"."st_multi"("public"."geometry") TO "service_role";



GRANT ALL ON FUNCTION "public"."st_multilinefromwkb"("bytea") TO "postgres";
GRANT ALL ON FUNCTION "public"."st_multilinefromwkb"("bytea") TO "anon";
GRANT ALL ON FUNCTION "public"."st_multilinefromwkb"("bytea") TO "authenticated";
GRANT ALL ON FUNCTION "public"."st_multilinefromwkb"("bytea") TO "service_role";



GRANT ALL ON FUNCTION "public"."st_multilinestringfromtext"("text") TO "postgres";
GRANT ALL ON FUNCTION "public"."st_multilinestringfromtext"("text") TO "anon";
GRANT ALL ON FUNCTION "public"."st_multilinestringfromtext"("text") TO "authenticated";
GRANT ALL ON FUNCTION "public"."st_multilinestringfromtext"("text") TO "service_role";



GRANT ALL ON FUNCTION "public"."st_multilinestringfromtext"("text", integer) TO "postgres";
GRANT ALL ON FUNCTION "public"."st_multilinestringfromtext"("text", integer) TO "anon";
GRANT ALL ON FUNCTION "public"."st_multilinestringfromtext"("text", integer) TO "authenticated";
GRANT ALL ON FUNCTION "public"."st_multilinestringfromtext"("text", integer) TO "service_role";



GRANT ALL ON FUNCTION "public"."st_multipointfromtext"("text") TO "postgres";
GRANT ALL ON FUNCTION "public"."st_multipointfromtext"("text") TO "anon";
GRANT ALL ON FUNCTION "public"."st_multipointfromtext"("text") TO "authenticated";
GRANT ALL ON FUNCTION "public"."st_multipointfromtext"("text") TO "service_role";



GRANT ALL ON FUNCTION "public"."st_multipointfromwkb"("bytea") TO "postgres";
GRANT ALL ON FUNCTION "public"."st_multipointfromwkb"("bytea") TO "anon";
GRANT ALL ON FUNCTION "public"."st_multipointfromwkb"("bytea") TO "authenticated";
GRANT ALL ON FUNCTION "public"."st_multipointfromwkb"("bytea") TO "service_role";



GRANT ALL ON FUNCTION "public"."st_multipointfromwkb"("bytea", integer) TO "postgres";
GRANT ALL ON FUNCTION "public"."st_multipointfromwkb"("bytea", integer) TO "anon";
GRANT ALL ON FUNCTION "public"."st_multipointfromwkb"("bytea", integer) TO "authenticated";
GRANT ALL ON FUNCTION "public"."st_multipointfromwkb"("bytea", integer) TO "service_role";



GRANT ALL ON FUNCTION "public"."st_multipolyfromwkb"("bytea") TO "postgres";
GRANT ALL ON FUNCTION "public"."st_multipolyfromwkb"("bytea") TO "anon";
GRANT ALL ON FUNCTION "public"."st_multipolyfromwkb"("bytea") TO "authenticated";
GRANT ALL ON FUNCTION "public"."st_multipolyfromwkb"("bytea") TO "service_role";



GRANT ALL ON FUNCTION "public"."st_multipolyfromwkb"("bytea", integer) TO "postgres";
GRANT ALL ON FUNCTION "public"."st_multipolyfromwkb"("bytea", integer) TO "anon";
GRANT ALL ON FUNCTION "public"."st_multipolyfromwkb"("bytea", integer) TO "authenticated";
GRANT ALL ON FUNCTION "public"."st_multipolyfromwkb"("bytea", integer) TO "service_role";



GRANT ALL ON FUNCTION "public"."st_multipolygonfromtext"("text") TO "postgres";
GRANT ALL ON FUNCTION "public"."st_multipolygonfromtext"("text") TO "anon";
GRANT ALL ON FUNCTION "public"."st_multipolygonfromtext"("text") TO "authenticated";
GRANT ALL ON FUNCTION "public"."st_multipolygonfromtext"("text") TO "service_role";



GRANT ALL ON FUNCTION "public"."st_multipolygonfromtext"("text", integer) TO "postgres";
GRANT ALL ON FUNCTION "public"."st_multipolygonfromtext"("text", integer) TO "anon";
GRANT ALL ON FUNCTION "public"."st_multipolygonfromtext"("text", integer) TO "authenticated";
GRANT ALL ON FUNCTION "public"."st_multipolygonfromtext"("text", integer) TO "service_role";



GRANT ALL ON FUNCTION "public"."st_ndims"("public"."geometry") TO "postgres";
GRANT ALL ON FUNCTION "public"."st_ndims"("public"."geometry") TO "anon";
GRANT ALL ON FUNCTION "public"."st_ndims"("public"."geometry") TO "authenticated";
GRANT ALL ON FUNCTION "public"."st_ndims"("public"."geometry") TO "service_role";



GRANT ALL ON FUNCTION "public"."st_node"("g" "public"."geometry") TO "postgres";
GRANT ALL ON FUNCTION "public"."st_node"("g" "public"."geometry") TO "anon";
GRANT ALL ON FUNCTION "public"."st_node"("g" "public"."geometry") TO "authenticated";
GRANT ALL ON FUNCTION "public"."st_node"("g" "public"."geometry") TO "service_role";



GRANT ALL ON FUNCTION "public"."st_normalize"("geom" "public"."geometry") TO "postgres";
GRANT ALL ON FUNCTION "public"."st_normalize"("geom" "public"."geometry") TO "anon";
GRANT ALL ON FUNCTION "public"."st_normalize"("geom" "public"."geometry") TO "authenticated";
GRANT ALL ON FUNCTION "public"."st_normalize"("geom" "public"."geometry") TO "service_role";



GRANT ALL ON FUNCTION "public"."st_npoints"("public"."geometry") TO "postgres";
GRANT ALL ON FUNCTION "public"."st_npoints"("public"."geometry") TO "anon";
GRANT ALL ON FUNCTION "public"."st_npoints"("public"."geometry") TO "authenticated";
GRANT ALL ON FUNCTION "public"."st_npoints"("public"."geometry") TO "service_role";



GRANT ALL ON FUNCTION "public"."st_nrings"("public"."geometry") TO "postgres";
GRANT ALL ON FUNCTION "public"."st_nrings"("public"."geometry") TO "anon";
GRANT ALL ON FUNCTION "public"."st_nrings"("public"."geometry") TO "authenticated";
GRANT ALL ON FUNCTION "public"."st_nrings"("public"."geometry") TO "service_role";



GRANT ALL ON FUNCTION "public"."st_numgeometries"("public"."geometry") TO "postgres";
GRANT ALL ON FUNCTION "public"."st_numgeometries"("public"."geometry") TO "anon";
GRANT ALL ON FUNCTION "public"."st_numgeometries"("public"."geometry") TO "authenticated";
GRANT ALL ON FUNCTION "public"."st_numgeometries"("public"."geometry") TO "service_role";



GRANT ALL ON FUNCTION "public"."st_numinteriorring"("public"."geometry") TO "postgres";
GRANT ALL ON FUNCTION "public"."st_numinteriorring"("public"."geometry") TO "anon";
GRANT ALL ON FUNCTION "public"."st_numinteriorring"("public"."geometry") TO "authenticated";
GRANT ALL ON FUNCTION "public"."st_numinteriorring"("public"."geometry") TO "service_role";



GRANT ALL ON FUNCTION "public"."st_numinteriorrings"("public"."geometry") TO "postgres";
GRANT ALL ON FUNCTION "public"."st_numinteriorrings"("public"."geometry") TO "anon";
GRANT ALL ON FUNCTION "public"."st_numinteriorrings"("public"."geometry") TO "authenticated";
GRANT ALL ON FUNCTION "public"."st_numinteriorrings"("public"."geometry") TO "service_role";



GRANT ALL ON FUNCTION "public"."st_numpatches"("public"."geometry") TO "postgres";
GRANT ALL ON FUNCTION "public"."st_numpatches"("public"."geometry") TO "anon";
GRANT ALL ON FUNCTION "public"."st_numpatches"("public"."geometry") TO "authenticated";
GRANT ALL ON FUNCTION "public"."st_numpatches"("public"."geometry") TO "service_role";



GRANT ALL ON FUNCTION "public"."st_numpoints"("public"."geometry") TO "postgres";
GRANT ALL ON FUNCTION "public"."st_numpoints"("public"."geometry") TO "anon";
GRANT ALL ON FUNCTION "public"."st_numpoints"("public"."geometry") TO "authenticated";
GRANT ALL ON FUNCTION "public"."st_numpoints"("public"."geometry") TO "service_role";



GRANT ALL ON FUNCTION "public"."st_offsetcurve"("line" "public"."geometry", "distance" double precision, "params" "text") TO "postgres";
GRANT ALL ON FUNCTION "public"."st_offsetcurve"("line" "public"."geometry", "distance" double precision, "params" "text") TO "anon";
GRANT ALL ON FUNCTION "public"."st_offsetcurve"("line" "public"."geometry", "distance" double precision, "params" "text") TO "authenticated";
GRANT ALL ON FUNCTION "public"."st_offsetcurve"("line" "public"."geometry", "distance" double precision, "params" "text") TO "service_role";



GRANT ALL ON FUNCTION "public"."st_orderingequals"("geom1" "public"."geometry", "geom2" "public"."geometry") TO "postgres";
GRANT ALL ON FUNCTION "public"."st_orderingequals"("geom1" "public"."geometry", "geom2" "public"."geometry") TO "anon";
GRANT ALL ON FUNCTION "public"."st_orderingequals"("geom1" "public"."geometry", "geom2" "public"."geometry") TO "authenticated";
GRANT ALL ON FUNCTION "public"."st_orderingequals"("geom1" "public"."geometry", "geom2" "public"."geometry") TO "service_role";



GRANT ALL ON FUNCTION "public"."st_orientedenvelope"("public"."geometry") TO "postgres";
GRANT ALL ON FUNCTION "public"."st_orientedenvelope"("public"."geometry") TO "anon";
GRANT ALL ON FUNCTION "public"."st_orientedenvelope"("public"."geometry") TO "authenticated";
GRANT ALL ON FUNCTION "public"."st_orientedenvelope"("public"."geometry") TO "service_role";



GRANT ALL ON FUNCTION "public"."st_overlaps"("geom1" "public"."geometry", "geom2" "public"."geometry") TO "postgres";
GRANT ALL ON FUNCTION "public"."st_overlaps"("geom1" "public"."geometry", "geom2" "public"."geometry") TO "anon";
GRANT ALL ON FUNCTION "public"."st_overlaps"("geom1" "public"."geometry", "geom2" "public"."geometry") TO "authenticated";
GRANT ALL ON FUNCTION "public"."st_overlaps"("geom1" "public"."geometry", "geom2" "public"."geometry") TO "service_role";



GRANT ALL ON FUNCTION "public"."st_patchn"("public"."geometry", integer) TO "postgres";
GRANT ALL ON FUNCTION "public"."st_patchn"("public"."geometry", integer) TO "anon";
GRANT ALL ON FUNCTION "public"."st_patchn"("public"."geometry", integer) TO "authenticated";
GRANT ALL ON FUNCTION "public"."st_patchn"("public"."geometry", integer) TO "service_role";



GRANT ALL ON FUNCTION "public"."st_perimeter"("public"."geometry") TO "postgres";
GRANT ALL ON FUNCTION "public"."st_perimeter"("public"."geometry") TO "anon";
GRANT ALL ON FUNCTION "public"."st_perimeter"("public"."geometry") TO "authenticated";
GRANT ALL ON FUNCTION "public"."st_perimeter"("public"."geometry") TO "service_role";



GRANT ALL ON FUNCTION "public"."st_perimeter"("geog" "public"."geography", "use_spheroid" boolean) TO "postgres";
GRANT ALL ON FUNCTION "public"."st_perimeter"("geog" "public"."geography", "use_spheroid" boolean) TO "anon";
GRANT ALL ON FUNCTION "public"."st_perimeter"("geog" "public"."geography", "use_spheroid" boolean) TO "authenticated";
GRANT ALL ON FUNCTION "public"."st_perimeter"("geog" "public"."geography", "use_spheroid" boolean) TO "service_role";



GRANT ALL ON FUNCTION "public"."st_perimeter2d"("public"."geometry") TO "postgres";
GRANT ALL ON FUNCTION "public"."st_perimeter2d"("public"."geometry") TO "anon";
GRANT ALL ON FUNCTION "public"."st_perimeter2d"("public"."geometry") TO "authenticated";
GRANT ALL ON FUNCTION "public"."st_perimeter2d"("public"."geometry") TO "service_role";



GRANT ALL ON FUNCTION "public"."st_point"(double precision, double precision) TO "postgres";
GRANT ALL ON FUNCTION "public"."st_point"(double precision, double precision) TO "anon";
GRANT ALL ON FUNCTION "public"."st_point"(double precision, double precision) TO "authenticated";
GRANT ALL ON FUNCTION "public"."st_point"(double precision, double precision) TO "service_role";



GRANT ALL ON FUNCTION "public"."st_point"(double precision, double precision, "srid" integer) TO "postgres";
GRANT ALL ON FUNCTION "public"."st_point"(double precision, double precision, "srid" integer) TO "anon";
GRANT ALL ON FUNCTION "public"."st_point"(double precision, double precision, "srid" integer) TO "authenticated";
GRANT ALL ON FUNCTION "public"."st_point"(double precision, double precision, "srid" integer) TO "service_role";



GRANT ALL ON FUNCTION "public"."st_pointfromgeohash"("text", integer) TO "postgres";
GRANT ALL ON FUNCTION "public"."st_pointfromgeohash"("text", integer) TO "anon";
GRANT ALL ON FUNCTION "public"."st_pointfromgeohash"("text", integer) TO "authenticated";
GRANT ALL ON FUNCTION "public"."st_pointfromgeohash"("text", integer) TO "service_role";



GRANT ALL ON FUNCTION "public"."st_pointfromtext"("text") TO "postgres";
GRANT ALL ON FUNCTION "public"."st_pointfromtext"("text") TO "anon";
GRANT ALL ON FUNCTION "public"."st_pointfromtext"("text") TO "authenticated";
GRANT ALL ON FUNCTION "public"."st_pointfromtext"("text") TO "service_role";



GRANT ALL ON FUNCTION "public"."st_pointfromtext"("text", integer) TO "postgres";
GRANT ALL ON FUNCTION "public"."st_pointfromtext"("text", integer) TO "anon";
GRANT ALL ON FUNCTION "public"."st_pointfromtext"("text", integer) TO "authenticated";
GRANT ALL ON FUNCTION "public"."st_pointfromtext"("text", integer) TO "service_role";



GRANT ALL ON FUNCTION "public"."st_pointfromwkb"("bytea") TO "postgres";
GRANT ALL ON FUNCTION "public"."st_pointfromwkb"("bytea") TO "anon";
GRANT ALL ON FUNCTION "public"."st_pointfromwkb"("bytea") TO "authenticated";
GRANT ALL ON FUNCTION "public"."st_pointfromwkb"("bytea") TO "service_role";



GRANT ALL ON FUNCTION "public"."st_pointfromwkb"("bytea", integer) TO "postgres";
GRANT ALL ON FUNCTION "public"."st_pointfromwkb"("bytea", integer) TO "anon";
GRANT ALL ON FUNCTION "public"."st_pointfromwkb"("bytea", integer) TO "authenticated";
GRANT ALL ON FUNCTION "public"."st_pointfromwkb"("bytea", integer) TO "service_role";



GRANT ALL ON FUNCTION "public"."st_pointinsidecircle"("public"."geometry", double precision, double precision, double precision) TO "postgres";
GRANT ALL ON FUNCTION "public"."st_pointinsidecircle"("public"."geometry", double precision, double precision, double precision) TO "anon";
GRANT ALL ON FUNCTION "public"."st_pointinsidecircle"("public"."geometry", double precision, double precision, double precision) TO "authenticated";
GRANT ALL ON FUNCTION "public"."st_pointinsidecircle"("public"."geometry", double precision, double precision, double precision) TO "service_role";



GRANT ALL ON FUNCTION "public"."st_pointm"("xcoordinate" double precision, "ycoordinate" double precision, "mcoordinate" double precision, "srid" integer) TO "postgres";
GRANT ALL ON FUNCTION "public"."st_pointm"("xcoordinate" double precision, "ycoordinate" double precision, "mcoordinate" double precision, "srid" integer) TO "anon";
GRANT ALL ON FUNCTION "public"."st_pointm"("xcoordinate" double precision, "ycoordinate" double precision, "mcoordinate" double precision, "srid" integer) TO "authenticated";
GRANT ALL ON FUNCTION "public"."st_pointm"("xcoordinate" double precision, "ycoordinate" double precision, "mcoordinate" double precision, "srid" integer) TO "service_role";



GRANT ALL ON FUNCTION "public"."st_pointn"("public"."geometry", integer) TO "postgres";
GRANT ALL ON FUNCTION "public"."st_pointn"("public"."geometry", integer) TO "anon";
GRANT ALL ON FUNCTION "public"."st_pointn"("public"."geometry", integer) TO "authenticated";
GRANT ALL ON FUNCTION "public"."st_pointn"("public"."geometry", integer) TO "service_role";



GRANT ALL ON FUNCTION "public"."st_pointonsurface"("public"."geometry") TO "postgres";
GRANT ALL ON FUNCTION "public"."st_pointonsurface"("public"."geometry") TO "anon";
GRANT ALL ON FUNCTION "public"."st_pointonsurface"("public"."geometry") TO "authenticated";
GRANT ALL ON FUNCTION "public"."st_pointonsurface"("public"."geometry") TO "service_role";



GRANT ALL ON FUNCTION "public"."st_points"("public"."geometry") TO "postgres";
GRANT ALL ON FUNCTION "public"."st_points"("public"."geometry") TO "anon";
GRANT ALL ON FUNCTION "public"."st_points"("public"."geometry") TO "authenticated";
GRANT ALL ON FUNCTION "public"."st_points"("public"."geometry") TO "service_role";



GRANT ALL ON FUNCTION "public"."st_pointz"("xcoordinate" double precision, "ycoordinate" double precision, "zcoordinate" double precision, "srid" integer) TO "postgres";
GRANT ALL ON FUNCTION "public"."st_pointz"("xcoordinate" double precision, "ycoordinate" double precision, "zcoordinate" double precision, "srid" integer) TO "anon";
GRANT ALL ON FUNCTION "public"."st_pointz"("xcoordinate" double precision, "ycoordinate" double precision, "zcoordinate" double precision, "srid" integer) TO "authenticated";
GRANT ALL ON FUNCTION "public"."st_pointz"("xcoordinate" double precision, "ycoordinate" double precision, "zcoordinate" double precision, "srid" integer) TO "service_role";



GRANT ALL ON FUNCTION "public"."st_pointzm"("xcoordinate" double precision, "ycoordinate" double precision, "zcoordinate" double precision, "mcoordinate" double precision, "srid" integer) TO "postgres";
GRANT ALL ON FUNCTION "public"."st_pointzm"("xcoordinate" double precision, "ycoordinate" double precision, "zcoordinate" double precision, "mcoordinate" double precision, "srid" integer) TO "anon";
GRANT ALL ON FUNCTION "public"."st_pointzm"("xcoordinate" double precision, "ycoordinate" double precision, "zcoordinate" double precision, "mcoordinate" double precision, "srid" integer) TO "authenticated";
GRANT ALL ON FUNCTION "public"."st_pointzm"("xcoordinate" double precision, "ycoordinate" double precision, "zcoordinate" double precision, "mcoordinate" double precision, "srid" integer) TO "service_role";



GRANT ALL ON FUNCTION "public"."st_polyfromtext"("text") TO "postgres";
GRANT ALL ON FUNCTION "public"."st_polyfromtext"("text") TO "anon";
GRANT ALL ON FUNCTION "public"."st_polyfromtext"("text") TO "authenticated";
GRANT ALL ON FUNCTION "public"."st_polyfromtext"("text") TO "service_role";



GRANT ALL ON FUNCTION "public"."st_polyfromtext"("text", integer) TO "postgres";
GRANT ALL ON FUNCTION "public"."st_polyfromtext"("text", integer) TO "anon";
GRANT ALL ON FUNCTION "public"."st_polyfromtext"("text", integer) TO "authenticated";
GRANT ALL ON FUNCTION "public"."st_polyfromtext"("text", integer) TO "service_role";



GRANT ALL ON FUNCTION "public"."st_polyfromwkb"("bytea") TO "postgres";
GRANT ALL ON FUNCTION "public"."st_polyfromwkb"("bytea") TO "anon";
GRANT ALL ON FUNCTION "public"."st_polyfromwkb"("bytea") TO "authenticated";
GRANT ALL ON FUNCTION "public"."st_polyfromwkb"("bytea") TO "service_role";



GRANT ALL ON FUNCTION "public"."st_polyfromwkb"("bytea", integer) TO "postgres";
GRANT ALL ON FUNCTION "public"."st_polyfromwkb"("bytea", integer) TO "anon";
GRANT ALL ON FUNCTION "public"."st_polyfromwkb"("bytea", integer) TO "authenticated";
GRANT ALL ON FUNCTION "public"."st_polyfromwkb"("bytea", integer) TO "service_role";



GRANT ALL ON FUNCTION "public"."st_polygon"("public"."geometry", integer) TO "postgres";
GRANT ALL ON FUNCTION "public"."st_polygon"("public"."geometry", integer) TO "anon";
GRANT ALL ON FUNCTION "public"."st_polygon"("public"."geometry", integer) TO "authenticated";
GRANT ALL ON FUNCTION "public"."st_polygon"("public"."geometry", integer) TO "service_role";



GRANT ALL ON FUNCTION "public"."st_polygonfromtext"("text") TO "postgres";
GRANT ALL ON FUNCTION "public"."st_polygonfromtext"("text") TO "anon";
GRANT ALL ON FUNCTION "public"."st_polygonfromtext"("text") TO "authenticated";
GRANT ALL ON FUNCTION "public"."st_polygonfromtext"("text") TO "service_role";



GRANT ALL ON FUNCTION "public"."st_polygonfromtext"("text", integer) TO "postgres";
GRANT ALL ON FUNCTION "public"."st_polygonfromtext"("text", integer) TO "anon";
GRANT ALL ON FUNCTION "public"."st_polygonfromtext"("text", integer) TO "authenticated";
GRANT ALL ON FUNCTION "public"."st_polygonfromtext"("text", integer) TO "service_role";



GRANT ALL ON FUNCTION "public"."st_polygonfromwkb"("bytea") TO "postgres";
GRANT ALL ON FUNCTION "public"."st_polygonfromwkb"("bytea") TO "anon";
GRANT ALL ON FUNCTION "public"."st_polygonfromwkb"("bytea") TO "authenticated";
GRANT ALL ON FUNCTION "public"."st_polygonfromwkb"("bytea") TO "service_role";



GRANT ALL ON FUNCTION "public"."st_polygonfromwkb"("bytea", integer) TO "postgres";
GRANT ALL ON FUNCTION "public"."st_polygonfromwkb"("bytea", integer) TO "anon";
GRANT ALL ON FUNCTION "public"."st_polygonfromwkb"("bytea", integer) TO "authenticated";
GRANT ALL ON FUNCTION "public"."st_polygonfromwkb"("bytea", integer) TO "service_role";



GRANT ALL ON FUNCTION "public"."st_polygonize"("public"."geometry"[]) TO "postgres";
GRANT ALL ON FUNCTION "public"."st_polygonize"("public"."geometry"[]) TO "anon";
GRANT ALL ON FUNCTION "public"."st_polygonize"("public"."geometry"[]) TO "authenticated";
GRANT ALL ON FUNCTION "public"."st_polygonize"("public"."geometry"[]) TO "service_role";



GRANT ALL ON FUNCTION "public"."st_project"("geog" "public"."geography", "distance" double precision, "azimuth" double precision) TO "postgres";
GRANT ALL ON FUNCTION "public"."st_project"("geog" "public"."geography", "distance" double precision, "azimuth" double precision) TO "anon";
GRANT ALL ON FUNCTION "public"."st_project"("geog" "public"."geography", "distance" double precision, "azimuth" double precision) TO "authenticated";
GRANT ALL ON FUNCTION "public"."st_project"("geog" "public"."geography", "distance" double precision, "azimuth" double precision) TO "service_role";



GRANT ALL ON FUNCTION "public"."st_quantizecoordinates"("g" "public"."geometry", "prec_x" integer, "prec_y" integer, "prec_z" integer, "prec_m" integer) TO "postgres";
GRANT ALL ON FUNCTION "public"."st_quantizecoordinates"("g" "public"."geometry", "prec_x" integer, "prec_y" integer, "prec_z" integer, "prec_m" integer) TO "anon";
GRANT ALL ON FUNCTION "public"."st_quantizecoordinates"("g" "public"."geometry", "prec_x" integer, "prec_y" integer, "prec_z" integer, "prec_m" integer) TO "authenticated";
GRANT ALL ON FUNCTION "public"."st_quantizecoordinates"("g" "public"."geometry", "prec_x" integer, "prec_y" integer, "prec_z" integer, "prec_m" integer) TO "service_role";



GRANT ALL ON FUNCTION "public"."st_reduceprecision"("geom" "public"."geometry", "gridsize" double precision) TO "postgres";
GRANT ALL ON FUNCTION "public"."st_reduceprecision"("geom" "public"."geometry", "gridsize" double precision) TO "anon";
GRANT ALL ON FUNCTION "public"."st_reduceprecision"("geom" "public"."geometry", "gridsize" double precision) TO "authenticated";
GRANT ALL ON FUNCTION "public"."st_reduceprecision"("geom" "public"."geometry", "gridsize" double precision) TO "service_role";



GRANT ALL ON FUNCTION "public"."st_relate"("geom1" "public"."geometry", "geom2" "public"."geometry") TO "postgres";
GRANT ALL ON FUNCTION "public"."st_relate"("geom1" "public"."geometry", "geom2" "public"."geometry") TO "anon";
GRANT ALL ON FUNCTION "public"."st_relate"("geom1" "public"."geometry", "geom2" "public"."geometry") TO "authenticated";
GRANT ALL ON FUNCTION "public"."st_relate"("geom1" "public"."geometry", "geom2" "public"."geometry") TO "service_role";



GRANT ALL ON FUNCTION "public"."st_relate"("geom1" "public"."geometry", "geom2" "public"."geometry", integer) TO "postgres";
GRANT ALL ON FUNCTION "public"."st_relate"("geom1" "public"."geometry", "geom2" "public"."geometry", integer) TO "anon";
GRANT ALL ON FUNCTION "public"."st_relate"("geom1" "public"."geometry", "geom2" "public"."geometry", integer) TO "authenticated";
GRANT ALL ON FUNCTION "public"."st_relate"("geom1" "public"."geometry", "geom2" "public"."geometry", integer) TO "service_role";



GRANT ALL ON FUNCTION "public"."st_relate"("geom1" "public"."geometry", "geom2" "public"."geometry", "text") TO "postgres";
GRANT ALL ON FUNCTION "public"."st_relate"("geom1" "public"."geometry", "geom2" "public"."geometry", "text") TO "anon";
GRANT ALL ON FUNCTION "public"."st_relate"("geom1" "public"."geometry", "geom2" "public"."geometry", "text") TO "authenticated";
GRANT ALL ON FUNCTION "public"."st_relate"("geom1" "public"."geometry", "geom2" "public"."geometry", "text") TO "service_role";



GRANT ALL ON FUNCTION "public"."st_relatematch"("text", "text") TO "postgres";
GRANT ALL ON FUNCTION "public"."st_relatematch"("text", "text") TO "anon";
GRANT ALL ON FUNCTION "public"."st_relatematch"("text", "text") TO "authenticated";
GRANT ALL ON FUNCTION "public"."st_relatematch"("text", "text") TO "service_role";



GRANT ALL ON FUNCTION "public"."st_removepoint"("public"."geometry", integer) TO "postgres";
GRANT ALL ON FUNCTION "public"."st_removepoint"("public"."geometry", integer) TO "anon";
GRANT ALL ON FUNCTION "public"."st_removepoint"("public"."geometry", integer) TO "authenticated";
GRANT ALL ON FUNCTION "public"."st_removepoint"("public"."geometry", integer) TO "service_role";



GRANT ALL ON FUNCTION "public"."st_removerepeatedpoints"("geom" "public"."geometry", "tolerance" double precision) TO "postgres";
GRANT ALL ON FUNCTION "public"."st_removerepeatedpoints"("geom" "public"."geometry", "tolerance" double precision) TO "anon";
GRANT ALL ON FUNCTION "public"."st_removerepeatedpoints"("geom" "public"."geometry", "tolerance" double precision) TO "authenticated";
GRANT ALL ON FUNCTION "public"."st_removerepeatedpoints"("geom" "public"."geometry", "tolerance" double precision) TO "service_role";



GRANT ALL ON FUNCTION "public"."st_reverse"("public"."geometry") TO "postgres";
GRANT ALL ON FUNCTION "public"."st_reverse"("public"."geometry") TO "anon";
GRANT ALL ON FUNCTION "public"."st_reverse"("public"."geometry") TO "authenticated";
GRANT ALL ON FUNCTION "public"."st_reverse"("public"."geometry") TO "service_role";



GRANT ALL ON FUNCTION "public"."st_rotate"("public"."geometry", double precision) TO "postgres";
GRANT ALL ON FUNCTION "public"."st_rotate"("public"."geometry", double precision) TO "anon";
GRANT ALL ON FUNCTION "public"."st_rotate"("public"."geometry", double precision) TO "authenticated";
GRANT ALL ON FUNCTION "public"."st_rotate"("public"."geometry", double precision) TO "service_role";



GRANT ALL ON FUNCTION "public"."st_rotate"("public"."geometry", double precision, "public"."geometry") TO "postgres";
GRANT ALL ON FUNCTION "public"."st_rotate"("public"."geometry", double precision, "public"."geometry") TO "anon";
GRANT ALL ON FUNCTION "public"."st_rotate"("public"."geometry", double precision, "public"."geometry") TO "authenticated";
GRANT ALL ON FUNCTION "public"."st_rotate"("public"."geometry", double precision, "public"."geometry") TO "service_role";



GRANT ALL ON FUNCTION "public"."st_rotate"("public"."geometry", double precision, double precision, double precision) TO "postgres";
GRANT ALL ON FUNCTION "public"."st_rotate"("public"."geometry", double precision, double precision, double precision) TO "anon";
GRANT ALL ON FUNCTION "public"."st_rotate"("public"."geometry", double precision, double precision, double precision) TO "authenticated";
GRANT ALL ON FUNCTION "public"."st_rotate"("public"."geometry", double precision, double precision, double precision) TO "service_role";



GRANT ALL ON FUNCTION "public"."st_rotatex"("public"."geometry", double precision) TO "postgres";
GRANT ALL ON FUNCTION "public"."st_rotatex"("public"."geometry", double precision) TO "anon";
GRANT ALL ON FUNCTION "public"."st_rotatex"("public"."geometry", double precision) TO "authenticated";
GRANT ALL ON FUNCTION "public"."st_rotatex"("public"."geometry", double precision) TO "service_role";



GRANT ALL ON FUNCTION "public"."st_rotatey"("public"."geometry", double precision) TO "postgres";
GRANT ALL ON FUNCTION "public"."st_rotatey"("public"."geometry", double precision) TO "anon";
GRANT ALL ON FUNCTION "public"."st_rotatey"("public"."geometry", double precision) TO "authenticated";
GRANT ALL ON FUNCTION "public"."st_rotatey"("public"."geometry", double precision) TO "service_role";



GRANT ALL ON FUNCTION "public"."st_rotatez"("public"."geometry", double precision) TO "postgres";
GRANT ALL ON FUNCTION "public"."st_rotatez"("public"."geometry", double precision) TO "anon";
GRANT ALL ON FUNCTION "public"."st_rotatez"("public"."geometry", double precision) TO "authenticated";
GRANT ALL ON FUNCTION "public"."st_rotatez"("public"."geometry", double precision) TO "service_role";



GRANT ALL ON FUNCTION "public"."st_scale"("public"."geometry", "public"."geometry") TO "postgres";
GRANT ALL ON FUNCTION "public"."st_scale"("public"."geometry", "public"."geometry") TO "anon";
GRANT ALL ON FUNCTION "public"."st_scale"("public"."geometry", "public"."geometry") TO "authenticated";
GRANT ALL ON FUNCTION "public"."st_scale"("public"."geometry", "public"."geometry") TO "service_role";



GRANT ALL ON FUNCTION "public"."st_scale"("public"."geometry", double precision, double precision) TO "postgres";
GRANT ALL ON FUNCTION "public"."st_scale"("public"."geometry", double precision, double precision) TO "anon";
GRANT ALL ON FUNCTION "public"."st_scale"("public"."geometry", double precision, double precision) TO "authenticated";
GRANT ALL ON FUNCTION "public"."st_scale"("public"."geometry", double precision, double precision) TO "service_role";



GRANT ALL ON FUNCTION "public"."st_scale"("public"."geometry", "public"."geometry", "origin" "public"."geometry") TO "postgres";
GRANT ALL ON FUNCTION "public"."st_scale"("public"."geometry", "public"."geometry", "origin" "public"."geometry") TO "anon";
GRANT ALL ON FUNCTION "public"."st_scale"("public"."geometry", "public"."geometry", "origin" "public"."geometry") TO "authenticated";
GRANT ALL ON FUNCTION "public"."st_scale"("public"."geometry", "public"."geometry", "origin" "public"."geometry") TO "service_role";



GRANT ALL ON FUNCTION "public"."st_scale"("public"."geometry", double precision, double precision, double precision) TO "postgres";
GRANT ALL ON FUNCTION "public"."st_scale"("public"."geometry", double precision, double precision, double precision) TO "anon";
GRANT ALL ON FUNCTION "public"."st_scale"("public"."geometry", double precision, double precision, double precision) TO "authenticated";
GRANT ALL ON FUNCTION "public"."st_scale"("public"."geometry", double precision, double precision, double precision) TO "service_role";



GRANT ALL ON FUNCTION "public"."st_scroll"("public"."geometry", "public"."geometry") TO "postgres";
GRANT ALL ON FUNCTION "public"."st_scroll"("public"."geometry", "public"."geometry") TO "anon";
GRANT ALL ON FUNCTION "public"."st_scroll"("public"."geometry", "public"."geometry") TO "authenticated";
GRANT ALL ON FUNCTION "public"."st_scroll"("public"."geometry", "public"."geometry") TO "service_role";



GRANT ALL ON FUNCTION "public"."st_segmentize"("geog" "public"."geography", "max_segment_length" double precision) TO "postgres";
GRANT ALL ON FUNCTION "public"."st_segmentize"("geog" "public"."geography", "max_segment_length" double precision) TO "anon";
GRANT ALL ON FUNCTION "public"."st_segmentize"("geog" "public"."geography", "max_segment_length" double precision) TO "authenticated";
GRANT ALL ON FUNCTION "public"."st_segmentize"("geog" "public"."geography", "max_segment_length" double precision) TO "service_role";



GRANT ALL ON FUNCTION "public"."st_segmentize"("public"."geometry", double precision) TO "postgres";
GRANT ALL ON FUNCTION "public"."st_segmentize"("public"."geometry", double precision) TO "anon";
GRANT ALL ON FUNCTION "public"."st_segmentize"("public"."geometry", double precision) TO "authenticated";
GRANT ALL ON FUNCTION "public"."st_segmentize"("public"."geometry", double precision) TO "service_role";



GRANT ALL ON FUNCTION "public"."st_seteffectivearea"("public"."geometry", double precision, integer) TO "postgres";
GRANT ALL ON FUNCTION "public"."st_seteffectivearea"("public"."geometry", double precision, integer) TO "anon";
GRANT ALL ON FUNCTION "public"."st_seteffectivearea"("public"."geometry", double precision, integer) TO "authenticated";
GRANT ALL ON FUNCTION "public"."st_seteffectivearea"("public"."geometry", double precision, integer) TO "service_role";



GRANT ALL ON FUNCTION "public"."st_setpoint"("public"."geometry", integer, "public"."geometry") TO "postgres";
GRANT ALL ON FUNCTION "public"."st_setpoint"("public"."geometry", integer, "public"."geometry") TO "anon";
GRANT ALL ON FUNCTION "public"."st_setpoint"("public"."geometry", integer, "public"."geometry") TO "authenticated";
GRANT ALL ON FUNCTION "public"."st_setpoint"("public"."geometry", integer, "public"."geometry") TO "service_role";



GRANT ALL ON FUNCTION "public"."st_setsrid"("geog" "public"."geography", "srid" integer) TO "postgres";
GRANT ALL ON FUNCTION "public"."st_setsrid"("geog" "public"."geography", "srid" integer) TO "anon";
GRANT ALL ON FUNCTION "public"."st_setsrid"("geog" "public"."geography", "srid" integer) TO "authenticated";
GRANT ALL ON FUNCTION "public"."st_setsrid"("geog" "public"."geography", "srid" integer) TO "service_role";



GRANT ALL ON FUNCTION "public"."st_setsrid"("geom" "public"."geometry", "srid" integer) TO "postgres";
GRANT ALL ON FUNCTION "public"."st_setsrid"("geom" "public"."geometry", "srid" integer) TO "anon";
GRANT ALL ON FUNCTION "public"."st_setsrid"("geom" "public"."geometry", "srid" integer) TO "authenticated";
GRANT ALL ON FUNCTION "public"."st_setsrid"("geom" "public"."geometry", "srid" integer) TO "service_role";



GRANT ALL ON FUNCTION "public"."st_sharedpaths"("geom1" "public"."geometry", "geom2" "public"."geometry") TO "postgres";
GRANT ALL ON FUNCTION "public"."st_sharedpaths"("geom1" "public"."geometry", "geom2" "public"."geometry") TO "anon";
GRANT ALL ON FUNCTION "public"."st_sharedpaths"("geom1" "public"."geometry", "geom2" "public"."geometry") TO "authenticated";
GRANT ALL ON FUNCTION "public"."st_sharedpaths"("geom1" "public"."geometry", "geom2" "public"."geometry") TO "service_role";



GRANT ALL ON FUNCTION "public"."st_shiftlongitude"("public"."geometry") TO "postgres";
GRANT ALL ON FUNCTION "public"."st_shiftlongitude"("public"."geometry") TO "anon";
GRANT ALL ON FUNCTION "public"."st_shiftlongitude"("public"."geometry") TO "authenticated";
GRANT ALL ON FUNCTION "public"."st_shiftlongitude"("public"."geometry") TO "service_role";



GRANT ALL ON FUNCTION "public"."st_shortestline"("geom1" "public"."geometry", "geom2" "public"."geometry") TO "postgres";
GRANT ALL ON FUNCTION "public"."st_shortestline"("geom1" "public"."geometry", "geom2" "public"."geometry") TO "anon";
GRANT ALL ON FUNCTION "public"."st_shortestline"("geom1" "public"."geometry", "geom2" "public"."geometry") TO "authenticated";
GRANT ALL ON FUNCTION "public"."st_shortestline"("geom1" "public"."geometry", "geom2" "public"."geometry") TO "service_role";



GRANT ALL ON FUNCTION "public"."st_simplify"("public"."geometry", double precision) TO "postgres";
GRANT ALL ON FUNCTION "public"."st_simplify"("public"."geometry", double precision) TO "anon";
GRANT ALL ON FUNCTION "public"."st_simplify"("public"."geometry", double precision) TO "authenticated";
GRANT ALL ON FUNCTION "public"."st_simplify"("public"."geometry", double precision) TO "service_role";



GRANT ALL ON FUNCTION "public"."st_simplify"("public"."geometry", double precision, boolean) TO "postgres";
GRANT ALL ON FUNCTION "public"."st_simplify"("public"."geometry", double precision, boolean) TO "anon";
GRANT ALL ON FUNCTION "public"."st_simplify"("public"."geometry", double precision, boolean) TO "authenticated";
GRANT ALL ON FUNCTION "public"."st_simplify"("public"."geometry", double precision, boolean) TO "service_role";



GRANT ALL ON FUNCTION "public"."st_simplifypolygonhull"("geom" "public"."geometry", "vertex_fraction" double precision, "is_outer" boolean) TO "postgres";
GRANT ALL ON FUNCTION "public"."st_simplifypolygonhull"("geom" "public"."geometry", "vertex_fraction" double precision, "is_outer" boolean) TO "anon";
GRANT ALL ON FUNCTION "public"."st_simplifypolygonhull"("geom" "public"."geometry", "vertex_fraction" double precision, "is_outer" boolean) TO "authenticated";
GRANT ALL ON FUNCTION "public"."st_simplifypolygonhull"("geom" "public"."geometry", "vertex_fraction" double precision, "is_outer" boolean) TO "service_role";



GRANT ALL ON FUNCTION "public"."st_simplifypreservetopology"("public"."geometry", double precision) TO "postgres";
GRANT ALL ON FUNCTION "public"."st_simplifypreservetopology"("public"."geometry", double precision) TO "anon";
GRANT ALL ON FUNCTION "public"."st_simplifypreservetopology"("public"."geometry", double precision) TO "authenticated";
GRANT ALL ON FUNCTION "public"."st_simplifypreservetopology"("public"."geometry", double precision) TO "service_role";



GRANT ALL ON FUNCTION "public"."st_simplifyvw"("public"."geometry", double precision) TO "postgres";
GRANT ALL ON FUNCTION "public"."st_simplifyvw"("public"."geometry", double precision) TO "anon";
GRANT ALL ON FUNCTION "public"."st_simplifyvw"("public"."geometry", double precision) TO "authenticated";
GRANT ALL ON FUNCTION "public"."st_simplifyvw"("public"."geometry", double precision) TO "service_role";



GRANT ALL ON FUNCTION "public"."st_snap"("geom1" "public"."geometry", "geom2" "public"."geometry", double precision) TO "postgres";
GRANT ALL ON FUNCTION "public"."st_snap"("geom1" "public"."geometry", "geom2" "public"."geometry", double precision) TO "anon";
GRANT ALL ON FUNCTION "public"."st_snap"("geom1" "public"."geometry", "geom2" "public"."geometry", double precision) TO "authenticated";
GRANT ALL ON FUNCTION "public"."st_snap"("geom1" "public"."geometry", "geom2" "public"."geometry", double precision) TO "service_role";



GRANT ALL ON FUNCTION "public"."st_snaptogrid"("public"."geometry", double precision) TO "postgres";
GRANT ALL ON FUNCTION "public"."st_snaptogrid"("public"."geometry", double precision) TO "anon";
GRANT ALL ON FUNCTION "public"."st_snaptogrid"("public"."geometry", double precision) TO "authenticated";
GRANT ALL ON FUNCTION "public"."st_snaptogrid"("public"."geometry", double precision) TO "service_role";



GRANT ALL ON FUNCTION "public"."st_snaptogrid"("public"."geometry", double precision, double precision) TO "postgres";
GRANT ALL ON FUNCTION "public"."st_snaptogrid"("public"."geometry", double precision, double precision) TO "anon";
GRANT ALL ON FUNCTION "public"."st_snaptogrid"("public"."geometry", double precision, double precision) TO "authenticated";
GRANT ALL ON FUNCTION "public"."st_snaptogrid"("public"."geometry", double precision, double precision) TO "service_role";



GRANT ALL ON FUNCTION "public"."st_snaptogrid"("public"."geometry", double precision, double precision, double precision, double precision) TO "postgres";
GRANT ALL ON FUNCTION "public"."st_snaptogrid"("public"."geometry", double precision, double precision, double precision, double precision) TO "anon";
GRANT ALL ON FUNCTION "public"."st_snaptogrid"("public"."geometry", double precision, double precision, double precision, double precision) TO "authenticated";
GRANT ALL ON FUNCTION "public"."st_snaptogrid"("public"."geometry", double precision, double precision, double precision, double precision) TO "service_role";



GRANT ALL ON FUNCTION "public"."st_snaptogrid"("geom1" "public"."geometry", "geom2" "public"."geometry", double precision, double precision, double precision, double precision) TO "postgres";
GRANT ALL ON FUNCTION "public"."st_snaptogrid"("geom1" "public"."geometry", "geom2" "public"."geometry", double precision, double precision, double precision, double precision) TO "anon";
GRANT ALL ON FUNCTION "public"."st_snaptogrid"("geom1" "public"."geometry", "geom2" "public"."geometry", double precision, double precision, double precision, double precision) TO "authenticated";
GRANT ALL ON FUNCTION "public"."st_snaptogrid"("geom1" "public"."geometry", "geom2" "public"."geometry", double precision, double precision, double precision, double precision) TO "service_role";



GRANT ALL ON FUNCTION "public"."st_split"("geom1" "public"."geometry", "geom2" "public"."geometry") TO "postgres";
GRANT ALL ON FUNCTION "public"."st_split"("geom1" "public"."geometry", "geom2" "public"."geometry") TO "anon";
GRANT ALL ON FUNCTION "public"."st_split"("geom1" "public"."geometry", "geom2" "public"."geometry") TO "authenticated";
GRANT ALL ON FUNCTION "public"."st_split"("geom1" "public"."geometry", "geom2" "public"."geometry") TO "service_role";



GRANT ALL ON FUNCTION "public"."st_square"("size" double precision, "cell_i" integer, "cell_j" integer, "origin" "public"."geometry") TO "postgres";
GRANT ALL ON FUNCTION "public"."st_square"("size" double precision, "cell_i" integer, "cell_j" integer, "origin" "public"."geometry") TO "anon";
GRANT ALL ON FUNCTION "public"."st_square"("size" double precision, "cell_i" integer, "cell_j" integer, "origin" "public"."geometry") TO "authenticated";
GRANT ALL ON FUNCTION "public"."st_square"("size" double precision, "cell_i" integer, "cell_j" integer, "origin" "public"."geometry") TO "service_role";



GRANT ALL ON FUNCTION "public"."st_squaregrid"("size" double precision, "bounds" "public"."geometry", OUT "geom" "public"."geometry", OUT "i" integer, OUT "j" integer) TO "postgres";
GRANT ALL ON FUNCTION "public"."st_squaregrid"("size" double precision, "bounds" "public"."geometry", OUT "geom" "public"."geometry", OUT "i" integer, OUT "j" integer) TO "anon";
GRANT ALL ON FUNCTION "public"."st_squaregrid"("size" double precision, "bounds" "public"."geometry", OUT "geom" "public"."geometry", OUT "i" integer, OUT "j" integer) TO "authenticated";
GRANT ALL ON FUNCTION "public"."st_squaregrid"("size" double precision, "bounds" "public"."geometry", OUT "geom" "public"."geometry", OUT "i" integer, OUT "j" integer) TO "service_role";



GRANT ALL ON FUNCTION "public"."st_srid"("geog" "public"."geography") TO "postgres";
GRANT ALL ON FUNCTION "public"."st_srid"("geog" "public"."geography") TO "anon";
GRANT ALL ON FUNCTION "public"."st_srid"("geog" "public"."geography") TO "authenticated";
GRANT ALL ON FUNCTION "public"."st_srid"("geog" "public"."geography") TO "service_role";



GRANT ALL ON FUNCTION "public"."st_srid"("geom" "public"."geometry") TO "postgres";
GRANT ALL ON FUNCTION "public"."st_srid"("geom" "public"."geometry") TO "anon";
GRANT ALL ON FUNCTION "public"."st_srid"("geom" "public"."geometry") TO "authenticated";
GRANT ALL ON FUNCTION "public"."st_srid"("geom" "public"."geometry") TO "service_role";



GRANT ALL ON FUNCTION "public"."st_startpoint"("public"."geometry") TO "postgres";
GRANT ALL ON FUNCTION "public"."st_startpoint"("public"."geometry") TO "anon";
GRANT ALL ON FUNCTION "public"."st_startpoint"("public"."geometry") TO "authenticated";
GRANT ALL ON FUNCTION "public"."st_startpoint"("public"."geometry") TO "service_role";



GRANT ALL ON FUNCTION "public"."st_subdivide"("geom" "public"."geometry", "maxvertices" integer, "gridsize" double precision) TO "postgres";
GRANT ALL ON FUNCTION "public"."st_subdivide"("geom" "public"."geometry", "maxvertices" integer, "gridsize" double precision) TO "anon";
GRANT ALL ON FUNCTION "public"."st_subdivide"("geom" "public"."geometry", "maxvertices" integer, "gridsize" double precision) TO "authenticated";
GRANT ALL ON FUNCTION "public"."st_subdivide"("geom" "public"."geometry", "maxvertices" integer, "gridsize" double precision) TO "service_role";



GRANT ALL ON FUNCTION "public"."st_summary"("public"."geography") TO "postgres";
GRANT ALL ON FUNCTION "public"."st_summary"("public"."geography") TO "anon";
GRANT ALL ON FUNCTION "public"."st_summary"("public"."geography") TO "authenticated";
GRANT ALL ON FUNCTION "public"."st_summary"("public"."geography") TO "service_role";



GRANT ALL ON FUNCTION "public"."st_summary"("public"."geometry") TO "postgres";
GRANT ALL ON FUNCTION "public"."st_summary"("public"."geometry") TO "anon";
GRANT ALL ON FUNCTION "public"."st_summary"("public"."geometry") TO "authenticated";
GRANT ALL ON FUNCTION "public"."st_summary"("public"."geometry") TO "service_role";



GRANT ALL ON FUNCTION "public"."st_swapordinates"("geom" "public"."geometry", "ords" "cstring") TO "postgres";
GRANT ALL ON FUNCTION "public"."st_swapordinates"("geom" "public"."geometry", "ords" "cstring") TO "anon";
GRANT ALL ON FUNCTION "public"."st_swapordinates"("geom" "public"."geometry", "ords" "cstring") TO "authenticated";
GRANT ALL ON FUNCTION "public"."st_swapordinates"("geom" "public"."geometry", "ords" "cstring") TO "service_role";



GRANT ALL ON FUNCTION "public"."st_symdifference"("geom1" "public"."geometry", "geom2" "public"."geometry", "gridsize" double precision) TO "postgres";
GRANT ALL ON FUNCTION "public"."st_symdifference"("geom1" "public"."geometry", "geom2" "public"."geometry", "gridsize" double precision) TO "anon";
GRANT ALL ON FUNCTION "public"."st_symdifference"("geom1" "public"."geometry", "geom2" "public"."geometry", "gridsize" double precision) TO "authenticated";
GRANT ALL ON FUNCTION "public"."st_symdifference"("geom1" "public"."geometry", "geom2" "public"."geometry", "gridsize" double precision) TO "service_role";



GRANT ALL ON FUNCTION "public"."st_symmetricdifference"("geom1" "public"."geometry", "geom2" "public"."geometry") TO "postgres";
GRANT ALL ON FUNCTION "public"."st_symmetricdifference"("geom1" "public"."geometry", "geom2" "public"."geometry") TO "anon";
GRANT ALL ON FUNCTION "public"."st_symmetricdifference"("geom1" "public"."geometry", "geom2" "public"."geometry") TO "authenticated";
GRANT ALL ON FUNCTION "public"."st_symmetricdifference"("geom1" "public"."geometry", "geom2" "public"."geometry") TO "service_role";



GRANT ALL ON FUNCTION "public"."st_tileenvelope"("zoom" integer, "x" integer, "y" integer, "bounds" "public"."geometry", "margin" double precision) TO "postgres";
GRANT ALL ON FUNCTION "public"."st_tileenvelope"("zoom" integer, "x" integer, "y" integer, "bounds" "public"."geometry", "margin" double precision) TO "anon";
GRANT ALL ON FUNCTION "public"."st_tileenvelope"("zoom" integer, "x" integer, "y" integer, "bounds" "public"."geometry", "margin" double precision) TO "authenticated";
GRANT ALL ON FUNCTION "public"."st_tileenvelope"("zoom" integer, "x" integer, "y" integer, "bounds" "public"."geometry", "margin" double precision) TO "service_role";



GRANT ALL ON FUNCTION "public"."st_touches"("geom1" "public"."geometry", "geom2" "public"."geometry") TO "postgres";
GRANT ALL ON FUNCTION "public"."st_touches"("geom1" "public"."geometry", "geom2" "public"."geometry") TO "anon";
GRANT ALL ON FUNCTION "public"."st_touches"("geom1" "public"."geometry", "geom2" "public"."geometry") TO "authenticated";
GRANT ALL ON FUNCTION "public"."st_touches"("geom1" "public"."geometry", "geom2" "public"."geometry") TO "service_role";



GRANT ALL ON FUNCTION "public"."st_transform"("public"."geometry", integer) TO "postgres";
GRANT ALL ON FUNCTION "public"."st_transform"("public"."geometry", integer) TO "anon";
GRANT ALL ON FUNCTION "public"."st_transform"("public"."geometry", integer) TO "authenticated";
GRANT ALL ON FUNCTION "public"."st_transform"("public"."geometry", integer) TO "service_role";



GRANT ALL ON FUNCTION "public"."st_transform"("geom" "public"."geometry", "to_proj" "text") TO "postgres";
GRANT ALL ON FUNCTION "public"."st_transform"("geom" "public"."geometry", "to_proj" "text") TO "anon";
GRANT ALL ON FUNCTION "public"."st_transform"("geom" "public"."geometry", "to_proj" "text") TO "authenticated";
GRANT ALL ON FUNCTION "public"."st_transform"("geom" "public"."geometry", "to_proj" "text") TO "service_role";



GRANT ALL ON FUNCTION "public"."st_transform"("geom" "public"."geometry", "from_proj" "text", "to_srid" integer) TO "postgres";
GRANT ALL ON FUNCTION "public"."st_transform"("geom" "public"."geometry", "from_proj" "text", "to_srid" integer) TO "anon";
GRANT ALL ON FUNCTION "public"."st_transform"("geom" "public"."geometry", "from_proj" "text", "to_srid" integer) TO "authenticated";
GRANT ALL ON FUNCTION "public"."st_transform"("geom" "public"."geometry", "from_proj" "text", "to_srid" integer) TO "service_role";



GRANT ALL ON FUNCTION "public"."st_transform"("geom" "public"."geometry", "from_proj" "text", "to_proj" "text") TO "postgres";
GRANT ALL ON FUNCTION "public"."st_transform"("geom" "public"."geometry", "from_proj" "text", "to_proj" "text") TO "anon";
GRANT ALL ON FUNCTION "public"."st_transform"("geom" "public"."geometry", "from_proj" "text", "to_proj" "text") TO "authenticated";
GRANT ALL ON FUNCTION "public"."st_transform"("geom" "public"."geometry", "from_proj" "text", "to_proj" "text") TO "service_role";



GRANT ALL ON FUNCTION "public"."st_translate"("public"."geometry", double precision, double precision) TO "postgres";
GRANT ALL ON FUNCTION "public"."st_translate"("public"."geometry", double precision, double precision) TO "anon";
GRANT ALL ON FUNCTION "public"."st_translate"("public"."geometry", double precision, double precision) TO "authenticated";
GRANT ALL ON FUNCTION "public"."st_translate"("public"."geometry", double precision, double precision) TO "service_role";



GRANT ALL ON FUNCTION "public"."st_translate"("public"."geometry", double precision, double precision, double precision) TO "postgres";
GRANT ALL ON FUNCTION "public"."st_translate"("public"."geometry", double precision, double precision, double precision) TO "anon";
GRANT ALL ON FUNCTION "public"."st_translate"("public"."geometry", double precision, double precision, double precision) TO "authenticated";
GRANT ALL ON FUNCTION "public"."st_translate"("public"."geometry", double precision, double precision, double precision) TO "service_role";



GRANT ALL ON FUNCTION "public"."st_transscale"("public"."geometry", double precision, double precision, double precision, double precision) TO "postgres";
GRANT ALL ON FUNCTION "public"."st_transscale"("public"."geometry", double precision, double precision, double precision, double precision) TO "anon";
GRANT ALL ON FUNCTION "public"."st_transscale"("public"."geometry", double precision, double precision, double precision, double precision) TO "authenticated";
GRANT ALL ON FUNCTION "public"."st_transscale"("public"."geometry", double precision, double precision, double precision, double precision) TO "service_role";



GRANT ALL ON FUNCTION "public"."st_triangulatepolygon"("g1" "public"."geometry") TO "postgres";
GRANT ALL ON FUNCTION "public"."st_triangulatepolygon"("g1" "public"."geometry") TO "anon";
GRANT ALL ON FUNCTION "public"."st_triangulatepolygon"("g1" "public"."geometry") TO "authenticated";
GRANT ALL ON FUNCTION "public"."st_triangulatepolygon"("g1" "public"."geometry") TO "service_role";



GRANT ALL ON FUNCTION "public"."st_unaryunion"("public"."geometry", "gridsize" double precision) TO "postgres";
GRANT ALL ON FUNCTION "public"."st_unaryunion"("public"."geometry", "gridsize" double precision) TO "anon";
GRANT ALL ON FUNCTION "public"."st_unaryunion"("public"."geometry", "gridsize" double precision) TO "authenticated";
GRANT ALL ON FUNCTION "public"."st_unaryunion"("public"."geometry", "gridsize" double precision) TO "service_role";



GRANT ALL ON FUNCTION "public"."st_union"("public"."geometry"[]) TO "postgres";
GRANT ALL ON FUNCTION "public"."st_union"("public"."geometry"[]) TO "anon";
GRANT ALL ON FUNCTION "public"."st_union"("public"."geometry"[]) TO "authenticated";
GRANT ALL ON FUNCTION "public"."st_union"("public"."geometry"[]) TO "service_role";



GRANT ALL ON FUNCTION "public"."st_union"("geom1" "public"."geometry", "geom2" "public"."geometry") TO "postgres";
GRANT ALL ON FUNCTION "public"."st_union"("geom1" "public"."geometry", "geom2" "public"."geometry") TO "anon";
GRANT ALL ON FUNCTION "public"."st_union"("geom1" "public"."geometry", "geom2" "public"."geometry") TO "authenticated";
GRANT ALL ON FUNCTION "public"."st_union"("geom1" "public"."geometry", "geom2" "public"."geometry") TO "service_role";



GRANT ALL ON FUNCTION "public"."st_union"("geom1" "public"."geometry", "geom2" "public"."geometry", "gridsize" double precision) TO "postgres";
GRANT ALL ON FUNCTION "public"."st_union"("geom1" "public"."geometry", "geom2" "public"."geometry", "gridsize" double precision) TO "anon";
GRANT ALL ON FUNCTION "public"."st_union"("geom1" "public"."geometry", "geom2" "public"."geometry", "gridsize" double precision) TO "authenticated";
GRANT ALL ON FUNCTION "public"."st_union"("geom1" "public"."geometry", "geom2" "public"."geometry", "gridsize" double precision) TO "service_role";



GRANT ALL ON FUNCTION "public"."st_voronoilines"("g1" "public"."geometry", "tolerance" double precision, "extend_to" "public"."geometry") TO "postgres";
GRANT ALL ON FUNCTION "public"."st_voronoilines"("g1" "public"."geometry", "tolerance" double precision, "extend_to" "public"."geometry") TO "anon";
GRANT ALL ON FUNCTION "public"."st_voronoilines"("g1" "public"."geometry", "tolerance" double precision, "extend_to" "public"."geometry") TO "authenticated";
GRANT ALL ON FUNCTION "public"."st_voronoilines"("g1" "public"."geometry", "tolerance" double precision, "extend_to" "public"."geometry") TO "service_role";



GRANT ALL ON FUNCTION "public"."st_voronoipolygons"("g1" "public"."geometry", "tolerance" double precision, "extend_to" "public"."geometry") TO "postgres";
GRANT ALL ON FUNCTION "public"."st_voronoipolygons"("g1" "public"."geometry", "tolerance" double precision, "extend_to" "public"."geometry") TO "anon";
GRANT ALL ON FUNCTION "public"."st_voronoipolygons"("g1" "public"."geometry", "tolerance" double precision, "extend_to" "public"."geometry") TO "authenticated";
GRANT ALL ON FUNCTION "public"."st_voronoipolygons"("g1" "public"."geometry", "tolerance" double precision, "extend_to" "public"."geometry") TO "service_role";



GRANT ALL ON FUNCTION "public"."st_within"("geom1" "public"."geometry", "geom2" "public"."geometry") TO "postgres";
GRANT ALL ON FUNCTION "public"."st_within"("geom1" "public"."geometry", "geom2" "public"."geometry") TO "anon";
GRANT ALL ON FUNCTION "public"."st_within"("geom1" "public"."geometry", "geom2" "public"."geometry") TO "authenticated";
GRANT ALL ON FUNCTION "public"."st_within"("geom1" "public"."geometry", "geom2" "public"."geometry") TO "service_role";



GRANT ALL ON FUNCTION "public"."st_wkbtosql"("wkb" "bytea") TO "postgres";
GRANT ALL ON FUNCTION "public"."st_wkbtosql"("wkb" "bytea") TO "anon";
GRANT ALL ON FUNCTION "public"."st_wkbtosql"("wkb" "bytea") TO "authenticated";
GRANT ALL ON FUNCTION "public"."st_wkbtosql"("wkb" "bytea") TO "service_role";



GRANT ALL ON FUNCTION "public"."st_wkttosql"("text") TO "postgres";
GRANT ALL ON FUNCTION "public"."st_wkttosql"("text") TO "anon";
GRANT ALL ON FUNCTION "public"."st_wkttosql"("text") TO "authenticated";
GRANT ALL ON FUNCTION "public"."st_wkttosql"("text") TO "service_role";



GRANT ALL ON FUNCTION "public"."st_wrapx"("geom" "public"."geometry", "wrap" double precision, "move" double precision) TO "postgres";
GRANT ALL ON FUNCTION "public"."st_wrapx"("geom" "public"."geometry", "wrap" double precision, "move" double precision) TO "anon";
GRANT ALL ON FUNCTION "public"."st_wrapx"("geom" "public"."geometry", "wrap" double precision, "move" double precision) TO "authenticated";
GRANT ALL ON FUNCTION "public"."st_wrapx"("geom" "public"."geometry", "wrap" double precision, "move" double precision) TO "service_role";



GRANT ALL ON FUNCTION "public"."st_x"("public"."geometry") TO "postgres";
GRANT ALL ON FUNCTION "public"."st_x"("public"."geometry") TO "anon";
GRANT ALL ON FUNCTION "public"."st_x"("public"."geometry") TO "authenticated";
GRANT ALL ON FUNCTION "public"."st_x"("public"."geometry") TO "service_role";



GRANT ALL ON FUNCTION "public"."st_xmax"("public"."box3d") TO "postgres";
GRANT ALL ON FUNCTION "public"."st_xmax"("public"."box3d") TO "anon";
GRANT ALL ON FUNCTION "public"."st_xmax"("public"."box3d") TO "authenticated";
GRANT ALL ON FUNCTION "public"."st_xmax"("public"."box3d") TO "service_role";



GRANT ALL ON FUNCTION "public"."st_xmin"("public"."box3d") TO "postgres";
GRANT ALL ON FUNCTION "public"."st_xmin"("public"."box3d") TO "anon";
GRANT ALL ON FUNCTION "public"."st_xmin"("public"."box3d") TO "authenticated";
GRANT ALL ON FUNCTION "public"."st_xmin"("public"."box3d") TO "service_role";



GRANT ALL ON FUNCTION "public"."st_y"("public"."geometry") TO "postgres";
GRANT ALL ON FUNCTION "public"."st_y"("public"."geometry") TO "anon";
GRANT ALL ON FUNCTION "public"."st_y"("public"."geometry") TO "authenticated";
GRANT ALL ON FUNCTION "public"."st_y"("public"."geometry") TO "service_role";



GRANT ALL ON FUNCTION "public"."st_ymax"("public"."box3d") TO "postgres";
GRANT ALL ON FUNCTION "public"."st_ymax"("public"."box3d") TO "anon";
GRANT ALL ON FUNCTION "public"."st_ymax"("public"."box3d") TO "authenticated";
GRANT ALL ON FUNCTION "public"."st_ymax"("public"."box3d") TO "service_role";



GRANT ALL ON FUNCTION "public"."st_ymin"("public"."box3d") TO "postgres";
GRANT ALL ON FUNCTION "public"."st_ymin"("public"."box3d") TO "anon";
GRANT ALL ON FUNCTION "public"."st_ymin"("public"."box3d") TO "authenticated";
GRANT ALL ON FUNCTION "public"."st_ymin"("public"."box3d") TO "service_role";



GRANT ALL ON FUNCTION "public"."st_z"("public"."geometry") TO "postgres";
GRANT ALL ON FUNCTION "public"."st_z"("public"."geometry") TO "anon";
GRANT ALL ON FUNCTION "public"."st_z"("public"."geometry") TO "authenticated";
GRANT ALL ON FUNCTION "public"."st_z"("public"."geometry") TO "service_role";



GRANT ALL ON FUNCTION "public"."st_zmax"("public"."box3d") TO "postgres";
GRANT ALL ON FUNCTION "public"."st_zmax"("public"."box3d") TO "anon";
GRANT ALL ON FUNCTION "public"."st_zmax"("public"."box3d") TO "authenticated";
GRANT ALL ON FUNCTION "public"."st_zmax"("public"."box3d") TO "service_role";



GRANT ALL ON FUNCTION "public"."st_zmflag"("public"."geometry") TO "postgres";
GRANT ALL ON FUNCTION "public"."st_zmflag"("public"."geometry") TO "anon";
GRANT ALL ON FUNCTION "public"."st_zmflag"("public"."geometry") TO "authenticated";
GRANT ALL ON FUNCTION "public"."st_zmflag"("public"."geometry") TO "service_role";



GRANT ALL ON FUNCTION "public"."st_zmin"("public"."box3d") TO "postgres";
GRANT ALL ON FUNCTION "public"."st_zmin"("public"."box3d") TO "anon";
GRANT ALL ON FUNCTION "public"."st_zmin"("public"."box3d") TO "authenticated";
GRANT ALL ON FUNCTION "public"."st_zmin"("public"."box3d") TO "service_role";



GRANT ALL ON FUNCTION "public"."storm_demand_examples"("example_year" integer, "result_limit" integer) TO "anon";
GRANT ALL ON FUNCTION "public"."storm_demand_examples"("example_year" integer, "result_limit" integer) TO "authenticated";
GRANT ALL ON FUNCTION "public"."storm_demand_examples"("example_year" integer, "result_limit" integer) TO "service_role";



GRANT ALL ON FUNCTION "public"."strict_word_similarity"("text", "text") TO "postgres";
GRANT ALL ON FUNCTION "public"."strict_word_similarity"("text", "text") TO "anon";
GRANT ALL ON FUNCTION "public"."strict_word_similarity"("text", "text") TO "authenticated";
GRANT ALL ON FUNCTION "public"."strict_word_similarity"("text", "text") TO "service_role";



GRANT ALL ON FUNCTION "public"."strict_word_similarity_commutator_op"("text", "text") TO "postgres";
GRANT ALL ON FUNCTION "public"."strict_word_similarity_commutator_op"("text", "text") TO "anon";
GRANT ALL ON FUNCTION "public"."strict_word_similarity_commutator_op"("text", "text") TO "authenticated";
GRANT ALL ON FUNCTION "public"."strict_word_similarity_commutator_op"("text", "text") TO "service_role";



GRANT ALL ON FUNCTION "public"."strict_word_similarity_dist_commutator_op"("text", "text") TO "postgres";
GRANT ALL ON FUNCTION "public"."strict_word_similarity_dist_commutator_op"("text", "text") TO "anon";
GRANT ALL ON FUNCTION "public"."strict_word_similarity_dist_commutator_op"("text", "text") TO "authenticated";
GRANT ALL ON FUNCTION "public"."strict_word_similarity_dist_commutator_op"("text", "text") TO "service_role";



GRANT ALL ON FUNCTION "public"."strict_word_similarity_dist_op"("text", "text") TO "postgres";
GRANT ALL ON FUNCTION "public"."strict_word_similarity_dist_op"("text", "text") TO "anon";
GRANT ALL ON FUNCTION "public"."strict_word_similarity_dist_op"("text", "text") TO "authenticated";
GRANT ALL ON FUNCTION "public"."strict_word_similarity_dist_op"("text", "text") TO "service_role";



GRANT ALL ON FUNCTION "public"."strict_word_similarity_op"("text", "text") TO "postgres";
GRANT ALL ON FUNCTION "public"."strict_word_similarity_op"("text", "text") TO "anon";
GRANT ALL ON FUNCTION "public"."strict_word_similarity_op"("text", "text") TO "authenticated";
GRANT ALL ON FUNCTION "public"."strict_word_similarity_op"("text", "text") TO "service_role";



GRANT ALL ON FUNCTION "public"."unlockrows"("text") TO "postgres";
GRANT ALL ON FUNCTION "public"."unlockrows"("text") TO "anon";
GRANT ALL ON FUNCTION "public"."unlockrows"("text") TO "authenticated";
GRANT ALL ON FUNCTION "public"."unlockrows"("text") TO "service_role";



GRANT ALL ON FUNCTION "public"."update_updated_at"() TO "anon";
GRANT ALL ON FUNCTION "public"."update_updated_at"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."update_updated_at"() TO "service_role";



GRANT ALL ON FUNCTION "public"."updategeometrysrid"(character varying, character varying, integer) TO "postgres";
GRANT ALL ON FUNCTION "public"."updategeometrysrid"(character varying, character varying, integer) TO "anon";
GRANT ALL ON FUNCTION "public"."updategeometrysrid"(character varying, character varying, integer) TO "authenticated";
GRANT ALL ON FUNCTION "public"."updategeometrysrid"(character varying, character varying, integer) TO "service_role";



GRANT ALL ON FUNCTION "public"."updategeometrysrid"(character varying, character varying, character varying, integer) TO "postgres";
GRANT ALL ON FUNCTION "public"."updategeometrysrid"(character varying, character varying, character varying, integer) TO "anon";
GRANT ALL ON FUNCTION "public"."updategeometrysrid"(character varying, character varying, character varying, integer) TO "authenticated";
GRANT ALL ON FUNCTION "public"."updategeometrysrid"(character varying, character varying, character varying, integer) TO "service_role";



GRANT ALL ON FUNCTION "public"."updategeometrysrid"("catalogn_name" character varying, "schema_name" character varying, "table_name" character varying, "column_name" character varying, "new_srid_in" integer) TO "postgres";
GRANT ALL ON FUNCTION "public"."updategeometrysrid"("catalogn_name" character varying, "schema_name" character varying, "table_name" character varying, "column_name" character varying, "new_srid_in" integer) TO "anon";
GRANT ALL ON FUNCTION "public"."updategeometrysrid"("catalogn_name" character varying, "schema_name" character varying, "table_name" character varying, "column_name" character varying, "new_srid_in" integer) TO "authenticated";
GRANT ALL ON FUNCTION "public"."updategeometrysrid"("catalogn_name" character varying, "schema_name" character varying, "table_name" character varying, "column_name" character varying, "new_srid_in" integer) TO "service_role";



GRANT ALL ON FUNCTION "public"."user_is_shop_owner"("target_shop_id" "uuid") TO "anon";
GRANT ALL ON FUNCTION "public"."user_is_shop_owner"("target_shop_id" "uuid") TO "authenticated";
GRANT ALL ON FUNCTION "public"."user_is_shop_owner"("target_shop_id" "uuid") TO "service_role";



GRANT ALL ON FUNCTION "public"."user_location_ids"() TO "anon";
GRANT ALL ON FUNCTION "public"."user_location_ids"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."user_location_ids"() TO "service_role";



GRANT ALL ON FUNCTION "public"."user_shop_ids"() TO "anon";
GRANT ALL ON FUNCTION "public"."user_shop_ids"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."user_shop_ids"() TO "service_role";



GRANT ALL ON FUNCTION "public"."word_similarity"("text", "text") TO "postgres";
GRANT ALL ON FUNCTION "public"."word_similarity"("text", "text") TO "anon";
GRANT ALL ON FUNCTION "public"."word_similarity"("text", "text") TO "authenticated";
GRANT ALL ON FUNCTION "public"."word_similarity"("text", "text") TO "service_role";



GRANT ALL ON FUNCTION "public"."word_similarity_commutator_op"("text", "text") TO "postgres";
GRANT ALL ON FUNCTION "public"."word_similarity_commutator_op"("text", "text") TO "anon";
GRANT ALL ON FUNCTION "public"."word_similarity_commutator_op"("text", "text") TO "authenticated";
GRANT ALL ON FUNCTION "public"."word_similarity_commutator_op"("text", "text") TO "service_role";



GRANT ALL ON FUNCTION "public"."word_similarity_dist_commutator_op"("text", "text") TO "postgres";
GRANT ALL ON FUNCTION "public"."word_similarity_dist_commutator_op"("text", "text") TO "anon";
GRANT ALL ON FUNCTION "public"."word_similarity_dist_commutator_op"("text", "text") TO "authenticated";
GRANT ALL ON FUNCTION "public"."word_similarity_dist_commutator_op"("text", "text") TO "service_role";



GRANT ALL ON FUNCTION "public"."word_similarity_dist_op"("text", "text") TO "postgres";
GRANT ALL ON FUNCTION "public"."word_similarity_dist_op"("text", "text") TO "anon";
GRANT ALL ON FUNCTION "public"."word_similarity_dist_op"("text", "text") TO "authenticated";
GRANT ALL ON FUNCTION "public"."word_similarity_dist_op"("text", "text") TO "service_role";



GRANT ALL ON FUNCTION "public"."word_similarity_op"("text", "text") TO "postgres";
GRANT ALL ON FUNCTION "public"."word_similarity_op"("text", "text") TO "anon";
GRANT ALL ON FUNCTION "public"."word_similarity_op"("text", "text") TO "authenticated";
GRANT ALL ON FUNCTION "public"."word_similarity_op"("text", "text") TO "service_role";



REVOKE ALL ON FUNCTION "sensitive"."log_pii_access"("p_action" "text", "p_target_table" "text", "p_actor_user_id" "uuid", "p_actor_email" "text", "p_actor_role" "text", "p_target_key" "text", "p_reason" "text", "p_request_metadata" "jsonb") FROM PUBLIC;
GRANT ALL ON FUNCTION "sensitive"."log_pii_access"("p_action" "text", "p_target_table" "text", "p_actor_user_id" "uuid", "p_actor_email" "text", "p_actor_role" "text", "p_target_key" "text", "p_reason" "text", "p_request_metadata" "jsonb") TO "service_role";
























GRANT ALL ON FUNCTION "public"."st_3dextent"("public"."geometry") TO "postgres";
GRANT ALL ON FUNCTION "public"."st_3dextent"("public"."geometry") TO "anon";
GRANT ALL ON FUNCTION "public"."st_3dextent"("public"."geometry") TO "authenticated";
GRANT ALL ON FUNCTION "public"."st_3dextent"("public"."geometry") TO "service_role";



GRANT ALL ON FUNCTION "public"."st_asflatgeobuf"("anyelement") TO "postgres";
GRANT ALL ON FUNCTION "public"."st_asflatgeobuf"("anyelement") TO "anon";
GRANT ALL ON FUNCTION "public"."st_asflatgeobuf"("anyelement") TO "authenticated";
GRANT ALL ON FUNCTION "public"."st_asflatgeobuf"("anyelement") TO "service_role";



GRANT ALL ON FUNCTION "public"."st_asflatgeobuf"("anyelement", boolean) TO "postgres";
GRANT ALL ON FUNCTION "public"."st_asflatgeobuf"("anyelement", boolean) TO "anon";
GRANT ALL ON FUNCTION "public"."st_asflatgeobuf"("anyelement", boolean) TO "authenticated";
GRANT ALL ON FUNCTION "public"."st_asflatgeobuf"("anyelement", boolean) TO "service_role";



GRANT ALL ON FUNCTION "public"."st_asflatgeobuf"("anyelement", boolean, "text") TO "postgres";
GRANT ALL ON FUNCTION "public"."st_asflatgeobuf"("anyelement", boolean, "text") TO "anon";
GRANT ALL ON FUNCTION "public"."st_asflatgeobuf"("anyelement", boolean, "text") TO "authenticated";
GRANT ALL ON FUNCTION "public"."st_asflatgeobuf"("anyelement", boolean, "text") TO "service_role";



GRANT ALL ON FUNCTION "public"."st_asgeobuf"("anyelement") TO "postgres";
GRANT ALL ON FUNCTION "public"."st_asgeobuf"("anyelement") TO "anon";
GRANT ALL ON FUNCTION "public"."st_asgeobuf"("anyelement") TO "authenticated";
GRANT ALL ON FUNCTION "public"."st_asgeobuf"("anyelement") TO "service_role";



GRANT ALL ON FUNCTION "public"."st_asgeobuf"("anyelement", "text") TO "postgres";
GRANT ALL ON FUNCTION "public"."st_asgeobuf"("anyelement", "text") TO "anon";
GRANT ALL ON FUNCTION "public"."st_asgeobuf"("anyelement", "text") TO "authenticated";
GRANT ALL ON FUNCTION "public"."st_asgeobuf"("anyelement", "text") TO "service_role";



GRANT ALL ON FUNCTION "public"."st_asmvt"("anyelement") TO "postgres";
GRANT ALL ON FUNCTION "public"."st_asmvt"("anyelement") TO "anon";
GRANT ALL ON FUNCTION "public"."st_asmvt"("anyelement") TO "authenticated";
GRANT ALL ON FUNCTION "public"."st_asmvt"("anyelement") TO "service_role";



GRANT ALL ON FUNCTION "public"."st_asmvt"("anyelement", "text") TO "postgres";
GRANT ALL ON FUNCTION "public"."st_asmvt"("anyelement", "text") TO "anon";
GRANT ALL ON FUNCTION "public"."st_asmvt"("anyelement", "text") TO "authenticated";
GRANT ALL ON FUNCTION "public"."st_asmvt"("anyelement", "text") TO "service_role";



GRANT ALL ON FUNCTION "public"."st_asmvt"("anyelement", "text", integer) TO "postgres";
GRANT ALL ON FUNCTION "public"."st_asmvt"("anyelement", "text", integer) TO "anon";
GRANT ALL ON FUNCTION "public"."st_asmvt"("anyelement", "text", integer) TO "authenticated";
GRANT ALL ON FUNCTION "public"."st_asmvt"("anyelement", "text", integer) TO "service_role";



GRANT ALL ON FUNCTION "public"."st_asmvt"("anyelement", "text", integer, "text") TO "postgres";
GRANT ALL ON FUNCTION "public"."st_asmvt"("anyelement", "text", integer, "text") TO "anon";
GRANT ALL ON FUNCTION "public"."st_asmvt"("anyelement", "text", integer, "text") TO "authenticated";
GRANT ALL ON FUNCTION "public"."st_asmvt"("anyelement", "text", integer, "text") TO "service_role";



GRANT ALL ON FUNCTION "public"."st_asmvt"("anyelement", "text", integer, "text", "text") TO "postgres";
GRANT ALL ON FUNCTION "public"."st_asmvt"("anyelement", "text", integer, "text", "text") TO "anon";
GRANT ALL ON FUNCTION "public"."st_asmvt"("anyelement", "text", integer, "text", "text") TO "authenticated";
GRANT ALL ON FUNCTION "public"."st_asmvt"("anyelement", "text", integer, "text", "text") TO "service_role";



GRANT ALL ON FUNCTION "public"."st_clusterintersecting"("public"."geometry") TO "postgres";
GRANT ALL ON FUNCTION "public"."st_clusterintersecting"("public"."geometry") TO "anon";
GRANT ALL ON FUNCTION "public"."st_clusterintersecting"("public"."geometry") TO "authenticated";
GRANT ALL ON FUNCTION "public"."st_clusterintersecting"("public"."geometry") TO "service_role";



GRANT ALL ON FUNCTION "public"."st_clusterwithin"("public"."geometry", double precision) TO "postgres";
GRANT ALL ON FUNCTION "public"."st_clusterwithin"("public"."geometry", double precision) TO "anon";
GRANT ALL ON FUNCTION "public"."st_clusterwithin"("public"."geometry", double precision) TO "authenticated";
GRANT ALL ON FUNCTION "public"."st_clusterwithin"("public"."geometry", double precision) TO "service_role";



GRANT ALL ON FUNCTION "public"."st_collect"("public"."geometry") TO "postgres";
GRANT ALL ON FUNCTION "public"."st_collect"("public"."geometry") TO "anon";
GRANT ALL ON FUNCTION "public"."st_collect"("public"."geometry") TO "authenticated";
GRANT ALL ON FUNCTION "public"."st_collect"("public"."geometry") TO "service_role";



GRANT ALL ON FUNCTION "public"."st_extent"("public"."geometry") TO "postgres";
GRANT ALL ON FUNCTION "public"."st_extent"("public"."geometry") TO "anon";
GRANT ALL ON FUNCTION "public"."st_extent"("public"."geometry") TO "authenticated";
GRANT ALL ON FUNCTION "public"."st_extent"("public"."geometry") TO "service_role";



GRANT ALL ON FUNCTION "public"."st_makeline"("public"."geometry") TO "postgres";
GRANT ALL ON FUNCTION "public"."st_makeline"("public"."geometry") TO "anon";
GRANT ALL ON FUNCTION "public"."st_makeline"("public"."geometry") TO "authenticated";
GRANT ALL ON FUNCTION "public"."st_makeline"("public"."geometry") TO "service_role";



GRANT ALL ON FUNCTION "public"."st_memcollect"("public"."geometry") TO "postgres";
GRANT ALL ON FUNCTION "public"."st_memcollect"("public"."geometry") TO "anon";
GRANT ALL ON FUNCTION "public"."st_memcollect"("public"."geometry") TO "authenticated";
GRANT ALL ON FUNCTION "public"."st_memcollect"("public"."geometry") TO "service_role";



GRANT ALL ON FUNCTION "public"."st_memunion"("public"."geometry") TO "postgres";
GRANT ALL ON FUNCTION "public"."st_memunion"("public"."geometry") TO "anon";
GRANT ALL ON FUNCTION "public"."st_memunion"("public"."geometry") TO "authenticated";
GRANT ALL ON FUNCTION "public"."st_memunion"("public"."geometry") TO "service_role";



GRANT ALL ON FUNCTION "public"."st_polygonize"("public"."geometry") TO "postgres";
GRANT ALL ON FUNCTION "public"."st_polygonize"("public"."geometry") TO "anon";
GRANT ALL ON FUNCTION "public"."st_polygonize"("public"."geometry") TO "authenticated";
GRANT ALL ON FUNCTION "public"."st_polygonize"("public"."geometry") TO "service_role";



GRANT ALL ON FUNCTION "public"."st_union"("public"."geometry") TO "postgres";
GRANT ALL ON FUNCTION "public"."st_union"("public"."geometry") TO "anon";
GRANT ALL ON FUNCTION "public"."st_union"("public"."geometry") TO "authenticated";
GRANT ALL ON FUNCTION "public"."st_union"("public"."geometry") TO "service_role";



GRANT ALL ON FUNCTION "public"."st_union"("public"."geometry", double precision) TO "postgres";
GRANT ALL ON FUNCTION "public"."st_union"("public"."geometry", double precision) TO "anon";
GRANT ALL ON FUNCTION "public"."st_union"("public"."geometry", double precision) TO "authenticated";
GRANT ALL ON FUNCTION "public"."st_union"("public"."geometry", double precision) TO "service_role";












GRANT ALL ON TABLE "public"."accident_density" TO "anon";
GRANT ALL ON TABLE "public"."accident_density" TO "authenticated";
GRANT ALL ON TABLE "public"."accident_density" TO "service_role";



GRANT ALL ON TABLE "public"."accident_import_sources" TO "anon";
GRANT ALL ON TABLE "public"."accident_import_sources" TO "authenticated";
GRANT ALL ON TABLE "public"."accident_import_sources" TO "service_role";



GRANT ALL ON SEQUENCE "public"."accident_import_sources_id_seq" TO "anon";
GRANT ALL ON SEQUENCE "public"."accident_import_sources_id_seq" TO "authenticated";
GRANT ALL ON SEQUENCE "public"."accident_import_sources_id_seq" TO "service_role";



GRANT ALL ON TABLE "public"."accident_market_daypart_rollup" TO "anon";
GRANT ALL ON TABLE "public"."accident_market_daypart_rollup" TO "authenticated";
GRANT ALL ON TABLE "public"."accident_market_daypart_rollup" TO "service_role";



GRANT ALL ON TABLE "public"."accident_market_rollup" TO "anon";
GRANT ALL ON TABLE "public"."accident_market_rollup" TO "authenticated";
GRANT ALL ON TABLE "public"."accident_market_rollup" TO "service_role";



GRANT ALL ON TABLE "public"."accident_market_zip_rollup" TO "anon";
GRANT ALL ON TABLE "public"."accident_market_zip_rollup" TO "authenticated";
GRANT ALL ON TABLE "public"."accident_market_zip_rollup" TO "service_role";



GRANT ALL ON TABLE "public"."accidents" TO "anon";
GRANT ALL ON TABLE "public"."accidents" TO "authenticated";
GRANT ALL ON TABLE "public"."accidents" TO "service_role";



GRANT ALL ON TABLE "public"."accidents_2016" TO "anon";
GRANT ALL ON TABLE "public"."accidents_2016" TO "authenticated";
GRANT ALL ON TABLE "public"."accidents_2016" TO "service_role";



GRANT ALL ON TABLE "public"."accidents_2017" TO "anon";
GRANT ALL ON TABLE "public"."accidents_2017" TO "authenticated";
GRANT ALL ON TABLE "public"."accidents_2017" TO "service_role";



GRANT ALL ON TABLE "public"."accidents_2018" TO "anon";
GRANT ALL ON TABLE "public"."accidents_2018" TO "authenticated";
GRANT ALL ON TABLE "public"."accidents_2018" TO "service_role";



GRANT ALL ON TABLE "public"."accidents_2019" TO "anon";
GRANT ALL ON TABLE "public"."accidents_2019" TO "authenticated";
GRANT ALL ON TABLE "public"."accidents_2019" TO "service_role";



GRANT ALL ON TABLE "public"."accidents_2020" TO "anon";
GRANT ALL ON TABLE "public"."accidents_2020" TO "authenticated";
GRANT ALL ON TABLE "public"."accidents_2020" TO "service_role";



GRANT ALL ON TABLE "public"."accidents_2021" TO "anon";
GRANT ALL ON TABLE "public"."accidents_2021" TO "authenticated";
GRANT ALL ON TABLE "public"."accidents_2021" TO "service_role";



GRANT ALL ON TABLE "public"."accidents_2022" TO "anon";
GRANT ALL ON TABLE "public"."accidents_2022" TO "authenticated";
GRANT ALL ON TABLE "public"."accidents_2022" TO "service_role";



GRANT ALL ON TABLE "public"."accidents_2023" TO "anon";
GRANT ALL ON TABLE "public"."accidents_2023" TO "authenticated";
GRANT ALL ON TABLE "public"."accidents_2023" TO "service_role";



GRANT ALL ON TABLE "public"."accidents_2024" TO "anon";
GRANT ALL ON TABLE "public"."accidents_2024" TO "authenticated";
GRANT ALL ON TABLE "public"."accidents_2024" TO "service_role";



GRANT ALL ON TABLE "public"."accidents_2025" TO "anon";
GRANT ALL ON TABLE "public"."accidents_2025" TO "authenticated";
GRANT ALL ON TABLE "public"."accidents_2025" TO "service_role";



GRANT ALL ON TABLE "public"."accidents_2026" TO "anon";
GRANT ALL ON TABLE "public"."accidents_2026" TO "authenticated";
GRANT ALL ON TABLE "public"."accidents_2026" TO "service_role";



GRANT ALL ON TABLE "public"."accidents_2027" TO "anon";
GRANT ALL ON TABLE "public"."accidents_2027" TO "authenticated";
GRANT ALL ON TABLE "public"."accidents_2027" TO "service_role";



GRANT ALL ON TABLE "public"."accidents_default" TO "anon";
GRANT ALL ON TABLE "public"."accidents_default" TO "authenticated";
GRANT ALL ON TABLE "public"."accidents_default" TO "service_role";



GRANT ALL ON TABLE "public"."activity_log" TO "anon";
GRANT ALL ON TABLE "public"."activity_log" TO "authenticated";
GRANT ALL ON TABLE "public"."activity_log" TO "service_role";



GRANT ALL ON TABLE "public"."ad_copy_events" TO "anon";
GRANT ALL ON TABLE "public"."ad_copy_events" TO "authenticated";
GRANT ALL ON TABLE "public"."ad_copy_events" TO "service_role";



GRANT ALL ON TABLE "public"."ai_prompt_templates" TO "anon";
GRANT ALL ON TABLE "public"."ai_prompt_templates" TO "authenticated";
GRANT ALL ON TABLE "public"."ai_prompt_templates" TO "service_role";



GRANT ALL ON TABLE "public"."analytics_snapshots" TO "anon";
GRANT ALL ON TABLE "public"."analytics_snapshots" TO "authenticated";
GRANT ALL ON TABLE "public"."analytics_snapshots" TO "service_role";



GRANT ALL ON TABLE "public"."api_cache" TO "anon";
GRANT ALL ON TABLE "public"."api_cache" TO "authenticated";
GRANT ALL ON TABLE "public"."api_cache" TO "service_role";



GRANT ALL ON TABLE "public"."body_shops" TO "anon";
GRANT ALL ON TABLE "public"."body_shops" TO "authenticated";
GRANT ALL ON TABLE "public"."body_shops" TO "service_role";



GRANT ALL ON TABLE "public"."bsm_campaigns" TO "anon";
GRANT ALL ON TABLE "public"."bsm_campaigns" TO "authenticated";
GRANT ALL ON TABLE "public"."bsm_campaigns" TO "service_role";



GRANT ALL ON TABLE "public"."campaign_budget_snapshots" TO "anon";
GRANT ALL ON TABLE "public"."campaign_budget_snapshots" TO "authenticated";
GRANT ALL ON TABLE "public"."campaign_budget_snapshots" TO "service_role";



GRANT ALL ON TABLE "public"."campaign_sends" TO "anon";
GRANT ALL ON TABLE "public"."campaign_sends" TO "authenticated";
GRANT ALL ON TABLE "public"."campaign_sends" TO "service_role";



GRANT ALL ON TABLE "public"."campaigns" TO "anon";
GRANT ALL ON TABLE "public"."campaigns" TO "authenticated";
GRANT ALL ON TABLE "public"."campaigns" TO "service_role";



GRANT ALL ON TABLE "public"."clients" TO "anon";
GRANT ALL ON TABLE "public"."clients" TO "authenticated";
GRANT ALL ON TABLE "public"."clients" TO "service_role";



GRANT ALL ON TABLE "public"."competitors" TO "anon";
GRANT ALL ON TABLE "public"."competitors" TO "authenticated";
GRANT ALL ON TABLE "public"."competitors" TO "service_role";



GRANT ALL ON TABLE "public"."configs" TO "anon";
GRANT ALL ON TABLE "public"."configs" TO "authenticated";
GRANT ALL ON TABLE "public"."configs" TO "service_role";



GRANT ALL ON TABLE "public"."consolidators" TO "anon";
GRANT ALL ON TABLE "public"."consolidators" TO "authenticated";
GRANT ALL ON TABLE "public"."consolidators" TO "service_role";



GRANT ALL ON TABLE "public"."content_items" TO "anon";
GRANT ALL ON TABLE "public"."content_items" TO "authenticated";
GRANT ALL ON TABLE "public"."content_items" TO "service_role";



GRANT ALL ON TABLE "public"."county_references" TO "anon";
GRANT ALL ON TABLE "public"."county_references" TO "authenticated";
GRANT ALL ON TABLE "public"."county_references" TO "service_role";



GRANT ALL ON TABLE "public"."county_vehicle_registrations" TO "anon";
GRANT ALL ON TABLE "public"."county_vehicle_registrations" TO "authenticated";
GRANT ALL ON TABLE "public"."county_vehicle_registrations" TO "service_role";



GRANT ALL ON SEQUENCE "public"."county_vehicle_registrations_id_seq" TO "anon";
GRANT ALL ON SEQUENCE "public"."county_vehicle_registrations_id_seq" TO "authenticated";
GRANT ALL ON SEQUENCE "public"."county_vehicle_registrations_id_seq" TO "service_role";



GRANT ALL ON TABLE "public"."crash_event_sources" TO "anon";
GRANT ALL ON TABLE "public"."crash_event_sources" TO "authenticated";
GRANT ALL ON TABLE "public"."crash_event_sources" TO "service_role";



GRANT ALL ON SEQUENCE "public"."crash_event_sources_id_seq" TO "anon";
GRANT ALL ON SEQUENCE "public"."crash_event_sources_id_seq" TO "authenticated";
GRANT ALL ON SEQUENCE "public"."crash_event_sources_id_seq" TO "service_role";



GRANT ALL ON TABLE "public"."crash_events" TO "anon";
GRANT ALL ON TABLE "public"."crash_events" TO "authenticated";
GRANT ALL ON TABLE "public"."crash_events" TO "service_role";



GRANT ALL ON SEQUENCE "public"."crash_events_id_seq" TO "anon";
GRANT ALL ON SEQUENCE "public"."crash_events_id_seq" TO "authenticated";
GRANT ALL ON SEQUENCE "public"."crash_events_id_seq" TO "service_role";



GRANT ALL ON TABLE "public"."crash_zip_annual" TO "anon";
GRANT ALL ON TABLE "public"."crash_zip_annual" TO "authenticated";
GRANT ALL ON TABLE "public"."crash_zip_annual" TO "service_role";



GRANT ALL ON TABLE "public"."customer_zip_report_monthly" TO "anon";
GRANT ALL ON TABLE "public"."customer_zip_report_monthly" TO "authenticated";
GRANT ALL ON TABLE "public"."customer_zip_report_monthly" TO "service_role";



GRANT ALL ON TABLE "public"."discovery_briefs" TO "anon";
GRANT ALL ON TABLE "public"."discovery_briefs" TO "authenticated";
GRANT ALL ON TABLE "public"."discovery_briefs" TO "service_role";



GRANT ALL ON TABLE "public"."dmv_vehicle_registrations" TO "anon";
GRANT ALL ON TABLE "public"."dmv_vehicle_registrations" TO "authenticated";
GRANT ALL ON TABLE "public"."dmv_vehicle_registrations" TO "service_role";



GRANT ALL ON SEQUENCE "public"."dmv_vehicle_registrations_id_seq" TO "anon";
GRANT ALL ON SEQUENCE "public"."dmv_vehicle_registrations_id_seq" TO "authenticated";
GRANT ALL ON SEQUENCE "public"."dmv_vehicle_registrations_id_seq" TO "service_role";



GRANT ALL ON TABLE "public"."elements" TO "anon";
GRANT ALL ON TABLE "public"."elements" TO "authenticated";
GRANT ALL ON TABLE "public"."elements" TO "service_role";



GRANT ALL ON TABLE "public"."email_events" TO "anon";
GRANT ALL ON TABLE "public"."email_events" TO "authenticated";
GRANT ALL ON TABLE "public"."email_events" TO "service_role";



GRANT ALL ON TABLE "public"."estimated_zip_vehicles" TO "anon";
GRANT ALL ON TABLE "public"."estimated_zip_vehicles" TO "authenticated";
GRANT ALL ON TABLE "public"."estimated_zip_vehicles" TO "service_role";



GRANT ALL ON SEQUENCE "public"."estimated_zip_vehicles_id_seq" TO "anon";
GRANT ALL ON SEQUENCE "public"."estimated_zip_vehicles_id_seq" TO "authenticated";
GRANT ALL ON SEQUENCE "public"."estimated_zip_vehicles_id_seq" TO "service_role";



GRANT ALL ON TABLE "public"."ev_registrations" TO "anon";
GRANT ALL ON TABLE "public"."ev_registrations" TO "authenticated";
GRANT ALL ON TABLE "public"."ev_registrations" TO "service_role";



GRANT ALL ON SEQUENCE "public"."ev_registrations_id_seq" TO "anon";
GRANT ALL ON SEQUENCE "public"."ev_registrations_id_seq" TO "authenticated";
GRANT ALL ON SEQUENCE "public"."ev_registrations_id_seq" TO "service_role";



GRANT ALL ON TABLE "public"."integrations" TO "anon";
GRANT ALL ON TABLE "public"."integrations" TO "authenticated";
GRANT ALL ON TABLE "public"."integrations" TO "service_role";



GRANT ALL ON TABLE "public"."invoiced_customers" TO "anon";
GRANT ALL ON TABLE "public"."invoiced_customers" TO "authenticated";
GRANT ALL ON TABLE "public"."invoiced_customers" TO "service_role";



GRANT ALL ON TABLE "public"."leads" TO "anon";
GRANT ALL ON TABLE "public"."leads" TO "authenticated";
GRANT ALL ON TABLE "public"."leads" TO "service_role";



GRANT ALL ON TABLE "public"."localreach_pages" TO "anon";
GRANT ALL ON TABLE "public"."localreach_pages" TO "authenticated";
GRANT ALL ON TABLE "public"."localreach_pages" TO "service_role";



GRANT ALL ON TABLE "public"."location_brand" TO "anon";
GRANT ALL ON TABLE "public"."location_brand" TO "authenticated";
GRANT ALL ON TABLE "public"."location_brand" TO "service_role";



GRANT ALL ON TABLE "public"."location_certifications" TO "anon";
GRANT ALL ON TABLE "public"."location_certifications" TO "authenticated";
GRANT ALL ON TABLE "public"."location_certifications" TO "service_role";



GRANT ALL ON TABLE "public"."location_insurance" TO "anon";
GRANT ALL ON TABLE "public"."location_insurance" TO "authenticated";
GRANT ALL ON TABLE "public"."location_insurance" TO "service_role";



GRANT ALL ON TABLE "public"."location_market" TO "anon";
GRANT ALL ON TABLE "public"."location_market" TO "authenticated";
GRANT ALL ON TABLE "public"."location_market" TO "service_role";



GRANT ALL ON TABLE "public"."location_paperclip_mapping" TO "anon";
GRANT ALL ON TABLE "public"."location_paperclip_mapping" TO "authenticated";
GRANT ALL ON TABLE "public"."location_paperclip_mapping" TO "service_role";



GRANT ALL ON TABLE "public"."location_profiles" TO "anon";
GRANT ALL ON TABLE "public"."location_profiles" TO "authenticated";
GRANT ALL ON TABLE "public"."location_profiles" TO "service_role";



GRANT ALL ON TABLE "public"."location_services" TO "anon";
GRANT ALL ON TABLE "public"."location_services" TO "authenticated";
GRANT ALL ON TABLE "public"."location_services" TO "service_role";



GRANT ALL ON TABLE "public"."locations" TO "anon";
GRANT ALL ON TABLE "public"."locations" TO "authenticated";
GRANT ALL ON TABLE "public"."locations" TO "service_role";



GRANT ALL ON TABLE "public"."market_map_point_cache" TO "anon";
GRANT ALL ON TABLE "public"."market_map_point_cache" TO "authenticated";
GRANT ALL ON TABLE "public"."market_map_point_cache" TO "service_role";



GRANT ALL ON TABLE "public"."market_zip_latest_signal" TO "anon";
GRANT ALL ON TABLE "public"."market_zip_latest_signal" TO "authenticated";
GRANT ALL ON TABLE "public"."market_zip_latest_signal" TO "service_role";



GRANT ALL ON TABLE "public"."pages" TO "anon";
GRANT ALL ON TABLE "public"."pages" TO "authenticated";
GRANT ALL ON TABLE "public"."pages" TO "service_role";



GRANT ALL ON TABLE "public"."portal_sessions_log" TO "anon";
GRANT ALL ON TABLE "public"."portal_sessions_log" TO "authenticated";
GRANT ALL ON TABLE "public"."portal_sessions_log" TO "service_role";



GRANT ALL ON TABLE "public"."portal_users" TO "anon";
GRANT ALL ON TABLE "public"."portal_users" TO "authenticated";
GRANT ALL ON TABLE "public"."portal_users" TO "service_role";



GRANT ALL ON TABLE "public"."profiles" TO "anon";
GRANT ALL ON TABLE "public"."profiles" TO "authenticated";
GRANT ALL ON TABLE "public"."profiles" TO "service_role";



GRANT ALL ON TABLE "public"."psg_knowledge_chunks" TO "anon";
GRANT ALL ON TABLE "public"."psg_knowledge_chunks" TO "authenticated";
GRANT ALL ON TABLE "public"."psg_knowledge_chunks" TO "service_role";



GRANT ALL ON TABLE "public"."psg_knowledge_meta" TO "anon";
GRANT ALL ON TABLE "public"."psg_knowledge_meta" TO "authenticated";
GRANT ALL ON TABLE "public"."psg_knowledge_meta" TO "service_role";



GRANT ALL ON TABLE "public"."reports" TO "anon";
GRANT ALL ON TABLE "public"."reports" TO "authenticated";
GRANT ALL ON TABLE "public"."reports" TO "service_role";



GRANT ALL ON TABLE "public"."research_artifacts" TO "anon";
GRANT ALL ON TABLE "public"."research_artifacts" TO "authenticated";
GRANT ALL ON TABLE "public"."research_artifacts" TO "service_role";



GRANT ALL ON TABLE "public"."review_items" TO "anon";
GRANT ALL ON TABLE "public"."review_items" TO "authenticated";
GRANT ALL ON TABLE "public"."review_items" TO "service_role";



GRANT ALL ON TABLE "public"."review_responses" TO "anon";
GRANT ALL ON TABLE "public"."review_responses" TO "authenticated";
GRANT ALL ON TABLE "public"."review_responses" TO "service_role";



GRANT ALL ON TABLE "public"."reviews" TO "anon";
GRANT ALL ON TABLE "public"."reviews" TO "authenticated";
GRANT ALL ON TABLE "public"."reviews" TO "service_role";



GRANT ALL ON TABLE "public"."shop_users" TO "anon";
GRANT ALL ON TABLE "public"."shop_users" TO "authenticated";
GRANT ALL ON TABLE "public"."shop_users" TO "service_role";



GRANT ALL ON TABLE "public"."shops" TO "anon";
GRANT ALL ON TABLE "public"."shops" TO "authenticated";
GRANT ALL ON TABLE "public"."shops" TO "service_role";



GRANT ALL ON TABLE "public"."skills" TO "anon";
GRANT ALL ON TABLE "public"."skills" TO "authenticated";
GRANT ALL ON TABLE "public"."skills" TO "service_role";



GRANT ALL ON TABLE "public"."sms_events" TO "anon";
GRANT ALL ON TABLE "public"."sms_events" TO "authenticated";
GRANT ALL ON TABLE "public"."sms_events" TO "service_role";



GRANT ALL ON TABLE "public"."state_references" TO "anon";
GRANT ALL ON TABLE "public"."state_references" TO "authenticated";
GRANT ALL ON TABLE "public"."state_references" TO "service_role";



GRANT ALL ON TABLE "public"."state_vehicle_registrations" TO "anon";
GRANT ALL ON TABLE "public"."state_vehicle_registrations" TO "authenticated";
GRANT ALL ON TABLE "public"."state_vehicle_registrations" TO "service_role";



GRANT ALL ON SEQUENCE "public"."state_vehicle_registrations_id_seq" TO "anon";
GRANT ALL ON SEQUENCE "public"."state_vehicle_registrations_id_seq" TO "authenticated";
GRANT ALL ON SEQUENCE "public"."state_vehicle_registrations_id_seq" TO "service_role";



GRANT ALL ON TABLE "public"."storm_event_sources" TO "anon";
GRANT ALL ON TABLE "public"."storm_event_sources" TO "authenticated";
GRANT ALL ON TABLE "public"."storm_event_sources" TO "service_role";



GRANT ALL ON SEQUENCE "public"."storm_event_sources_id_seq" TO "anon";
GRANT ALL ON SEQUENCE "public"."storm_event_sources_id_seq" TO "authenticated";
GRANT ALL ON SEQUENCE "public"."storm_event_sources_id_seq" TO "service_role";



GRANT ALL ON TABLE "public"."storm_events" TO "anon";
GRANT ALL ON TABLE "public"."storm_events" TO "authenticated";
GRANT ALL ON TABLE "public"."storm_events" TO "service_role";



GRANT ALL ON SEQUENCE "public"."storm_events_id_seq" TO "anon";
GRANT ALL ON SEQUENCE "public"."storm_events_id_seq" TO "authenticated";
GRANT ALL ON SEQUENCE "public"."storm_events_id_seq" TO "service_role";



GRANT ALL ON TABLE "public"."storm_zip_monthly" TO "anon";
GRANT ALL ON TABLE "public"."storm_zip_monthly" TO "authenticated";
GRANT ALL ON TABLE "public"."storm_zip_monthly" TO "service_role";



GRANT ALL ON TABLE "public"."subscriptions" TO "anon";
GRANT ALL ON TABLE "public"."subscriptions" TO "authenticated";
GRANT ALL ON TABLE "public"."subscriptions" TO "service_role";



GRANT ALL ON TABLE "public"."survey_responses" TO "anon";
GRANT ALL ON TABLE "public"."survey_responses" TO "authenticated";
GRANT ALL ON TABLE "public"."survey_responses" TO "service_role";



GRANT ALL ON SEQUENCE "public"."survey_responses_id_seq" TO "anon";
GRANT ALL ON SEQUENCE "public"."survey_responses_id_seq" TO "authenticated";
GRANT ALL ON SEQUENCE "public"."survey_responses_id_seq" TO "service_role";



GRANT ALL ON TABLE "public"."utm_exports" TO "anon";
GRANT ALL ON TABLE "public"."utm_exports" TO "authenticated";
GRANT ALL ON TABLE "public"."utm_exports" TO "service_role";



GRANT ALL ON TABLE "public"."v_accident_trends_by_zip" TO "anon";
GRANT ALL ON TABLE "public"."v_accident_trends_by_zip" TO "authenticated";
GRANT ALL ON TABLE "public"."v_accident_trends_by_zip" TO "service_role";



GRANT ALL ON TABLE "public"."zipcode_boundaries" TO "anon";
GRANT ALL ON TABLE "public"."zipcode_boundaries" TO "authenticated";
GRANT ALL ON TABLE "public"."zipcode_boundaries" TO "service_role";



GRANT ALL ON TABLE "public"."v_collision_targeting_zip_annual" TO "anon";
GRANT ALL ON TABLE "public"."v_collision_targeting_zip_annual" TO "authenticated";
GRANT ALL ON TABLE "public"."v_collision_targeting_zip_annual" TO "service_role";



GRANT ALL ON TABLE "public"."v_market_opportunity" TO "anon";
GRANT ALL ON TABLE "public"."v_market_opportunity" TO "authenticated";
GRANT ALL ON TABLE "public"."v_market_opportunity" TO "service_role";



GRANT ALL ON TABLE "public"."v_shop_coverage" TO "anon";
GRANT ALL ON TABLE "public"."v_shop_coverage" TO "authenticated";
GRANT ALL ON TABLE "public"."v_shop_coverage" TO "service_role";



GRANT ALL ON TABLE "public"."v_storm_demand_examples" TO "anon";
GRANT ALL ON TABLE "public"."v_storm_demand_examples" TO "authenticated";
GRANT ALL ON TABLE "public"."v_storm_demand_examples" TO "service_role";



GRANT ALL ON TABLE "public"."weather_cache" TO "anon";
GRANT ALL ON TABLE "public"."weather_cache" TO "authenticated";
GRANT ALL ON TABLE "public"."weather_cache" TO "service_role";



GRANT ALL ON TABLE "public"."zcta_income_annual" TO "anon";
GRANT ALL ON TABLE "public"."zcta_income_annual" TO "authenticated";
GRANT ALL ON TABLE "public"."zcta_income_annual" TO "service_role";



GRANT ALL ON TABLE "public"."zcta_vehicle_availability" TO "anon";
GRANT ALL ON TABLE "public"."zcta_vehicle_availability" TO "authenticated";
GRANT ALL ON TABLE "public"."zcta_vehicle_availability" TO "service_role";



GRANT ALL ON SEQUENCE "public"."zcta_vehicle_availability_id_seq" TO "anon";
GRANT ALL ON SEQUENCE "public"."zcta_vehicle_availability_id_seq" TO "authenticated";
GRANT ALL ON SEQUENCE "public"."zcta_vehicle_availability_id_seq" TO "service_role";



GRANT ALL ON TABLE "public"."zcta_zip_mapping" TO "anon";
GRANT ALL ON TABLE "public"."zcta_zip_mapping" TO "authenticated";
GRANT ALL ON TABLE "public"."zcta_zip_mapping" TO "service_role";



GRANT ALL ON TABLE "public"."zip_references" TO "anon";
GRANT ALL ON TABLE "public"."zip_references" TO "authenticated";
GRANT ALL ON TABLE "public"."zip_references" TO "service_role";



GRANT SELECT,INSERT ON TABLE "sensitive"."pii_access_log" TO "service_role";



GRANT SELECT,USAGE ON SEQUENCE "sensitive"."pii_access_log_id_seq" TO "service_role";



GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE "sensitive"."repair_customer_locations" TO "service_role";



GRANT SELECT,USAGE ON SEQUENCE "sensitive"."repair_customer_locations_id_seq" TO "service_role";



GRANT SELECT,INSERT ON TABLE "sensitive"."repair_customers" TO "service_role";



GRANT SELECT,USAGE ON SEQUENCE "sensitive"."repair_customers_id_seq" TO "service_role";



GRANT SELECT,INSERT ON TABLE "sensitive"."survey_pii" TO "service_role";



GRANT SELECT,USAGE ON SEQUENCE "sensitive"."survey_pii_id_seq" TO "service_role";









ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON SEQUENCES TO "postgres";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON SEQUENCES TO "anon";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON SEQUENCES TO "authenticated";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON SEQUENCES TO "service_role";






ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON FUNCTIONS TO "postgres";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON FUNCTIONS TO "anon";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON FUNCTIONS TO "authenticated";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON FUNCTIONS TO "service_role";






ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON TABLES TO "postgres";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON TABLES TO "anon";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON TABLES TO "authenticated";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON TABLES TO "service_role";






ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "sensitive" GRANT SELECT,USAGE ON SEQUENCES TO "service_role";



ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "sensitive" GRANT SELECT,INSERT ON TABLES TO "service_role";
































