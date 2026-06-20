// PSG-133 — FileMaker "Import Flush v5" export module (public surface).
//
// Net-new IP harvested from Phoenix-Solutions-Group/import (PSG-50 decommission
// pending) — the canonical-38 → Import Flush v5 export mapping plus a three-file
// tab-delimited exporter. Directly feeds the v1.3 FileMaker cutover (PSG-44).
//
// Direction: this is the EXPORT side (psg-hub/canonical -> FileMaker). The import
// side (source files -> psg-hub canonical) lives in the parent module
// (../index.ts, ported by PSG-38).
//
// ── PSG-44 CROSS-CHECK / OPEN ITEMS (must be reconciled before live cutover) ──
//  1. Field count: source carries 193 (README) / 174 (file comment) / 165
//     (actual array). FM_FIELD_COUNT === 165 is asserted by the test suite.
//     Confirm the live production Import Flush v5 column order against FileMaker
//     (the import repo README itself flags this as a known risk).
//  2. canonical-fields.ts: README says 38 canonical fields; the array has 37,
//     and CANONICAL_TO_FM_MAP references OwnerCompanyName which is absent from
//     CANONICAL_FIELDS. Reconcile the canonical schema.
//  3. bridge.ts: HUB_FIELDS_WITHOUT_FM_TARGET (total_loss_flag, estimate_number,
//     estimate_date) have no Import Flush target through the harvested map —
//     decide whether the FM layout needs those columns wired.
//  4. Line endings: FileMaker on Windows expects CRLF; exporter defaults to LF
//     (override via buildImportFlushExport({ lineEnding: "\r\n" })). Confirm the
//     FM import script's expected terminator.
//
// The 9 FileMaker integration specs (filemaker/**.md in the import repo) describe
// the *API* ingestion path (Import_Staging table, IS_* fields) — a separate
// mechanism from this tab-delimited Import Flush export — and are referenced in
// PSG-44 rather than re-vendored here.

export { FM_FIELD_ORDER, FM_FIELD_COUNT } from "./fm-field-order";
export type { FmField } from "./fm-field-order";
export {
  CANONICAL_FIELDS,
  CANONICAL_TO_FM_MAP,
} from "./canonical-fields";
export type { CanonicalField } from "./canonical-fields";
export { expandToImportFlush } from "./expand-to-fm";
export {
  buildImportFlushExport,
  formatDateStamp,
} from "./export-flush";
export type {
  CanonicalRow,
  ErrorRecord,
  ImportFlushExportInput,
  ExportFile,
  ImportFlushExport,
} from "./export-flush";
export {
  HUB_TO_IMPORT_CANONICAL,
  HUB_FIELDS_WITHOUT_FM_TARGET,
  hubRowToCanonical,
  hubRowsToCanonical,
} from "./bridge";
// PSG-138 — canonical-38 standardization pipeline (wires the PSG-132 helpers).
export { standardizeCanonicalRows } from "./standardize";
export type { StandardizeOptions, StandardizeResult } from "./standardize";
