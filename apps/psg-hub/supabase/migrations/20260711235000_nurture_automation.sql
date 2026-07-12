-- PSG-1210 — BSM nurture automation foundation.
--
-- These append-only/auditable tables back the Wave 1 nurture engine:
--   - nurture_consent_events: explicit SMS opt-in evidence captured from web forms.
--   - nurture_enrollments: one active path enrollment per Pipedrive deal/contact.
--   - nurture_step_events: immutable step audit rows for sent/skipped/failed events.
--
-- SMS must never send without a matching opted-in consent event. Contacts are keyed by
-- salted HMAC hashes (same contact hash helper as solicitation), not raw phone/email.

create table if not exists public.nurture_consent_events (
  id uuid primary key default gen_random_uuid(),
  channel text not null check (channel in ('email', 'sms')),
  contact_hash text not null,
  state text not null check (state in ('opted_in', 'opted_out')),
  source text not null,
  evidence_jsonb jsonb not null default '{}'::jsonb,
  company_id uuid,
  created_at timestamptz not null default now()
);

create index if not exists nurture_consent_events_contact_idx
  on public.nurture_consent_events (channel, contact_hash, created_at desc);

alter table public.nurture_consent_events enable row level security;
-- Service-role only: compliance evidence is contact-keyed and not exposed to browser sessions.

create table if not exists public.nurture_enrollments (
  id uuid primary key default gen_random_uuid(),
  path text not null check (path in ('hot_inbound', 'stalled_deal', 'onboarding_retention')),
  status text not null default 'active' check (status in ('active', 'exited', 'completed')),
  pipedrive_deal_id bigint,
  pipedrive_person_id bigint,
  pipedrive_org_id bigint,
  email_contact_hash text,
  sms_contact_hash text,
  trigger_ref text not null,
  exit_reason text,
  company_id uuid,
  enrolled_at timestamptz not null default now(),
  exited_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (path, trigger_ref)
);

create index if not exists nurture_enrollments_due_idx
  on public.nurture_enrollments (status, path, enrolled_at);
create index if not exists nurture_enrollments_deal_idx
  on public.nurture_enrollments (pipedrive_deal_id) where pipedrive_deal_id is not null;

alter table public.nurture_enrollments enable row level security;
-- Service-role only until the customer-facing reporting view is designed.

create table if not exists public.nurture_step_events (
  id uuid primary key default gen_random_uuid(),
  enrollment_id uuid not null references public.nurture_enrollments(id) on delete cascade,
  step_id text not null,
  channel text not null check (channel in ('email', 'sms')),
  status text not null check (status in ('sent', 'skipped', 'failed')),
  skip_reason text,
  provider_ref text,
  error text,
  company_id uuid,
  created_at timestamptz not null default now(),
  unique (enrollment_id, step_id, channel)
);

create index if not exists nurture_step_events_enrollment_idx
  on public.nurture_step_events (enrollment_id, created_at);

alter table public.nurture_step_events enable row level security;
-- Service-role only; later reporting should read through a tenant-safe view.

create or replace function private.set_nurture_enrollments_updated_at()
  returns trigger
  language plpgsql
  security definer
  set search_path = ''
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists set_updated_at_nurture_enrollments on public.nurture_enrollments;
create trigger set_updated_at_nurture_enrollments
  before update on public.nurture_enrollments
  for each row execute function private.set_nurture_enrollments_updated_at();

revoke update, delete on public.nurture_consent_events from anon, authenticated;
revoke update, delete on public.nurture_step_events from anon, authenticated;
