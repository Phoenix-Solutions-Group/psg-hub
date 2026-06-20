// PSG-133 — Import Flush v5 export fixture tests.
//
// Proves the harvested canonical-38 -> Import Flush v5 mapping and the three-file
// tab-delimited exporter produce the exact layout the FileMaker cutover (PSG-44)
// expects: canonical rows -> 3 files, with the field order verified.

import { describe, it, expect } from "vitest";
import {
  FM_FIELD_ORDER,
  FM_FIELD_COUNT,
  CANONICAL_TO_FM_MAP,
  expandToImportFlush,
  buildImportFlushExport,
  formatDateStamp,
  hubRowToCanonical,
  hubRowsToCanonical,
  type CanonicalRow,
  type ErrorRecord,
} from "@/lib/ops/import/filemaker";
import type { ValidatedRow } from "@/lib/ops/import";

const TAB = "\t";

const SAMPLE: CanonicalRow = {
  RONumber: "RO-1001",
  OwnerFName: "Jane",
  OwnerLName: "Doe",
  OwnerAddress1: "123 Main St",
  OwnerCity: "Austin",
  OwnerStateProvince: "TX",
  OwnerPostalZip: "78701",
  OwnerEmail: "jane@example.com",
  OwnerCellPhone: "5125551234",
  VehicleYear: "2021",
  VehicleMake: "Toyota",
  VehicleModel: "Camry",
  InsuranceCompany: "Acme Insurance",
  BUName: "Courtesy Body Works",
  BusinessKeyPSG: "SHOP-42",
  GrossAmount: "4250.00",
  VehicleArrivedDate: "06/01/2026",
  DeliveredDate: "06/10/2026",
};

describe("Import Flush v5 field order (PSG-133)", () => {
  it("is exactly 165 columns (verbatim source length) with no duplicates", () => {
    expect(FM_FIELD_COUNT).toBe(165);
    expect(FM_FIELD_ORDER.length).toBe(165);
    expect(new Set(FM_FIELD_ORDER).size).toBe(165);
  });

  it("starts and ends with the source's anchor columns", () => {
    expect(FM_FIELD_ORDER[0]).toBe("R_RONumber");
    expect(FM_FIELD_ORDER[FM_FIELD_ORDER.length - 1]).toBe("AddressType");
    expect(FM_FIELD_ORDER).toContain("PSGID");
    expect(FM_FIELD_ORDER).toContain("R_ImportBatchID");
  });

  it("every CANONICAL_TO_FM_MAP target exists in the field order", () => {
    for (const fm of Object.values(CANONICAL_TO_FM_MAP)) {
      expect(FM_FIELD_ORDER).toContain(fm);
    }
  });
});

describe("expandToImportFlush (PSG-133)", () => {
  it("maps canonical values onto their FM columns, empty elsewhere", () => {
    const fm = expandToImportFlush(SAMPLE);
    expect(Object.keys(fm).length).toBe(165);
    expect(fm.R_RONumber).toBe("RO-1001");
    expect(fm.R_Customer_First).toBe("Jane");
    expect(fm.R_Customer_Last).toBe("Doe");
    expect(fm.R_EmailAdress).toBe("jane@example.com");
    expect(fm.R_Phone_Home).toBe("5125551234"); // OwnerCellPhone -> R_Phone_Home
    expect(fm.R_RepairTotal).toBe("4250.00");
    expect(fm.R_Custom1).toBe("");
    expect(fm.R_Vehicle_VIN).toBe(""); // no canonical source
  });

  it("BusinessKeyPSG feeds BOTH R_ShopID and PSGID (verbatim behaviour)", () => {
    const fm = expandToImportFlush(SAMPLE);
    expect(fm.R_ShopID).toBe("SHOP-42");
    expect(fm.PSGID).toBe("SHOP-42");
  });

  it("tolerates extra/unknown canonical keys", () => {
    const fm = expandToImportFlush({ ...SAMPLE, NotAField: "x" });
    expect(fm.R_RONumber).toBe("RO-1001");
  });
});

