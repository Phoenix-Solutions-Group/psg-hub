// PSG-138 — canonical-38 standardization pipeline wired into the FM export.
//
// Proves the PSG-132 helpers (standardizeVehicles / applyRules / extractUnit) are
// actually invoked at the canonical-38 layer and that their output flows cleanly
// into buildImportFlushExport — while the untouched PSG-133 export suite still
// passes (no-regression: this file is purely additive).

import { describe, it, expect } from "vitest";
import {
  standardizeCanonicalRows,
  buildImportFlushExport,
  expandToImportFlush,
  FM_FIELD_ORDER,
  type CanonicalRow,
} from "@/lib/ops/import/filemaker";

const TAB = "\t";

describe("standardizeCanonicalRows — vehicle standardization (PSG-138)", () => {
  it("expands BMS make abbreviations and strips trim to the base model", () => {
    const { clean } = standardizeCanonicalRows([
      { OwnerLName: "Doe", VehicleMake: "CHEV", VehicleModel: "Silverado 1500 LT 4X4" },
    ]);
    expect(clean[0].VehicleMake).toBe("Chevrolet");
    expect(clean[0].VehicleModel).toBe("Silverado 1500");
  });

  it("flags out-of-range years without rejecting the row", () => {
    const { clean, stats } = standardizeCanonicalRows([
      { OwnerLName: "Old", VehicleMake: "Ford", VehicleYear: "1950" },
      { OwnerLName: "Ok", VehicleMake: "Ford", VehicleYear: "2021" },
    ]);
    expect(stats.vehiclesFlagged).toBe(1);
    expect(clean).toHaveLength(2); // flagged years stay in the clean set
  });
});

describe("standardizeCanonicalRows — rules engine (PSG-138)", () => {
  it("decodes HTML-entity ampersands in name fields", () => {
    const { clean } = standardizeCanonicalRows([
      { OwnerFName: "Tom &amp; Jerry", OwnerLName: "Smith", OwnerAddress1: "1 A St" },
    ]);
    expect(clean[0].OwnerFName).toBe("Tom and Jerry");
  });

  it("routes fleet/commercial owners to errors with a fleet-filter stage", () => {
    const { clean, errors } = standardizeCanonicalRows([
      { OwnerLName: "Hertz Rental", OwnerAddress1: "9 Fleet Rd" },
      { OwnerLName: "Private", OwnerAddress1: "10 Main St" },
    ]);
    expect(clean).toHaveLength(1);
    expect(clean[0].OwnerLName).toBe("Private");
    expect(errors).toHaveLength(1);
    expect(errors[0].errorReason).toBe("Fleet/Commercial detected");
    expect(errors[0].errorStage).toBe("fleet-filter");
  });

  it("de-dupes on name+address+phone, keeping the newer DeliveredDate, older → dedupe error", () => {
    const dupe = (deliveredDate: string): CanonicalRow => ({
      OwnerFName: "Ann",
      OwnerLName: "Lee",
      OwnerAddress1: "5 Oak St",
      OwnerHomePhone: "5551112222",
      DeliveredDate: deliveredDate,
    });
    const { clean, errors } = standardizeCanonicalRows([dupe("2026-01-01"), dupe("2026-06-01")]);
    expect(clean).toHaveLength(1);
    expect(clean[0].DeliveredDate).toBe("2026-06-01"); // newer kept
    expect(errors).toHaveLength(1);
    expect(errors[0].errorStage).toBe("dedupe");
  });
});

