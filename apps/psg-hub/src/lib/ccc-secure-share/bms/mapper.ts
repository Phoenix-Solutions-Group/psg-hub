// PSG-261 / CCC Secure Share Phase 1B — BMS tree → canonical estimate mapper.
//
// Stage 2 of the domain core. Reads the validated BMS tree (./parser.ts) and
// projects it onto the canonical CccCanonicalEstimate (./types.ts), modelled on
// the CIECA BMS data dictionary. Fields with no canonical home are collected
// into `overflow`/`extra` under the stable dotted-path namespace documented in
// ./README.md. Pure, no I/O.
//
// Element names follow the public BMS data dictionary. Where the dictionary
// admits synonyms across versions/vendors, each `pick(...)` lists the accepted
// aliases (most-specific first). This will be reconciled against a real CCC
// Secure Share export in Phase 2 (see ./README.md + fixture note).

import { child, find, text, type XmlNode } from "./xml";
import type {
  BmsLineItem,
  BmsLineKind,
  BmsOwner,
  BmsSupplement,
  BmsTotals,
  BmsVehicle,
  CccCanonicalEstimate,
} from "./types";

// ── Coercion helpers ─────────────────────────────────────────────────────────

/** Parse a money/number string ("$1,234.50" -> 1234.5); null when not numeric. */
function num(raw: string): number | null {
  const cleaned = raw.replace(/[$,\s]/g, "");
  if (cleaned === "") return null;
  const n = Number(cleaned);
  return Number.isFinite(n) ? n : null;
}

/** Trim to ISO yyyy-mm-dd when parseable; else the raw trimmed string; else null. */
function isoDate(raw: string): string | null {
  const v = raw.trim();
  if (!v) return null;
  const t = Date.parse(v);
  return Number.isNaN(t) ? v : new Date(t).toISOString().slice(0, 10);
}

/** Trimmed string, or null when blank. */
function nz(raw: string): string | null {
  const v = raw.trim();
  return v ? v : null;
}

/** First non-empty direct-child text among the given local names. */
function pick(parent: XmlNode | undefined, ...names: string[]): string {
  for (const name of names) {
    const t = text(parent, name);
    if (t) return t;
  }
  return "";
}

/** Record a non-blank value into the overflow map under a dotted path. */
function put(overflow: Record<string, string>, path: string, value: string): void {
  const v = value.trim();
  if (v) overflow[path] = v;
}

// ── Line-item classification ──────────────────────────────────────────────────

function classifyLine(lineType: string, operation: string): BmsLineKind {
  const t = lineType.toLowerCase();
  if (t.includes("part")) return "part";
  if (t.includes("refinish") || t.includes("paint")) return "paint";
  if (t.includes("labor") || t.includes("labour")) return "labor";
  const op = operation.toLowerCase();
  if (op.includes("refinish") || op.includes("paint")) return "paint";
  return "other";
}

const LINE_CANONICAL_ELEMENTS = new Set(
  [
    "LineNumber",
    "LineType",
    "OperationCode",
    "Operation",
    "LineDescription",
    "Description",
    "PartNumber",
    "Quantity",
    "Qty",
    "LaborHours",
    "Hours",
    "UnitPrice",
    "ExtendedPrice",
    "TotalPrice",
  ].map((s) => s.toLowerCase()),
);

/** Collect leaf child elements not already consumed canonically, keyed by name. */
function collectExtra(node: XmlNode, consumed: Set<string>): Record<string, string> {
  const extra: Record<string, string> = {};
  for (const c of node.children) {
    if (consumed.has(c.name.toLowerCase())) continue;
    if (c.children.length > 0) continue; // only flat leaf attributes
    const v = c.text.trim();
    if (v) extra[c.name] = v;
  }
  return extra;
}

