# Route Ownership and Legacy Portal Guardrail

`apps/psg-hub` is the active Body Shop Marketer product app. `psg-advantage-portal`
is reference-only: it can be read for historical market-intelligence context, but new
product work should land in `apps/psg-hub`.

Source of truth: [PSG-2473](/PSG/issues/PSG-2473#document-route-manifest).

## What This Protects

- Every current hub page or API route must match one ownership family in
  `route-ownership-manifest.json`.
- Any exact URL overlap with `psg-advantage-portal` must be listed in
  `allowedLegacyOverlaps` with a reason.
- New work must not silently recreate old portal routes in the hub.

Run the check from `apps/psg-hub`:

```bash
pnpm check:route-ownership
```

If the check fails after adding a route, either classify the route in the manifest or
choose a different path that does not duplicate the reference-only portal.

## Legacy Portal Status

Recommended path from PSG-2473: keep `psg-advantage-portal` reference-only now, then
archive it after confirming no DNS, Vercel project, cron job, or customer link still
depends on it. Do not delete or publicly change legacy routes without a separate
approved cleanup and quality-assurance path.
