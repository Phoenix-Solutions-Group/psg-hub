// v1.1 / PSG-38 — File parsing for RO/Estimate import.
//
// CSV/TXT are parsed natively (zero-dependency) — these are the formats every
// estimating system (CCC, Mitchell, Audatex) can export, so they are the
// guaranteed shipping path. Every other spreadsheet shape the real pilot export
// ships in — xlsx/xlsm, the legacy binary .xls (BIFF), the binary .xlsb, and
// Excel-2003 SpreadsheetML .xml — decodes through SheetJS (`xlsx`, PSG-51b).
//
// SheetJS loads via a runtime dynamic import so it stays out of the client
// bundle and is only pulled in when a spreadsheet is actually uploaded
// (server-side parse only). It is now a real dependency, but the lazy load +
// UnsupportedSpreadsheetError fallback keep the route resilient if the module
// is ever absent, instead of crashing the whole import handler. We pin the
// patched SheetJS CDN build (>=0.20.x), not the stale npm `xlsx@0.18.5` which
// carries CVE-2023-30533 (prototype pollution) + CVE-2024-22363 (ReDoS) — both
// matter because this parser ingests untrusted operator-uploaded files.
//
// NOTE: `.xml` is content-sniffed, not extension-routed: a `.xml` upload may be
// either an Excel SpreadsheetML workbook (which we parse) OR a CIECA BMS
// interchange document (which we reject with re-export guidance) — only the
// bytes tell them apart.

import type { ImportFileFormat, RawTable } from "./types";

export class UnsupportedSpreadsheetError extends Error {
  constructor(format: ImportFileFormat) {
    super(
      `${format.toUpperCase()} decoding requires the "xlsx" (SheetJS) dependency, ` +
        `which could not be loaded. Re-export the file as CSV, or reinstall ` +
        `dependencies (pnpm install) to restore the spreadsheet decoder.`,
    );
    this.name = "UnsupportedSpreadsheetError";
  }
}

/**
 * Raised when the upload is a CIECA estimate-interchange artifact (EMS flat
 * files or a BMS XML document) rather than a tabular RO/Estimate report. CCC
 * ONE, Mitchell, and Audatex can all emit these, and a shop operator may grab
 * one by mistake — it is NOT a single spreadsheet/CSV, so our tabular parser
 * cannot ingest it. Fail with concrete re-export guidance instead of a generic
 * "unsupported file" error or a silent mis-parse. (PSG-51 pilot hardening.)
 */
export class CiecaInterchangeError extends Error {
  constructor(kind: "ems" | "bms") {
    const label = kind === "ems" ? "CIECA EMS (Estimate Management Standard)" : "CIECA BMS (XML)";
    super(
      `This looks like a ${label} export, which is an estimate-interchange ` +
        `bundle — not a tabular RO/Estimate list our import wizard reads. In ` +
        `CCC ONE / Mitchell / Audatex, export the RO or Estimate *list/report* ` +
        `view and save it as CSV (or XLSX), then upload that instead.`,
    );
    this.name = "CiecaInterchangeError";
  }
}

/**
 * Raised when a spreadsheet decodes fine but contains no tabular customer/RO
 * list — e.g. a fillable single-record "repair information form" laid out as
 * label/value pairs down the page (the .xls/.xlsx twin of the scanned PDF forms
 * that route to OCR). We refuse to emit garbage rows from a non-table; instead
 * we tell the operator to export the list/report view. (PSG-51b.)
 */
export class NonTabularSpreadsheetError extends Error {
  constructor(format: ImportFileFormat) {
    super(
      `This ${format.toUpperCase()} file decoded, but it looks like a fillable ` +
        `form or single-record layout — not a tabular customer/RO list (no row ` +
        `of column headers with aligned data beneath it). Export the RO or ` +
        `Estimate *list/report* view (one row per record) and re-upload, or use ` +
        `the scanned-form path for individual intake forms.`,
    );
    this.name = "NonTabularSpreadsheetError";
  }
}

/** First non-whitespace bytes look like an XML/BMS document. */
function looksLikeXml(text: string): boolean {
  const head = text.replace(/^﻿/, "").trimStart().slice(0, 256).toLowerCase();
  return head.startsWith("<?xml") || head.startsWith("<bms") || /<\s*[a-z][\w:-]*[\s>]/.test(head.slice(0, 64));
}

