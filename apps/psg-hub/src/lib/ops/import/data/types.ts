// PSG-132 — Shared row type for the harvested canonical-38 processing helpers.
//
// The reference datasets + rules engine ported from the standalone
// `Phoenix-Solutions-Group/import` repo (decommission pending PSG-50) operate on
// a flat, string-keyed row in the import repo's **canonical-38 vocabulary**
// (`OwnerFName`, `VehicleMake`, `DeliveredDate`, …) — the same vocabulary the
// in-hub FileMaker export layer uses (`CanonicalRow` in ../filemaker/export-flush.ts).
//
// This is intentionally distinct from the parent module's RO/Estimate import
// vocabulary (`customer_first_name`, `vehicle_make`, … in ../types.ts). The two
// vocabularies are bridged by ../filemaker/bridge.ts.
//
// Helpers may attach `_`-prefixed metadata keys (e.g. `_vehicleWarning`,
// `_errorReason`, `_nameContainedAmpersand`) to a row; an open string index keeps
// those assignments type-safe without enumerating every canonical field.

/** A canonical-38 row: canonical field key -> string value (+ `_`-prefixed flags). */
export type Row = Record<string, string>;
