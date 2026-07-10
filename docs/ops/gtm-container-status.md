# GTM Container Status Feed

PSG-1082 adds the read-side inventory BSM needs before an operator uses GTM
mutation tooling. This feed is intentionally separate from write actions.

## Minimum Inventory

Each shop/container row stores:

- GTM container public id, account name, and container name
- Default workspace id/name/fingerprint and a status of `unknown`, `clean`,
  `modified`, `published`, or `error`
- Published version id/name/fingerprint when Google returns one
- Key tags: id, name, type, paused state, firing trigger ids, blocking trigger ids
- Key triggers: id, name, type
- `last_checked_at` so the UI can show whether readiness data is fresh

## Safety Boundary

The app route is read-only:

- `GET /api/ads-mutations/gtm/status?shop_id=<uuid>` reads stored inventory.
- It never calls Google and never writes.
- Mutation execution still goes through the existing Ads Mutation Studio
  dry-run, approval allow-list, rate-limit, and Sandbox gate.

Database writes are reserved for the service-role collector that will read from
`apps/psg-ads-mutations/gtm_psg`. The table has default-deny row-level security:
shop members can read their own shop, and internal staff with the Ads Mutation
Studio capability can read readiness rows.

## Verification

Use non-secret fixtures or mocked Supabase rows. Do not use live GTM credentials
for unit tests.

