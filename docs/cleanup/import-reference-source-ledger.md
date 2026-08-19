# Import Reference Source Cleanup Ledger

**Issue:** PSG-2472  
**Date:** 2026-07-29  
**Scope:** `docs/harvest/import-repo/**` compared with the active hub import code under `apps/psg-hub/src/lib/ops/import/**`.

## Bottom Line

The harvested import source is not used by product code. The active import implementation lives in `apps/psg-hub/src/lib/ops/import/**`, and static search found no app or package imports from `docs/harvest/import-repo/**`.

Most non-scan import logic has already been ported into the hub and has focused tests. The document-scan / OCR pipeline remains pending as a future capability, and the original reference copies can be quarantined after a separate approval task.

## Verification

- Used Graphify first per the BSM code-navigation rule to locate the active ops import module and related source relationships.
- Confirmed `docs/harvest/import-repo/README.md` says the harvest is reference-only and must not be imported by product code.
- Ran a static import search against `apps/` and `packages/`; it returned no references to `docs/harvest/import-repo`.
- Ran the focused import/FileMaker/shop resolver tests; 7 test files passed, 71 tests passed.
- Checked active hub coverage references in:
  - `apps/psg-hub/src/lib/ops/import/data/__tests__/rules-engine.test.ts`
  - `apps/psg-hub/src/lib/ops/import/data/__tests__/vehicle-standardization.test.ts`
  - `apps/psg-hub/src/lib/ops/import/data/__tests__/header-mappings.test.ts`
  - `apps/psg-hub/src/lib/ops/import/data/__tests__/address-units.test.ts`
  - `apps/psg-hub/src/lib/ops/import/filemaker/__tests__/filemaker-export.test.ts`
  - `apps/psg-hub/src/lib/ops/import/filemaker/__tests__/standardize.test.ts`
  - `apps/psg-hub/src/lib/ops/import/shops/__tests__/shops.test.ts`

Command evidence:

```bash
/paperclip/instances/default/companies/a38dde7c-f8ee-4901-804d-bf1d6887dbf0/codex-home/tools/graphify-venv/bin/graphify query "how does the active ops import module relate to harvested import-repo source files rules-engine vehicle-standardization header-mappings canonical-fields fm-field-order expand-to-fm shops resolver scan extractor" --budget 1500
rg -n "docs/harvest/import-repo|harvest/import-repo|from ['\"](.*docs/harvest|.*harvest/import-repo)|import\(.*harvest/import-repo" apps packages --glob '!**/.next/**' --glob '!**/node_modules/**'
rg -n "standardizeVehicles|applyRules|MASTER_HEADER_MAPPINGS|buildImportFlushExport|standardizeImportFlushRows|resolveShop|PSGID" apps/psg-hub/src/lib/ops/import apps/psg-hub/src/app/api/ops/import apps/psg-hub/src/components/ops/import-wizard.tsx
```

## Ledger

