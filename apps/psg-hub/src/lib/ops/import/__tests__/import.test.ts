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
});
