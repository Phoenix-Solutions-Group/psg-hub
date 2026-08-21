-- PSG-2026 — FileMaker-parity import suppression rules.
--
-- Rules are shop-scoped and configurable, not hard-coded per shop. The importer
-- reads enabled rules through the service-role commit/preview routes after
-- app-level manage_companies checks. Rejected rows are logged without storing the
-- full customer row payload, so operators can audit counts without duplicating PII.

create table if not exists public.import_suppression_rules (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  kind text check (kind in ('ro', 'estimate', 'ccc_estimate')),
  field text not null,
  operator text not null default 'equals'
    check (operator in ('equals', 'contains', 'starts_with', 'ends_with', 'regex')),
  values text[] not null,
  reason text not null default 'shop_field_exclusion'
    check (reason in (
      'missing_required_value',
      'zero_or_negative_repair_total',
      'total_loss',
      'job_classification',
      'malformed_ro_number',
      'insurance_pay_type_conflict',
      'insurer_exclusion',
      'vehicle_make_exclusion',
      'vehicle_model_exclusion',
      'shop_field_exclusion',
      'non_actionable_pay_type'
    )),
  message text,
  enabled boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (array_length(values, 1) > 0)
);

comment on table public.import_suppression_rules is
  'Shop-scoped configurable rules that suppress non-actionable RO/estimate import rows before they affect reports or mailings.';
comment on column public.import_suppression_rules.kind is
  'Null means the rule applies to every import kind for the company.';

create index if not exists import_suppression_rules_company_kind_idx
  on public.import_suppression_rules (company_id, kind)
  where enabled;

alter table public.import_suppression_rules enable row level security;

drop policy if exists import_suppression_rules_ops_all on public.import_suppression_rules;
create policy import_suppression_rules_ops_all on public.import_suppression_rules
  for all to authenticated
  using (private.current_user_has_fn('manage_companies'))
  with check (private.current_user_has_fn('manage_companies'));

drop trigger if exists set_updated_at_import_suppression_rules on public.import_suppression_rules;
create trigger set_updated_at_import_suppression_rules
  before update on public.import_suppression_rules
  for each row execute function public.set_updated_at();

create table if not exists public.import_row_exclusions (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  kind text not null check (kind in ('ro', 'estimate', 'ccc_estimate')),
  row_index integer not null check (row_index > 0),
  business_key text,
  reasons_jsonb jsonb not null,
  created_at timestamptz not null default now(),
  check (jsonb_typeof(reasons_jsonb) = 'array' and jsonb_array_length(reasons_jsonb) > 0)
);

comment on table public.import_row_exclusions is
  'Append-only audit of import rows excluded by FileMaker-parity suppression rules. Stores reasons and business key, not the full customer row payload.';

create index if not exists import_row_exclusions_company_created_idx
  on public.import_row_exclusions (company_id, created_at desc);
create index if not exists import_row_exclusions_business_key_idx
  on public.import_row_exclusions (company_id, kind, business_key)
  where business_key is not null;

alter table public.import_row_exclusions enable row level security;

drop policy if exists import_row_exclusions_select_ops on public.import_row_exclusions;
create policy import_row_exclusions_select_ops on public.import_row_exclusions
  for select to authenticated
  using (private.current_user_has_fn('manage_companies'));

create or replace function private.import_row_exclusions_block_mutate()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  raise exception 'import_row_exclusions is append-only: % is not permitted', tg_op;
end;
$$;

drop trigger if exists import_row_exclusions_no_update on public.import_row_exclusions;
create trigger import_row_exclusions_no_update
  before update or delete on public.import_row_exclusions
  for each row execute function private.import_row_exclusions_block_mutate();

revoke update, delete on public.import_row_exclusions from anon, authenticated;
