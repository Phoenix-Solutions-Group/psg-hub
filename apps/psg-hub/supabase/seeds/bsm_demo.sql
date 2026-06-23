-- BSM runnable demo environment seed. [PSG-335] (parent PSG-334 demo script)
-- Seeds one pilot shop ("Riverside Collision") so a presenter can click every
-- step of apps/psg-hub/docs/demos/bsm-board-demo-script.md (§2 super admin, §3 shop)
-- with no empty states and zero live mail. See docs/runbooks/bsm-demo-seed.md.
--
-- NOT auto-run. config.toml [db.seed] points only at ./seed.sql; apply this file
-- explicitly (operator runbook step) against the shared project.
--
-- Fully idempotent — fixed demo UUIDs + ON CONFLICT. Safe to re-run.
-- Teardown block at the bottom (commented) removes every demo row.
--
-- PREREQUISITES handled by the operator BEFORE the fenced sections at the end work:
--   * `supabase db push` of 20260624120000_approval_queue.sql AND
--     20260624140000_review_solicitation.sql (not yet in the shared DB) — needed
--     for the §3 approvals inbox (C1/C2/C4).
--   * A real auth.users login for the Riverside shop (agents cannot create auth
--     users / passwords) — needed to attach shop_users membership so /dashboard/*
--     renders the seeded rows.
-- The two fenced sections at the end stay commented until those prereqs land.

begin;

-- ---------------------------------------------------------------------------
-- 1. Demo client + shop + primary location (portal model -> /dashboard/*, /ops CCC)
-- ---------------------------------------------------------------------------
insert into public.clients (id, name, primary_market, zip_code)
values ('d5e00000-0000-4000-8000-000000000001', 'Riverside Collision (BSM Demo)', 'Lincoln, NE', '68508')
on conflict (id) do nothing;

insert into public.shops (id, client_id, name, url, telephone,
                          address_street, address_locality, address_region, address_postal_code, address_country,
                          slug, is_multi_location)
values ('d5e00000-0000-4000-8000-000000000010',
        'd5e00000-0000-4000-8000-000000000001',
        'Riverside Collision', 'riversidecollision.example', '(555) 014-7700',
        '1400 Riverside Dr', 'Lincoln', 'NE', '68508', 'US',
        'riverside-collision', false)
on conflict (id) do nothing;

insert into public.locations (id, shop_id, name, slug, is_primary)
values ('d5e00000-0000-4000-8000-000000000011',
        'd5e00000-0000-4000-8000-000000000010',
        'Riverside Collision', 'riverside-collision', true)
on conflict (id) do nothing;

-- ---------------------------------------------------------------------------
-- 2. Reviews + sentiment (§3 C3 /dashboard/reviews — mixed sentiment, 1 actionable)
-- ---------------------------------------------------------------------------
insert into public.review_items (id, shop_id, location_id, platform, rating, text, author, reviewed_at) values
  ('d5e00000-0000-4000-8000-000000000021','d5e00000-0000-4000-8000-000000000010','d5e00000-0000-4000-8000-000000000011',
   'google', 5, 'Maria''s Civic came back looking brand new. The team kept me updated the whole time — could not be happier.', 'Maria Alvarez', now() - interval '2 days'),
  ('d5e00000-0000-4000-8000-000000000022','d5e00000-0000-4000-8000-000000000010','d5e00000-0000-4000-8000-000000000011',
   'google', 5, 'Fast, fair, and the paint match is perfect. Highly recommend Riverside.', 'Devon Park', now() - interval '6 days'),
  ('d5e00000-0000-4000-8000-000000000023','d5e00000-0000-4000-8000-000000000010','d5e00000-0000-4000-8000-000000000011',
   'google', 3, 'Repair was solid but it took a couple days longer than I was told.', 'Sam Whitfield', now() - interval '11 days'),
  ('d5e00000-0000-4000-8000-000000000024','d5e00000-0000-4000-8000-000000000010','d5e00000-0000-4000-8000-000000000011',
   'google', 1, 'Got my car back with overspray on the trim and nobody called me back. Frustrated.', 'Karen Boyd', now() - interval '1 day')
on conflict (id) do nothing;

insert into public.review_sentiment (review_item_id, shop_id, polarity, confidence, themes, actionable_complaint) values
  ('d5e00000-0000-4000-8000-000000000021','d5e00000-0000-4000-8000-000000000010','positive', 0.97, array['communication','quality'], false),
  ('d5e00000-0000-4000-8000-000000000022','d5e00000-0000-4000-8000-000000000010','positive', 0.95, array['speed','quality','price'], false),
  ('d5e00000-0000-4000-8000-000000000023','d5e00000-0000-4000-8000-000000000010','neutral',  0.78, array['cycle_time'], false),
  ('d5e00000-0000-4000-8000-000000000024','d5e00000-0000-4000-8000-000000000010','negative', 0.93, array['quality','communication'], true)
on conflict (review_item_id) do nothing;

-- Owner-voice draft reply queued for the actionable 1-star (the "save").
insert into public.review_responses (review_item_id, shop_id, draft_text, status) values
  ('d5e00000-0000-4000-8000-000000000024','d5e00000-0000-4000-8000-000000000010',
   'Karen, this is the owner — I''m sorry we let you down on the trim and the callback. That''s not our standard. Please reach me directly at (555) 014-7701 and I''ll make this right personally.',
   'draft')
on conflict (review_item_id) do nothing;

-- ---------------------------------------------------------------------------
-- 3. Content items (§3 C5 /dashboard/content — approved, fresh)
-- ---------------------------------------------------------------------------
insert into public.content_items (id, shop_id, location_id, type, title, body, status) values
  ('d5e00000-0000-4000-8000-000000000031','d5e00000-0000-4000-8000-000000000010','d5e00000-0000-4000-8000-000000000011',
   'blog', 'What to do after a collision in Lincoln, NE', 'A step-by-step guide for drivers...', 'approved'),
  ('d5e00000-0000-4000-8000-000000000032','d5e00000-0000-4000-8000-000000000010','d5e00000-0000-4000-8000-000000000011',
   'faq', 'Do you work with my insurance?', 'Yes — Riverside Collision works directly with all major carriers...', 'published')
on conflict (id) do nothing;

-- ---------------------------------------------------------------------------
-- 4. Analytics (§3 C6 /dashboard/analytics). NOTE: only the 'semrush' (organic)
--    source is agent-seedable; google_ads / ga4 / gsc / gbp require live API
--    integrations and will show "not linked" cards. Present organic; describe the rest.
-- ---------------------------------------------------------------------------
insert into public.analytics_snapshots (id, shop_id, location_id, source, date, period, metrics) values
  ('d5e00000-0000-4000-8000-000000000041','d5e00000-0000-4000-8000-000000000010', null,
   'semrush', (now() - interval '3 days')::date, 'daily',
   '{"organic_traffic": 184, "organic_keywords": 57, "organic_traffic_cost": 1240.50, "backlinks": 142, "authority_score": 41}'::jsonb)
on conflict (id) do nothing;

-- ---------------------------------------------------------------------------
-- 5. CCC connections in each state (§2 S6 /ops/admin/integrations/ccc tabs).
--    Service-role table; no real credentials seeded (credential_kind='unconfirmed').
--    connection_status drives the Pending / Connected / Errors tabs.
-- ---------------------------------------------------------------------------
insert into public.ccc_accounts
  (id, shop_id, ccc_account_id, facility_id, credential_kind, status, connection_status,
   enabled_at, last_event_at, last_event_label)
values
  ('d5e00000-0000-4000-8000-000000000051','d5e00000-0000-4000-8000-000000000010',
   'BSMDEMO-PENDING','F-7701','unconfirmed','linked','pending_review', now(), now(), 'Enabled in CCC'),
  ('d5e00000-0000-4000-8000-000000000052','d5e00000-0000-4000-8000-000000000010',
   'BSMDEMO-CONNECTED','F-7702','unconfirmed','linked','connected', now(), now(), 'Connection approved'),
  ('d5e00000-0000-4000-8000-000000000053','d5e00000-0000-4000-8000-000000000010',
   'BSMDEMO-ERROR','F-7703','unconfirmed','error','error', now(), now(), 'Ingest auth failed')
on conflict (shop_id, ccc_account_id) do nothing;
update public.ccc_accounts set error_reason = 'auth_failed'
  where ccc_account_id = 'BSMDEMO-ERROR';

-- ---------------------------------------------------------------------------
-- 6. Mail template approvals (§2 S3/S4/S5 /ops/production/templates).
--    content_hash MUST match the deployed template bytes. Values below are the
--    origin/main hashes as of cd4c500 (PSG-331 service_recovery tokenization).
--    Re-verify against the deployed commit: the gate page shows the live hash;
--    a mismatch renders "released-stale". (Compute: currentTemplateHash(key) in
--    src/lib/production/template-gate.ts.)
--    thank_you -> released (shows an approved+live-eligible example for item 2).
--    service_recovery -> approved (leaves the live Approve->Release demo at S5).
-- ---------------------------------------------------------------------------
insert into public.mail_template_approvals
  (template_key, content_hash, status, approved_by_name, approved_at, released_at) values
  ('thank_you',        'a419851abe51f0f2af737336f8b3dcc7bbacfc378ce33b8e3fc484a019b94254',
   'released', 'PSG Ops (BSM demo seed)', now(), now()),
  ('service_recovery', 'd1846f2d85722f41357a010b5c8774c11479db93d5fa55ad1d391ea3d88a0b9c',
   'approved', 'PSG Ops (BSM demo seed)', now(), null)
on conflict (template_key, content_hash) do update
  set status = excluded.status,
      approved_by_name = excluded.approved_by_name,
      approved_at = excluded.approved_at,
      released_at = excluded.released_at,
      updated_at = now();

-- ---------------------------------------------------------------------------
-- 7. Ops repair data — Maria Alvarez / 2021 Honda Civic completed RO + CSI surveys.
--    Feeds the triggered-letter / production narrative (the proof PDF itself uses
--    SAMPLE_MERGE_DATA, not these rows). Reuses the existing pilot company FK.
--    company_id 00000000-0000-4000-8000-000000089000 = "PSG Pilot Body Shop".
-- ---------------------------------------------------------------------------
insert into public.vehicles (id, make, model) values
  ('d5e00000-0000-4000-8000-000000000062','Honda','Civic')
on conflict (id) do nothing;

insert into public.repair_customers (id, company_id, first_name, last_name, address, phone, email) values
  ('d5e00000-0000-4000-8000-000000000061','00000000-0000-4000-8000-000000089000',
   'Maria','Alvarez',
   '{"line1":"742 Evergreen Terrace","city":"Lincoln","state":"NE","zip":"68508"}'::jsonb,
   '(555) 014-3321','maria.alvarez@example.com')
on conflict (id) do nothing;

insert into public.repair_orders (id, repair_customer_id, company_id, ro_number, vehicle_id,
                                  total_loss_flag, status, dates_json, payload_jsonb) values
  ('d5e00000-0000-4000-8000-000000000063','d5e00000-0000-4000-8000-000000000061',
   '00000000-0000-4000-8000-000000089000','RO-77001','d5e00000-0000-4000-8000-000000000062',
   false,'closed',
   jsonb_build_object('date_in',(now()-interval '9 days')::date::text,'date_out',(now()-interval '3 days')::date::text),
   '{"vehicle_year":"2021"}'::jsonb)
on conflict (id) do nothing;

-- CSI surveys: one thank-you-eligible (high), one service-recovery-eligible (low).
insert into public.survey_responses (id, shop_name, survey_date, scale_emi_pct, would_recommend,
                                     ro_number, repair_order_id, shop_id, text_customer_comments) values
  (99000001,'Riverside Collision',(now()-interval '2 days')::date, 0.97, true,
   'RO-77001','d5e00000-0000-4000-8000-000000000063','d5e00000-0000-4000-8000-000000000010',
   'Great experience, thank you!'),
  (99000002,'Riverside Collision',(now()-interval '1 days')::date, 0.42, false,
   'RO-77050', null,'d5e00000-0000-4000-8000-000000000010',
   'Disappointed with the finish and the wait.')
on conflict (id) do nothing;

commit;

-- ===========================================================================
-- FENCED SECTION A — APPROVAL QUEUE (§3 C1/C2/C4). REQUIRES the two pending
-- migrations to be db-pushed first (approval_queue, review_solicitation).
-- Uncomment and run after the operator applies them.
-- ===========================================================================
-- begin;
-- insert into public.approval_queue (id, shop_id, action_type, title, summary, status, proposed_by, payload_jsonb) values
--   ('d5e00000-0000-4000-8000-000000000071','d5e00000-0000-4000-8000-000000000010',
--    'review_solicitation','Review request for Maria Alvarez (SMS + email)',
--    'Drafted in Riverside Collision''s voice, ready to send after pickup.', 'pending', 'agent:solicitation',
--    '{"channels":["email","sms"],"recipient_first_name":"Maria",
--      "email":{"subject":"How did we do, Maria?","text":"Hi Maria, thanks for trusting Riverside Collision with your Civic. If you have a moment, we''d be grateful for a quick review.","html":"<p>Hi Maria,</p><p>Thanks for trusting Riverside Collision with your Civic. If you have a moment, we''d be grateful for a quick review.</p>"},
--      "sms":"Hi Maria, thanks for choosing Riverside Collision! Mind leaving a quick review? [link] Reply STOP to opt out."}'::jsonb),
--   ('d5e00000-0000-4000-8000-000000000072','d5e00000-0000-4000-8000-000000000010',
--    'review_reply','Service-recovery reply to a 1-star review',
--    'Owner-voice apology + direct line for Karen Boyd''s 1-star. Approve to publish.', 'pending', 'agent:review-responder',
--    '{"review_item_id":"d5e00000-0000-4000-8000-000000000024","tone":"apologetic",
--      "draft":"Karen, this is the owner — I''m sorry we let you down. Please call me at (555) 014-7701 and I''ll make this right."}'::jsonb)
-- on conflict (id) do nothing;
-- commit;

-- ===========================================================================
-- FENCED SECTION B — SHOP-SCOPED LOGIN MEMBERSHIP (§1 item 5, §3). REQUIRES the
-- operator to create the Riverside auth.users login first, then paste its UUID.
-- ===========================================================================
-- begin;
-- insert into public.shop_users (user_id, shop_id, role) values
--   ('<RIVERSIDE_AUTH_USER_UUID>','d5e00000-0000-4000-8000-000000000010','owner')
-- on conflict do nothing;
-- commit;

-- ===========================================================================
-- TEARDOWN — removes every BSM demo row. Run to clean up after the demo.
-- ===========================================================================
-- begin;
-- delete from public.shop_users where shop_id = 'd5e00000-0000-4000-8000-000000000010';
-- delete from public.approval_queue where shop_id = 'd5e00000-0000-4000-8000-000000000010';
-- delete from public.survey_responses where id in (99000001, 99000002);
-- delete from public.repair_orders where id = 'd5e00000-0000-4000-8000-000000000063';
-- delete from public.repair_customers where id = 'd5e00000-0000-4000-8000-000000000061';
-- delete from public.vehicles where id = 'd5e00000-0000-4000-8000-000000000062';
-- delete from public.mail_template_approvals where approved_by_name = 'PSG Ops (BSM demo seed)';
-- delete from public.ccc_accounts where ccc_account_id like 'BSMDEMO-%';
-- delete from public.analytics_snapshots where shop_id = 'd5e00000-0000-4000-8000-000000000010';
-- delete from public.content_items where shop_id = 'd5e00000-0000-4000-8000-000000000010';
-- delete from public.review_responses where shop_id = 'd5e00000-0000-4000-8000-000000000010';
-- delete from public.review_sentiment where shop_id = 'd5e00000-0000-4000-8000-000000000010';
-- delete from public.review_items where shop_id = 'd5e00000-0000-4000-8000-000000000010';
-- delete from public.locations where shop_id = 'd5e00000-0000-4000-8000-000000000010';
-- delete from public.shops where id = 'd5e00000-0000-4000-8000-000000000010';
-- delete from public.clients where id = 'd5e00000-0000-4000-8000-000000000001';
-- commit;
