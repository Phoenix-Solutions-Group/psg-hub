-- Keep public survey raw_payload free of identity-adjacent duplicate fields.
-- text_customer_comments remains in its first-class dashboard column.

DO $$
DECLARE
  v_updated INTEGER;
BEGIN
  LOOP
    WITH batch AS (
      SELECT ctid
      FROM public.survey_responses
      WHERE raw_payload ?| ARRAY['sq_referral_agent', 'text_customer_comments']
      LIMIT 25000
    )
    UPDATE public.survey_responses sr
    SET raw_payload = sr.raw_payload - 'sq_referral_agent' - 'text_customer_comments'
    FROM batch
    WHERE sr.ctid = batch.ctid;

    GET DIAGNOSTICS v_updated = ROW_COUNT;
    EXIT WHEN v_updated = 0;
  END LOOP;
END
$$;
