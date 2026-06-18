// v1.1 / PSG-38 — File parsing for RO/Estimate import.
//
// CSV/TXT are parsed natively (zero-dependency) — these are the formats every
// estimating system (CCC, Mitchell, Audatex) can export, so they are the
// guaranteed shipping path. XLSX/XLSB decode through an OPTIONAL runtime
// dynamic import of SheetJS (`xlsx`); when that dependency is not installed we
// fail with a clear, actionable error instead of crashing the route. This keeps
// the binary-spreadsheet path additive and avoids mutating the shared
// workspace lockfile to land the core import flow.

import type { ImportFileFormat, RawTable } from "./types";

export class UnsupportedSpreadsheetError extends Error {
  constructor(format: ImportFileFormat) {
    super(
      `${format.toUpperCase()} decoding requires the optional "xlsx" dependency. ` +
        `Export the file as CSV, or install the spreadsheet decoder (pnpm add xlsx).`,
    );
    this.name = "UnsupportedSpreadsheetError";
  }
}

export function detectFormat(filename: string): ImportFileFormat | null {
  const ext = filename.toLowerCase().split(".").pop() ?? "";
  if (ext === "csv") return "csv";
  if (ext === "txt" || ext === "tsv") return "txt";
  if (ext === "xlsx" || ext === "xlsm") return "xlsx";
  if (ext === "xlsb") return "xlsb";
  return null;
}

/** Detect the most likely delimiter for a delimited text file. */
export function detectDelimiter(headerLine: string): string {
  const candidates = ["\t", ",", "|", ";"];
  let best = ",";
  let bestCount = -1;
  for (const d of candidates) {
    const count = countUnquoted(headerLine, d);
    if (count > bestCount) {
      bestCount = count;
      best = d;
    }
  }
  return best;
}

function countUnquoted(line: string, delimiter: string): number {
  let inQuotes = false;
  let count = 0;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (ch === '"') inQuotes = !inQuotes;
    else if (!inQuotes && line.startsWith(delimiter, i)) count++;
  }
  return count;
}

/** Parse one delimited line honoring "" RFC-4180-style quoting. */
export function parseDelimitedLine(line: string, delimiter: string): string[] {
  const out: string[] = [];
  let field = "";
  let inQuotes = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (inQuotes) {
      if (ch === '"') {
        if (line[i + 1] === '"') {
          field += '"';
          i++;
        } else {
          inQuotes = false;
        }
      } else {
        field += ch;
      }
    } else if (ch === '"') {
      inQuotes = true;
    } else if (line.startsWith(delimiter, i)) {
      out.push(field);
      field = "";
      i += delimiter.length - 1;
    } else {
      field += ch;
    }
  }
  out.push(field);
  return out;
}

/** Split text into logical rows, keeping newlines that fall inside quotes. */
function splitRows(text: string): string[] {
  const rows: string[] = [];
  let current = "";
  let inQuotes = false;
  const normalized = text.replace(/\r\n/g, "\n").replace(/\r/g, "\n");
  for (let i = 0; i < normalized.length; i++) {
    const ch = normalized[i];
    if (ch === '"') inQuotes = !inQuotes;
    if (ch === "\n" && !inQuotes) {
      rows.push(current);
      current = "";
    } else {
      current += ch;
    }
  }
  if (current.length > 0) rows.push(current);
  return rows;
}

export function parseDelimited(text: string, format: ImportFileFormat): RawTable {
  // Strip a UTF-8 BOM if present.
  const clean = text.replace(/^﻿/, "");
  const lines = splitRows(clean).filter((l) => l.trim().length > 0);
  if (lines.length === 0) {
    return { format, headers: [], rows: [] };
  }
  const delimiter = detectDelimiter(lines[0]);
  const headers = parseDelimitedLine(lines[0], delimiter).map((h) => h.trim());
  const rows = lines.slice(1).map((line) => {
    const cells = parseDelimitedLine(line, delimiter);
    const row: Record<string, string> = {};
    headers.forEach((h, i) => {
      row[h] = (cells[i] ?? "").trim();
    });
    return row;
  });
  return { format, headers, rows };
}

// Minimal structural type for the bits of SheetJS we use. Declared locally so
// the build does not require @types/xlsx (the dep is optional / runtime-only).
type SheetJS = {
  read: (data: Buffer, opts: { type: "buffer" }) => { SheetNames: string[]; Sheets: Record<string, unknown> };
  utils: {
    sheet_to_json: (
      sheet: unknown,
      opts: { header: 1; blankrows: boolean; defval: string; raw: boolean },
    ) => unknown[][];
  };
};

/** Decode a spreadsheet (xlsx/xlsb) via optional SheetJS. */
async function parseSpreadsheet(buffer: Buffer, format: ImportFileFormat): Promise<RawTable> {
  let XLSX: SheetJS;
  try {
    // Optional dependency — resolved at runtime via a non-literal specifier so
    // the bundler/type-checker does not hard-require it. Install with `pnpm add
    // xlsx` to activate the xlsx/xlsb path; csv/txt work without it.
    const moduleName = "xlsx";
    XLSX = (await import(/* webpackIgnore: true */ moduleName)) as unknown as SheetJS;
  } catch {
    throw new UnsupportedSpreadsheetError(format);
  }
  const wb = XLSX.read(buffer, { type: "buffer" });
  const sheet = wb.Sheets[wb.SheetNames[0]];
  const matrix = XLSX.utils.sheet_to_json(sheet, {
    header: 1,
    blankrows: false,
    defval: "",
    raw: false,
  });
  if (matrix.length === 0) return { format, headers: [], rows: [] };
  const headers = (matrix[0] as unknown[]).map((h) => String(h ?? "").trim());
  const rows = matrix.slice(1).map((line: unknown[]) => {
    const cells = line as unknown[];
    const row: Record<string, string> = {};
    headers.forEach((h, i) => {
      row[h] = String(cells[i] ?? "").trim();
    });
    return row;
  });
  return { format, headers, rows };
}

/** Top-level parse: route by detected format. */
export async function parseFile(filename: string, buffer: Buffer): Promise<RawTable> {
  const format = detectFormat(filename);
  if (!format) {
    throw new Error(`Unsupported file type: ${filename}. Use csv, txt, xlsx, or xlsb.`);
  }
  if (format === "csv" || format === "txt") {
    return parseDelimited(buffer.toString("utf8"), format);
  }
  return parseSpreadsheet(buffer, format);
}
