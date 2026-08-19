-- PSG-2028 — direct-mail eligibility + survey-alert suppression.
--
-- Makes the FileMaker mail decision explicit and idempotent:
--   * survey_responses gets alert fields used by the suppression rule.
--   * letter_eligibility stores one decision per customer + letter kind + cycle.
--   * later production-document migrations can link generated/printed rows back
--     to the eligibility row that produced them.
--
-- Default-deny posture: all new tables enable RLS and are capability-gated.

alter table public.survey_responses
  add column if not exists repair_customer_id uuid
    references public.repair_customers(id) on delete set null,
  add column if not exists alert_class text not null default 'none'
    check (alert_class in ('perfect', 'misfire', 'hotspot', 'unresolved', 'referral', 'none')),
  add column if not exists alert_posted_at timestamptz,
  add column if not exists csi_resolve numeric,
  add column if not exists unresolved_shop boolean,
  add column if not exists referral_consumer boolean,
  add column if not exists referral_letter_posted_at timestamptz;

create index if not exists idx_survey_responses_repair_customer_alert
  on public.survey_responses (repair_customer_id, alert_posted_at)
  where alert_class <> 'none';

alter table public.repair_customers
  add column if not exists legacy_match_key text,
  add column if not exists referral_tracking_enabled boolean not null default false,
  add column if not exists credit_hold boolean not null default false;

create index if not exists idx_repair_customers_legacy_match_key
  on public.repair_customers (legacy_match_key);

alter table public.company_programs
  add column if not exists referral_tracking_enabled boolean not null default false;

create table if not exists public.letter_eligibility (
  id uuid primary key default gen_random_uuid(),
  repair_customer_id uuid not null references public.repair_customers(id) on delete cascade,
  letter_kind text not null
    check (letter_kind in (
      'three_month', 'six_month', 'one_year', 'eighteen_month', 'two_year',
      'birthday', 'drivers_license', 'thank_you', 'referral'
    )),
  period_key text not null,
  eligible boolean not null default false,
  printable boolean not null default true,
  suppressed_by_alert boolean not null default false,
  reasons jsonb not null default '[]'::jsonb,
  computed_at timestamptz not null default now(),
  printed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint letter_eligibility_unique_cycle
    unique (repair_customer_id, letter_kind, period_key)
);

alter table public.letter_eligibility enable row level security;

create index if not exists idx_letter_eligibility_customer_kind
  on public.letter_eligibility (repair_customer_id, letter_kind);

create index if not exists idx_letter_eligibility_ready
  on public.letter_eligibility (letter_kind, period_key)
  where eligible and printable and printed_at is null;

do $$
begin
  drop policy if exists letter_eligibility_ops_all on public.letter_eligibility;
  create policy letter_eligibility_ops_all on public.letter_eligibility
    for all to authenticated
    using (private.current_user_has_fn('manage_production'))
    with check (private.current_user_has_fn('manage_production'));
end $$;

do $$
begin
  drop trigger if exists set_updated_at_letter_eligibility on public.letter_eligibility;
  create trigger set_updated_at_letter_eligibility
    before update on public.letter_eligibility
    for each row execute function public.set_updated_at();
end $$;
