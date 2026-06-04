-- Migration: llm_call_log (shared LLM-call audit + rate-limit window table)
-- Phase 6 / plan 06-05 (RBAC + RLS spine close).
--
-- Why: the shipped reviews draft-response path calls assertWithinLimits()
-- (src/lib/reviews/rate-limit.ts) and logLLMCall() (src/lib/logging/llm-call.ts),
-- both of which read/write public.llm_call_log. The table was never provisioned,
-- so assertWithinLimits THROWS on the count query and the draft route 500s today.
-- This stands the table up to match those two files exactly.
--
-- RLS posture (per CHECKLIST-rls-review.md): RLS ENABLED, default-deny, NO policy.
-- Both callers use the service-role client (createServiceClient, "server-only"),
-- which bypasses RLS. No anon/authenticated access. Mirrors the 06-02 default-deny
-- spine tables. Expect exactly one advisor INFO (rls_enabled_no_policy) for this table.
--
-- Idempotent: safe to re-run (create-if-not-exists throughout).

create table if not exists public.llm_call_log (
  id uuid primary key default gen_random_uuid(),
  user_id uuid,
  shop_id uuid,
  review_id uuid,
  purpose text not null,
  model_id text,
  input_tokens int,
  output_tokens int,
  latency_ms int,
  result text not null,
  error_code text,
  created_at timestamptz not null default now()
);

-- Rate-limit window scans (rate-limit.ts): per-review-hour and per-shop-day counts.
create index if not exists llm_call_log_review_created_idx
  on public.llm_call_log (review_id, created_at);
create index if not exists llm_call_log_shop_created_idx
  on public.llm_call_log (shop_id, created_at);

-- Default-deny: RLS on, no policy. Service-role only.
alter table public.llm_call_log enable row level security;
