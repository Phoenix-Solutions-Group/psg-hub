# Import Reference Boundary

This folder is harvested reference source only. Product code must not import it.

Ported-and-tested reference areas from the PSG-2472 ledger:

- `mappings/canonical-fields.ts`
- `mappings/expand-to-fm.ts`
- `mappings/fm-field-order.ts`
- `mappings/header-mappings.ts`
- `processing/car-data.ts`
- `processing/rules-engine.ts`
- `processing/vehicle-standardization.ts`
- `shops/registry.ts`
- `shops/resolver.ts`

Still-pending reference areas:

- `processing/fm-normalize.ts`
- `scan/**`

The active hub implementation lives under
`apps/psg-hub/src/lib/ops/import/**`. Keep changes there and add hub tests.
