-- Allow superadmins to clear a shop's BSM subscription tier from the User Access page.
-- The existing CHECK constraint still restricts non-null values to the approved
-- BSM tiers; dropping NOT NULL only adds the intentional no-tier state.

alter table public.subscriptions
  alter column tier drop not null;
