import { readFileSync } from "node:fs";
import { describe, it, expect } from "vitest";
import {
  parseXml,
  XmlParseError,
  decodeEntities,
  child,
  text,
  find,
} from "@/lib/ccc-secure-share/bms/xml";
import { parseBmsEstimateXml, BmsParseError } from "@/lib/ccc-secure-share/bms/parser";
import {
  bmsXmlToCanonical,
  canonicalToRawTable,
  bmsEstimatePayloadJsonb,
  CCC_BMS_PAYLOAD_FIELD,
} from "@/lib/ccc-secure-share/bms";
import { previewImport, toCommitRecord, parseImportTable, CiecaInterchangeError } from "@/lib/ops/import";

const FIXTURE = readFileSync(
  new URL("../__fixtures__/sample-estimate.bms.xml", import.meta.url),
  "utf8",
);

describe("xml reader", () => {
  it("decodes the five predefined entities and numeric refs", () => {
    expect(decodeEntities("a &amp; b &lt;c&gt; &quot;d&quot; &apos;e&apos;")).toBe(
      `a & b <c> "d" 'e'`,
    );
    expect(decodeEntities("&#65;&#x42;")).toBe("AB");
    expect(decodeEntities("no entities")).toBe("no entities");
  });

  it("parses elements, attributes, nesting, text, and self-closing tags", () => {
    const root = parseXml(
      `<?xml version="1.0"?><Root a="1" ns:b="two"><Child>hi</Child><Empty/></Root>`,
    );
    expect(root.name).toBe("Root");
    expect(root.attributes.a).toBe("1");
    expect(root.attributes.b).toBe("two"); // namespace prefix stripped
    expect(text(root, "Child")).toBe("hi");
    expect(child(root, "Empty")?.children).toEqual([]);
  });

  it("handles CDATA and comments", () => {
    const root = parseXml(`<R><!-- c --><V><![CDATA[a < b & c]]></V></R>`);
    expect(text(root, "V")).toBe("a < b & c");
  });

  it("throws on a mismatched close tag and on missing root", () => {
    expect(() => parseXml(`<a><b></a>`)).toThrow(XmlParseError);
    expect(() => parseXml(`   `)).toThrow(XmlParseError);
  });

  it("find() locates a descendant by local name", () => {
    const root = parseXml(`<A><B><C>x</C></B></A>`);
    expect(find(root, "C")?.text).toBe("x");
    expect(find(root, "Z")).toBeUndefined();
  });
});

describe("parseBmsEstimateXml", () => {
  it("accepts a BMS estimate document", () => {
    expect(() => parseBmsEstimateXml(FIXTURE)).not.toThrow();
  });

  it("rejects empty and non-estimate XML", () => {
    expect(() => parseBmsEstimateXml("")).toThrow(BmsParseError);
    expect(() => parseBmsEstimateXml(`<?xml version="1.0"?><Catalog><Item>x</Item></Catalog>`)).toThrow(
      BmsParseError,
    );
  });
});

describe("BMS estimate -> canonical mapper", () => {
  const est = bmsXmlToCanonical(FIXTURE);

  it("maps identity / RO / claim / status / facility", () => {
    expect(est.estimateNumber).toBe("EST-2025-0001");
    expect(est.roNumber).toBe("RO-88231");
    expect(est.claimNumber).toBe("CLM-553201");
    expect(est.status).toBe("Supplement");
    expect(est.facilityId).toBe("PS1042");
    expect(est.facilityName).toBe("Demo Body Shop");
  });

  it("maps the vehicle", () => {
    expect(est.vehicle).toEqual({
      vin: "1HGCM82633A004352",
      year: "2003",
      make: "Honda",
      model: "Accord",
    });
  });

  it("maps the owner (raw — normalization happens in validate)", () => {
    expect(est.owner.firstName).toBe("Jordan");
    expect(est.owner.lastName).toBe("Rivera");
    expect(est.owner.phone).toBe("(555) 123-4567");
    expect(est.owner.email).toBe("jordan.rivera@example.com");
    expect(est.owner.address1).toBe("123 Main St");
    expect(est.owner.city).toBe("Omaha");
    expect(est.owner.state).toBe("NE");
    expect(est.owner.zip).toBe("68102");
  });

  it("maps totals (parts / labor / paint / tax / grand total)", () => {
    expect(est.totals).toEqual({
      parts: 433.5,
      labor: 260,
      paint: 45,
      tax: 35.2,
      grandTotal: 773.7,
    });
  });

  it("maps multi-line parts / labor / paint with classification", () => {
    expect(est.lineItems).toHaveLength(5);
    expect(est.lineItems.map((l) => l.kind)).toEqual(["part", "part", "labor", "labor", "paint"]);

    const bumper = est.lineItems[0];
    expect(bumper.operation).toBe("Repl");
    expect(bumper.description).toBe("Front bumper cover");
    expect(bumper.partNumber).toBe("04711-T2A-A90");
    expect(bumper.quantity).toBe(1);
    expect(bumper.unitPrice).toBe(345.5);
    expect(bumper.extendedPrice).toBe(345.5);
    expect(bumper.extra.PartType).toBe("OEM");

    const labor = est.lineItems[2];
    expect(labor.operation).toBe("R&I"); // entity-decoded
    expect(labor.hours).toBe(2.5);
    expect(labor.extra.LaborType).toBe("Body");

    const paint = est.lineItems[4];
    expect(paint.kind).toBe("paint");
    expect(paint.hours).toBe(2);
  });

  it("maps a supplement with sequence linkage", () => {
    expect(est.supplements).toHaveLength(1);
    const s = est.supplements[0];
    expect(s.number).toBe("1");
    expect(s.sequence).toBe(1);
    expect(s.date).toBe("2025-09-12");
    expect(s.extra.SupplementReason).toContain("hidden damage");
  });

  it("routes non-canonical fields to dotted-path overflow", () => {
    expect(est.overflow["bms.vehicle.bodyStyle"]).toBe("4D Sedan");
    expect(est.overflow["bms.vehicle.odometer"]).toBe("84210");
    expect(est.overflow["bms.claim.insuranceCompany"]).toBe("Acme Mutual Insurance");
    expect(est.overflow["bms.claim.lossType"]).toBe("Collision");
    expect(est.overflow["bms.document.version"]).toBe("BMS 4.0");
  });
});

