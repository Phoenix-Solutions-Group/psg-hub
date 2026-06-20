// PSG-133 — Expand a canonical-38 row into a flat Import Flush v5 row.
//
// Net-new IP harvested verbatim from Phoenix-Solutions-Group/import @ main
// (src/lib/mappings/expand-to-fm.ts) ahead of decommission (PSG-50).
//
// For every column in FM_FIELD_ORDER, look up the canonical field that feeds it
// (reverse of CANONICAL_TO_FM_MAP) and copy the value; unmapped columns flush to
// empty strings. `BusinessKeyPSG` additionally populates `PSGID` directly (it
// also feeds `R_ShopID` via the map — both behaviours preserved verbatim).

import { FM_FIELD_ORDER } from "./fm-field-order";
import { CANONICAL_TO_FM_MAP } from "./canonical-fields";

// Reverse map: FM field -> canonical field
const fmToCanonical = new Map<string, string>();
for (const [canonical, fm] of Object.entries(CANONICAL_TO_FM_MAP)) {
  fmToCanonical.set(fm, canonical);
}

export function expandToImportFlush(
  canonicalRow: Record<string, string>,
): Record<string, string> {
  const fmRow: Record<string, string> = {};

  for (const fmField of FM_FIELD_ORDER) {
    const canonicalField = fmToCanonical.get(fmField);
    fmRow[fmField] = canonicalField ? (canonicalRow[canonicalField] ?? "") : "";
  }

  // Direct assignments for fields that map by name
  if (canonicalRow["BusinessKeyPSG"]) {
    fmRow["PSGID"] = canonicalRow["BusinessKeyPSG"];
  }

  return fmRow;
}
