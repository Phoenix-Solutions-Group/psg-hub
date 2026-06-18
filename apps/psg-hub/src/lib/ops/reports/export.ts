// v1.4 / PSG-28 — Operational Reports: export serializers.
// Pure functions over a ReportResult. CSV is RFC-4180; "Excel" is dependency-free
// SpreadsheetML 2003 (.xls) which Excel/Sheets open natively (no xlsx lib needed
// for the internal/pilot bar). PDF is produced by the print route (browser
// print-to-PDF) — see /ops/reports/[slug]/print; this module only handles the
// tabular byte formats.

import type {
  ColumnType,
  ReportCell,
  ReportColumn,
  ReportResult,
} from "./types";

/** Human-facing cell text for table display + PDF. */
export function formatCell(value: ReportCell, type: ColumnType): string {
  if (value === null || value === undefined) return "";
  switch (type) {
    case "currency": {
      const n = typeof value === "number" ? value : Number(value);
      if (Number.isNaN(n)) return String(value);
      return n.toLocaleString("en-US", {
        style: "currency",
        currency: "USD",
        minimumFractionDigits: 2,
        maximumFractionDigits: 2,
      });
    }
    case "percent": {
      const n = typeof value === "number" ? value : Number(value);
      if (Number.isNaN(n)) return String(value);
      return `${n.toFixed(1)}%`;
    }
    case "number": {
      const n = typeof value === "number" ? value : Number(value);
      if (Number.isNaN(n)) return String(value);
      return n.toLocaleString("en-US");
    }
    default:
      return String(value);
  }
}

/** Raw, locale-free string for machine formats (CSV/Excel). Numbers stay numeric. */
function rawCell(value: ReportCell): string {
  if (value === null || value === undefined) return "";
  return String(value);
}

function csvEscape(field: string): string {
  // Quote if the field contains comma, quote, CR or LF; double internal quotes.
  if (/[",\r\n]/.test(field)) {
    return `"${field.replace(/"/g, '""')}"`;
  }
  return field;
}

/** RFC-4180 CSV. Header row + data rows + optional totals row. */
export function toCSV(result: ReportResult): string {
  const lines: string[] = [];
  lines.push(result.columns.map((c) => csvEscape(c.label)).join(","));
  for (const row of result.rows) {
    lines.push(
      result.columns.map((c) => csvEscape(rawCell(row[c.key]))).join(","),
    );
  }
  if (result.totals) {
    lines.push(
      result.columns
        .map((c) => csvEscape(rawCell(result.totals![c.key])))
        .join(","),
    );
  }
  // RFC-4180 uses CRLF line breaks.
  return lines.join("\r\n");
}

function xmlEscape(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function isNumericType(type: ColumnType): boolean {
  return type === "number" || type === "currency" || type === "percent";
}

function xmlDataCell(value: ReportCell, type: ColumnType): string {
  if (value === null || value === undefined || value === "") {
    return "<Cell><Data ss:Type=\"String\"></Data></Cell>";
  }
  if (isNumericType(type)) {
    const n = typeof value === "number" ? value : Number(value);
    if (!Number.isNaN(n)) {
      return `<Cell><Data ss:Type="Number">${n}</Data></Cell>`;
    }
  }
  return `<Cell><Data ss:Type="String">${xmlEscape(String(value))}</Data></Cell>`;
}

/**
 * SpreadsheetML 2003 workbook (.xls). Single worksheet, bold header row.
 * Dependency-free and opens in Excel, Numbers and Google Sheets.
 */
export function toSpreadsheetXml(result: ReportResult, title: string): string {
  const headerCells = result.columns
    .map(
      (c) =>
        `<Cell ss:StyleID="hdr"><Data ss:Type="String">${xmlEscape(c.label)}</Data></Cell>`,
    )
    .join("");

  const dataRows = result.rows
    .map(
      (row) =>
        `<Row>${result.columns
          .map((c) => xmlDataCell(row[c.key], c.type))
          .join("")}</Row>`,
    )
    .join("");

  const totalsRow = result.totals
    ? `<Row>${result.columns
        .map((c) => {
          const cell = xmlDataCell(result.totals![c.key], c.type);
          return cell.replace("<Cell>", '<Cell ss:StyleID="tot">');
        })
        .join("")}</Row>`
    : "";

  const sheetName = xmlEscape(title).slice(0, 31) || "Report";

  return `<?xml version="1.0"?>
<?mso-application progid="Excel.Sheet"?>
<Workbook xmlns="urn:schemas-microsoft-com:office:spreadsheet"
 xmlns:ss="urn:schemas-microsoft-com:office:spreadsheet">
 <Styles>
  <Style ss:ID="hdr"><Font ss:Bold="1"/></Style>
  <Style ss:ID="tot"><Font ss:Bold="1"/></Style>
 </Styles>
 <Worksheet ss:Name="${sheetName}">
  <Table>
   <Row>${headerCells}</Row>
   ${dataRows}
   ${totalsRow}
  </Table>
 </Worksheet>
</Workbook>`;
}

/** Build a safe download filename stem from a slug + optional date range. */
export function exportFilename(
  slug: string,
  ext: "csv" | "xls",
  start?: string | null,
  end?: string | null,
): string {
  const range = start && end ? `_${start}_${end}` : "";
  return `${slug}${range}.${ext}`;
}

export const EXPORT_CONTENT_TYPES = {
  csv: "text/csv; charset=utf-8",
  // SpreadsheetML 2003 served as legacy Excel mime so the browser offers a download.
  xls: "application/vnd.ms-excel; charset=utf-8",
} as const;
