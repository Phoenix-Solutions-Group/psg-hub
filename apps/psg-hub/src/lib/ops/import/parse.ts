// v1.1 / PSG-38 — File parsing for RO/Estimate import.
//
// CSV/TXT are parsed natively (zero-dependency) — these are the formats every
// estimating system (CCC, Mitchell, Audatex) can export, so they are the
// guaranteed shipping path. The binary/spreadsheet formats the shop actually
// exports (xlsx/xlsm/xlsb, legacy BIFF `.xls`, and Excel-2003 SpreadsheetML
// `.xml`) decode through SheetJS (`xlsx`), loaded via a runtime dynamic import
// (PSG-186 installed it as a workspace dependency). If it is ever absent we
// still fail with a clear, actionable error instead of crashing the route.

import type { ImportFileFormat, RawTable } from "./types";

export class UnsupportedSpreadsheetError extends Error {
  constructor(format: ImportFileFormat) {
    super(
      `${format.toUpperCase()} decoding needs the "xlsx" spreadsheet decoder, ` +
        `which failed to load. Re-install workspace dependencies (pnpm install), ` +
        `or export the file as CSV and upload that instead.`,
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

/** First non-whitespace bytes look like an XML/BMS document. */
function looksLikeXml(text: string): boolean {
  const head = text.replace(/^﻿/, "").trimStart().slice(0, 256).toLowerCase();
  return head.startsWith("<?xml") || head.startsWith("<bms") || /<\s*[a-z][\w:-]*[\s>]/.test(head.slice(0, 64));
}

/**
 * An `.xml` upload is Excel-2003 SpreadsheetML (a spreadsheet) rather than a
 * CIECA BMS interchange doc. Both share the `.xml` extension, so we sniff the
 * header for SpreadsheetML's signature markers — the `Excel.Sheet` mso-application
 * processing instruction and the `office:spreadsheet` namespace URN — which
 * appear in the first few hundred bytes of every Excel XML save.
 */
function looksLikeSpreadsheetML(text: string): boolean {
  const head = text.replace(/^﻿/, "").slice(0, 1024).toLowerCase();
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
  // Legacy BIFF (.xls). SheetJS reads the binary format; route to the
  // spreadsheet decoder like the other Excel encodings. (PSG-186)
  if (ext === "xls") return "xls";
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
// the build does not require @types/xlsx.
type SheetJS = {
  read: (data: Buffer, opts: { type: "buffer" }) => { SheetNames: string[]; Sheets: Record<string, unknown> };
  utils: {
    sheet_to_json: (
      sheet: unknown,
      opts: { header: 1; blankrows: boolean; defval: string; raw: boolean },
    ) => unknown[][];
  };
};

/** Count cells in a raw row that hold any non-whitespace text. */
function nonEmptyCount(row: unknown[]): number {
  let n = 0;
  for (const cell of row) if (String(cell ?? "").trim() !== "") n++;
  return n;
}

/**
 * Real shop spreadsheets rarely start at A1 with the header. Estimating systems
 * and hand-kept workbooks prepend report banners (company name, date range,
 * filters), section labels ("Customer Data Elements"), and type-hint rows
 * ("Text") above the actual column header. Those preamble lines are narrow —
 * one or two populated cells — while the header spans the full table width. So
 * the header is the first row that is "wide" relative to the widest row in the
 * sheet; everything above it is preamble we skip.
 */
function detectHeaderRow(matrix: unknown[][]): number {
  const counts = matrix.map(nonEmptyCount);
  const maxWidth = counts.reduce((a, b) => Math.max(a, b), 0);
  if (maxWidth <= 1) return 0;
  const threshold = Math.max(2, Math.ceil(maxWidth / 2));
  const idx = counts.findIndex((c) => c >= threshold);
  return idx < 0 ? 0 : idx;
}

/**
 * Shape a raw cell matrix into headers + rows: locate the header row (skipping
 * banners/preamble), then keep only genuine data rows. A real RO record fills
 * at least two columns (a name plus an RO/address/etc.), so rows with a single
 * populated cell are separators, section labels, or type-hint lines and are
 * dropped — this keeps the messy multi-band worksheets the shop exports from
 * polluting the table with junk rows. Empty header columns are ignored so
 * trailing blank columns don't collide on a shared "" key.
 */
function matrixToTable(matrix: unknown[][], format: ImportFileFormat): RawTable {
  if (matrix.length === 0) return { format, headers: [], rows: [] };
  const headerIdx = detectHeaderRow(matrix);
  const headers = (matrix[headerIdx] as unknown[]).map((h) => String(h ?? "").trim());
  const rows: Array<Record<string, string>> = [];
  for (let i = headerIdx + 1; i < matrix.length; i++) {
    const cells = matrix[i] as unknown[];
    if (nonEmptyCount(cells) < 2) continue;
    const row: Record<string, string> = {};
    headers.forEach((h, ci) => {
      if (h) row[h] = String(cells[ci] ?? "").trim();
    });
    rows.push(row);
  }
  return { format, headers, rows };
}

/** Decode a spreadsheet (xlsx/xlsm/xlsb/xls/SpreadsheetML xml) via SheetJS. */
async function parseSpreadsheet(buffer: Buffer, format: ImportFileFormat): Promise<RawTable> {
  let XLSX: SheetJS;
  try {
    // Resolved at runtime via a non-literal specifier so the bundler does not
    // statically hard-require it. SheetJS ships as CommonJS, so the dynamic
    // import may surface its exports either as named bindings or under
    // `default` depending on the interop path — accept both.
    const moduleName = "xlsx";
    const mod = (await import(/* webpackIgnore: true */ moduleName)) as unknown as
      | SheetJS
      | { default: SheetJS };
    XLSX = "read" in mod ? mod : mod.default;
  } catch {
    throw new UnsupportedSpreadsheetError(format);
  }
  const wb = XLSX.read(buffer, { type: "buffer" });
  // Workbooks routinely carry chart sheets, blank tabs, and "MASTER COPY"
  // templates alongside the real data tab. Decode every sheet and keep the one
  // that yields the most data rows rather than blindly taking the first.
  let best: RawTable = { format, headers: [], rows: [] };
  for (const name of wb.SheetNames) {
    const matrix = XLSX.utils.sheet_to_json(wb.Sheets[name], {
      header: 1,
      blankrows: false,
      defval: "",
      raw: false,
    });
    const table = matrixToTable(matrix, format);
    if (table.rows.length > best.rows.length) best = table;
  }
  return best;
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
    // An `.xml` (or extensionless) upload is one of two very different things:
    // an Excel-2003 SpreadsheetML workbook (a spreadsheet we CAN read via
    // SheetJS) or a CIECA BMS interchange doc (we cannot). Sniff the header and
    // route accordingly — SpreadsheetML to the decoder, true BMS to guidance.
    if (ext === "xml" || ext === "") {
      const head = buffer.toString("utf8", 0, 1024);
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
