-- CCC Secure Share — Phase 3: connection-status lifecycle columns on ccc_accounts.
-- [PSG-267, child 2/3 of PSG-256]
--
-- Phase 1A (20260623190000) provisioned ccc_accounts as the CREDENTIAL VAULT: it carries
-- `status` (linked|revoked|error) for the credential-blob lifecycle. Phase 3 adds the
-- ORTHOGONAL *connection* lifecycle the approval queue + onboarding card drive — the §2 state
-- machine of docs/ops/ccc/phase3-onboarding-consent-ux.md, exposed as the §5 column contract.
-- The two are independent: `status` = "is a credential present/revoked?", `connection_status` =
-- "where is this shop in the approve→connected flow?". The UI binds to connection_status (see
-- src/lib/ccc/connection-state.ts, which already types this 5-state set); ingest/health own the
-- connected/error writes, the queue owns pending_review→connected|declined and revoke.
--
-- All columns are ADDITIVE + idempotent (add column if not exists). No data is written. The
-- existing RLS (membership + manage_ccc_integration capability for SELECT; service-role writes)
-- is unchanged and still applies — the superadmin queue reads/writes via the service client
-- (RLS bypass), mirroring /ops/intel. Phase 1A's `facility_id` is reused for the §5
-- `ccc_facility_id` display (no duplicate column).
--
-- LOCAL-applied during build; PROD apply stays behind the operator gate (PROTOCOL-migration-
-- safety.md — NOT auto-applied by the pipeline). Page degrades safely if unapplied (the columns
-- are read via service select; a missing column surfaces as an empty queue, not a crash).
--
-- Rollback: alter table public.ccc_accounts drop column connection_status, last_event_at,
--   last_event_label, enabled_at, approved_by, approved_at, declined_reason, error_reason,
--   data_scope;

alter table public.ccc_accounts
  -- §2 connection state machine. Default not_connected: a freshly created credential row is not
  -- yet a live connection. The handshake (Phase 0/2) moves it to pending_review; the queue
  -- approves to connected or declines; ingest/health flip connected↔error.
  add column if not exists connection_status text not null default 'not_connected'
    check (connection_status in
      ('not_connected', 'pending_review', 'connected', 'error', 'declined')),
  -- "Last event: Workfile saved · 3 min ago" — stamped on every transition + by ingest.
  add column if not exists last_event_at timestamptz,
  add column if not exists last_event_label text,
  -- "Enabled in CCC on…" — when the shop enabled BSM on the CCC side (handshake).
  add column if not exists enabled_at timestamptz,
  -- Approval attribution (queue Approve). Distinct from Phase 1A's linked_by (who linked the
  -- credential) — approved_by is who signed off the *connection*.
  add column if not exists approved_by uuid,
  add column if not exists approved_at timestamptz,
  -- Shop-facing decline reason (queue Decline, required, ≤280 chars enforced at the route).
  add column if not exists declined_reason text,
  -- Machine error reason (ingest/health) — the UI derives a human hint via errorHint().
  add column if not exists error_reason text,
  -- Approved data scope (Phase 0 → Phase 1 seed) — drives the data-scope panel data-driven.
  add column if not exists data_scope jsonb;

-- Partial index for the queue's primary view (Pending tab) — the hot read.
create index if not exists ccc_accounts_connection_status_idx
  on public.ccc_accounts (connection_status, enabled_at);