/**
 * True when the bytes are an Excel-2003 SpreadsheetML workbook, which SheetJS
 * reads as a normal spreadsheet. Excel stamps these with the
 * `mso-application progid="Excel.Sheet"` processing instruction and/or the
 * `urn:schemas-microsoft-com:office:spreadsheet` namespace — neither appears in
 * a CIECA BMS document, so this cleanly separates "spreadsheet we parse" from
 * "interchange bundle we reject".
 */
function looksLikeSpreadsheetML(text: string): boolean {
  const head = text.replace(/^﻿/, "").slice(0, 2048).toLowerCase();
  return (
    head.includes('progid="excel.sheet"') ||
    head.includes("urn:schemas-microsoft-com:office:spreadsheet")
  );
}

export function detectFormat(filename: string): ImportFileFormat | null {
  const ext = filename.toLowerCase().split(".").pop() ?? "";
  if (ext === "csv") return "csv";
  if (ext === "txt" || ext === "tsv") return "txt";
  if (ext === "xlsx" || ext === "xlsm") return "xlsx";
  if (ext === "xlsb") return "xlsb";
  if (ext === "xls") return "xls";
  // `.xml` is intentionally NOT matched here: the extension alone cannot tell a
  // SpreadsheetML workbook apart from a CIECA BMS document — parseFile sniffs
  // the bytes and routes accordingly.
  return null;
}

