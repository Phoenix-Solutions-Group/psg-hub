import { describe, it, expect } from "vitest";
import { formatCell, toCSV, toSpreadsheetXml, exportFilename } from "../export";
import type { ReportResult } from "../types";

const result: ReportResult = {
  columns: [
    { key: "shop", label: "Shop", type: "string" },
    { key: "amount", label: "Invoiced", type: "currency" },
    { key: "rate", label: "Rate", type: "percent" },
    { key: "n", label: "Count", type: "number" },
  ],
  rows: [
    { shop: "Anaheim, Inc.", amount: 1234.5, rate: 42.75, n: 12 },
    { shop: 'Quote "A"', amount: null, rate: 0, n: 0 },
  ],
  totals: { shop: "Total", amount: 1234.5, rate: null, n: 12 },
  sample: true,
  generatedAt: "2026-06-18T00:00:00.000Z",
};

describe("formatCell", () => {
  it("formats currency, percent, number, string", () => {
    expect(formatCell(1234.5, "currency")).toBe("$1,234.50");
    expect(formatCell(42.75, "percent")).toBe("42.8%");
    expect(formatCell(12000, "number")).toBe("12,000");
    expect(formatCell("hi", "string")).toBe("hi");
  });
  it("renders null as empty", () => {
    expect(formatCell(null, "currency")).toBe("");
  });
});

describe("toCSV", () => {
  it("emits header, rows, totals with RFC-4180 quoting", () => {
    const csv = toCSV(result);
    const lines = csv.split("\r\n");
    expect(lines[0]).toBe("Shop,Invoiced,Rate,Count");
    // commas + quotes escaped
    expect(lines[1]).toBe('"Anaheim, Inc.",1234.5,42.75,12');
    expect(lines[2]).toBe('"Quote ""A""",,0,0');
    expect(lines[3]).toBe("Total,1234.5,,12");
  });
});

describe("toSpreadsheetXml", () => {
  it("produces a SpreadsheetML workbook with numeric + string cells", () => {
    const xml = toSpreadsheetXml(result, "Invoicing Recap");
    expect(xml).toContain("<?mso-application progid=\"Excel.Sheet\"?>");
    expect(xml).toContain('ss:Type="Number">1234.5<');
    expect(xml).toContain('ss:Type="String">Anaheim, Inc.<');
    // header label present
    expect(xml).toContain(">Invoiced<");
  });
  it("truncates the worksheet name to 31 chars", () => {
    const xml = toSpreadsheetXml(result, "x".repeat(40));
    const m = xml.match(/ss:Name="([^"]+)"/);
    expect(m?.[1].length).toBe(31);
  });
});

describe("exportFilename", () => {
  it("includes the date range when present", () => {
    expect(exportFilename("audit", "csv", "2026-05-01", "2026-05-31")).toBe(
      "audit_2026-05-01_2026-05-31.csv",
    );
    expect(exportFilename("audit", "xls")).toBe("audit.xls");
  });
});
