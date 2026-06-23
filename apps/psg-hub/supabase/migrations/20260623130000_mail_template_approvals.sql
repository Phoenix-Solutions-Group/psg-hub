-- PSG-217 / PSG-115b — Mail template proof / approve / release gate.
-- No un-approved template may ever be mailed in a live batch. A template is
-- identified by its product key (thank_you / warranty / envelope) + a content
-- hash of the rendered body (see src/lib/production/template-gate.ts). One row
-- per (template_key, content_hash): the approval is bound to the exact bytes a
-- human signed off on, so editing a released template invalidates the approval
-- (hash mismatch) and forces a fresh proof + sign-off — fail-closed.
--
-- Workflow: draft → approved (named sign-off, who/when) → released (eligible for
-- live batches) → revoked. Attributable + audited via access_audit
-- (production.template.{approve,release,revoke}); this table is the live state,
-- access_audit is the immutable history.
--
-- Builds on the v1.1 Ops Foundation spine: default-deny RLS gated by
-- private.current_user_has_fn('manage_production') — the same capability the
-- production module already uses. service-role bypasses RLS for writes (routes
-- write via the service client after the manage_production app gate, exactly like
-- the rest of the production module). Reuses public.set_updated_at().
--
-- Idempotent (create-if-not-exists / drop-then-create policy).
-- Rollback: drop table public.mail_template_approvals.

-- =========================================================================
-- 1. Table — one approval record per template version (key + content hash).
-- =========================================================================
create table if not exists public.mail_template_approvals (
  id uuid primary key default gen_random_uuid(),
  -- Product/template key: thank_you | warranty | envelope (MailProduct).
  template_key text not null,
  -- sha256 of the rendered template body; binds the approval to exact bytes.
  content_hash text not null,
  -- draft → approved → released (eligible for live); revoked at any time after approve.
  status text not null default 'draft'
    check (status in ('draft', 'approved', 'released', 'revoked')),
  -- Named sign-off: who approved (profile) + the typed human name, and when.
  approved_by_profile_id uuid references public.profiles(id) on delete set null,
  approved_by_name text,
  approved_at timestamptz,
  -- Who released it for live batches + when.
  released_by_profile_id uuid references public.profiles(id) on delete set null,
  released_at timestamptz,
  -- Who revoked it + when.
  revoked_by_profile_id uuid references public.profiles(id) on delete set null,
  revoked_at timestamptz,
  notes text,
  created_by_profile_id uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  -- The gate looks up by (key, hash); exactly one record per template version.
  unique (template_key, content_hash)
);
alter table public.mail_template_approvals enable row level security;

create index if not exists idx_mail_template_approvals_key
  on public.mail_template_approvals (template_key);
create index if not exists idx_mail_template_approvals_status
  on public.mail_template_approvals (status);

-- =========================================================================
-- 2. RLS — gated by manage_production (default-deny). service-role bypasses.
-- =========================================================================
drop policy if exists mail_template_approvals_ops_all on public.mail_template_approvals;
create policy mail_template_approvals_ops_all on public.mail_template_approvals
  for all to authenticated
  using (private.current_user_has_fn('manage_production'))
  with check (private.current_user_has_fn('manage_production'));

-- =========================================================================
-- 3. updated_at trigger.
-- =========================================================================
drop trigger if exists set_updated_at_mail_template_approvals on public.mail_template_approvals;
create trigger set_updated_at_mail_template_approvals
  before update on public.mail_template_approvals
  for each row execute function public.set_updated_at();
