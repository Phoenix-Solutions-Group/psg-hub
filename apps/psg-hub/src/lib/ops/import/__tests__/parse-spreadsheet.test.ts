// PSG-51b — Spreadsheet upload formats (xlsx/xlsm/xlsb + legacy .xls + Excel-2003
// SpreadsheetML .xml) decode through SheetJS and produce the SAME canonical
// mapping/validation outcome as the equivalent CSV.
//
// Fixtures are generated in-memory from SYNTHETIC rows (no customer PII — the
// real pilot exports are gitignored and must never be committed). SheetJS is
// used here both to *write* the binary fixtures and, in production, to *read*
// them, so the round-trip exercises the same library the route relies on.

import { describe, it, expect, beforeAll } from "vitest";
import {
  parseFile,
  detectFormat,
  previewImport,
  CiecaInterchangeError,
  NonTabularSpreadsheetError,
  type RawTable,
} from "@/lib/ops/import";

// SheetJS bookType -> the extension the importer routes by.
const BINARY_FORMATS = [
  { bookType: "xlsx", ext: "xlsx", format: "xlsx" },
  { bookType: "xlsb", ext: "xlsb", format: "xlsb" },
  { bookType: "biff8", ext: "xls", format: "xls" }, // legacy binary BIFF
  { bookType: "xlml", ext: "xml", format: "xml" }, // Excel-2003 SpreadsheetML
] as const;

const HEADERS = ["RO #", "First Name", "Last Name", "Address", "City", "State", "Zip"];
const DATA = [
  ["1001", "Alex", "Synth", "100 Main St", "Reno", "NV", "89501"],
  ["1002", "Sam", "Demo", "200 Oak Ave", "Austin", "TX", "78701"],
];
const AOA = [HEADERS, ...DATA];

// SheetJS is loaded lazily (it is the optional spreadsheet decoder). Tests that
// need to *build* binary fixtures grab it once up front.
type XlsxModule = typeof import("xlsx");
let XLSX: XlsxModule;
beforeAll(async () => {
  XLSX = await import("xlsx");
});

function workbookFromAoa(aoa: unknown[][], sheetName = "Sheet1") {
  const ws = XLSX.utils.aoa_to_sheet(aoa);
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, sheetName);
  return wb;
}

function buildBuffer(aoa: unknown[][], bookType: string): Buffer {
  return XLSX.write(workbookFromAoa(aoa), { type: "buffer", bookType: bookType as never }) as Buffer;
}

