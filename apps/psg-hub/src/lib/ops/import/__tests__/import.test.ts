import { describe, it, expect } from "vitest";
import {
  normalizeState,
  normalizeZip,
  normalizePhone,
  normalizeStreet,
  resolveAddress,
} from "@/lib/ops/import/address";
import {
  detectFormat,
  detectCiecaInterchange,
  detectDelimiter,
  parseDelimitedLine,
  parseDelimited,
  parseFile,
  CiecaInterchangeError,
} from "@/lib/ops/import/parse";
import { suggestMapping, applyMapping, missingRequiredMappings } from "@/lib/ops/import/template";
import { validateRecords } from "@/lib/ops/import/validate";
import { previewImport, toCommitRecord } from "@/lib/ops/import";

describe("address normalization", () => {
  it("resolves full state names and codes", () => {
    expect(normalizeState("California")).toBe("CA");
    expect(normalizeState("new york")).toBe("NY");
    expect(normalizeState("tx")).toBe("TX");
    expect(normalizeState("Atlantis")).toBeNull();
    expect(normalizeState("")).toBeNull();
  });

  it("normalizes zips to 5 or ZIP+4", () => {
    expect(normalizeZip("90210")).toBe("90210");
    expect(normalizeZip("90210-1234")).toBe("90210-1234");
    expect(normalizeZip("902101234")).toBe("90210-1234");
    expect(normalizeZip("1234")).toBe("01234"); // dropped leading zero
    expect(normalizeZip("abc")).toBeNull();
  });

  it("normalizes US phone numbers", () => {
    expect(normalizePhone("(555) 123-4567")).toBe("5551234567");
    expect(normalizePhone("+1 555 123 4567")).toBe("5551234567");
    expect(normalizePhone("12345")).toBeNull();
  });

  it("smart-resolves street abbreviations", () => {
    const r = normalizeStreet("123 main st");
    expect(r.value).toBe("123 Main Street");
    expect(r.changed).toBe(true);
    expect(normalizeStreet("45 N ELM AVE").value).toBe("45 N Elm Avenue");
  });

  it("flags unresolvable state + malformed zip as errors", () => {
    const res = resolveAddress({ line1: "1 a st", city: "x", state: "ZZ", zip: "abc" });
    expect(res.errors.length).toBe(2);
  });

  it("warns (not errors) when address is corrected", () => {
    const res = resolveAddress({ line1: "10 oak rd", city: "reno", state: "nevada", zip: "89501" });
    expect(res.errors).toEqual([]);
    expect(res.address.state).toBe("NV");
    expect(res.warnings.length).toBeGreaterThan(0);
  });
});

describe("file parsing", () => {
  it("detects formats by extension", () => {
    expect(detectFormat("a.CSV")).toBe("csv");
    expect(detectFormat("a.txt")).toBe("txt");
    expect(detectFormat("a.xlsx")).toBe("xlsx");
    expect(detectFormat("a.xlsb")).toBe("xlsb");
    expect(detectFormat("a.pdf")).toBeNull();
  });

  it("detects delimiter and parses quoted CSV cells", () => {
    expect(detectDelimiter('a,b,c')).toBe(",");
    expect(detectDelimiter("a\tb\tc")).toBe("\t");
    expect(parseDelimitedLine('"Smith, Jr.",42,"he said ""hi"""', ",")).toEqual([
      "Smith, Jr.",
      "42",
      'he said "hi"',
    ]);
  });

  it("parses a CSV body with header + rows, stripping BOM", () => {
    const csv = '﻿First Name,Last Name,RO #\nJane,Doe,1001\nJohn,Roe,1002\n';
    const t = parseDelimited(csv, "csv");
    expect(t.headers).toEqual(["First Name", "Last Name", "RO #"]);
    expect(t.rows).toHaveLength(2);
    expect(t.rows[0]["First Name"]).toBe("Jane");
  });

  it("handles quoted newlines inside a field", () => {
    const csv = 'a,b\n"line1\nline2",x\n';
    const t = parseDelimited(csv, "csv");
    expect(t.rows).toHaveLength(1);
    expect(t.rows[0].a).toContain("line1");
  });
});