| Harvested source file | Status | Active hub file or reason |
| --- | --- | --- |
| `docs/harvest/import-repo/src/lib/processing/car-data.ts` | Ported and tested | Ported to `apps/psg-hub/src/lib/ops/import/data/car-data.ts`; used by `vehicle-standardization.ts`. |
| `docs/harvest/import-repo/src/lib/processing/vehicle-standardization.ts` | Ported and tested | Ported to `apps/psg-hub/src/lib/ops/import/data/vehicle-standardization.ts`; covered by `data/__tests__/vehicle-standardization.test.ts`. |
| `docs/harvest/import-repo/src/lib/processing/rules-engine.ts` | Ported and tested | Ported to `apps/psg-hub/src/lib/ops/import/data/rules-engine.ts`; covered by `data/__tests__/rules-engine.test.ts`. |
| `docs/harvest/import-repo/src/lib/mappings/header-mappings.ts` | Ported and tested | Ported to `apps/psg-hub/src/lib/ops/import/data/header-mappings.ts`; covered by `data/__tests__/header-mappings.test.ts`. |
| `docs/harvest/import-repo/src/lib/shops/registry.ts` | Ported and tested | Reworked into safe hub files `apps/psg-hub/src/lib/ops/import/shops/types.ts`, `directory.ts`, and `loader.ts`. Real shop billing data is intentionally not committed; runtime loaders supply it. Covered by `shops/__tests__/shops.test.ts`. |
| `docs/harvest/import-repo/src/lib/shops/resolver.ts` | Ported and tested | Reworked into `apps/psg-hub/src/lib/ops/import/shops/resolver.ts`; covered by `shops/__tests__/shops.test.ts`. |
| `docs/harvest/import-repo/src/lib/mappings/expand-to-fm.ts` | Ported and tested | Ported to `apps/psg-hub/src/lib/ops/import/filemaker/expand-to-fm.ts`; covered by `filemaker/__tests__/filemaker-export.test.ts`. |
| `docs/harvest/import-repo/src/lib/mappings/fm-field-order.ts` | Ported and tested | Ported to `apps/psg-hub/src/lib/ops/import/filemaker/fm-field-order.ts`; covered by `filemaker/__tests__/filemaker-export.test.ts`. |
| `docs/harvest/import-repo/src/lib/mappings/canonical-fields.ts` | Ported and tested | Ported to `apps/psg-hub/src/lib/ops/import/filemaker/canonical-fields.ts`; hub-specific mapping bridge lives in `filemaker/bridge.ts`. Covered by `filemaker/__tests__/filemaker-export.test.ts`. |
| `docs/harvest/import-repo/src/lib/processing/fm-normalize.ts` | Still pending | Not ported as a standalone module. The hub has the FileMaker export path and canonical bridge, but the 433-entry FileMaker auto-enter normalization table for insurance/payment/referral cleanup has no direct active equivalent. Keep as pending reference until Ada decides whether this is needed for v1.3 FileMaker cutover. |
| `docs/harvest/import-repo/src/lib/scan/checkbox.ts` | Still pending | Document-scan / OCR pipeline is not in active ops import code. Keep for PSG-134/Ada or a future scan-intake task. |
| `docs/harvest/import-repo/src/lib/scan/confidence.ts` | Still pending | Same scan/OCR pending capability; no active hub import destination. |
| `docs/harvest/import-repo/src/lib/scan/extractor.ts` | Still pending | Same scan/OCR pending capability; no active hub import destination. |
| `docs/harvest/import-repo/src/lib/scan/job-store.ts` | Still pending | Same scan/OCR pending capability; no active hub import destination. |
| `docs/harvest/import-repo/src/lib/scan/merge-pages.ts` | Still pending | Same scan/OCR pending capability; no active hub import destination. |
| `docs/harvest/import-repo/src/lib/scan/pdf-rasterize.ts` | Still pending | Same scan/OCR pending capability; no active hub import destination. |
| `docs/harvest/import-repo/src/lib/scan/schema.ts` | Still pending | Same scan/OCR pending capability; no active hub import destination. |
| `docs/harvest/import-repo/src/lib/scan/types.ts` | Still pending | Same scan/OCR pending capability; no active hub import destination. |
| `docs/harvest/import-repo/src/lib/scan/templates/acrb-cif.ts` | Still pending | Same scan/OCR pending capability; no active hub import destination. |
| `docs/harvest/import-repo/src/lib/scan/drivers/anthropic-vision.ts` | Still pending | Same scan/OCR pending capability; no active hub import destination. Do not wire without a separate security and cost review because it would introduce model-backed document processing. |
| `docs/harvest/import-repo/src/lib/scan/drivers/mock.ts` | Still pending | Same scan/OCR pending capability; no active hub import destination. |
| `docs/harvest/import-repo/src/lib/scan/drivers/prompt.ts` | Still pending | Same scan/OCR pending capability; no active hub import destination. |
| `docs/harvest/import-repo/src/lib/scan/__tests__/checkbox.test.ts` | Not needed / quarantine candidate | Test belongs to the unported reference scan module. Keep only while scan code remains as reference. |
| `docs/harvest/import-repo/src/lib/scan/__tests__/confidence.test.ts` | Not needed / quarantine candidate | Test belongs to the unported reference scan module. Keep only while scan code remains as reference. |
| `docs/harvest/import-repo/src/lib/scan/__tests__/merge-pages.test.ts` | Not needed / quarantine candidate | Test belongs to the unported reference scan module. Keep only while scan code remains as reference. |

## Recommended Smallest Safe Cleanup Step

Do not delete source in PSG-2472. The smallest safe next step is a separate approval task to quarantine `docs/harvest/import-repo/src/lib/processing/**`, `docs/harvest/import-repo/src/lib/mappings/**`, and `docs/harvest/import-repo/src/lib/shops/**` into an archive-only folder or remove those completed reference copies after Ada confirms the v1.3 FileMaker cutover no longer needs side-by-side comparison.

Keep the following reference files until a separate owner accepts or rejects the scan/OCR capability:

- `docs/harvest/import-repo/src/lib/processing/fm-normalize.ts`
- `docs/harvest/import-repo/src/lib/scan/**`

## Follow-Up Recommendation

Create one follow-up task for Ada to decide whether `fm-normalize.ts` is required for FileMaker cutover and whether PSG wants the scan/OCR intake path at all. If Ada rejects both, the whole `docs/harvest/import-repo/src/**` tree can be quarantined or removed with low product risk because product code does not import it.

Relevant SOPs checked: board communication standard, Graphify code-navigation rule, Reference.md engineering-decision rule.
