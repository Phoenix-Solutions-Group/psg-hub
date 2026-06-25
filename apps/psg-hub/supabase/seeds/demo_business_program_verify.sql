-- Acceptance verification for the PSG-333 production run preconditions. Run AFTER
-- survey_attribution_pilot.sql + bsm_demo.sql + demo_business_program.sql:
--   psql "$DATABASE_URL" -f supabase/seeds/demo_business_program_verify.sql
--
-- (Agents have no shared-prod DB access in-sandbox — this is the operator step.
--  The render math is verified in CI by src/lib/ops/__tests__/production.test.ts.)

-- A) The ops company the batch generates for: renamed + addressed with the
--    canonical postal_code shape. Expected one row:
--      Riverside Collision | (555) 014-7700 | line1=1450 O Street | postal_code=68508
select c.name, c.phone,
       c.address->>'line1' as line1, c.address->>'city' as city,
       c.address->>'state' as state, c.address->>'postal_code' as postal_code
from public.companies c
where c.id = '00000000-0000-4000-8000-000000089000';

-- B) The program skin is present and complete. Expected one row; every flagged
--    column should be non-empty (these are the program.* tokens the W1 masters read).
select p.name as product,
       cp.customizations_jsonb->>'greeting'   as greeting,
       cp.customizations_jsonb->>'ownerName'  as owner_name,
       cp.customizations_jsonb->>'surveyUrl'  as survey_url,
       cp.customizations_jsonb->>'tagline'    as tagline,
       cp.customizations_jsonb->>'warrantyTerm' as warranty_term
from public.company_programs cp
join public.products p on p.id = cp.product_id
where cp.company_id = '00000000-0000-4000-8000-000000089000'
  and cp.product_id = '00000000-0000-4000-8000-000000033310';

-- C) Maria's recipient address uses the postal_code shape (cf. PSG-335 fix).
--    Expected: 742 Evergreen Terrace | Lincoln | NE | 68508
select rc.first_name, rc.last_name,
       rc.address->>'line1' as line1, rc.address->>'city' as city,
       rc.address->>'state' as state, rc.address->>'postal_code' as postal_code
from public.repair_customers rc
where rc.id = 'd5e00000-0000-4000-8000-000000000061';

-- D) Template approvals: thank_you must be `released` (gate passes); service_recovery
--    is `approved` until released. Expected: thank_you=released, service_recovery=approved.
select template_key, status, left(content_hash, 12) as hash12
from public.mail_template_approvals
where template_key in ('thank_you','service_recovery')
order by template_key;
