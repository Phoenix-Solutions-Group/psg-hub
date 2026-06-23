-- W0 / PSG-224 (PSG-115e) — mined direct-mail trigger + A/B priors. Spec §3.3
-- (docs/specs/002-mail-send-history-w0/spec.md).
--
-- Read-mostly output table for the priors MINER (src/lib/ops/mail/priors.ts):
-- one row per (segment, piece, A/B arm) carrying the empirical outcome rate
-- mined from mail_send_history (send side, PSG-216a) joined to the repair-customer
-- + survey exports (outcome side: repeat / referral / survey-returned / RO) over a
-- date window. The direct-mail engine reads these priors to choose which numbered
-- piece + arm to send for a given segment; the human-readable companion lives at
-- docs/ops/mail/priors/.
--
-- RLS posture: mirrors survey_dispatches / repair_orders EXACTLY — default-deny,
-- gated by private.current_user_has_fn('manage_companies'). The miner writes via
-- the service-role client (createServiceClient, bypasses RLS); direct authenticated
-- access is capability-scoped; no anon access.
--
-- Idempotency (PSG mandate): the natural key is (segment_key, piece_code,
-- ab_variant). The miner is a full regenerator (read-mostly output), so it UPSERTs
-- ON CONFLICT (segment_key, piece_code, ab_variant) and re-runs never duplicate a
-- (segment, piece, arm) prior.
--
-- ab_variant note vs spec §3.3: the spec lists `ab_variant text` (nullable) with a
-- `unique (segment_key, piece_code, coalesce(ab_variant,''))`. The miner ALWAYS
-- emits an explicit arm — 'A' for the base piece (e.g. '04', '07', 't') and 'B'
-- for its lettered alternate (e.g. '04b', '10b') — so the column is NOT NULL with
-- default 'A'. With a never-null arm a plain composite UNIQUE is equivalent to the
-- spec's coalesce() index (coalesce(ab_variant,'') == ab_variant) AND is directly
-- addressable by supabase-js .upsert({ onConflict }). Idempotency guarantee is
-- preserved; the column shape is the only deviation, and it is the safer one.
--
-- Idempotent + re-runnable (create table if not exists / drop-if-exists policy +
-- trigger). ZERO data written here — priors are produced by the miner run, which
-- is gated on PSG-216a (send-history import) landing real mail_send_history rows.
-- Rollback: drop table public.mail_send_priors;

-- =========================================================================
-- mail_send_priors — mined (segment × piece × A/B arm) outcome priors.
-- =========================================================================
create table if not exists public.mail_send_priors (
  id uuid primary key default gen_random_uuid(),
  -- Stable segment fingerprint built from RO/customer-side attributes carried on
  -- the send, e.g. 'paytype=Ins|repeat=Y|region=LA'. See src/lib/ops/mail/priors.ts.
  segment_key text not null,
  -- Numbered-letter base code: 't','04','07','10','12'..'16','b' (the 'b'
  -- alternate is folded into ab_variant='B', not a distinct piece_code).
  piece_code text not null,
  -- Program trigger this piece serves (total_loss_thank_you, warranty_letter,
  -- survey_followup_warranty, followup_sequence, birthday_seasonal, ...). The
  -- authoritative catalog is the numbered-letter library (PSG-216c).
  trigger text,
  -- A/B arm: 'A' = base piece, 'B' = its lettered alternate (04 vs 04b).
  ab_variant text not null default 'A'
    check (ab_variant in ('A', 'B')),
  n_sent int not null check (n_sent >= 0),
  -- Sends in this (segment, piece, arm) cell that produced a positive outcome
  -- (repeat / referral / survey-returned / subsequent RO) inside the window.
  n_outcome int not null default 0 check (n_outcome >= 0),
  -- n_outcome / n_sent (0 when n_sent = 0). Materialized by the miner for cheap reads.
  outcome_rate numeric,
  -- Pointer to the miner run / doc that produced this row (e.g.
  -- 'docs/ops/mail/priors/README.md@<window>/<computed_at>').
  method_ref text,
  computed_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (segment_key, piece_code, ab_variant)
);
alter table public.mail_send_priors enable row level security;

create index if not exists idx_mail_send_priors_trigger
  on public.mail_send_priors (trigger);
create index if not exists idx_mail_send_priors_segment
  on public.mail_send_priors (segment_key);

-- =========================================================================
-- RLS — default-deny, ops-capability gated (mirrors survey_dispatches).
-- =========================================================================
do $$
declare
  t text;
  manage_companies_tables text[] := array['mail_send_priors'];
begin
  foreach t in array manage_companies_tables loop
    execute format('drop policy if exists %I on public.%I', t || '_ops_all', t);
    execute format(
      'create policy %I on public.%I for all to authenticated '
      || 'using (private.current_user_has_fn(''manage_companies'')) '
      || 'with check (private.current_user_has_fn(''manage_companies''))',
      t || '_ops_all', t
    );
  end loop;
end $$;

-- =========================================================================
-- updated_at trigger (reuse public.set_updated_at from ops foundation).
-- =========================================================================
do $$
declare
  t text;
  all_tables text[] := array['mail_send_priors'];
begin
  foreach t in array all_tables loop
    execute format('drop trigger if exists %I on public.%I', 'set_updated_at_' || t, t);
    execute format(
      'create trigger %I before update on public.%I '
      || 'for each row execute function public.set_updated_at()',
      'set_updated_at_' || t, t
    );
  end loop;
end $$;
