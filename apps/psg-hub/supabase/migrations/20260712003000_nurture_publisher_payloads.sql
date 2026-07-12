-- PSG-1217 — connect due nurture steps to compliant email/SMS sending.
--
-- The publisher needs raw contact details to send, but compliance matching remains
-- keyed by the existing salted hashes. Templates are explicit per step/channel:
-- missing or non-compliant templates are audited as skipped, so no customer-facing
-- copy is invented by the automation.

alter table public.nurture_enrollments
  add column if not exists contact_jsonb jsonb not null default '{}'::jsonb,
  add column if not exists template_jsonb jsonb not null default '{}'::jsonb;

comment on column public.nurture_enrollments.contact_jsonb is
  'Server-only send contact payload for nurture automation. Publisher verifies it against email_contact_hash/sms_contact_hash before sending.';

comment on column public.nurture_enrollments.template_jsonb is
  'Approved per-step/channel nurture templates plus required compliance metadata. Missing templates cause skipped audits, not sends.';
