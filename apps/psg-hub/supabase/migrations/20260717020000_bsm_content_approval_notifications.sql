-- PSG-1718 — BSM content approval admin notifications.
--
-- First release scope: store PSG admin in-app alerts and email delivery state
-- for customer approval comments/decisions. The row's event_key + channel +
-- recipient key is unique so replayed customer actions or retried route calls do
-- not spam admins.

create table if not exists public.bsm_content_approval_notifications (
  id uuid primary key default gen_random_uuid(),
  shop_id uuid not null references public.shops(id) on delete cascade,
  review_item_id uuid not null,
  event_key text not null,
  event_type text not null check (
    event_type in (
      'comment_created',
      'decision_approved',
      'decision_declined',
      'decision_updates_requested'
    )
  ),
  channel text not null check (channel in ('in_app', 'email')),
  recipient_profile_id uuid references public.profiles(id) on delete cascade,
  recipient_email text,
  recipient_kind text not null default 'psg_admin' check (recipient_kind = 'psg_admin'),
  title text not null,
  body text not null,
  action_url text not null,
  status text not null default 'queued' check (status in ('unread', 'queued', 'sent', 'failed')),
  attempts integer not null default 0 check (attempts >= 0),
  send_message_id text,
  last_error text,
  sent_at timestamptz,
  read_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint bsm_content_approval_notifications_recipient_present check (
    recipient_profile_id is not null or recipient_email is not null
  ),
  constraint bsm_content_approval_notifications_email_channel_has_email check (
    channel <> 'email' or recipient_email is not null
  ),
  constraint bsm_content_approval_notifications_in_app_channel_has_profile check (
    channel <> 'in_app' or recipient_profile_id is not null
  ),
  constraint bsm_content_approval_notifications_title_present check (length(btrim(title)) > 0),
  constraint bsm_content_approval_notifications_body_present check (length(btrim(body)) > 0),
  constraint bsm_content_approval_notifications_action_url_present check (length(btrim(action_url)) > 0)
);

alter table public.bsm_content_approval_notifications
  add column if not exists shop_id uuid references public.shops(id) on delete cascade,
  add column if not exists review_item_id uuid,
  add column if not exists event_key text,
  add column if not exists event_type text,
  add column if not exists channel text,
  add column if not exists recipient_profile_id uuid references public.profiles(id) on delete cascade,
  add column if not exists recipient_email text,
  add column if not exists recipient_kind text not null default 'psg_admin',
  add column if not exists title text,
  add column if not exists body text,
  add column if not exists action_url text,
  add column if not exists status text not null default 'queued',
  add column if not exists attempts integer not null default 0,
  add column if not exists send_message_id text,
  add column if not exists last_error text,
  add column if not exists sent_at timestamptz,
  add column if not exists read_at timestamptz,
  add column if not exists created_at timestamptz not null default now(),
  add column if not exists updated_at timestamptz not null default now();

alter table public.bsm_content_approval_notifications enable row level security;

create unique index if not exists idx_bsm_content_approval_notifications_once
  on public.bsm_content_approval_notifications (
    event_key,
    channel,
    coalesce(recipient_profile_id::text, ''),
    coalesce(lower(recipient_email), '')
  );

create index if not exists idx_bsm_content_approval_notifications_in_app_unread
  on public.bsm_content_approval_notifications (recipient_profile_id, created_at desc)
  where channel = 'in_app' and status = 'unread';

create index if not exists idx_bsm_content_approval_notifications_review_item
  on public.bsm_content_approval_notifications (review_item_id, created_at desc);

drop trigger if exists set_updated_at_bsm_content_approval_notifications
  on public.bsm_content_approval_notifications;
create trigger set_updated_at_bsm_content_approval_notifications
  before update on public.bsm_content_approval_notifications
  for each row execute function public.set_updated_at();

drop policy if exists bsm_content_approval_notifications_default_deny
  on public.bsm_content_approval_notifications;
create policy bsm_content_approval_notifications_default_deny
  on public.bsm_content_approval_notifications
  for all to authenticated
  using (false)
  with check (false);

comment on table public.bsm_content_approval_notifications is
  'PSG admin in-app and email notification rows for BSM customer approval comments and decisions. Service-role writes only; event_key/channel/recipient uniqueness prevents duplicate alerts.';
