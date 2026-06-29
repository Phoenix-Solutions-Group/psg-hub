-- PSG-395 (Track B) — FileMaker full-DB → Supabase staging schema + dedup ingest.
--
-- Builds the SCALABLE multi-customer ingest (single-RO acceptance is covered by
-- Track A + the v1.1 importer; this is OFF the 07-10 critical path, built in
-- parallel). Two additive pieces:
--
--   1. a `staging` schema with one raw landing table per FM export table
--      (columns captured as-text in a jsonb blob) + provenance metadata; and
--   2. provenance columns (source_system, source_id, content_hash) on the
--      canonical public tables so the ingest can dedup against what already
--      exists and back-fill rows first loaded by the single-file importer.
--
-- Everything here is ADDITIVE + IDEMPOTENT (create-if-not-exists / add-column-
-- if-not-exists / guarded constraint) so it is safe to re-run.
--
-- ── RLS / SECURITY POSTURE ────────────────────────────────────────────────
--  * staging.* landing tables: RLS ENABLED with NO policy = default-deny. These
--    are operational ingestion tables — no customer or app user ever reads them;
--    all access is via createServiceClient() (RLS-bypass), exactly mirroring
--    public.stripe_webhook_events / oauth_states (the rls_enabled_no_policy
--    advisor INFO is the intended posture, not a finding).
--  * canonical public.repair_orders / public.estimates / public.repair_customers:
--    the new columns are added to EXISTING tables and inherit their EXISTING
--    `*_ops_all` policy (for all to authenticated using/with check
--    (private.current_user_has_fn('manage_companies'))) from
--    20260618170000_ops_foundation_v1_1.sql. NO new/changed policy, NO grant,
--    NO RLS widening — default-deny is fully preserved.
--
-- ── OPERATOR NOTE (not applied here) ──────────────────────────────────────
--  Reaching staging.* through PostgREST (the supabase-js .schema("staging")
--  path) requires `staging` to be added to the project exposed-schemas config
--  (PGRST_DB_SCHEMAS). That is an operator step alongside the prod
--  `supabase db push`, same gate as the other authored-not-applied migrations.

-- =========================================================================
-- 1. staging schema.
-- =========================================================================
create schema if not exists staging;

-- =========================================================================
-- 2. Raw landing tables — one per FM export table, columns captured as-text.
--    `columns` is the faithful as-text capture of the whole source row (so the
--    landing table is a lossless replay buffer); `source_id` is the FileMaker
--    primary key; `content_hash` is the stable hash of `columns` (the dedup
--    change-detection signal). UNIQUE (company_id, source_system, source_id)
--    makes a re-landed source row an UPSERT, never a duplicate.
-- =========================================================================
do $$
declare
  t text;
  landing_tables text[] := array['fm_repair_orders', 'fm_estimates', 'fm_repair_customers'];
begin
  foreach t in array landing_tables loop
    execute format($f$
      create table if not exists staging.%I (
        id uuid primary key default gen_random_uuid(),
        company_id uuid not null references public.companies(id) on delete cascade,
        source_system text not null,
        source_id text not null,
        source_file text,
        content_hash text not null,
        columns jsonb not null default '{}'::jsonb,
        ingested_at timestamptz not null default now(),
        unique (company_id, source_system, source_id)
      )
    $f$, t);
    -- Default-deny: RLS on, NO policy. Service-role writes bypass RLS.
    execute format('alter table staging.%I enable row level security', t);
    execute format(
      'create index if not exists %I on staging.%I (company_id)',
      'idx_' || t || '_company', t
    );
    execute format(
      'create index if not exists %I on staging.%I (content_hash)',
      'idx_' || t || '_content_hash', t
    );
  end loop;
end $$;

-- =========================================================================
-- 3. Canonical provenance columns (additive) on the public ops tables.
--    Nullable so existing rows are untouched; the ingest back-fills them on
--    the first pass over an already-imported DB. A PARTIAL unique index keeps
--    one canonical row per source record once provenance is set, while leaving
--    pre-provenance (NULL) rows unconstrained.
-- =========================================================================
do $$
declare
  t text;
  canonical_tables text[] := array['repair_orders', 'estimates', 'repair_customers'];
begin
  foreach t in array canonical_tables loop
    execute format('alter table public.%I add column if not exists source_system text', t);
    execute format('alter table public.%I add column if not exists source_id text', t);
    execute format('alter table public.%I add column if not exists content_hash text', t);
    execute format(
      'create unique index if not exists %I on public.%I '
      || '(company_id, source_system, source_id) where source_system is not null',
      'uq_' || t || '_source', t
    );
  end loop;
end $$;

comment on column public.repair_orders.source_system is
  'PSG-395 ingest provenance: originating system (e.g. ''filemaker''). NULL = pre-provenance row.';
comment on column public.repair_orders.source_id is
  'PSG-395 ingest provenance: source primary key (e.g. FileMaker PK).';
comment on column public.repair_orders.content_hash is
  'PSG-395 ingest provenance: stable hash of the source record; unchanged hash => skip on re-ingest.';
comment on column public.estimates.source_system is
  'PSG-395 ingest provenance: originating system. NULL = pre-provenance row.';
comment on column public.estimates.source_id is
  'PSG-395 ingest provenance: source primary key.';
comment on column public.estimates.content_hash is
  'PSG-395 ingest provenance: stable hash of the source record.';
comment on column public.repair_customers.source_system is
  'PSG-395 ingest provenance: originating system. NULL = pre-provenance row.';
comment on column public.repair_customers.source_id is
  'PSG-395 ingest provenance: source primary key.';
comment on column public.repair_customers.content_hash is
  'PSG-395 ingest provenance: stable hash of the source record.';
