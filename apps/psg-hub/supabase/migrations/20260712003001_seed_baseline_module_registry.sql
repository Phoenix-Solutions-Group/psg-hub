-- PSG-1215 - keep the Superadmin Module Access Matrix QA-ready.
--
-- The Module Access Matrix page is useful only when at least one module exists.
-- The original registry migration intentionally created an empty table and relied
-- on admins to add modules through the UI, but the shared QA/demo surface needs a
-- deterministic baseline so the Allow / Deny / Inherit walkthrough can run after
-- every rebuild. This seed is idempotent and does not grant access by itself; it
-- only registers modules that already exist in the app navigation.

insert into public.modules (slug, display_name, audience, min_tier_slug, default_visibility)
values
  ('client-hub', 'Client Hub', 'customer', null, 'visible'),
  ('analytics', 'Analytics', 'customer', 'essentials', 'visible'),
  ('ads-mutations', 'Ads Mutations', 'ops', null, 'hidden'),
  ('production', 'Production Mail', 'ops', null, 'hidden'),
  ('superadmin', 'Superadmin', 'ops', null, 'hidden')
on conflict (slug) do update
set
  display_name = excluded.display_name,
  audience = excluded.audience,
  min_tier_slug = excluded.min_tier_slug,
  default_visibility = excluded.default_visibility;
