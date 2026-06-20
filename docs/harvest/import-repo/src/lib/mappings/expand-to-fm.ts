import { FM_FIELD_ORDER } from "./fm-field-order";
import { CANONICAL_TO_FM_MAP } from "./canonical-fields";

// Reverse map: FM field -> canonical field
const fmToCanonical = new Map<string, string>();
for (const [canonical, fm] of Object.entries(CANONICAL_TO_FM_MAP)) {
  fmToCanonical.set(fm, canonical);
}

export function expandToImportFlush(
  canonicalRow: Record<string, string>
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