function toCsv(aoa: string[][]): string {
  return aoa.map((r) => r.map((c) => (/[",\n]/.test(c) ? `"${c.replace(/"/g, '""')}"` : c)).join(",")).join("\n");
}

describe("PSG-51b spreadsheet format detection", () => {
  it("detects the legacy binary .xls extension", () => {
    expect(detectFormat("export.xls")).toBe("xls");
    expect(detectFormat("EXPORT.XLS")).toBe("xls");
  });

  it("does NOT route .xml by extension (content decides spreadsheet vs BMS)", () => {
    // .xml is ambiguous — parseFile sniffs the bytes; detectFormat stays null.
    expect(detectFormat("export.xml")).toBeNull();
  });
});

describe("PSG-51b spreadsheet decode → RawTable", () => {
  for (const { bookType, ext, format } of BINARY_FORMATS) {
    it(`decodes .${ext} (${bookType}) to headers + rows`, async () => {
      const buf = buildBuffer(AOA, bookType);
      const table = await parseFile(`export.${ext}`, buf);
      expect(table.format).toBe(format);
      expect(table.headers).toEqual(HEADERS);
      expect(table.rows).toHaveLength(2);
      expect(table.rows[0]).toMatchObject({ "RO #": "1001", "First Name": "Alex", State: "NV" });
    });
  }

  it("every spreadsheet format yields the SAME canonical mapping/validation as CSV", async () => {
    const csv = await previewImport({ kind: "ro", filename: "export.csv", buffer: Buffer.from(toCsv(AOA)) });
    // CSV is the reference: required fields auto-map and rows validate clean.
    expect(csv.validation.unmappedRequired).toEqual([]);
    expect(csv.validation.invalid).toBe(0);
    expect(csv.validation.valid).toBe(2);

    for (const { bookType, ext } of BINARY_FORMATS) {
      const buf = buildBuffer(AOA, bookType);
      const res = await previewImport({ kind: "ro", filename: `export.${ext}`, buffer: buf });
      expect(res.mapping, `${ext} mapping`).toEqual(csv.mapping);
      expect(res.validation.unmappedRequired, `${ext} unmappedRequired`).toEqual([]);
      expect(res.validation.valid, `${ext} valid count`).toBe(csv.validation.valid);
      expect(res.validation.invalid, `${ext} invalid count`).toBe(csv.validation.invalid);
    }
  });
});

describe("PSG-51b real-export shapes: banners, multi-sheet, forms", () => {
  it("skips report banner/filter rows above the header", async () => {
    const withBanner = [
      ["QUALITY COLLISION GROUP, LLC"],
      ["psg report"],
      ["Date Range: Custom (6/23/2025 - 6/27/2025)"],
      [],
      ...AOA,
    ];
    const table = await parseFile("banner.xlsx", buildBuffer(withBanner, "xlsx"));
    expect(table.headers).toEqual(HEADERS);
    expect(table.rows).toHaveLength(2);
  });

  it("picks the data sheet, not an empty/chart leading tab", async () => {
    const ws1 = XLSX.utils.aoa_to_sheet([["1"]]); // chart-like stub
    const ws2 = XLSX.utils.aoa_to_sheet(AOA);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws1, "Chart1");
    XLSX.utils.book_append_sheet(wb, ws2, "JUNE");
    const buf = XLSX.write(wb, { type: "buffer", bookType: "xlsx" }) as Buffer;
    const table = await parseFile("multi.xlsx", buf);
    expect(table.headers).toEqual(HEADERS);
    expect(table.rows).toHaveLength(2);
  });

  it("rejects a fillable single-record form (no tabular header) with guidance", async () => {
    // Label/value pairs scattered down the page — the .xls twin of a scanned form.
    const form = [
      ["C U S T O M E R   R E P A I R   I N F O R M A T I O N   F O R M"],
      ["Superior Collision"],
      ["Customer FIRST Name:", "", "", "", "", "Middle:", "", "LAST Name:"],
      ["Cassandra", "", "", "", "", "", "", "Bell"],
      ["Address:"],
      ["8270 Rice Road"],
    ];
    await expect(parseFile("form.xls", buildBuffer(form, "biff8"))).rejects.toBeInstanceOf(
      NonTabularSpreadsheetError,
    );
  });
});

describe("PSG-51b .xml content-sniffing", () => {
  it("parses an Excel-2003 SpreadsheetML .xml workbook", async () => {
    const buf = buildBuffer(AOA, "xlml");
    // Sanity: the bytes carry the SpreadsheetML marker the sniffer keys on.
    const head = buf.toString("utf8", 0, 2048).toLowerCase();
    expect(
      head.includes('progid="excel.sheet"') || head.includes("urn:schemas-microsoft-com:office:spreadsheet"),
    ).toBe(true);

    const table: RawTable = await parseFile("export.xml", buf);
    expect(table.format).toBe("xml");
    expect(table.headers).toEqual(HEADERS);
    expect(table.rows).toHaveLength(2);
  });

  it("still rejects a CIECA BMS .xml document (not a spreadsheet)", async () => {
    const bms =
      '<?xml version="1.0" encoding="UTF-8"?>\n' +
      '<VehicleDamageEstimateAddRq xmlns="http://www.cieca.com/BMS"><DocumentInfo/></VehicleDamageEstimateAddRq>';
    await expect(parseFile("estimate.xml", Buffer.from(bms))).rejects.toBeInstanceOf(CiecaInterchangeError);
  });
});