describe("canonicalToRawTable", () => {
  it("projects onto a single row keyed by canonical field keys + carry column", () => {
    const table = canonicalToRawTable(bmsXmlToCanonical(FIXTURE));
    expect(table.format).toBe("xml");
    expect(table.rows).toHaveLength(1);
    expect(table.rows[0].estimate_number).toBe("EST-2025-0001");
    expect(table.rows[0].vehicle_vin).toBe("1HGCM82633A004352");
    expect(table.headers).toContain(CCC_BMS_PAYLOAD_FIELD);
  });
});

describe("ccc_estimate import kind — parse -> suggest -> validate -> normalize -> commit", () => {
  const buffer = Buffer.from(FIXTURE, "utf8");

  it("routes BMS XML to the BMS parser for ccc_estimate only", async () => {
    const table = await parseImportTable("ccc_estimate", "estimate.xml", buffer);
    expect(table.rows[0].estimate_number).toBe("EST-2025-0001");
    // The generic kinds still reject a BMS document with re-export guidance.
    await expect(parseImportTable("estimate", "estimate.xml", buffer)).rejects.toBeInstanceOf(
      CiecaInterchangeError,
    );
  });

  it("auto-resolves the canonical headers and validates the estimate", async () => {
    const res = await previewImport({ kind: "ccc_estimate", filename: "estimate.xml", buffer });
    expect(res.table.rowCount).toBe(1);
    expect(res.mapping.estimate_number).toBe("estimate_number");
    expect(res.mapping.ro_number).toBe("ro_number");
    expect(res.mapping.vehicle_vin).toBe("vehicle_vin");
    expect(res.validation.valid).toBe(1);
    expect(res.validation.unmappedRequired).toEqual([]);
  });

  it("commits to estimate + repair_orders payloads with overflow", async () => {
    const res = await previewImport({ kind: "ccc_estimate", filename: "estimate.xml", buffer });
    const rec = toCommitRecord("ccc_estimate", res.validation.rows[0]);

    // Customer is built from the validated/normalized scalar fields.
    expect(rec.customer.first_name).toBe("Jordan");
    expect(rec.customer.last_name).toBe("Rivera");
    expect(rec.customer.phone).toBe("5551234567"); // normalized in validate
    expect(rec.customer.address.state).toBe("NE");
    expect(rec.customer.address.postal_code).toBe("68102");

    // Estimate insert + payload_jsonb overflow.
    expect(rec.estimate?.estimate_number).toBe("EST-2025-0001");
    const payload = rec.estimate?.payload_jsonb as Record<string, unknown>;
    expect(payload.source).toBe("ccc_secure_share_bms");
    expect(payload["bms.claim.number"]).toBe("CLM-553201");
    expect(payload["bms.totals.grandTotal"]).toBe(773.7);
    expect((payload["bms.lineItems"] as unknown[]).length).toBe(5);
    expect((payload["bms.supplements"] as unknown[]).length).toBe(1);
    expect(payload["bms.vehicle.bodyStyle"]).toBe("4D Sedan");
    // No owner PII leaks into payload_jsonb (owner -> customer insert only).
    expect(JSON.stringify(payload)).not.toContain("Jordan");

    // The RO that the estimate carries is emitted too.
    expect(rec.ro?.ro_number).toBe("RO-88231");
    expect(rec.ro?.vehicle_make).toBe("Honda");
    expect(rec.ro?.vehicle_model).toBe("Accord");
    expect((rec.ro?.payload_jsonb as Record<string, unknown>)["bms.estimate.number"]).toBe(
      "EST-2025-0001",
    );
  });

  it("verifies bmsEstimatePayloadJsonb keys directly", () => {
    const payload = bmsEstimatePayloadJsonb(bmsXmlToCanonical(FIXTURE));
    expect(payload["bms.facility.id"]).toBe("PS1042");
    expect(payload["bms.totals.parts"]).toBe(433.5);
  });
});
