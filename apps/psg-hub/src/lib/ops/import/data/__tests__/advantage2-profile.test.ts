// PSG-176 — Advantage2.0 / CCI import profile tests.
//
// Exercises the alias layer over representative Advantage2.0 header rows drawn
// directly from `docs/import/advantage2.0/field-mapping.csv` in all three
// namings (FieldName / MASTER_DisplayName / RC_*), plus the payload_jsonb
// overflow (Pay Type + insurance-agent sub-record).

import { describe, it, expect } from "vitest";
import {
  ADVANTAGE2_FIELD_MAP,
  ADVANTAGE2_OVERFLOW_MAP,
  resolveAdvantage2Header,
  mapAdvantage2Row,
  assertAdvantage2Coverage,
} from "@/lib/ops/import/data/advantage2-profile";
import { CANONICAL_FIELDS } from "@/lib/ops/import/filemaker/canonical-fields";

describe("Advantage2.0 import profile — canonical-38 coverage", () => {
  it("covers all 37 canonical-38 fields exactly once (37/37)", () => {
    expect(() => assertAdvantage2Coverage()).not.toThrow();
    expect(ADVANTAGE2_FIELD_MAP).toHaveLength(CANONICAL_FIELDS.length);
    expect(CANONICAL_FIELDS.length).toBe(37);

    const mapped = new Set(ADVANTAGE2_FIELD_MAP.map((s) => s.canonical));
    for (const f of CANONICAL_FIELDS) {
      expect(mapped.has(f), `canonical field ${f} should have an Advantage2.0 source`).toBe(true);
    }
    expect(mapped.size).toBe(37);
  });

  it("every spec carries a FieldName and a MASTER_DisplayName", () => {
    for (const s of ADVANTAGE2_FIELD_MAP) {
      expect(s.fieldName.length, `${s.canonical} FieldName`).toBeGreaterThan(0);
      expect(s.displayName.length, `${s.canonical} MASTER_DisplayName`).toBeGreaterThan(0);
    }
  });
});

describe("resolveAdvantage2Header — three namings + priority", () => {
  it("resolves raw FileMaker FieldName headers", () => {
    expect(resolveAdvantage2Header("String3")).toBe("BUName");
    expect(resolveAdvantage2Header("FirstName")).toBe("OwnerFName");
    expect(resolveAdvantage2Header("Address1")).toBe("OwnerAddress1");
    expect(resolveAdvantage2Header("String24")).toBe("VehicleYear");
    expect(resolveAdvantage2Header("PSGID")).toBe("BusinessKeyPSG");
  });

  it("resolves MASTER_DisplayName headers", () => {
    expect(resolveAdvantage2Header("Shop_Name")).toBe("BUName");
    expect(resolveAdvantage2Header("Cust_Address_Line_1")).toBe("OwnerAddress1");
    expect(resolveAdvantage2Header("Cust_Vehicle_Year")).toBe("VehicleYear");
    expect(resolveAdvantage2Header("Repair_Total")).toBe("GrossAmount");
  });

  it("resolves legacy RC_* column headers", () => {
    expect(resolveAdvantage2Header("RC_Cust_First")).toBe("OwnerFName");
    expect(resolveAdvantage2Header("RC_Cust_Last")).toBe("OwnerLName");
    expect(resolveAdvantage2Header("RC_Vehicle_Make")).toBe("VehicleMake");
    expect(resolveAdvantage2Header("RC_Shop")).toBe("BUName");
    expect(resolveAdvantage2Header("RC_SerialNum")).toBe("RepairOrderID");
  });

  it("is case- and whitespace-insensitive", () => {
    expect(resolveAdvantage2Header("  firstname  ")).toBe("OwnerFName");
    expect(resolveAdvantage2Header("CUST_ADDRESS_LINE_1")).toBe("OwnerAddress1");
    expect(resolveAdvantage2Header("rc_cust_first")).toBe("OwnerFName");
  });

  it("returns null for survey-instrument / metadata / unknown columns", () => {
    expect(resolveAdvantage2Header("SQ_Scale_Work")).toBeNull();
    expect(resolveAdvantage2Header("Cust_Demo_Age_Group")).toBeNull();
    expect(resolveAdvantage2Header("String4")).toBeNull(); // overflow, not canonical
    expect(resolveAdvantage2Header("totally_unknown")).toBeNull();
  });

  it("resolves every spec via each of its declared namings", () => {
    for (const s of ADVANTAGE2_FIELD_MAP) {
      expect(resolveAdvantage2Header(s.fieldName), `${s.canonical} via FieldName`).toBe(s.canonical);
      expect(resolveAdvantage2Header(s.displayName), `${s.canonical} via DisplayName`).toBe(s.canonical);
      if (s.rcColumn) {
        expect(resolveAdvantage2Header(s.rcColumn), `${s.canonical} via RC_*`).toBe(s.canonical);
      }
    }
  });
});

