-- PSG-503 — Inbound lead-form abuse control: rate-limit window table.
--
-- The public POST /api/leads/inbound endpoint (PSG-499) creates Pipedrive deals with a
-- privileged admin write token. Before it goes live we cap how many submissions a single
-- client IP — and the endpoint globally — may make in a sliding time window, so a bot
-- that simply skips the honeypot cannot flood our CRM (and burn our Pipedrive write
-- quota) with junk companies/contacts/deals.
--
-- The limiter (src/lib/leads/rate-limit.ts) COUNTS rows in this table over the window —
-- durable + serverless-safe. An in-process counter cannot be used: it resets on every
-- Vercel cold start, so a flood spread across instances would never be caught. One row is
-- written per genuine submission attempt (honeypot hit or accepted lead).
--
-- PII posture: we NEVER store the raw client IP. ip_hash is a salted HMAC of the IP
-- (mirrors the contact-hash posture in src/lib/ops/solicitation/contact.ts). The salt
-- lives in env, so the table alone cannot be reversed to an IP address.
--
-- RLS posture (per CHECKLIST-rls-review.md): RLS ENABLED, default-deny, NO policy. The
-- only caller is the route via the service-role client (createServiceClient,
-- "server-only"), which bypasses RLS. No anon/authenticated access. Expect exactly one
-- advisor INFO (rls_enabled_no_policy) for this table, like llm_call_log.
--
-- Idempotent: safe to re-run (create-if-not-exists throughout).

create table if not exists public.inbound_lead_submissions (
  id uuid primary key default gen_random_uuid(),
  -- Salted HMAC of the client IP (first x-forwarded-for hop). Never the raw IP.
  ip_hash text not null,
  -- Coarse triage label: 'honeypot' | 'accepted'. Not used in security logic — the
  -- window count is keyed on ip_hash + created_at only.
  outcome text not null,
  created_at timestamptz not null default now()
);

-- Per-IP sliding-window count (the main abuse gate).
create index if not exists inbound_lead_submissions_ip_created_idx
  on public.inbound_lead_submissions (ip_hash, created_at);

-- Global sliding-window count (the flood ceiling across all IPs).
create index if not exists inbound_lead_submissions_created_idx
  on public.inbound_lead_submissions (created_at);

-- Default-deny: RLS on, no policy. Service-role only.
alter table public.inbound_lead_submissions enable row level security;