function mapLineItem(node: XmlNode): BmsLineItem {
  const operation = pick(node, "OperationCode", "Operation");
  const lineType = pick(node, "LineType");
  return {
    lineNumber: num(pick(node, "LineNumber")),
    kind: classifyLine(lineType, operation),
    operation: nz(operation),
    description: nz(pick(node, "LineDescription", "Description")),
    quantity: num(pick(node, "Quantity", "Qty")),
    hours: num(pick(node, "LaborHours", "Hours")),
    unitPrice: num(pick(node, "UnitPrice")),
    extendedPrice: num(pick(node, "ExtendedPrice", "TotalPrice")),
    partNumber: nz(pick(node, "PartNumber")),
    extra: collectExtra(node, LINE_CANONICAL_ELEMENTS),
  };
}

const SUPPLEMENT_CANONICAL_ELEMENTS = new Set(
  ["SupplementNumber", "SupplementSequenceNumber", "SequenceNumber", "SupplementDate", "Date"].map(
    (s) => s.toLowerCase(),
  ),
);

function mapSupplement(node: XmlNode): BmsSupplement {
  return {
    number: nz(pick(node, "SupplementNumber")),
    sequence: num(pick(node, "SupplementSequenceNumber", "SequenceNumber")),
    date: isoDate(pick(node, "SupplementDate", "Date")),
    extra: collectExtra(node, SUPPLEMENT_CANONICAL_ELEMENTS),
  };
}

function mapVehicle(root: XmlNode, overflow: Record<string, string>): BmsVehicle {
  const v = find(root, "VehicleInfo");
  const vehicle: BmsVehicle = {
    vin: nz(pick(v, "VIN", "VINNumber")),
    year: nz(pick(v, "ModelYear", "Year", "VehicleYear")),
    make: nz(pick(v, "MakeDescription", "Make", "MakeName")),
    model: nz(pick(v, "ModelName", "Model")),
  };
  if (v) {
    put(overflow, "bms.vehicle.bodyStyle", pick(v, "BodyStyle"));
    put(overflow, "bms.vehicle.exteriorColor", pick(v, "ExteriorColor", "Color"));
    put(overflow, "bms.vehicle.odometer", pick(v, "Odometer", "Mileage"));
    put(overflow, "bms.vehicle.licensePlate", pick(v, "LicensePlate", "Plate"));
    put(overflow, "bms.vehicle.engine", pick(v, "Engine", "EngineDescription"));
    put(overflow, "bms.vehicle.trim", pick(v, "Trim", "SubModel"));
  }
  return vehicle;
}

function mapOwner(root: XmlNode): BmsOwner {
  const owner = find(root, "Owner");
  const person = child(owner, "PersonInfo") ?? owner;
  const contact = child(owner, "ContactInfo") ?? owner;
  const addr = child(owner, "Address") ?? owner;
  return {
    firstName: nz(pick(person, "FirstName", "GivenName")),
    lastName: nz(pick(person, "LastName", "Surname", "FamilyName", "CompanyName")),
    phone: nz(pick(contact, "Phone", "PhoneNumber", "CellPhone")),
    email: nz(pick(contact, "Email", "EmailAddress")),
    address1: nz(pick(addr, "Address1", "AddressLine1", "Street")),
    address2: nz(pick(addr, "Address2", "AddressLine2")),
    city: nz(pick(addr, "City")),
    state: nz(pick(addr, "StateProvince", "State")),
    zip: nz(pick(addr, "PostalCode", "Zip", "PostalZip")),
  };
}

function mapTotals(root: XmlNode): BmsTotals {
  const totals = find(root, "RepairTotalsInfo");
  const summary = child(totals, "SummaryTotalsInfo") ?? totals;
  return {
    parts: num(pick(summary, "PartsAmount", "PartsTotalAmount", "TotalPartsAmount")),
    labor: num(pick(summary, "LaborAmount", "LaborTotalAmount", "TotalLaborAmount")),
    paint: num(
      pick(summary, "PaintMaterialsAmount", "PaintMaterialAmount", "PaintMaterialsTotalAmount"),
    ),
    tax: num(pick(summary, "TaxAmount", "TaxTotalAmount", "TotalTaxAmount")),
    grandTotal: num(pick(summary, "NetTotalAmount", "GrandTotalAmount", "TotalAmount")),
  };
}