describe("CIECA EMS/BMS interchange guard (PSG-51 pilot hardening)", () => {
  it("recognizes EMS/BMS extensions, ignores tabular ones", () => {
    expect(detectCiecaInterchange("EST.EMS")).toBe("ems");
    expect(detectCiecaInterchange("pointer.env")).toBe("ems");
    expect(detectCiecaInterchange("estimate.bms")).toBe("bms");
    expect(detectCiecaInterchange("ros.csv")).toBeNull();
    expect(detectCiecaInterchange("estimates.xlsx")).toBeNull();
  });

  it("rejects an EMS upload with actionable re-export guidance", async () => {
    await expect(parseFile("VEH.EMS", Buffer.from("1|HONDA|CIVIC"))).rejects.toBeInstanceOf(
      CiecaInterchangeError,
    );
    await expect(parseFile("VEH.EMS", Buffer.from("x"))).rejects.toThrow(/list\/report/i);
  });

  it("rejects an XML/BMS document even without a .bms extension", async () => {
    const bms = '<?xml version="1.0"?>\n<BMS><Estimate><RONumber>1001</RONumber></Estimate></BMS>';
    await expect(parseFile("export.bms", Buffer.from(bms))).rejects.toBeInstanceOf(
      CiecaInterchangeError,
    );
    await expect(parseFile("unknown.xml", Buffer.from(bms))).rejects.toBeInstanceOf(
      CiecaInterchangeError,
    );
  });

  it("still rejects a truly unknown type with the generic error", async () => {
    await expect(parseFile("scan.pdf", Buffer.from("%PDF-1.7"))).rejects.toThrow(
      /Unsupported file type/i,
    );
  });
});