describe("standardizeCanonicalRows — address unit extraction (PSG-138)", () => {
  it("lifts a trailing unit off OwnerAddress1 into an empty OwnerAddress2", () => {
    const { clean } = standardizeCanonicalRows([
      { OwnerLName: "U", OwnerAddress1: "123 Main St Apt 4B" },
    ]);
    expect(clean[0].OwnerAddress1).toBe("123 Main St");
    expect(clean[0].OwnerAddress2).toBe("Apt 4B");
  });

  it("never clobbers an existing OwnerAddress2", () => {
    const { clean } = standardizeCanonicalRows([
      { OwnerLName: "U", OwnerAddress1: "123 Main St Apt 4B", OwnerAddress2: "Floor 2" },
    ]);
    expect(clean[0].OwnerAddress1).toBe("123 Main St Apt 4B"); // left intact
    expect(clean[0].OwnerAddress2).toBe("Floor 2");
  });

  it("can be disabled via extractUnits: false", () => {
    const { clean } = standardizeCanonicalRows(
      [{ OwnerLName: "U", OwnerAddress1: "123 Main St Apt 4B" }],
      { extractUnits: false },
    );
    expect(clean[0].OwnerAddress1).toBe("123 Main St Apt 4B");
    expect(clean[0].OwnerAddress2).toBeUndefined();
  });
});

describe("standardizeCanonicalRows — metadata hygiene (PSG-138)", () => {
  it("strips _-prefixed helper metadata from clean rows and error originals", () => {
    const { clean, errors } = standardizeCanonicalRows([
      { OwnerFName: "Bob &amp; Sue", OwnerLName: "Jones", OwnerAddress1: "1 St" },
      { OwnerLName: "Enterprise Leasing", OwnerAddress1: "2 St" },
    ]);
    for (const row of clean) {
      expect(Object.keys(row).some((k) => k.startsWith("_"))).toBe(false);
    }
    for (const err of errors) {
      expect(Object.keys(err.original).some((k) => k.startsWith("_"))).toBe(false);
    }
  });
});

describe("standardizeCanonicalRows → buildImportFlushExport (PSG-138 end-to-end)", () => {
  it("standardized values land in the correct FM columns", () => {
    const { clean } = standardizeCanonicalRows([
      {
        RONumber: "RO-500",
        OwnerFName: "Lee &amp; Co",
        OwnerLName: "Park",
        OwnerAddress1: "77 Pine Ave Ste 200",
        VehicleMake: "TOYT",
        VehicleModel: "Camry LE",
        BusinessKeyPSG: "SHOP-9",
      },
    ]);
    const fm = expandToImportFlush(clean[0]);
    expect(fm.R_Vehicle_Make).toBe("Toyota");
    expect(fm.R_Vehicle_Model).toBe("Camry");
    expect(fm.R_Customer_First).toBe("Lee and Co");
    expect(fm.R_Address).toBe("77 Pine Ave");
    expect(fm.R_AddressB).toBe("Ste 200");
    expect(fm.R_ShopID).toBe("SHOP-9");
  });

  it("clean rows + error records flow into the three-file export", () => {
    const result = standardizeCanonicalRows([
      { OwnerFName: "Real", OwnerLName: "Customer", OwnerAddress1: "1 Main St", VehicleMake: "HOND" },
      { OwnerLName: "Avis Rent A Car", OwnerAddress1: "2 Fleet Way" },
    ]);
    const out = buildImportFlushExport({
      shopId: "SHOP-9",
      dateStamp: "20260620",
      cleanRows: result.clean,
      errorRecords: result.errors,
    });

    // Clean file: header + 1 standardized row, Honda mapped through.
    const cleanLines = out.clean.content.replace(/\n$/, "").split("\n");
    expect(cleanLines).toHaveLength(2);
    expect(cleanLines[1].split(TAB)[FM_FIELD_ORDER.indexOf("R_Vehicle_Make")]).toBe("Honda");

    // Errors file: the fleet row, with Error_Stage = fleet-filter.
    const errLines = out.errors.content.replace(/\n$/, "").split("\n");
    const errHeader = errLines[0].split(TAB);
    expect(errHeader).toContain("Error_Reason");
    expect(errHeader).toContain("Error_Stage");
    expect(errLines[1].split(TAB)[errHeader.indexOf("Error_Stage")]).toBe("fleet-filter");

    expect(out.report.content).toContain("Errors:         1");
    expect(result.stats.inputCount).toBe(2);
  });
});
