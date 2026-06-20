// PSG-138 — Wire the PSG-132 standardization helpers into the canonical-38 export.
//
// The PSG-132 reference library (../data) was ported standalone and intentionally
// left unwired to keep PSG-132 / PSG-133 regression-free. This module is that
// follow-up integration (Ada's decision: wire as its own change). It operates at
// the canonical-38 layer — the SAME vocabulary the FileMaker export layer uses
// (CanonicalRow in ./export-flush == Row in ../data/types) — so it slots between
// "canonical rows in" and buildImportFlushExport:
//
//   raw canonical-38 rows
//     → standardizeVehicles  (BMS make expansion, trim-strip, year validation)
//     → extractUnit          (split a trailing Apt/Ste/# off OwnerAddress1)
//     → applyRules           (ampersand decode, fleet detection, dedup)
//     → { clean, errors }    (clean → cleanRows, errors → errorRecords)
//     → buildImportFlushExport
//
// It is purely additive: ./bridge.ts and ./export-flush.ts are untouched, so the
// PSG-133 export suite is unaffected. Callers that want raw passthrough simply
// keep calling buildImportFlushExport directly.

import { standardizeVehicles } from "../data/vehicle-standardization";
import { applyRules, DEFAULT_FLEET_KEYWORDS } from "../data/rules-engine";
import { extractUnit } from "../data/address-units";
import type { Row } from "../data/types";
import type { CanonicalRow, ErrorRecord } from "./export-flush";

export type StandardizeOptions = {
  /** Fleet/commercial keyword list passed to applyRules. Defaults to DEFAULT_FLEET_KEYWORDS. */
  fleetKeywords?: string[];
  /**
   * Split a trailing unit token (Apt 4B, Ste 200, #12) off OwnerAddress1 into
   * OwnerAddress2 — but only when OwnerAddress2 is empty, so an existing line-2
   * value is never clobbered. Default: true.
   */
  extractUnits?: boolean;
};

export type StandardizeResult = {
  /** Cleaned, standardized, deduped canonical rows — feed to buildImportFlushExport.cleanRows. */
  clean: CanonicalRow[];
  /** Rows the rules engine rejected, shaped for buildImportFlushExport.errorRecords. */
  errors: ErrorRecord[];
  stats: {
    inputCount: number;
    cleanCount: number;
    errorCount: number;
    /** Rows whose VehicleYear fell outside the valid range (still exported, flagged only). */
    vehiclesFlagged: number;
  };
};

/** Metadata keys the helpers attach (`_`-prefixed); stripped from emitted rows. */
function stripMeta(row: Row): CanonicalRow {
  const out: CanonicalRow = {};
  for (const [k, v] of Object.entries(row)) {
    if (!k.startsWith("_")) out[k] = v;
  }
  return out;
}

/** Map a rules-engine rejection reason onto the export's errorStage label. */
function stageForReason(reason: string): string {
  if (reason.startsWith("Fleet")) return "fleet-filter";
  if (reason.startsWith("Duplicate")) return "dedupe";
  return "rules";
}

/** Move a trailing unit off OwnerAddress1 into OwnerAddress2 when line 2 is free. */
function liftUnit(row: Row): Row {
  const line1 = row.OwnerAddress1;
  if (!line1) return row;
  const line2 = (row.OwnerAddress2 ?? "").trim();
  if (line2) return row; // never clobber an existing line 2
  const { street, unit } = extractUnit(line1);
  if (!unit) return row;
  return { ...row, OwnerAddress1: street, OwnerAddress2: unit };
}

/**
 * Run raw canonical-38 rows through the PSG-132 standardization pipeline and
 * partition them into export-ready clean rows + error records. Pure and
 * deterministic apart from standardizeVehicles' year-range check (which reads the
 * current year only to flag — never to reject — out-of-range model years).
 */
export function standardizeCanonicalRows(
  rows: CanonicalRow[],
  opts: StandardizeOptions = {},
): StandardizeResult {
  const { fleetKeywords = DEFAULT_FLEET_KEYWORDS, extractUnits = true } = opts;

  // 1. Vehicle make/model/year standardization.
  const { rows: standardized, flagged } = standardizeVehicles(rows);

  // 2. Address unit extraction (opt-out via extractUnits: false).
  const addressed = extractUnits ? standardized.map(liftUnit) : standardized;

  // 3. Rules: ampersand decode, fleet detection, dedup.
  const { clean, errors } = applyRules(addressed, fleetKeywords);

  return {
    clean: clean.map(stripMeta),
    errors: errors.map((row) => {
      const reason = row._errorReason ?? "Rejected";
      return {
        original: stripMeta(row),
        errorReason: reason,
        errorStage: stageForReason(reason),
      };
    }),
    stats: {
      inputCount: rows.length,
      cleanCount: clean.length,
      errorCount: errors.length,
      vehiclesFlagged: flagged,
    },
  };
}