/**
 * Map a validated BMS estimate tree onto the canonical estimate. Never throws on
 * missing fields — absent values become null/[] so partial estimates still map
 * (validation downstream decides what is required).
 */
export function mapBmsEstimate(root: XmlNode): CccCanonicalEstimate {
  const overflow: Record<string, string> = {};

  const adminInfo = find(root, "AdminInfo") ?? root;
  const estimateInfo = find(adminInfo, "EstimateInfo");
  const claimInfo = find(adminInfo, "ClaimInfo");
  const facility = find(adminInfo, "RepairFacility");
  const docInfo = find(root, "DocumentInfo");

  // Document-level overflow.
  if (docInfo) {
    put(overflow, "bms.document.id", pick(docInfo, "DocumentID", "DocumentId"));
    put(overflow, "bms.document.type", pick(docInfo, "DocumentType"));
    put(overflow, "bms.document.version", pick(docInfo, "DocumentVersion"));
    put(overflow, "bms.document.createDateTime", pick(docInfo, "CreateDateTime", "CreatedDateTime"));
  }

  // Claim overflow (claim number is canonical; the rest is overflow).
  if (claimInfo) {
    put(overflow, "bms.claim.policyNumber", pick(claimInfo, "PolicyNumber"));
    put(overflow, "bms.claim.lossType", pick(claimInfo, "LossType"));
    put(overflow, "bms.claim.deductible", pick(claimInfo, "DeductibleAmount", "Deductible"));
    const insurer = find(claimInfo, "InsuranceCompany");
    put(overflow, "bms.claim.insuranceCompany", pick(insurer, "CompanyName", "Name"));
  }

  // Facility overflow (id + name are canonical; address etc. overflow).
  if (facility) {
    const fAddr = find(facility, "Address");
    put(overflow, "bms.facility.city", pick(fAddr, "City"));
    put(overflow, "bms.facility.state", pick(fAddr, "StateProvince", "State"));
  }

  // Lines may sit directly under the document or under a <DamageInfo> wrapper —
  // collect every <DamageLineInfo> descendant either way, in document order.
  const lineItems = findAllDamageLines(root).map(mapLineItem);
  const supplements = findAllSupplements(adminInfo).map(mapSupplement);

  return {
    estimateNumber: nz(pick(estimateInfo, "EstimateID", "EstimateNumber")),
    roNumber: nz(
      pick(estimateInfo, "RepairOrderNumber", "RONumber") || pick(adminInfo, "RepairOrderNumber"),
    ),
    claimNumber: nz(pick(claimInfo, "ClaimNumber", "ClaimNo")),
    status: nz(pick(estimateInfo, "EstimateStatus", "Status")),
    facilityId: nz(pick(facility, "FacilityID", "FacilityId", "BusinessKeyPSG", "PSGID")),
    facilityName: nz(pick(facility, "BusinessName", "Name", "FacilityName")),
    vehicle: mapVehicle(root, overflow),
    owner: mapOwner(root),
    totals: mapTotals(root),
    lineItems,
    supplements,
    overflow,
  };
}

/** All <DamageLineInfo> descendants anywhere under the document. */
function findAllDamageLines(root: XmlNode): XmlNode[] {
  const out: XmlNode[] = [];
  const walk = (n: XmlNode): void => {
    for (const c of n.children) {
      if (c.name.toLowerCase() === "damagelineinfo") out.push(c);
      else walk(c);
    }
  };
  walk(root);
  return out;
}

/** All <SupplementInfo> descendants anywhere under admin info. */
function findAllSupplements(root: XmlNode): XmlNode[] {
  const out: XmlNode[] = [];
  const walk = (n: XmlNode): void => {
    for (const c of n.children) {
      if (c.name.toLowerCase() === "supplementinfo") out.push(c);
      else walk(c);
    }
  };
  walk(root);
  return out;
}