describe("template mapping (smart column resolution)", () => {
  it("auto-resolves headers to canonical fields", () => {
    const headers = ["RO #", "First Name", "Last Name", "Phone", "City", "State", "Zip"];
    const m = suggestMapping("ro", headers);
    expect(m.ro_number).toBe("RO #");
    expect(m.customer_first_name).toBe("First Name");
    expect(m.customer_last_name).toBe("Last Name");
    expect(m.address_state).toBe("State");
    expect(m.address_zip).toBe("Zip");
  });

  it("reports missing required mappings", () => {
    const m = suggestMapping("estimate", ["First Name", "Last Name"]);
    expect(missingRequiredMappings("estimate", m)).toContain("estimate_number");
  });

  // PSG-51 — regressions from REAL pilot exports (header shapes only, no PII).
  // The old substring resolver mis-mapped compound camelCase headers; these lock
  // in the scoring/tokenizing resolver. See docs/Filemaker Exports.
  it("maps a CCC ONE export without grabbing decoy ID columns", () => {
    // RODataPreparationID / CustomerProgramID precede the real columns — the old
    // resolver grabbed them via "ro" / "st" substrings ("cu·st·omer").
    const headers = [
      "RODataPreparationID", "RepairOrderID", "CustomerProgramID", "RONumber",
      "OwnerFName", "OwnerLName", "OwnerAddress1", "OwnerCity",
      "OwnerStateProvince", "OwnerPostalZip", "OwnerHomePhone", "OwnerCellPhone",
      "OwnerEmail", "VehicleMake", "VehicleModel", "TotalLaborHrs", "DeliveredDate",
    ];
    const m = suggestMapping("ro", headers);
    expect(m.ro_number).toBe("RONumber");
    expect(m.address_state).toBe("OwnerStateProvince");
    expect(m.customer_phone).toBe("OwnerCellPhone"); // cell preferred over home
    expect(m.address_zip).toBe("OwnerPostalZip");
    expect(m.date_out).toBe("DeliveredDate");
    // No real total-loss column present -> must stay unmapped (not TotalLaborHrs).
    expect(m.total_loss_flag).toBeUndefined();
  });

  it("maps the canonical PSG export, picking RONumber over phone columns", () => {
    // "OwnerOtherPhone" contains the substring "ro" — the old resolver mapped
    // ro_number to it (col 10) instead of RONumber (col 18).
    const headers = [
      "BusinessKeyPSG", "OwnerFName", "OwnerLName", "OwnerAddress1",
      "OwnerCity", "OwnerStateProvince", "OwnerPostalZip", "OwnerCellPhone",
      "OwnerOtherPhone", "OwnerEmail", "RONumber", "Total_Loss",
    ];
    const m = suggestMapping("ro", headers);
    expect(m.ro_number).toBe("RONumber");
    expect(m.address_state).toBe("OwnerStateProvince");
    expect(m.total_loss_flag).toBe("Total_Loss");
  });

  it("does not map total-loss to a dollar 'Total' column", () => {
    const m = suggestMapping("ro", ["RO", "First Name", "Last Name", "Total"]);
    expect(m.ro_number).toBe("RO");
    expect(m.total_loss_flag).toBeUndefined();
  });

  // PSG-461 — REAL pilot export (Shelton Collision; FileMaker "RC" layout; header
  // shapes only, no PII). The old resolver tied RC_Cust_* against the parallel
  // RC_Agent_* columns on the shared trailing word and the agent column (listed
  // first) won, so customer_last_name resolved to RC_Agent_Last — blank for 93%
  // of rows -> all rejected, and the rest imported the agent AS the customer.
  // The customer-identity fields must lock onto the RC_Cust_* / RC_Phone1 columns
  // and the RC_Agent_* columns must never win them.
  it("maps the FileMaker RC export to the customer columns, never the agent columns", () => {
    const headers = [
      "RC_RONumber",
      // Agent columns are listed BEFORE the customer columns — the order that
      // used to make the agent win on a tie.
      "RC_Agent_First", "RC_Agent_Last", "RC_Agent_Phone",
      "RC_Agent_Address1", "RC_Agent_City", "RC_Agent_State", "RC_Agent_Zip",
      "RC_Cust_First", "RC_Cust_Last", "RC_Phone1", "RC_EmailAddress",
      "RC_Cust_Address1", "RC_Cust_Address2", "RC_Cust_City", "RC_Cust_State", "RC_Cust_Zip",
      "RC_Vehicle_Make", "RC_Vehicle_Model", "RC_PayType", "RC_Date_In", "RC_Date_Out",
    ];
    const m = suggestMapping("ro", headers);
    // Required identity anchors resolve to the CUSTOMER columns.
    expect(m.ro_number).toBe("RC_RONumber");
    expect(m.customer_last_name).toBe("RC_Cust_Last");
    expect(m.customer_first_name).toBe("RC_Cust_First");
    // The agent columns must never be chosen for any customer-identity field.
    const agentHeaders = headers.filter((h) => h.includes("Agent"));
    for (const key of [
      "customer_first_name", "customer_last_name", "customer_phone",
      "address_line1", "address_line2", "address_city", "address_state", "address_zip",
    ]) {
      expect(agentHeaders).not.toContain(m[key]);
    }
    // Rest of the customer block resolves to RC_Cust_* / RC_Phone1 / RC_EmailAddress.
    expect(m.customer_phone).toBe("RC_Phone1");
    expect(m.customer_email).toBe("RC_EmailAddress");
    expect(m.address_line1).toBe("RC_Cust_Address1");
    expect(m.address_line2).toBe("RC_Cust_Address2");
    expect(m.address_city).toBe("RC_Cust_City");
    expect(m.address_state).toBe("RC_Cust_State");
    expect(m.address_zip).toBe("RC_Cust_Zip");
    // Vehicle / pay-type / dates resolve through the existing catalog.
    expect(m.vehicle_make).toBe("RC_Vehicle_Make");
    expect(m.vehicle_model).toBe("RC_Vehicle_Model");
    expect(m.pay_type).toBe("RC_PayType");
    expect(m.date_in).toBe("RC_Date_In");
    expect(m.date_out).toBe("RC_Date_Out");
  });

  it("leaves a customer-identity field unmapped rather than importing the agent column", () => {
    // When the export carries ONLY agent identity columns (no RC_Cust_*), the
    // required customer_last_name must stay unmapped (surfaced to the operator),
    // never silently filled from the agent — the silent-wrong-data failure mode.
    const m = suggestMapping("ro", ["RC_RONumber", "RC_Agent_Last", "RC_Agent_First", "RC_Agent_Phone"]);
    expect(m.ro_number).toBe("RC_RONumber");
    expect(m.customer_last_name).toBeUndefined();
    expect(missingRequiredMappings("ro", m)).toContain("customer_last_name");
  });

  it("applies a mapping to produce canonical-keyed rows", () => {
    const table = { format: "csv" as const, headers: ["RO #", "First Name"], rows: [{ "RO #": "1", "First Name": "Jane" }] };
    const mapped = applyMapping(table, { ro_number: "RO #", customer_first_name: "First Name" });
    expect(mapped[0]).toEqual({ ro_number: "1", customer_first_name: "Jane" });
  });
});

describe("validation", () => {
  const mapping = {
    ro_number: "RO #",
    customer_first_name: "First Name",
    customer_last_name: "Last Name",
    address_state: "State",
    address_zip: "Zip",
  };

  it("passes a clean row and flags a bad one", () => {
    const records = [
      { ro_number: "1001", customer_first_name: "Jane", customer_last_name: "Doe", address_state: "CA", address_zip: "90210" },
      { ro_number: "", customer_first_name: "John", customer_last_name: "Roe", address_state: "ZZ", address_zip: "x" },
    ];
    const summary = validateRecords("ro", mapping, records);
    expect(summary.total).toBe(2);
    expect(summary.valid).toBe(1);
    expect(summary.invalid).toBe(1);
    expect(summary.rows[1].errors.length).toBeGreaterThan(0);
  });

  it("reports unmapped required fields", () => {
    const summary = validateRecords("ro", { customer_first_name: "First Name" }, []);
    expect(summary.unmappedRequired).toContain("ro_number");
    expect(summary.unmappedRequired).toContain("customer_last_name");
    // first name is optional (commercial/fleet ROs have no personal first name).
    expect(summary.unmappedRequired).not.toContain("customer_first_name");
  });

  // PSG-51 — commercial / fleet ROs carry the business name in the last-name
  // field with a blank first name (e.g. "CARMAX", "OMAHA GLASS CO"). These are
  // valid records, not errors.
  it("accepts a commercial RO with a company last name and no first name", () => {
    const summary = validateRecords(
      "ro",
      { ro_number: "RONumber", customer_first_name: "OwnerFName", customer_last_name: "OwnerLName" },
      [{ ro_number: "141647", customer_first_name: "", customer_last_name: "OMAHA GLASS CO" }],
    );
    expect(summary.invalid).toBe(0);
    expect(summary.rows[0].errors).toEqual([]);
  });
});

