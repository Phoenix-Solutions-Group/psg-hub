-- Backfill the one provisional SPC batch whose events were loaded before the
-- recurring source-ledger transaction existed.
insert into public.storm_event_sources (
  source_key,
  source_url,
  file_family,
  source_year,
  cycle,
  file_url,
  row_count,
  status,
  import_batch_id,
  notes,
  imported_at
)
select
  'noaa_spc_preliminary_reports',
  'https://www.spc.noaa.gov/climo/reports/',
  'daily_reports',
  2026,
  '20260801-20260817',
  'https://www.spc.noaa.gov/climo/reports/YYMMDD_rpts_TYPE.csv',
  count(*)::integer,
  'loaded_provisional',
  event.import_batch_id,
  'Provenance backfill for the bounded 2026-08-01 through 2026-08-16 SPC event batch.',
  min(event.imported_at)
from public.storm_events event
where event.source = 'noaa_spc_preliminary_reports'
  and event.import_batch_id = 'noaa_spc_preliminary-20260801-20260817'
group by event.import_batch_id
having count(*) > 0
on conflict (source_key, file_family, source_year, cycle) do nothing;

create view public.v_collision_storm_source_reconciliation
with (security_invoker = true)
as
with event_batches as (
  select
    event.source as source_key,
    event.import_batch_id,
    count(*)::integer as event_rows,
    min(event.begin_time) as first_event_at,
    max(event.begin_time) as latest_event_at
  from public.storm_events event
  group by event.source, event.import_batch_id
),
source_batches as (
  select
    source.source_key,
    source.import_batch_id,
    sum(source.row_count)::integer as reported_rows,
    max(source.imported_at) as ledger_imported_at
  from public.storm_event_sources source
  group by source.source_key, source.import_batch_id
)
select
  coalesce(event.source_key, source.source_key) as source_key,
  coalesce(event.import_batch_id, source.import_batch_id) as import_batch_id,
  event.event_rows,
  source.reported_rows,
  event.first_event_at,
  event.latest_event_at,
  source.ledger_imported_at,
  event.event_rows is not null
    and source.reported_rows is not null
    and event.event_rows = source.reported_rows as is_reconciled,
  case
    when event.event_rows is null then 'missing_events'
    when source.reported_rows is null then 'missing_source_ledger'
    when event.event_rows <> source.reported_rows then 'count_mismatch'
    else 'reconciled'
  end as reconciliation_status
from event_batches event
full join source_batches source
  on source.source_key = event.source_key
 and source.import_batch_id = event.import_batch_id;

comment on view public.v_collision_storm_source_reconciliation is
  'Service-only storm event/source ledger reconciliation by import batch.';

revoke all on public.v_collision_storm_source_reconciliation
  from public, anon, authenticated;
grant select on public.v_collision_storm_source_reconciliation to service_role;
