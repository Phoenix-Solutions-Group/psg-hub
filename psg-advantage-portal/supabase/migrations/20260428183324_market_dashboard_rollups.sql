CREATE OR REPLACE FUNCTION market_state_rollup()
RETURNS TABLE(
  state TEXT,
  total_accidents BIGINT,
  high_severity_count BIGINT,
  weather_related_count BIGINT,
  zip_count BIGINT,
  severe_rate NUMERIC,
  weather_rate NUMERIC,
  opportunity_score NUMERIC
)
LANGUAGE sql
STABLE
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
