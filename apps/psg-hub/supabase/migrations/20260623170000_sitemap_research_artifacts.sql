-- PSG-236 / Wave 1A — allow sitemap packages in research_artifacts.
--
-- The sitemap engine (PSG-225) persists a finished SitemapPackage + its four derived
-- artifacts as a research_artifacts row, scoped to a shop via data->>'shop_id' (NOT the
-- legacy campaign_id join), so a shop with no campaign row can still own a sitemap.
--
-- research_artifacts is already DEFAULT-DENY RLS — the blanket "Allow all" policies were
-- dropped and RLS left enabled with no authenticated SELECT policy
-- (see 20260603194623_close_blanket_allow_rls.sql). Reads/writes are service-role only,
-- and the /ops/sitemap route is superadmin-gated. So the only schema change needed is to
-- widen the artifact_type CHECK constraint and add a tenant-scoped read index. Additive
-- and safe to apply ahead of the route.

alter table public.research_artifacts
  drop constraint if exists research_artifacts_artifact_type_check;

alter table public.research_artifacts
  add constraint research_artifacts_artifact_type_check
  check (artifact_type = any (array[
    'semrush_base'::text, 'semrush_geo'::text, 'semrush_competitor'::text, 'semrush_gap'::text,
    'social_sentiment'::text, 'social_personas'::text, 'content_brief'::text, 'qa_report'::text,
    'sitemap_package'::text
  ]));

-- Tenant-scoped read path: /ops/sitemap loads a shop's packages by data->>'shop_id'.
create index if not exists research_artifacts_sitemap_shop_idx
  on public.research_artifacts ((data->>'shop_id'))
  where artifact_type = 'sitemap_package';

-- Idempotent re-assertion of default-deny (no new authenticated policy is added).
alter table public.research_artifacts enable row level security;
