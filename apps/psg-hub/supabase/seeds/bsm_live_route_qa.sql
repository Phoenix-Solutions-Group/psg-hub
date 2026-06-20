-- BSM live-route QA seed — keyword-targets / content-briefs E2E fixtures. [PSG-168]
--
-- Stands up the DB-layer fixtures every BSM live-route E2E QA needs (PSG-167's
-- residual 401/403/400/topic cases, and every future shop-scoped API route).
-- Pairs with docs/infra/psg-168-preview-pipeline.md.
--
-- NOT auto-run. config.toml [db.seed] points only at ./seed.sql, so this file is
-- applied INTENTIONALLY against a NON-PROD seedable Supabase preview env ONLY —
-- NEVER prod (gylkkzmcmbdftxieyabw). It is fully idempotent (fixed UUIDs +
-- ON CONFLICT), so re-applying backfills, never dupes.
--
-- PREREQUISITE (one step the SQL deliberately does NOT do — see runbook §4):
--   Create the QA auth user FIRST via the GoTrue Admin API, pinning the SAME
--   fixed UUID this seed references, so password sign-in yields a real session:
--     POST {SUPABASE_URL}/auth/v1/admin/users
--       Authorization: Bearer {SERVICE_ROLE_KEY}
--       { "id": "00000000-0000-4000-8000-000000168001",
--         "email": "qa.bsm@psg.test", "password": "<set-in-runbook>",
--         "email_confirm": true }
--   The seed inserts only public.* rows and references that uid for shop_users
--   (FK → auth.users). Doing auth via the Admin API keeps the seed independent of
--   GoTrue's internal schema version (no fragile auth.users/identities SQL).
--
-- Apply (preview branch only):
--   psql "$PREVIEW_DATABASE_URL" -v qa_user_id="'00000000-0000-4000-8000-000000168001'" \
--     -f apps/psg-hub/supabase/seeds/bsm_live_route_qa.sql
--
-- Fixture triad (the real BSM QA shops): Tracy's / Wallace / Tedesco.
--   * Tracy's Collision  — QA user is OWNER, HAS auditor artifacts  → 200 + data, topic filter
--   * Wallace Auto Body  — QA user is NOT a member, HAS its own data → 403 (cross-tenant isolation)
--   * Tedesco Collision  — QA user is VIEWER, has NO auditor artifacts → 200 + [] (empty path)

\set qa_user_id '00000000-0000-4000-8000-000000168001'

begin;

-- 1. Clients (one client per shop — the onboarding 1:1 invariant the loader relies on).
insert into public.clients (id, name, primary_market) values
  ('00000000-0000-4000-8000-0000001680c1', 'Tracy''s Collision Center', 'Denver, CO'),
  ('00000000-0000-4000-8000-0000001680c2', 'Wallace Auto Body',          'Aurora, CO'),
  ('00000000-0000-4000-8000-0000001680c3', 'Tedesco Collision',          'Lakewood, CO')
on conflict (id) do nothing;

-- 2. Shops (FK shops.client_id → clients.id).
insert into public.shops (id, client_id, name) values
  ('00000000-0000-4000-8000-000000168501', '00000000-0000-4000-8000-0000001680c1', 'Tracy''s Collision Center'),
  ('00000000-0000-4000-8000-000000168502', '00000000-0000-4000-8000-0000001680c2', 'Wallace Auto Body'),
  ('00000000-0000-4000-8000-000000168503', '00000000-0000-4000-8000-0000001680c3', 'Tedesco Collision')
on conflict (id) do nothing;

-- 3. Membership (shop_users.user_id → auth.users.id; QA user created via Admin API first).
--    Tracy's = owner, Tedesco = viewer. Wallace is intentionally OMITTED → 403.
insert into public.shop_users (id, user_id, shop_id, role) values
  ('00000000-0000-4000-8000-000000168701', :'qa_user_id', '00000000-0000-4000-8000-000000168501', 'owner'),
  ('00000000-0000-4000-8000-000000168703', :'qa_user_id', '00000000-0000-4000-8000-000000168503', 'viewer')
