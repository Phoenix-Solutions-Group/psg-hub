# Harvested source — `Phoenix-Solutions-Group/import` (pre-decommission)

**Provenance:** files copied verbatim (byte-exact) from the private standalone repo
`Phoenix-Solutions-Group/import` @ `main` (commit `a11133d`), 2026-06-20, via PSG-129.
This is **reference source only** — it is NOT wired into any build, route, or test runner
in `psg-hub`. It exists so the porters (PSG-132/133/134) can adapt the net-new IP into the
hub under normal conventions before [PSG-50](https://.../PSG-50) decommissions the repo.

Do not import from this directory in product code. Port the relevant logic into
`apps/psg-hub/src/lib/ops/import/**` (or the agreed module) with hub conventions + tests.

## Why only these files
The `import` repo's core engine (parse, smart column-mapping, address/phone/zip normalize,
field-level validation, canonical field catalog) was **already absorbed by PSG-38** into
`apps/psg-hub/src/lib/ops/import/` — and the hub version went further (CIECA EMS/BMS
detection, PSG-51 pilot hardening). Re-porting that would be a regression, so it is **not**
staged here. Only genuinely net-new IP is included below.

## Per-porter file map

### → PSG-132 (Ravi) — reference datasets + standardization rules
- `src/lib/processing/car-data.ts` — us-car-models dataset (inline TS, ~43 KB)
- `src/lib/processing/vehicle-standardization.ts` — vehicle-make / BMS abbreviation table
- `src/lib/processing/rules-engine.ts` — ampersand removal, fleet detection, dedup, commercial-vs-residential
- `src/lib/mappings/header-mappings.ts` — source→canonical header map (the real "MASTER_header_mappings"; it's TS, not JSON)
- `src/lib/shops/registry.ts` + `src/lib/shops/resolver.ts` — PSG shop / PSGID registry + resolver

### → PSG-133 (Nora) — FileMaker Import Flush v5 export map (canonical → 193-field FM)
- `src/lib/mappings/expand-to-fm.ts`
- `src/lib/mappings/fm-field-order.ts`
- `src/lib/mappings/canonical-fields.ts` — **diff vs in-hub `lib/ops/import/fields.ts` first; port only deltas**
- `src/lib/processing/fm-normalize.ts`
- `filemaker/*.md` — 9 Import Flush / FM Server integration specs (reference docs)

### → PSG-134 (Ada) — document-scan / OCR pipeline (net-new capability)
- `src/lib/scan/**` — drivers (`anthropic-vision`, `mock`, `prompt`), `checkbox`, `confidence`,
  `extractor`, `job-store`, `merge-pages`, `pdf-rasterize`, `schema`, `types`,
  `templates/acrb-cif.ts`, and `__tests__/` (checkbox, confidence, merge-pages)

## Explicitly DROPPED (not staged — superseded or unsafe)
- `billing/**`, `invoiced/**`, `shops/invoiced-customers.json` — BSM is Stripe-native (PSG-56/59); the JSON is PII.
- `parser/**`, `processing/{normalize,address-validation,pipeline}.ts`, `mappings/map-columns.ts` — already in-hub via PSG-38.
- `auth/`, `export/build-export.ts`, app scaffold, `public/*`, tooling configs — not reusable IP.
- Networked geo path (Smarty Streets / Google Places) — hub is intentionally dependency-free / no network geocoder.

## Correction to earlier scoping
There are **no bundled JSON datasets** in the `import` repo (no `us-car-models.json`,
`MASTER_header_mappings.json`, or `map_export_fm.json`). All datasets, header maps, and the
FM export map are **inline TypeScript** — port the `.ts` modules above, not data blobs.