/** Recognize a CIECA interchange artifact by extension; null if not one. */
export function detectCiecaInterchange(filename: string): "ems" | "bms" | null {
  const ext = filename.toLowerCase().split(".").pop() ?? "";
  if (ext === "ems" || ext === "env") return "ems";
  if (ext === "bms") return "bms";
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
// the build does not require @types/xlsx (no published types for the CDN build).
type SheetJS = {
  read: (data: Buffer, opts: { type: "buffer" }) => { SheetNames: string[]; Sheets: Record<string, unknown> };
  utils: {
    sheet_to_json: (
      sheet: unknown,
      opts: { header: 1; blankrows: boolean; defval: string; raw: boolean },
    ) => unknown[][];
  };
};

// Real estimating-system spreadsheets are messy: report banners and filter
// rows sit above the header, the data lives on one of several tabs (often after
// chart sheets), and the header may not be on row 0. These heuristics locate
// the actual table so xlsx/xlsb/xls/xml import as cleanly as a tidy CSV.
const MAX_HEADER_SCAN = 50; // header is always near the top, even under banners
const MIN_HEADER_COLS = 3; // a real list has at least a few columns
const MIN_HEADER_DENSITY = 0.6; // headers are a contiguous run of titles, not scattered form labels

const cellText = (v: unknown): string => String(v ?? "").trim();

function countFilled(row: unknown[]): number {
  let n = 0;
  for (const c of row) if (cellText(c) !== "") n++;
  return n;
}

/** Width from the first to the last filled cell (gaps included). */
function filledSpan(row: unknown[]): number {
  let first = -1;
  let last = -1;
  for (let i = 0; i < row.length; i++) {
    if (cellText(row[i]) !== "") {
      if (first < 0) first = i;
      last = i;
    }
  }
  return first < 0 ? 0 : last - first + 1;
}

/**
 * A header row is a dense, contiguous run of >=MIN_HEADER_COLS column titles
 * with aligned data rows beneath it. The density gate rejects fillable forms
 * (e.g. "First:" … "Middle:" … "Last:" scattered across a wide row); the
 * alignment gate rejects stray banner/title lines that happen to be wide.
 */
function looksLikeHeaderRow(matrix: unknown[][], i: number): boolean {
  const row = matrix[i];
  const width = countFilled(row);
  if (width < MIN_HEADER_COLS) return false;
  const span = filledSpan(row);
  if (span === 0 || width / span < MIN_HEADER_DENSITY) return false;
  let aligned = 0;
  let seen = 0;
  for (let j = i + 1; j < matrix.length && seen < 8; j++) {
    const filled = countFilled(matrix[j]);
    if (filled === 0) continue;
    seen++;
    if (filled >= Math.max(MIN_HEADER_COLS, Math.ceil(width / 2))) aligned++;
  }
  return aligned >= 2;
}

/** Index of the first plausible header row, or -1 if none in the scan window. */
function findHeaderRow(matrix: unknown[][]): number {
  const limit = Math.min(matrix.length, MAX_HEADER_SCAN);
  for (let i = 0; i < limit; i++) {
    if (looksLikeHeaderRow(matrix, i)) return i;
  }
  return -1;
}

/**
 * Pick the sheet+header that yields the largest table. Skips chart/empty tabs
 * and "MASTER COPY" style stubs by preferring the sheet with the most data
 * rows (tie-broken by header width).
 */
function chooseTable(
  XLSX: SheetJS,
  wb: { SheetNames: string[]; Sheets: Record<string, unknown> },
): { matrix: unknown[][]; header: number } | null {
  let best: { matrix: unknown[][]; header: number; score: number } | null = null;
  for (const name of wb.SheetNames) {
    const matrix = XLSX.utils.sheet_to_json(wb.Sheets[name], {
      header: 1,
      blankrows: false,
      defval: "",
      raw: false,
    });
    const header = findHeaderRow(matrix);
    if (header < 0) continue;
    const dataRows = matrix.length - header - 1;
    if (dataRows < 1) continue;
    const score = dataRows * 1000 + countFilled(matrix[header]);
    if (!best || score > best.score) best = { matrix, header, score };
  }
  return best ? { matrix: best.matrix, header: best.header } : null;
}

/** Decode a spreadsheet (xlsx/xlsm/xlsb/xls/SpreadsheetML-xml) via SheetJS. */
async function parseSpreadsheet(buffer: Buffer, format: ImportFileFormat): Promise<RawTable> {
  let XLSX: SheetJS;
  try {
    // Resolved at runtime via a non-literal specifier so the bundler keeps it
    // out of the client bundle (server-side parse only) and the type-checker
    // does not need @types/xlsx. SheetJS auto-detects the container, so one
    // read path covers xlsx/xlsm, binary xls + xlsb, and SpreadsheetML xml.
    const moduleName = "xlsx";
    XLSX = (await import(/* webpackIgnore: true */ moduleName)) as unknown as SheetJS;
  } catch {
    throw new UnsupportedSpreadsheetError(format);
  }
  const wb = XLSX.read(buffer, { type: "buffer" });
  const choice = chooseTable(XLSX, wb);
  if (!choice) throw new NonTabularSpreadsheetError(format);

  const { matrix, header } = choice;
  // Trim trailing empty header cells (binary formats pad to the used range) so
  // we don't synthesize spurious blank-keyed columns.
  const rawHeader = matrix[header];
  let lastFilled = -1;
  for (let i = 0; i < rawHeader.length; i++) if (cellText(rawHeader[i]) !== "") lastFilled = i;
  const headers = rawHeader.slice(0, lastFilled + 1).map(cellText);

  const rows = matrix.slice(header + 1).map((line: unknown[]) => {
    const cells = line;
    const row: Record<string, string> = {};
    headers.forEach((h, i) => {
      row[h] = cellText(cells[i]);
    });
    return row;
  });
  return { format, headers, rows };
}

/** Top-level parse: route by detected format. */
export async function parseFile(filename: string, buffer: Buffer): Promise<RawTable> {
  // Reject CIECA interchange bundles up front with actionable guidance — these
  // share extensions/shape with nothing we parse and would otherwise produce a
  // confusing generic error mid-pilot.
  const cieca = detectCiecaInterchange(filename);
  if (cieca) throw new CiecaInterchangeError(cieca);

  const format = detectFormat(filename);
  const ext = filename.toLowerCase().split(".").pop() ?? "";
  if (!format) {
    // `.xml` (or extensionless XML) is ambiguous: it can be an Excel-2003
    // SpreadsheetML workbook we CAN read, or a CIECA BMS interchange document
    // we can't. Sniff the bytes — SpreadsheetML wins (parse it); otherwise an
    // XML-shaped payload is almost certainly BMS, so guide the operator.
    if (ext === "xml" || ext === "") {
      const head = buffer.toString("utf8", 0, 2048);
      if (looksLikeSpreadsheetML(head)) return parseSpreadsheet(buffer, "xml");
      if (looksLikeXml(head)) throw new CiecaInterchangeError("bms");
    }
    throw new Error(`Unsupported file type: ${filename}. Use csv, txt, xlsx, xlsb, xls, or xml.`);
  }
  if (format === "csv" || format === "txt") {
    return parseDelimited(buffer.toString("utf8"), format);
  }
  return parseSpreadsheet(buffer, format);
}
