-- Demo-business PRODUCTION seed: completes the fake business so a real
-- generate->print batch (the PSG-333 "test all the way to production" run)
-- renders a fully-skinned, correctly-addressed letter — not just the proof PDF.
--
-- WHY THIS EXISTS (precondition gap found auditing the demo tenant for PSG-333):
--   bsm_demo.sql seeds Maria Alvarez's repair_customer + RO under the *reused*
--   pilot ops company  00000000-0000-4000-8000-000000089000  ("PSG Pilot Body
--   Shop", from survey_attribution_pilot.sql). That company has NO address and
--   NO company_programs row, so a live batch (`POST /api/production/generate` ->
--   `buildBatchDocuments`) would render a letter with a BLANK return address and
--   a BLANK shop skin (greeting / owner / survey URL / footer / tagline). The
--   board demo hides this because its production step uses the *Proof* action
--   (SAMPLE_MERGE_DATA), but PSG-333 runs the real batch path, which reads these
--   rows. This seed fills them.
--
-- DEPENDS ON: survey_attribution_pilot.sql (creates company …089000) AND
--   bsm_demo.sql (creates Maria + the released thank_you approval). Apply last:
--     psql "$DATABASE_URL" -f supabase/seeds/survey_attribution_pilot.sql
--     psql "$DATABASE_URL" -f supabase/seeds/bsm_demo.sql
--     psql "$DATABASE_URL" -f supabase/seeds/demo_business_program.sql
--
-- NOT auto-run (config.toml [db.seed] -> ./seed.sql only). Fully idempotent —
-- fixed UUIDs + ON CONFLICT + UPDATE-by-id — so re-applying backfills, never dupes.
--
-- IDENTITY NOTE (@Lee — please confirm): this renames company …089000 to
--   "Riverside Collision" so the letter, Maria's survey rows, the reviews, the
--   approvals queue and the shop login all read the SAME shop (they already say
--   "Riverside Collision" everywhere except this reused ops-company row). The one
--   consequence: the *older* survey_attribution_pilot rows ("Dana Driver", RO-8900x)
--   carry a denormalized text `survey_responses.shop_name = 'PSG Pilot Body Shop'`,
--   so those legacy report rows keep the old name. Trivially reversible — drop the
--   `name =` line below to keep "PSG Pilot Body Shop".
--
-- BRAND NOTE (@Lee): the skin copy + the logo / owner-signature URLs below are
--   functional placeholders so the letter renders clean today. Swap them for the
--   real Riverside Collision brand assets/voice when ready (changing them does not
--   change the released `thank_you` content hash — the skin is data, not template).
--
-- SERVICE-RECOVERY NOTE: bsm_demo.sql seeds `service_recovery` as `approved` (not
--   `released`). To also run the service_recovery batch, release it first (the
--   demo's S5 approve->release step, or set status='released'+released_at=now()
--   on its approval row). `thank_you` is already released, so it runs as-is.

begin;

-- 1. Shop identity + addressing on the ops company the batch generates for.
--    address jsonb MUST use the canonical StoredAddressInput keys
--    (line1/city/state/postal_code) — the generate route passes it through
--    verbatim; a `zip` key would fail-closed to a blank ZIP (cf. PSG-333).
update public.companies
   set name    = 'Riverside Collision',
       phone   = '(555) 014-7700',
       address = '{"line1":"1450 O Street","city":"Lincoln","state":"NE","postal_code":"68508"}'::jsonb,
       updated_at = now()
 where id = '00000000-0000-4000-8000-000000089000';

-- 2. The mail program (product) the batch is built from.
insert into public.products (id, name, description, items_jsonb, total_cost_cents, selling_price_cents)
values ('00000000-0000-4000-8000-000000033310',
        'W1 Thank-You + ACRB Survey Program',
        'Post-repair thank-you letter with ACRB satisfaction survey (BSM demo).',
        '[]'::jsonb, 0, 0)
on conflict (id) do nothing;

-- 3. The per-shop skin (customizations_jsonb) the mail-merge engine reads as
--    `program.*`. Fills every program token the W1 master letters reference so
--    `missingByCustomer` carries only the documented data-sourced residuals
--    (customer.vehicle/serviceDate via RO join, survey codes, company.websiteUrl).
insert into public.company_programs
  (id, company_id, product_id, quantity, unit_price_cents, customizations_jsonb)
values
  ('00000000-0000-4000-8000-000000033320',
   '00000000-0000-4000-8000-000000089000',
   '00000000-0000-4000-8000-000000033310',
   1, 0,
   jsonb_build_object(
     'greeting',          'Thank you for trusting Riverside Collision with your vehicle.',
     'footer',            'Riverside Collision ·',
     'logo',              'https://cdn.example/riverside-collision-logo.png',
     'addressLine1',      '1450 O Street',
     'addressLine2',      'Lincoln, NE 68508',
     'ownerName',         'Sam Rivera',
     'ownerFirstName',    'Sam',
     'ownerTitle',        'Owner',
     'ownerSignatureUrl', 'https://cdn.example/sam-rivera-signature.png',
     'ownerDirectLine',   '(555) 014-7701',
     'surveyUrl',         'www.theacrb.com',
     'tagline',           'We keep our customers by keeping our customers satisfied',
     'pieceCode',         'RC-W1',
     'jobNumber',         'RC.0001',
     'certifications',    'I-CAR Gold Class · ASE Certified',
     'hasWarranty',       'true',
     'warrantyTerm',      'limited lifetime workmanship warranty'
   ))
on conflict (company_id, product_id) do update
  set customizations_jsonb = excluded.customizations_jsonb,
      updated_at = now();

commit;
