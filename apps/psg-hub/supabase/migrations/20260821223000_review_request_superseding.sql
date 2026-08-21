-- Keep recurring Review Requests current without deleting their audit history.

alter table public.approval_queue
  drop constraint if exists approval_queue_status_check;

alter table public.approval_queue
  add constraint approval_queue_status_check
  check (status in (
    'pending',
    'approved',
    'rejected',
    'published',
    'publish_failed',
    'superseded'
  ));

-- Attach the series key to the existing weekly GBP rows so the next insert can
-- supersede the current legacy request as well as every future request.
update public.approval_queue
set payload_jsonb = jsonb_set(
  payload_jsonb,
  '{reviewRequestSeriesKey}',
  to_jsonb('weekly_gbp_update'::text),
  true
)
where action_type = 'gbp_post'
  and payload_jsonb ->> 'cadence' = 'weekly'
  and coalesce(payload_jsonb ->> 'reviewRequestSeriesKey', '') = '';

-- Backfill the existing weekly GBP backlog, preserving the newest request per shop.
with ranked as (
  select
    id,
    row_number() over (
      partition by shop_id, action_type
      order by created_at desc, id desc
    ) as request_rank
  from public.approval_queue
  where status = 'pending'
    and action_type = 'gbp_post'
    and payload_jsonb ->> 'cadence' = 'weekly'
)
update public.approval_queue as request
set
  status = 'superseded',
  decided_at = coalesce(request.decided_at, now()),
  decision_notes = coalesce(
    request.decision_notes,
    'Superseded by a newer recurring request.'
  )
from ranked
where request.id = ranked.id
  and ranked.request_rank > 1;

create or replace function public.supersede_pending_approval_series()
returns trigger
language plpgsql
security invoker
set search_path = public
as $$
declare
  series_key text := btrim(new.payload_jsonb ->> 'reviewRequestSeriesKey');
begin
  -- ponytail: current enqueue paths are serialized per shop; add an advisory
  -- transaction lock here if concurrent generators are introduced.
  if series_key is null or series_key = '' then
    return new;
  end if;

  update public.approval_queue
  set
    status = 'superseded',
    decided_at = coalesce(decided_at, now()),
    decision_notes = coalesce(
      decision_notes,
      'Superseded by a newer recurring request.'
    )
  where shop_id = new.shop_id
    and action_type = new.action_type
    and status = 'pending'
    and payload_jsonb ->> 'reviewRequestSeriesKey' = series_key;

  return new;
end;
$$;

drop trigger if exists supersede_pending_approval_series on public.approval_queue;
create trigger supersede_pending_approval_series
  before insert on public.approval_queue
  for each row execute function public.supersede_pending_approval_series();