describe("mapAdvantage2Row — full Advantage2.0 export row", () => {
  // Representative row in raw FileMaker FieldName naming (the workbook's
  // `FieldName` column), one value per canonical-38 field + overflow.
  const fieldNameRow: Record<string, string> = {
    RODataPreparationID: "1001",
    RepairOrderID: "55501",
    CustomerProgramID: "7",
    RepairOrderNumber: "RO-2026-0420",
    String100: "Advantage2.0",
    FirstName: "Dana",
    LastName: "Reyes",
    Address1: "742 Evergreen Terrace",
    Address2: "Apt 3",
    City: "Springfield",
    State: "IL",
    PostalZip: "62704",
    Country: "US",
    Phone: "217-555-0100",
    WorkPhone: "217-555-0111",
    MobilePhone: "217-555-0122",
    OtherPhone: "217-555-0133",
    DayPhone: "217-555-0144",
    NightPhone: "217-555-0155",
    Email: "dana.reyes@example.com",
    String24: "2021",
    String25: "Toyota",
    String26: "Camry",
    String13: "State Farm",
    String98: "Google",
    String28: "Pat Estimator",
    InsuranceAgentName: "Jordan Agent",
    String3: "Courtesy Body Works",
    PSGID: "9063126657",
    TotalLaborHours: "12.5",
    GrossAmount: "4250.75",
    String27: "Insured",
    VehicleArrivedDate: "2026-04-01",
    RepairStartedDate: "2026-04-02",
    DeliveredDate: "2026-04-10",
    PaintTechnician: "Sam Painter",
    BodyTechician: "Alex Body",
    // overflow (recommendation B)
    String4: "Direct Pay",
    String14: "Jordan",
    String15: "Agent",
    String16: "100 Insurance Way",
    String17: "Suite 200",
    String18: "Bloomington",
    String19: "IL",
    String20: "61701",
    // ignored survey-instrument column
    SQ_Scale_Work: "5",
  };

  it("maps all 37 canonical-38 fields from a FieldName row", () => {
    const { row } = mapAdvantage2Row(fieldNameRow);
    for (const f of CANONICAL_FIELDS) {
      expect(row[f], `canonical ${f} should be populated`).toBeDefined();
    }
    expect(Object.keys(row).sort()).toEqual([...CANONICAL_FIELDS].sort());
    // spot-check values landed on the right canonical keys
    expect(row.OwnerFName).toBe("Dana");
    expect(row.BUName).toBe("Courtesy Body Works");
    expect(row.BusinessKeyPSG).toBe("9063126657");
    expect(row.VehicleYear).toBe("2021");
    expect(row.GrossAmount).toBe("4250.75");
  });

  it("does not leak overflow or survey columns into the canonical row", () => {
    const { row } = mapAdvantage2Row(fieldNameRow);
    // ClaimType (canonical) must NOT be overwritten by PayType overflow
    expect(row.ClaimType).toBe("Insured");
    expect(Object.keys(row)).not.toContain("String4");
    expect(Object.keys(row)).not.toContain("payType");
    expect(Object.keys(row)).not.toContain("SQ_Scale_Work");
  });

  it("captures Pay Type + insurance-agent sub-record in payload_jsonb overflow", () => {
    const { payload } = mapAdvantage2Row(fieldNameRow);
    expect(payload.payType).toBe("Direct Pay");
    expect(payload.insuranceAgent).toEqual({
      firstName: "Jordan",
      lastName: "Agent",
      address1: "100 Insurance Way",
      address2: "Suite 200",
      city: "Bloomington",
      state: "IL",
      zip: "61701",
    });
  });

  it("maps an equivalent MASTER_DisplayName row identically", () => {
    const displayRow: Record<string, string> = {};
    for (const s of ADVANTAGE2_FIELD_MAP) displayRow[s.displayName] = fieldNameRow[s.fieldName];
    for (const s of ADVANTAGE2_OVERFLOW_MAP) displayRow[s.displayName] = fieldNameRow[s.fieldName];
    const fromDisplay = mapAdvantage2Row(displayRow);
    const fromFieldName = mapAdvantage2Row(fieldNameRow);
    // survey col absent from displayRow, so canonical rows + payload match
    expect(fromDisplay.row).toEqual(fromFieldName.row);
    expect(fromDisplay.payload).toEqual(fromFieldName.payload);
  });

  it("maps a legacy RC_* row onto canonical-38 + overflow", () => {
    const rcRow: Record<string, string> = {
      RC_Cust_First: "Dana",
      RC_Cust_Last: "Reyes",
      RC_Vehicle_Make: "Toyota",
      RC_Shop: "Courtesy Body Works",
      RC_MatchField_Master: "9063126657",
      RC_PayType: "Direct Pay",
      RC_Agent_First: "Jordan",
      RC_Agent_City: "Bloomington",
    };
    const { row, payload } = mapAdvantage2Row(rcRow);
    expect(row.OwnerFName).toBe("Dana");
    expect(row.OwnerLName).toBe("Reyes");
    expect(row.VehicleMake).toBe("Toyota");
    expect(row.BUName).toBe("Courtesy Body Works");
    expect(row.BusinessKeyPSG).toBe("9063126657");
    expect(payload.payType).toBe("Direct Pay");
    expect(payload.insuranceAgent).toEqual({ firstName: "Jordan", city: "Bloomington" });
  });

  it("skips blank/whitespace-only and null values", () => {
    const { row, payload } = mapAdvantage2Row({
      FirstName: "Dana",
      LastName: "   ",
      Address1: "",
      String4: null,
      String14: undefined,
    });
    expect(row.OwnerFName).toBe("Dana");
    expect(row).not.toHaveProperty("OwnerLName");
    expect(row).not.toHaveProperty("OwnerAddress1");
    expect(payload.payType).toBeUndefined();
    expect(payload.insuranceAgent).toBeUndefined();
  });
});

describe("Advantage2.0 overflow map (recommendation B)", () => {
  it("declares Pay Type + the 7-part insurance-agent sub-record", () => {
    const paths = ADVANTAGE2_OVERFLOW_MAP.map((s) => s.path);
    expect(paths).toContain("payType");
    expect(paths).toContain("insuranceAgent.firstName");
    expect(paths).toContain("insuranceAgent.zip");
    expect(ADVANTAGE2_OVERFLOW_MAP).toHaveLength(8);
  });

  it("keeps overflow FieldNames disjoint from canonical FieldNames", () => {
    const canonicalNames = new Set(ADVANTAGE2_FIELD_MAP.map((s) => s.fieldName.toLowerCase()));
    for (const s of ADVANTAGE2_OVERFLOW_MAP) {
      expect(canonicalNames.has(s.fieldName.toLowerCase()), `${s.fieldName} should not collide`).toBe(false);
    }
  });
});