describe("previewImport + toCommitRecord", () => {
  it("runs end-to-end from a CSV buffer with auto mapping", async () => {
    const csv = "First Name,Last Name,RO #,State,Zip\nJane,Doe,1001,California,90210\n";
    const res = await previewImport({ kind: "ro", filename: "ros.csv", buffer: Buffer.from(csv) });
    expect(res.table.rowCount).toBe(1);
    expect(res.mapping.ro_number).toBe("RO #");
    expect(res.validation.valid).toBe(1);

    const rec = toCommitRecord("ro", res.validation.rows[0]);
    expect(rec.customer.first_name).toBe("Jane");
    expect(rec.customer.address.state).toBe("CA");
    expect(rec.ro?.ro_number).toBe("1001");
  });

  it("shapes an estimate commit record", () => {
    const summary = validateRecords(
      "estimate",
      { estimate_number: "Est #", customer_first_name: "F", customer_last_name: "L", estimate_total: "Total" },
      [{ estimate_number: "E-9", customer_first_name: "Amy", customer_last_name: "Lee", estimate_total: "$1,250.50" }],
    );
    const rec = toCommitRecord("estimate", summary.rows[0]);
    expect(rec.estimate?.estimate_number).toBe("E-9");
    expect(rec.estimate?.payload_jsonb.total).toBe(1250.5);
  });

  // PSG-352 — canonical invoiced-$ + pay-type on the generic RO builder.
  // validateRecords reads records keyed by canonical field key (the mapping only
  // gates required-field presence), so records below use canonical keys.
  it("populates repair_amount_cents + pay_type from generic RO columns", () => {
    const summary = validateRecords(
      "ro",
      { ro_number: "RO #", customer_last_name: "Last", repair_amount: "Amount", pay_type: "Pay Type" },
      [{ ro_number: "2002", customer_last_name: "Smith", repair_amount: "$3,400.00", pay_type: "Insurance" }],
    );
    const rec = toCommitRecord("ro", summary.rows[0]);
    expect(rec.ro?.repair_amount_cents).toBe(340000);
    expect(rec.ro?.pay_type).toBe("insurance");
    // Raw token retained on the audit path the PSG-46 report reads.
    expect((rec.ro?.payload_jsonb as { advantage2?: { payType?: string } }).advantage2?.payType).toBe(
      "Insurance",
    );
  });

  it("leaves repair_amount_cents + pay_type null when the RO source omits them", () => {
    const summary = validateRecords(
      "ro",
      { ro_number: "RO #", customer_last_name: "Last" },
      [{ ro_number: "2003", customer_last_name: "Doe" }],
    );
    const rec = toCommitRecord("ro", summary.rows[0]);
    // Honest sourcing — absent amount is null, never 0.
    expect(rec.ro?.repair_amount_cents).toBeNull();
    expect(rec.ro?.pay_type).toBeNull();
  });

  it("auto-resolves Advantage2.0 column names through the generic RO path", async () => {
    // A real Advantage2.0/CCI export header set imported end-to-end (parse →
    // suggestMapping → applyMapping → validate → builder); GrossAmount +
    // Cust_Demo_Pay_Type must resolve onto the new repair_amount / pay_type
    // fields and normalize.
    const csv =
      "RepairOrderNumber,LastName,GrossAmount,Cust_Demo_Pay_Type\n9001,Vega,1875.25,Customer Pay\n";
    const res = await previewImport({ kind: "ro", filename: "adv2.csv", buffer: Buffer.from(csv) });
    expect(res.mapping.repair_amount).toBe("GrossAmount");
    expect(res.mapping.pay_type).toBe("Cust_Demo_Pay_Type");

    const rec = toCommitRecord("ro", res.validation.rows[0]);
    expect(rec.ro?.repair_amount_cents).toBe(187525);
    expect(rec.ro?.pay_type).toBe("customer");
  });
});
