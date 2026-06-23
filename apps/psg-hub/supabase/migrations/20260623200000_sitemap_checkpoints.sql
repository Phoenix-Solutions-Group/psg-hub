-- PSG-258 / Wave 1A — sitemap pipeline checkpoint approval queue.
--
-- The sitemap engine (PSG-225) has TWO mandatory human gates: approve the SERP
-- clusters + page types, then approve the finished package before client hand-off.
-- The /ops/sitemap run binds those gates to this poll-based approval queue: a run
-- enqueues a PENDING row for the gate it reaches and stops; a superadmin flips the row
-- to `approved` (or `changes_requested`); the next run matches the same content_hash and
-- advances. One row per (shop_id, phase, content_hash) so a re-run of the same plan
-- re-uses the existing decision (idempotent) rather than queueing a duplicate.
--
-- DEFAULT-DENY RLS: like research_artifacts / competitor_scores, this table has RLS
-- enabled and NO authenticated policy — only the service-role client (used by the
-- superadmin-gated route) reads/writes it. Tenant scoping is by shop_id.

create table if not exists public.sitemap_checkpoints (
  id uuid primary key default gen_random_uuid(),
  shop_id uuid not null references public.shops(id) on delete cascade,
  phase text not null check (phase in ('clusters_page_types', 'package_handoff')),
  content_hash text not null,
  status text not null default 'pending'
    check (status in ('pending', 'approved', 'changes_requested')),
  -- compact, approver-facing digest of what is being signed off (never the full package)
  summary jsonb not null default '{}'::jsonb,
  decided_by_profile_id uuid,
  decided_by_name text,
  decided_at timestamptz,
  notes text,
  requested_by_profile_id uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (shop_id, phase, content_hash)
);

-- Queue read path: a superadmin lists a shop's pending gates.
create index if not exists sitemap_checkpoints_shop_status_idx
  on public.sitemap_checkpoints (shop_id, status);

-- Default-deny: enable RLS, add NO authenticated policy (service-role only).
alter table public.sitemap_checkpoints enable row level security;

comment on table public.sitemap_checkpoints is
  'PSG-258: poll-based approval queue for the sitemap pipeline''s two human checkpoints. Default-deny RLS, service-role only; scoped by shop_id.';
