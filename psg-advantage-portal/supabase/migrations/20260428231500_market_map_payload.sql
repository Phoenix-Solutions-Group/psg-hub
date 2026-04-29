CREATE OR REPLACE FUNCTION market_map_payload(
  p_state TEXT DEFAULT NULL,
  p_directory_limit INTEGER DEFAULT 40000
)
RETURNS TABLE(payload JSONB)
LANGUAGE sql
STABLE
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
