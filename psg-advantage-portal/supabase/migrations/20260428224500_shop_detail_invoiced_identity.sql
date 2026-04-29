DROP FUNCTION IF EXISTS shop_detail(TEXT, DATE, DATE);

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
  WITH identity AS (
    SELECT
      ic.invoiced_id,
      ic.psg_id,
      ic.city,
      ic.state
    FROM invoiced_customers ic
    WHERE ic.normalized_name = REGEXP_REPLACE(LOWER(p_shop_name), '[^a-z0-9]', '', 'g')
    ORDER BY ic.imported_at DESC
    LIMIT 1
  )
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
    ) AS network_avg_communication,
    identity.invoiced_id,
    identity.psg_id,
    identity.city AS invoiced_city,
    identity.state AS invoiced_state
  FROM survey_responses sr
  LEFT JOIN identity ON TRUE
  WHERE sr.shop_name = $1
    AND sr.survey_date BETWEEN $2 AND $3
  GROUP BY
    sr.shop_name,
    identity.invoiced_id,
    identity.psg_id,
    identity.city,
    identity.state;
$$;
