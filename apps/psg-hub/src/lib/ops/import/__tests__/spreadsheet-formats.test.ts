// PSG-186 — Binary/spreadsheet RO upload regression tests (PII-free synthetic).
//
// The real pilot exports (xlsx ×5, xlsb ×1, xls ×2, SpreadsheetML xml ×1) carry
// customer PII and are .gitignore'd, so they only run through the (skipped-by-
// default) real-export-validation harness. These synthetic fixtures keep the
// newly-enabled SheetJS decode path covered in CI without any customer data:
// xlsx/xlsm/xlsb/xls buffers are generated in-memory via SheetJS, and the
// Excel-2003 SpreadsheetML case is a hand-written literal so the BMS-vs-
// spreadsheet content split is exercised on a real marker set.

import * as XLSX from "xlsx";
import { describe, it, expect } from "vitest";
import { parseFile, CiecaInterchangeError } from "@/lib/ops/import/parse";
import { previewImport } from "@/lib/ops/import";

// Synthetic, obviously-fake RO rows in the raw "Advantage-style" header shape
// (the schema that validates clean end-to-end in the PSG-51 review).
const HEADERS = ["RO", "First Name", "Last Name", "Address 1", "City", "State", "zip", "Make"];
const ROWS = [
  ["1001", "Jane", "Doe", "123 Main St", "Reno", "NV", "89501", "Honda"],
  ["1002", "John", "Roe", "45 Oak Ave", "Reno", "NV", "89502", "Toyota"],
];

/** Build an in-memory workbook buffer for the given SheetJS bookType. */
function workbookBuffer(bookType: "xlsx" | "xlsb" | "xls"): Buffer {
  const ws = XLSX.utils.aoa_to_sheet([HEADERS, ...ROWS]);
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, "Sheet1");
  return XLSX.write(wb, { type: "buffer", bookType }) as Buffer;
}

// A minimal but real Excel-2003 SpreadsheetML document — carries BOTH signature
// markers (the Excel.Sheet processing instruction and the office:spreadsheet
// namespace URN) so it must route to the spreadsheet path, NOT CIECA BMS.
const SPREADSHEETML = `<?xml version="1.0"?>
<?mso-application progid="Excel.Sheet"?>
<Workbook xmlns="urn:schemas-microsoft-com:office:spreadsheet"
 xmlns:ss="urn:schemas-microsoft-com:office:spreadsheet">
 <Worksheet ss:Name="Sheet1">
  <Table>
   <Row>${HEADERS.map((h) => `<Cell><Data ss:Type="String">${h}</Data></Cell>`).join("")}</Row>
   ${ROWS.map(
     (r) => `<Row>${r.map((c) => `<Cell><Data ss:Type="String">${c}</Data></Cell>`).join("")}</Row>`,
   ).join("\n   ")}
  </Table>
 </Worksheet>
</Workbook>`;

describe("binary/spreadsheet decode via SheetJS (PSG-186)", () => {
  for (const bookType of ["xlsx", "xlsb", "xls"] as const) {
    it(`parses a .${bookType} workbook into headers + rows`, async () => {
      const buffer = workbookBuffer(bookType);
      const table = await parseFile(`ros.${bookType}`, buffer);
      expect(table.headers).toEqual(HEADERS);
      expect(table.rows).toHaveLength(2);
      expect(table.rows[0]["First Name"]).toBe("Jane");
      expect(table.rows[1]["Make"]).toBe("Toyota");
    });
  }

  it("auto-maps required fields and validates clean for an .xlsx RO upload", async () => {
    const buffer = workbookBuffer("xlsx");
    const res = await previewImport({ kind: "ro", filename: "ros.xlsx", buffer });
    expect(res.table.format).toBe("xlsx");
    expect(res.table.rowCount).toBe(2);
    expect(res.validation.unmappedRequired).toEqual([]);
    expect(res.validation.invalid).toBe(0);
  });
});

describe("Excel-2003 SpreadsheetML vs CIECA BMS split (PSG-186)", () => {
  it("routes a SpreadsheetML .xml to the spreadsheet path and decodes it", async () => {
    const table = await parseFile("ros.xml", Buffer.from(SPREADSHEETML, "utf8"));
    expect(table.format).toBe("xml");
    expect(table.headers).toEqual(HEADERS);
    expect(table.rows).toHaveLength(2);
    expect(table.rows[0]["Last Name"]).toBe("Doe");
  });

  it("auto-maps + validates a SpreadsheetML RO upload end-to-end", async () => {
    const res = await previewImport({
      kind: "ro",
      filename: "ros.xml",
      buffer: Buffer.from(SPREADSHEETML, "utf8"),
    });
    expect(res.validation.unmappedRequired).toEqual([]);
    expect(res.validation.invalid).toBe(0);
  });

  it("still rejects a true CIECA BMS .xml (no SpreadsheetML markers)", async () => {
    const bms = '<?xml version="1.0"?>\n<BMS><Estimate><RONumber>1001</RONumber></Estimate></BMS>';
    await expect(parseFile("export.xml", Buffer.from(bms))).rejects.toBeInstanceOf(
      CiecaInterchangeError,
    );
  });
});
