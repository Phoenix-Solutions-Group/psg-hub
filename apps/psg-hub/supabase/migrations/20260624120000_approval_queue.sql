-- PSG-245 / Wave 2 (G-d) — Generic agent→approve→publish approval queue.
--
-- A reusable human-in-the-loop gate harvested from Providence
-- (docs/reviews/psg-215-providence-sitemap-bsm-incorporation.md, item G-d): an
-- agent proposes an action, a role-gated human approves or rejects it, and the
-- action is published ONLY on approve. Generic over `action_type` (content,
-- gbp_post, review_reply, …) so the G-a/b/c autonomy layer all publishes through
-- one gate. This is the prerequisite that makes G-a/b/c safe to ship.
--
-- The queue row is the LIVE state of a single proposed action and moves through:
--
--   pending → approved → published        (publisher ran on approve)
--   pending → approved                     (no publisher wired yet — ready)
--   pending → approved → publish_failed    (publisher threw; retriable)
--   pending → rejected                     (never published)
--
-- Every decision (approve/reject) is recorded in the append-only access_audit
-- table (actions approval.approve / approval.reject) — this table is the live
-- state, access_audit is the immutable history. Decisions/publishes are written
-- by the routes via the service-role client AFTER the per-shop owner/manager gate,
-- exactly like content_items + mail_template_approvals.
--
-- Tenant isolation: per-shop default-deny RLS. A user may SELECT only rows for
-- shops they belong to (shop_id IN (select public.user_shop_ids()), mirroring
-- competitors / verified_facts / competitor_monitor_runs). No INSERT/UPDATE/DELETE
-- policy → writes are service-role only (RLS bypassed by design after the app gate).
-- Reuses public.set_updated_at().
--
-- Idempotent (create-if-not-exists / drop-then-create policy).
-- Rollback: drop table public.approval_queue.

-- =========================================================================
-- 1. Table — one row per proposed action awaiting (or carrying) a decision.
-- =========================================================================
create table if not exists public.approval_queue (
  id uuid primary key default gen_random_uuid(),
  -- Tenant: the shop the proposed action belongs to. Cascade so a deleted shop
  -- takes its queued actions with it.
  shop_id uuid not null references public.shops(id) on delete cascade,
  -- Generic action discriminator: content | gbp_post | review_reply | … . Kept as
  -- free text (not a CHECK enum) so a new autonomy capability can queue through
  -- the same gate without a migration; the publisher registry keys off this.
  action_type text not null,
  -- Short human label shown on the approval card.
  title text not null,
  -- Optional longer description / preview for the reviewer.
  summary text,
  -- The proposed action's data — opaque to the gate, consumed by the publisher.
  payload_jsonb jsonb not null default '{}'::jsonb,
  -- Lifecycle. pending is the only decidable state.
  status text not null default 'pending'
    check (status in ('pending', 'approved', 'rejected', 'published', 'publish_failed')),
  -- Who/what proposed it (agent id/name or automation source) — informational.
  proposed_by text,
  -- The role-gated human who decided (profile + typed name) and when.
  decided_by_profile_id uuid references public.profiles(id) on delete set null,
  decided_by_name text,
  decided_at timestamptz,
  decision_notes text,
  -- Publish outcome (only ever set on the approve path).
  published_at timestamptz,
  publish_error text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
alter table public.approval_queue enable row level security;

-- The queue UI lists a shop's pending items newest-first; decisions look up by id.
create index if not exists idx_approval_queue_shop_status
  on public.approval_queue (shop_id, status, created_at desc);

-- =========================================================================
-- 2. RLS — per-shop SELECT (default-deny). service-role bypasses for writes.
-- =========================================================================
drop policy if exists approval_queue_select on public.approval_queue;
create policy approval_queue_select on public.approval_queue
  for select to authenticated
  using (shop_id in (select public.user_shop_ids()));

-- =========================================================================
-- 3. updated_at trigger.
-- =========================================================================
drop trigger if exists set_updated_at_approval_queue on public.approval_queue;
create trigger set_updated_at_approval_queue
  before update on public.approval_queue
  for each row execute function public.set_updated_at();
