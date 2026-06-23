// PSG-261 / CCC Secure Share Phase 1B — BMS estimate domain core (public surface).
//
// Pure parser + mapper for CIECA BMS estimate XML, plus the thin adapters that
// let the ops import backbone treat a BMS document as a `ccc_estimate` import
// (parse → suggest → validate → normalize → commit). No I/O here.
//
// A BMS estimate is a single rich document, not a tabular list. The import
// pipeline is row-oriented, so `canonicalToRawTable` projects the estimate onto
// a one-row table whose headers are canonical field keys (scalar identity /
// vehicle / owner / totals). The line items, supplements, totals breakdown and
// every BMS-specific extra ride along in a single reserved carry column
// (CCC_BMS_PAYLOAD_FIELD) as JSON, so they survive validate and reach
// toCommitRecord, which lands them in payload_jsonb under the dotted-path
// namespace documented in ./README.md.

import type { RawTable } from "@/lib/ops/import/types";
import { mapBmsEstimate } from "./mapper";
import { parseBmsEstimateXml } from "./parser";
import type { BmsLineItem, BmsSupplement, CccCanonicalEstimate } from "./types";

export { parseXml, XmlParseError, type XmlNode } from "./xml";
export { parseBmsEstimateXml, BmsParseError } from "./parser";
export { mapBmsEstimate } from "./mapper";
export type {
  CccCanonicalEstimate,
  BmsLineItem,
  BmsLineKind,
  BmsSupplement,
  BmsVehicle,
  BmsTotals,
  BmsOwner,
} from "./types";

/**
 * Reserved canonical field key that carries the full structured BMS estimate
 * (as JSON) through the row-oriented import pipeline so non-tabular data (line
 * items, supplements, overflow) reaches commit. It is a system field, not an
 * operator-mapped column.
 */
export const CCC_BMS_PAYLOAD_FIELD = "ccc_bms_payload";

/** Parse + map BMS estimate XML straight to the canonical estimate. */
export function bmsXmlToCanonical(xml: string): CccCanonicalEstimate {
  return mapBmsEstimate(parseBmsEstimateXml(xml));
}

/**
 * Project a canonical estimate onto a single-row {@link RawTable}. Headers are
 * canonical field keys so suggestMapping auto-resolves them 1:1; the reserved
 * carry column holds the whole estimate as JSON.
 */
export function canonicalToRawTable(estimate: CccCanonicalEstimate): RawTable {
  const row: Record<string, string> = {};
  const set = (key: string, value: string | number | null): void => {
    if (value === null || value === "") return;
    row[key] = String(value);
  };

  set("estimate_number", estimate.estimateNumber);
  set("ro_number", estimate.roNumber);
  set("claim_number", estimate.claimNumber);
  set("estimate_status", estimate.status);
  set("facility_id", estimate.facilityId);
  set("vehicle_vin", estimate.vehicle.vin);
  set("vehicle_year", estimate.vehicle.year);
  set("vehicle_make", estimate.vehicle.make);
  set("vehicle_model", estimate.vehicle.model);
  set("estimate_total", estimate.totals.grandTotal);
  set("customer_first_name", estimate.owner.firstName);
  set("customer_last_name", estimate.owner.lastName);
  set("customer_phone", estimate.owner.phone);
  set("customer_email", estimate.owner.email);
  set("address_line1", estimate.owner.address1);
  set("address_line2", estimate.owner.address2);
  set("address_city", estimate.owner.city);
  set("address_state", estimate.owner.state);
  set("address_zip", estimate.owner.zip);

  row[CCC_BMS_PAYLOAD_FIELD] = JSON.stringify(estimate);

  return { format: "xml", headers: Object.keys(row), rows: [row] };
}

/** Recover the canonical estimate from the reserved carry column. */
export function parseCarriedEstimate(json: string | null | undefined): CccCanonicalEstimate | null {
  if (!json) return null;
  try {
    return JSON.parse(json) as CccCanonicalEstimate;
  } catch {
    return null;
  }
}

function lineItemJson(line: BmsLineItem): Record<string, unknown> {
  return {
    lineNumber: line.lineNumber,
    kind: line.kind,
    operation: line.operation,
    description: line.description,
    quantity: line.quantity,
    hours: line.hours,
    unitPrice: line.unitPrice,
    extendedPrice: line.extendedPrice,
    partNumber: line.partNumber,
    extra: line.extra,
  };
}

function supplementJson(s: BmsSupplement): Record<string, unknown> {
  return { number: s.number, sequence: s.sequence, date: s.date, extra: s.extra };
}

/**
 * Build the estimates.payload_jsonb overflow for a canonical estimate. Flat
 * dotted-path keys under the `bms.` namespace (see ./README.md); structured
 * collections (line items, supplements) ride under their own dotted key.
 */
export function bmsEstimatePayloadJsonb(estimate: CccCanonicalEstimate): Record<string, unknown> {
  const payload: Record<string, unknown> = {
    source: "ccc_secure_share_bms",
    "bms.estimate.number": estimate.estimateNumber,
    "bms.estimate.status": estimate.status,
    "bms.ro.number": estimate.roNumber,
    "bms.claim.number": estimate.claimNumber,
    "bms.facility.id": estimate.facilityId,
    "bms.facility.name": estimate.facilityName,
    "bms.vehicle.vin": estimate.vehicle.vin,
    "bms.vehicle.year": estimate.vehicle.year,
    "bms.vehicle.make": estimate.vehicle.make,
    "bms.vehicle.model": estimate.vehicle.model,
    "bms.totals.parts": estimate.totals.parts,
    "bms.totals.labor": estimate.totals.labor,
    "bms.totals.paint": estimate.totals.paint,
    "bms.totals.tax": estimate.totals.tax,
    "bms.totals.grandTotal": estimate.totals.grandTotal,
    "bms.lineItems": estimate.lineItems.map(lineItemJson),
    "bms.supplements": estimate.supplements.map(supplementJson),
  };
  // Spread the mapper's already-dotted overflow (bms.vehicle.bodyStyle, etc.).
  for (const [k, v] of Object.entries(estimate.overflow)) payload[k] = v;
  return payload;
}

/**
 * Build the repair_orders.payload_jsonb overflow — a focused subset that links
 * the RO to its estimate/claim and carries the headline figures.
 */
export function bmsRepairOrderPayloadJsonb(estimate: CccCanonicalEstimate): Record<string, unknown> {
  return {
    source: "ccc_secure_share_bms",
    "bms.estimate.number": estimate.estimateNumber,
    "bms.estimate.status": estimate.status,
    "bms.claim.number": estimate.claimNumber,
    "bms.vehicle.vin": estimate.vehicle.vin,
    "bms.totals.grandTotal": estimate.totals.grandTotal,
  };
}
