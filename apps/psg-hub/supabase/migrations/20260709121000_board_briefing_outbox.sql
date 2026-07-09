-- PSG-973 — Board briefing email outbox for Vercel Cron delivery.
--
-- This replaces the agent-push path with Vercel-owned delivery. The daily
-- briefing routine stages the markdown and live document URL here; the Vercel
-- cron claims one unsent row, sends it with the existing board-briefing mailer,
-- then stamps sent_at. Agents never need a copy of CRON_SECRET.
--
-- Idempotent + forward-only: create table if not exists, add missing columns,
-- create or replace function. All app access is via createServiceClient()
-- (service role, server-only); direct authenticated access is default-deny.

create table if not exists public.board_briefing_outbox (
  id uuid primary key default gen_random_uuid(),
  briefing_date date not null,
  subject text,
  body_markdown text not null,
  briefing_url text not null,
  generated_at timestamptz,
  claimed_at timestamptz,
  claim_token uuid,
  sent_at timestamptz,
  send_message_id text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (briefing_date),
  constraint board_briefing_outbox_body_present check (length(btrim(body_markdown)) > 0),
  constraint board_briefing_outbox_url_present check (length(btrim(briefing_url)) > 0)
);

alter table public.board_briefing_outbox
  add column if not exists subject text,
  add column if not exists generated_at timestamptz,
  add column if not exists claimed_at timestamptz,
  add column if not exists claim_token uuid,
  add column if not exists sent_at timestamptz,
  add column if not exists send_message_id text,
  add column if not exists created_at timestamptz not null default now(),
  add column if not exists updated_at timestamptz not null default now();

alter table public.board_briefing_outbox enable row level security;

create index if not exists idx_board_briefing_outbox_unsent
  on public.board_briefing_outbox (briefing_date desc, created_at desc)
  where sent_at is null;

drop trigger if exists set_updated_at_board_briefing_outbox on public.board_briefing_outbox;
create trigger set_updated_at_board_briefing_outbox
  before update on public.board_briefing_outbox
  for each row execute function public.set_updated_at();

-- Default deny for direct clients. The service-role client bypasses RLS.
drop policy if exists board_briefing_outbox_default_deny on public.board_briefing_outbox;
create policy board_briefing_outbox_default_deny on public.board_briefing_outbox
  for all to authenticated
  using (false)
  with check (false);

-- Atomically claims the freshest unsent briefing row. A fresh claim blocks
-- overlapping cron/manual retries; a crashed run can be reclaimed after the
-- stale window so the briefing is not permanently stuck.
create or replace function public.claim_board_briefing_outbox(
  p_claim_token uuid,
  p_now timestamptz default now(),
  p_stale_minutes integer default 30
) returns table (
  id uuid,
  briefing_date date,
  subject text,
  body_markdown text,
  briefing_url text,
  generated_at timestamptz
)
language sql
as $$
  update public.board_briefing_outbox row
  set claimed_at = p_now,
      claim_token = p_claim_token
  where row.id = (
    select candidate.id
    from public.board_briefing_outbox candidate
    where candidate.sent_at is null
      and (
        candidate.claimed_at is null
        or candidate.claimed_at < p_now - make_interval(mins => p_stale_minutes)
      )
    order by candidate.briefing_date desc, candidate.created_at desc
    limit 1
    for update skip locked
  )
  returning row.id,
            row.briefing_date,
            row.subject,
            row.body_markdown,
            row.briefing_url,
            row.generated_at;
$$;

comment on function public.claim_board_briefing_outbox(uuid, timestamptz, integer) is
  'Atomic exclusive claim of the freshest unsent board briefing email row. See PSG-973.';