on conflict (id) do nothing;

-- 4. Campaigns (research_artifacts.campaign_id → campaigns.id; campaigns.client_id → clients.id).
insert into public.campaigns (id, client_id, name, status) values
  ('00000000-0000-4000-8000-000000168a01', '00000000-0000-4000-8000-0000001680c1', 'Tracy''s SEO Audit', 'completed'),
  ('00000000-0000-4000-8000-000000168a02', '00000000-0000-4000-8000-0000001680c2', 'Wallace SEO Audit',  'completed')
  -- Tedesco has NO campaign → loader returns [] (empty-path coverage).
on conflict (id) do nothing;

-- 5. SEO-auditor artifacts. Loader reads artifact_type ∈ (semrush_base|geo|competitor|gap),
--    structured keyword rows under data->'keywords'. source_skill is NOT NULL.
--    Tracy's: a base set + a gap set. Two keywords contain "bumper" → topic=bumper returns a SUBSET.
insert into public.research_artifacts (id, campaign_id, artifact_type, source_skill, data) values
  ('00000000-0000-4000-8000-000000168b01',
   '00000000-0000-4000-8000-000000168a01', 'semrush_base', 'seo-auditor',
   '{"keywords":[
       {"keyword":"bumper repair","search_volume":1900,"competitor_presence":6,"priority":"HIGH"},
       {"keyword":"auto body shop near me","search_volume":5400,"competitor_presence":9,"priority":"HIGH"},
       {"keyword":"collision repair estimate","search_volume":880,"competitor_presence":4,"priority":"MEDIUM"},
       {"keyword":"paintless dent removal","search_volume":1300,"competitor_presence":5}
     ]}'::jsonb),
  ('00000000-0000-4000-8000-000000168b02',
   '00000000-0000-4000-8000-000000168a01', 'semrush_gap', 'seo-auditor',
   '{"keywords":[
       {"keyword":"bumper scuff repair cost","search_volume":720,"competitor_presence":2}
     ]}'::jsonb),
  -- Wallace's OWN keyword the QA user must NEVER see (cross-tenant isolation proof).
  ('00000000-0000-4000-8000-000000168b03',
   '00000000-0000-4000-8000-000000168a02', 'semrush_base', 'seo-auditor',
   '{"keywords":[
       {"keyword":"wallace exclusive keyword","search_volume":999,"competitor_presence":1}
     ]}'::jsonb)
on conflict (id) do nothing;

commit;

-- ---------------------------------------------------------------------------
-- Verify (run after seeding; expectations encoded as a single assert query).
-- ---------------------------------------------------------------------------
-- Expect exactly one row, all booleans true.
with tracy_keywords as (
  select jsonb_array_elements(ra.data->'keywords')->>'keyword' as kw
  from public.research_artifacts ra
  join public.campaigns c on c.id = ra.campaign_id
  join public.shops s on s.client_id = c.client_id
  where s.id = '00000000-0000-4000-8000-000000168501'
    and ra.artifact_type in ('semrush_base','semrush_geo','semrush_competitor','semrush_gap')
)
select
  (select count(*) from public.shop_users
     where user_id = :'qa_user_id'
       and shop_id = '00000000-0000-4000-8000-000000168501') = 1            as tracy_membership_ok,
  (select count(*) from public.shop_users
     where user_id = :'qa_user_id'
       and shop_id = '00000000-0000-4000-8000-000000168502') = 0            as wallace_non_member_ok,
  (select count(*) from tracy_keywords) = 5                                  as tracy_keyword_count_ok,
  (select count(*) from tracy_keywords where kw ilike '%bumper%') = 2        as topic_filter_subset_ok,
  not exists (select 1 from tracy_keywords where kw = 'wallace exclusive keyword') as isolation_ok;
