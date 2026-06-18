-- Phase 15 / 15-01 — stripe_webhook_events: inbound webhook idempotency + audit.
-- GROUNDING (research/phase-15-billing-foundation-stripe-spine.md §1, §3): Stripe
-- delivers events at-least-once, so the webhook MUST dedupe redeliveries or it
-- reprocesses side effects (the S3 duplicate-key bug at route.ts:56 is one symptom).
-- This table is the dedupe gate: the handler does
--   INSERT ... ON CONFLICT (event_id) DO NOTHING RETURNING event_id
-- and an empty result means "already processed" -> skip all side effects, ack 200.
-- It also doubles as an audit/replay log (type/api_version/created/payload).
--
-- Same pattern Phase 3 uses for email_events.sg_event_id / sms_events UNIQUE.
--
-- RLS: enabled with NO policy = default-deny. This is an operational/service-role
-- table (no customer ever reads it), mirroring oauth_states / google_oauth_pending_states
-- / ads_api_call_log. All access is via createServiceClient() (RLS-bypass). The advisor
-- security baseline will flag rls_enabled_no_policy as INFO — that is the intended
-- default-deny posture, not a finding (the 13-04 precedent).
--
-- Additive + idempotent (run-once safe). AUTHORED ONLY — NOT applied to prod here; prod
-- apply is the Phase-15 gate batch (mirrors 13-04 / 14-04) under PROTOCOL-migration-safety.md
-- with an advisor baseline+diff. ZERO data written.

create table if not exists public.stripe_webhook_events (
  event_id text primary key,
  type text not null,
  api_version text,
  created timestamptz,
  payload jsonb,
  received_at timestamptz not null default now(),
  processed_at timestamptz
);

-- Default-deny: RLS on, no policy. Service-role writes bypass RLS.
alter table public.stripe_webhook_events enable row level security;

-- Retention/debug lookup by arrival time (cheap; the PK already covers dedupe).
create index if not exists stripe_webhook_events_received_at_idx
  on public.stripe_webhook_events(received_at);