describe("buildImportFlushExport three files (PSG-133)", () => {
  const input = {
    shopId: "SHOP-42",
    dateStamp: "20260620",
    cleanRows: [SAMPLE, { RONumber: "RO-1002", OwnerFName: "Sam", OwnerLName: "Lee" }],
    errorRecords: [
      {
        original: { "RO #": "RO-9", "Last Name": "Nguyen", "Zip": "" },
        errorReason: "Missing ZIP for dedupe",
        errorStage: "validate",
      },
      {
        original: { "RO #": "RO-10", "Customer": "Fleet Co" },
        errorReason: "Fleet record removed",
        errorStage: "fleet-filter",
      },
    ] as ErrorRecord[],
  };

  it("names all three files per the Import Flush convention", () => {
    const out = buildImportFlushExport(input);
    expect(out.clean.filename).toBe("PSG_Clean_Export_SHOP-42_20260620.txt");
    expect(out.errors.filename).toBe("PSG_Errors_SHOP-42_20260620.txt");
    expect(out.report.filename).toBe("PSG_Report_SHOP-42_20260620.txt");
  });

  it("clean file: header = full FM field order, data rows = 165 cols each", () => {
    const out = buildImportFlushExport(input);
    const lines = out.clean.content.replace(/\n$/, "").split("\n");
    expect(lines).toHaveLength(3); // header + 2 rows
    const header = lines[0].split(TAB);
    expect(header).toEqual([...FM_FIELD_ORDER]);
    expect(header).toHaveLength(165);

    const row1 = lines[1].split(TAB);
    expect(row1).toHaveLength(165);
    expect(row1[FM_FIELD_ORDER.indexOf("R_RONumber")]).toBe("RO-1001");
    expect(row1[FM_FIELD_ORDER.indexOf("R_Customer_First")]).toBe("Jane");
    expect(row1[FM_FIELD_ORDER.indexOf("PSGID")]).toBe("SHOP-42");

    const row2 = lines[2].split(TAB);
    expect(row2[FM_FIELD_ORDER.indexOf("R_RONumber")]).toBe("RO-1002");
    expect(row2[FM_FIELD_ORDER.indexOf("R_RepairTotal")]).toBe(""); // unmapped
  });

  it("errors file: original columns (union) + Error_Reason + Error_Stage", () => {
    const out = buildImportFlushExport(input);
    const lines = out.errors.content.replace(/\n$/, "").split("\n");
    const header = lines[0].split(TAB);
    expect(header).toEqual(["RO #", "Last Name", "Zip", "Customer", "Error_Reason", "Error_Stage"]);
    const r1 = lines[1].split(TAB);
    expect(r1[header.indexOf("RO #")]).toBe("RO-9");
    expect(r1[header.indexOf("Error_Reason")]).toBe("Missing ZIP for dedupe");
    expect(r1[header.indexOf("Error_Stage")]).toBe("validate");
    expect(r1[header.indexOf("Customer")]).toBe(""); // absent in record 1
  });

  it("report file: plain-text summary with counts, field layout, stage breakdown", () => {
    const out = buildImportFlushExport(input);
    const r = out.report.content;
    expect(r).toContain("Import Flush v5 (165 columns)");
    expect(r).toContain("Clean export:   2");
    expect(r).toContain("Errors:         2");
    expect(r).toContain("validate: 1");
    expect(r).toContain("fleet-filter: 1");
    expect(out.stats).toEqual({ cleanCount: 2, errorCount: 2, fieldCount: 165 });
  });

  it("collapses embedded tabs/newlines so the grid stays intact", () => {
    const out = buildImportFlushExport({
      shopId: "S1",
      dateStamp: "20260620",
      cleanRows: [{ RONumber: "RO\t-\n3", OwnerFName: "A" }],
    });
    const dataLine = out.clean.content.replace(/\n$/, "").split("\n")[1];
    expect(dataLine.split(TAB)).toHaveLength(165);
    expect(dataLine.split(TAB)[FM_FIELD_ORDER.indexOf("R_RONumber")]).toBe("RO - 3");
  });

  it("supports CRLF line endings for FileMaker on Windows", () => {
    const out = buildImportFlushExport({ ...input, lineEnding: "\r\n" });
    expect(out.clean.content).toContain("\r\n");
    expect(out.clean.content.replace(/\r\n$/, "").split("\r\n")).toHaveLength(3);
  });

  it("sanitizes shopId/date for filesystem-safe filenames", () => {
    const out = buildImportFlushExport({ shopId: "../evil/Shop 7", dateStamp: "2026-06-20", cleanRows: [] });
    expect(out.clean.filename).toBe("PSG_Clean_Export_.._evil_Shop_7_2026-06-20.txt");
    expect(out.clean.filename).not.toContain("/");
  });
});

describe("psg-hub canonical bridge (PSG-133)", () => {
  it("maps psg-hub canonical keys through to FM columns", () => {
    const values: ValidatedRow["values"] = {
      customer_first_name: "Maria",
      customer_last_name: "Garcia",
      ro_number: "RO-77",
      customer_phone: "5120000000",
      address_zip: "78704",
      total_loss_flag: true, // no FM target -> dropped
      vehicle_make: "Honda",
    };
    const canon = hubRowToCanonical(values);
    expect(canon.OwnerFName).toBe("Maria");
    expect(canon.RONumber).toBe("RO-77");
    expect(canon.OwnerCellPhone).toBe("5120000000");
    expect(canon).not.toHaveProperty("total_loss_flag");

    const fm = expandToImportFlush(canon);
    expect(fm.R_Customer_First).toBe("Maria");
    expect(fm.R_RONumber).toBe("RO-77");
    expect(fm.R_Vehicle_Make).toBe("Honda");
  });

  it("hubRowsToCanonical + buildImportFlushExport produces a valid clean file", () => {
    const rows: ValidatedRow[] = [
      { index: 1, values: { customer_first_name: "A", customer_last_name: "B", ro_number: "RO-1" }, errors: [], warnings: [] },
    ];
    const out = buildImportFlushExport({
      shopId: "S",
      dateStamp: "20260620",
      cleanRows: hubRowsToCanonical(rows),
    });
    const dataLine = out.clean.content.replace(/\n$/, "").split("\n")[1].split(TAB);
    expect(dataLine[FM_FIELD_ORDER.indexOf("R_RONumber")]).toBe("RO-1");
    expect(dataLine[FM_FIELD_ORDER.indexOf("R_Customer_First")]).toBe("A");
  });
});

describe("formatDateStamp (PSG-133)", () => {
  it("formats a Date as YYYYMMDD (UTC)", () => {
    expect(formatDateStamp(new Date("2026-06-20T12:00:00Z"))).toBe("20260620");
    expect(formatDateStamp(new Date("2026-01-05T00:00:00Z"))).toBe("20260105");
  });
});
