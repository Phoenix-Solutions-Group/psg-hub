// PSG-133 — Import Flush v5 three-file exporter.
//
// Builds the three tab-delimited files the import repo emitted "after user
// review and approval" (import README, Output section), now ported into the ops
// backbone to feed the v1.3 FileMaker cutover (PSG-44):
//
//   1. PSG_Clean_Export_{ShopID}_{YYYYMMDD}.txt
//        tab-delimited, header = FM_FIELD_ORDER, one row per clean canonical-38
//        record expanded via expandToImportFlush (unmapped columns = "").
//   2. PSG_Errors_{ShopID}_{YYYYMMDD}.txt
//        tab-delimited, original source columns + Error_Reason + Error_Stage.
//   3. PSG_Report_{ShopID}_{YYYYMMDD}.txt
//        plain-text processing summary.
//
// Tab-delimited files carry NO quoting, so embedded tabs / CR / LF in any value
// are collapsed to single spaces (standard FileMaker tab-import convention) to
// keep the column/row grid intact. This is deterministic and time-pure: callers
// supply the YYYYMMDD stamp (use formatDateStamp) so the function is safe inside
// pure scripts/tests.

import { FM_FIELD_ORDER, FM_FIELD_COUNT } from "./fm-field-order";
import { expandToImportFlush } from "./expand-to-fm";

/** A cleaned, canonical-38 input record (canonical field name -> value). */
export type CanonicalRow = Record<string, string>;

/** A rejected record: its original source columns plus why/where it failed. */
export type ErrorRecord = {
  /** Original source columns, keyed by the source header. */
  original: Record<string, string>;
  /** Human-readable reason the record was rejected. */
  errorReason: string;
  /** Pipeline stage that rejected it (e.g. "validate", "dedupe", "address"). */
  errorStage: string;
};

export type ImportFlushExportInput = {
  /** Shop identifier used in the file names (sanitized for filesystem safety). */
  shopId: string;
  /** Approved clean records to flush into the Import Flush v5 layout. */
  cleanRows: CanonicalRow[];
  /** Rejected records (optional — an empty errors file is still emitted). */
  errorRecords?: ErrorRecord[];
  /** YYYYMMDD stamp for the file names. Caller-supplied (keeps this pure). */
  dateStamp: string;
  /** Line terminator. FileMaker on Windows expects CRLF; defaults to "\n". */
  lineEnding?: "\n" | "\r\n";
  /** Override the "now" label shown in the report header (else dateStamp). */
  reportLabel?: string;
};

export type ExportFile = { filename: string; content: string };

export type ImportFlushExport = {
  clean: ExportFile;
  errors: ExportFile;
  report: ExportFile;
  stats: { cleanCount: number; errorCount: number; fieldCount: number };
};

const TAB = "\t";

/** Collapse tab/CR/LF in a cell so the tab-delimited grid stays intact. */
function cell(value: string | null | undefined): string {
  if (value == null) return "";
  return String(value).replace(/[\t\r\n]+/g, " ");
}

/** Strip characters that are unsafe in a file name (path separators etc.). */
function safeForFilename(s: string): string {
  return String(s).replace(/[^A-Za-z0-9._-]+/g, "_").replace(/^_+|_+$/g, "") || "UNKNOWN";
}

/** Format a Date as the YYYYMMDD stamp used in Import Flush file names. */
export function formatDateStamp(date: Date): string {
  const y = date.getUTCFullYear().toString().padStart(4, "0");
  const m = (date.getUTCMonth() + 1).toString().padStart(2, "0");
  const d = date.getUTCDate().toString().padStart(2, "0");
  return `${y}${m}${d}`;
}

function joinRows(rows: string[][], eol: string): string {
  // Trailing EOL so the file ends with a newline (FileMaker-friendly).
  return rows.map((cols) => cols.join(TAB)).join(eol) + eol;
}

/** Build the clean Import Flush v5 file content (header + expanded rows). */
function buildClean(cleanRows: CanonicalRow[], eol: string): string {
  const header = [...FM_FIELD_ORDER];
  const lines: string[][] = [header];
  for (const row of cleanRows) {
    const fm = expandToImportFlush(row);
    lines.push(FM_FIELD_ORDER.map((f) => cell(fm[f])));
  }
  return joinRows(lines, eol);
}

/**
 * Build the errors file: original columns (stable union across all records, in
 * first-seen order) followed by Error_Reason + Error_Stage.
 */
function buildErrors(errorRecords: ErrorRecord[], eol: string): string {
  const cols: string[] = [];
  const seen = new Set<string>();
  for (const rec of errorRecords) {
    for (const key of Object.keys(rec.original)) {
      if (!seen.has(key)) {
        seen.add(key);
        cols.push(key);
      }
    }
  }
  const header = [...cols, "Error_Reason", "Error_Stage"];
  const lines: string[][] = [header];
  for (const rec of errorRecords) {
    const row = cols.map((c) => cell(rec.original[c]));
    row.push(cell(rec.errorReason), cell(rec.errorStage));
    lines.push(row);
  }
  return joinRows(lines, eol);
}

/** Build the plain-text processing summary. */
function buildReport(input: ImportFlushExportInput, cleanCount: number, errorCount: number): string {
  const total = cleanCount + errorCount;
  const byStage = new Map<string, number>();
  for (const rec of input.errorRecords ?? []) {
    byStage.set(rec.errorStage, (byStage.get(rec.errorStage) ?? 0) + 1);
  }
  const lines: string[] = [];
  lines.push("PSG Import Flush v5 — Processing Report");
  lines.push("=".repeat(42));
  lines.push(`Shop ID:        ${input.shopId}`);
  lines.push(`Date:           ${input.reportLabel ?? input.dateStamp}`);
  lines.push(`Field layout:   Import Flush v5 (${FM_FIELD_COUNT} columns)`);
  lines.push("");
  lines.push(`Records in:     ${total}`);
  lines.push(`Clean export:   ${cleanCount}`);
  lines.push(`Errors:         ${errorCount}`);
  if (byStage.size > 0) {
    lines.push("");
    lines.push("Errors by stage:");
    for (const [stage, n] of [...byStage.entries()].sort((a, b) => b[1] - a[1])) {
      lines.push(`  - ${stage}: ${n}`);
    }
  }
  lines.push("");
  return lines.join("\n");
}

/**
 * Produce the three Import Flush v5 export files from approved clean rows and
 * rejected error records. Returns each file's name + content plus summary stats.
 */
export function buildImportFlushExport(input: ImportFlushExportInput): ImportFlushExport {
  const eol = input.lineEnding ?? "\n";
  const shop = safeForFilename(input.shopId);
  const stamp = safeForFilename(input.dateStamp);
  const cleanRows = input.cleanRows ?? [];
  const errorRecords = input.errorRecords ?? [];

  return {
    clean: {
      filename: `PSG_Clean_Export_${shop}_${stamp}.txt`,
      content: buildClean(cleanRows, eol),
    },
    errors: {
      filename: `PSG_Errors_${shop}_${stamp}.txt`,
      content: buildErrors(errorRecords, eol),
    },
    report: {
      filename: `PSG_Report_${shop}_${stamp}.txt`,
      content: buildReport(input, cleanRows.length, errorRecords.length),
    },
    stats: {
      cleanCount: cleanRows.length,
      errorCount: errorRecords.length,
      fieldCount: FM_FIELD_COUNT,
    },
  };
}
