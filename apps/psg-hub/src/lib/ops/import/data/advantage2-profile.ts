// PSG-176 — Advantage2.0 / CCI import profile (recommendation A + B of PSG-175).
//
// Real Advantage2.0/CCI exports arrive with **FileMaker field names** (`String3`,
// `FirstName`, `Address1`, `String24`), and/or **MASTER_DisplayName**
// (`Shop_Name`, `Cust_Address_Line_1`), and/or legacy **`RC_*`** column names
// (`RC_Cust_First`). The human-label `MASTER_HEADER_MAPPINGS` (./header-mappings.ts)
// does NOT recognize any of those, so a real export fails auto-mapping — the
// field-name gap blocking pilot import validation (PSG-51).
//
// This profile encodes the workbook's `CCI Import Mapping` column verbatim from
// `docs/import/advantage2.0/field-mapping.csv` as a deterministic alias layer.
// `resolveAdvantage2Header()` resolves any inbound header, in priority order:
//   1. raw FileMaker `FieldName`   (`String3`, `FirstName`, …)
//   2. `MASTER_DisplayName`        (`Shop_Name`, `Cust_Address_Line_1`, …)
//   3. legacy `RC_*` column name   (`RC_Cust_First`, …)
// onto the **canonical-38** vocabulary (../filemaker/canonical-fields.ts).
//
// Recommendation B: two field groups have no canonical-38 home — customer
// **Pay Type** (distinct from `ClaimType`) and the structured **insurance-agent
// sub-record** (agent name first/last + address). Those are routed to
// `repair_orders.payload_jsonb` via `mapAdvantage2Row()`. No migration / no
// canonical-38 change.
//
// Selected when the import profile / `SourceFeed` = Advantage2.0; the
// human-label `MASTER_HEADER_MAPPINGS` remains the default profile for other
// estimating-system exports.

import type { CanonicalField } from "@/lib/ops/import/filemaker/canonical-fields";
import { CANONICAL_FIELDS } from "@/lib/ops/import/filemaker/canonical-fields";
import type { Row } from "@/lib/ops/import/data/types";

/** One canonical-38 field's Advantage2.0 source names (workbook row). */
export interface Advantage2FieldSpec {
  /** canonical-38 target key */
  canonical: CanonicalField;
  /** raw FileMaker `FieldName` */
  fieldName: string;
  /** `MASTER_DisplayName` */
  displayName: string;
  /** legacy `RC_*` column (Repair Customer Mapping), when one exists */
  rcColumn?: string;
}

/**
 * The 37 canonical-38 ↔ Advantage2.0 mappings, verbatim from the workbook's
 * `CCI Import Mapping` column (`docs/import/advantage2.0/field-mapping.csv`).
 * Every member of `CANONICAL_FIELDS` has exactly one entry here (asserted by
 * `assertAdvantage2Coverage()` / the unit suite) — 37/37 coverage.
 */
export const ADVANTAGE2_FIELD_MAP: readonly Advantage2FieldSpec[] = [
  { canonical: "RODataPreparationID", fieldName: "RODataPreparationID", displayName: "RODataPreparationID" },
  { canonical: "RepairOrderID", fieldName: "RepairOrderID", displayName: "RepairOrderID", rcColumn: "RC_SerialNum" },
  { canonical: "CustomerProgramID", fieldName: "CustomerProgramID", displayName: "Cust_Program_ID" },
  { canonical: "RONumber", fieldName: "RepairOrderNumber", displayName: "RO_Number" },
  { canonical: "SourceFeed", fieldName: "String100", displayName: "SourceFeed" },
  { canonical: "OwnerFName", fieldName: "FirstName", displayName: "Cust_Name_First", rcColumn: "RC_Cust_First" },
  { canonical: "OwnerLName", fieldName: "LastName", displayName: "Cust_Name_Last", rcColumn: "RC_Cust_Last" },
  { canonical: "OwnerAddress1", fieldName: "Address1", displayName: "Cust_Address_Line_1", rcColumn: "RC_Cust_Address1" },
  { canonical: "OwnerAddress2", fieldName: "Address2", displayName: "Cust_Address_Line_2", rcColumn: "RC_Cust_Address2" },
  { canonical: "OwnerCity", fieldName: "City", displayName: "Cust_Address_City", rcColumn: "RC_Cust_City" },
  { canonical: "OwnerStateProvince", fieldName: "State", displayName: "Cust_State", rcColumn: "RC_Cust_State" },
  { canonical: "OwnerPostalZip", fieldName: "PostalZip", displayName: "Cust_Zip_Code", rcColumn: "RC_Cust_Zip" },
  { canonical: "OwnerCountryCode", fieldName: "Country", displayName: "Cust_Address_Country" },
  { canonical: "OwnerHomePhone", fieldName: "Phone", displayName: "Cust_Phone_Home" },
  { canonical: "OwnerWorkPhone", fieldName: "WorkPhone", displayName: "Cust_Work_Phone" },
  { canonical: "OwnerCellPhone", fieldName: "MobilePhone", displayName: "Cust_Phone_Mobile" },
  { canonical: "OwnerOtherPhone", fieldName: "OtherPhone", displayName: "Cust_Phone_Other" },
  { canonical: "OwnerDayPhone", fieldName: "DayPhone", displayName: "Cust_Phone_Day" },
  { canonical: "OwnerNightPhone", fieldName: "NightPhone", displayName: "Cust_Phone_Night" },
  { canonical: "OwnerEmail", fieldName: "Email", displayName: "Cust_Address_Email", rcColumn: "RC_EmailAddress" },
  { canonical: "VehicleYear", fieldName: "String24", displayName: "Cust_Vehicle_Year", rcColumn: "RC_Vehicle_Yr" },
  { canonical: "VehicleMake", fieldName: "String25", displayName: "Cust_Vehicle_Make", rcColumn: "RC_Vehicle_Make" },
  { canonical: "VehicleModel", fieldName: "String26", displayName: "Cust_Vehicle_Model", rcColumn: "RC_Vehicle_Model" },
  { canonical: "InsuranceCompany", fieldName: "String13", displayName: "Cust_Ins_Company", rcColumn: "RC_InsuranceCompany" },
  { canonical: "ReferralSourceName", fieldName: "String98", displayName: "Cust_Referral_Source_Name" },
  { canonical: "EstimatorName", fieldName: "String28", displayName: "Shop_Estimator_Name" },
  { canonical: "InsuranceAgentName", fieldName: "InsuranceAgentName", displayName: "Ins_Agent_Full_Name" },
  { canonical: "BUName", fieldName: "String3", displayName: "Shop_Name", rcColumn: "RC_Shop" },
  { canonical: "BusinessKeyPSG", fieldName: "PSGID", displayName: "PSGID", rcColumn: "RC_MatchField_Master" },
  { canonical: "TotalLaborHrs", fieldName: "TotalLaborHours", displayName: "Repair_Labor_Hours" },
  { canonical: "GrossAmount", fieldName: "GrossAmount", displayName: "Repair_Total", rcColumn: "RC_Repair_Dlz" },
  { canonical: "ClaimType", fieldName: "String27", displayName: "Cust_Demo_Claim_Type" },
  { canonical: "VehicleArrivedDate", fieldName: "VehicleArrivedDate", displayName: "Repair_Vehicle_Arrived_Date" },
  { canonical: "RepairStartedDate", fieldName: "RepairStartedDate", displayName: "Repair_Start_Date", rcColumn: "RC_Date_In" },
  { canonical: "DeliveredDate", fieldName: "DeliveredDate", displayName: "Repair_Delivered_Date", rcColumn: "RC_Date_Out" },
  { canonical: "PaintTechFullName", fieldName: "PaintTechnician", displayName: "Shop_Paint_Tech_Full_Name" },
  { canonical: "BodyTechFullName", fieldName: "BodyTechician", displayName: "Shop_Body_Tech_Full_Name" },
];

/** Dotted path under `repair_orders.payload_jsonb` for an overflow field. */
export type Advantage2OverflowPath =
  | "payType"
  | "insuranceAgent.firstName"
  | "insuranceAgent.lastName"
  | "insuranceAgent.address1"
  | "insuranceAgent.address2"
  | "insuranceAgent.city"
  | "insuranceAgent.state"
  | "insuranceAgent.zip";

/** An Advantage2.0 field with no canonical-38 home (→ `payload_jsonb`). */
export interface Advantage2OverflowSpec {
  /** dotted destination path under `payload_jsonb.advantage2` */
  path: Advantage2OverflowPath;
  fieldName: string;
  displayName: string;
  rcColumn?: string;
}

/**
 * Recommendation B — Advantage2.0 fields captured in `repair_orders.payload_jsonb`
 * because canonical-38 has no slot: customer **Pay Type** (distinct from
 * `ClaimType`) and the structured **insurance-agent sub-record** (name +
 * address). Verbatim from §2 of the PSG-175 reconciliation.
 */
export const ADVANTAGE2_OVERFLOW_MAP: readonly Advantage2OverflowSpec[] = [
  { path: "payType", fieldName: "String4", displayName: "Cust_Demo_Pay_Type", rcColumn: "RC_PayType" },
  { path: "insuranceAgent.firstName", fieldName: "String14", displayName: "Ins_Agent_Name_First", rcColumn: "RC_Agent_First" },
  { path: "insuranceAgent.lastName", fieldName: "String15", displayName: "Ins_Agent_Name_Last", rcColumn: "RC_Agent_Last" },
  { path: "insuranceAgent.address1", fieldName: "String16", displayName: "Ins_Agent_Address_1", rcColumn: "RC_Agent_Address" },
  { path: "insuranceAgent.address2", fieldName: "String17", displayName: "Ins_Agent_Address_2", rcColumn: "RC_Agent_Address2" },
  { path: "insuranceAgent.city", fieldName: "String18", displayName: "Ins_Agent_City", rcColumn: "RC_Agent_City" },
  { path: "insuranceAgent.state", fieldName: "String19", displayName: "Ins_Agent_State", rcColumn: "RC_Agent_State" },
  { path: "insuranceAgent.zip", fieldName: "String20", displayName: "Ins_Agent_Zip", rcColumn: "RC_Agent_Zip" },
];

/** Normalize a header for lookup: trim + lowercase (tolerant of case/whitespace). */
function normalizeHeader(header: string): string {
  return header.trim().toLowerCase();
}

type Resolution =
  | { kind: "canonical"; canonical: CanonicalField }
  | { kind: "overflow"; path: Advantage2OverflowPath };

/**
 * Build the priority-ordered lookup index. Earlier layers win on collision:
 * FieldName (1) > MASTER_DisplayName (2) > RC_* (3). Within a layer, canonical
 * and overflow specs are disjoint (verified by the unit suite), so a `set`-once
 * guard is enough to honor the priority order across layers.
 */
function buildIndex(): Map<string, Resolution> {
  const index = new Map<string, Resolution>();
  const put = (raw: string | undefined, res: Resolution) => {
    if (!raw) return;
    const key = normalizeHeader(raw);
    if (!index.has(key)) index.set(key, res);
  };
  // Layer 1 — raw FieldName
  for (const s of ADVANTAGE2_FIELD_MAP) put(s.fieldName, { kind: "canonical", canonical: s.canonical });
  for (const s of ADVANTAGE2_OVERFLOW_MAP) put(s.fieldName, { kind: "overflow", path: s.path });
  // Layer 2 — MASTER_DisplayName
  for (const s of ADVANTAGE2_FIELD_MAP) put(s.displayName, { kind: "canonical", canonical: s.canonical });
  for (const s of ADVANTAGE2_OVERFLOW_MAP) put(s.displayName, { kind: "overflow", path: s.path });
  // Layer 3 — legacy RC_* column name
  for (const s of ADVANTAGE2_FIELD_MAP) put(s.rcColumn, { kind: "canonical", canonical: s.canonical });
  for (const s of ADVANTAGE2_OVERFLOW_MAP) put(s.rcColumn, { kind: "overflow", path: s.path });
  return index;
}

const RESOLUTION_INDEX = buildIndex();

/**
 * Resolve a single Advantage2.0/CCI export header (in any of the 3 namings) to
 * its canonical-38 field, or `null` if it is not part of the import profile
 * (e.g. an `SQ_*` survey-instrument column, or unrelated metadata).
 */
export function resolveAdvantage2Header(header: string): CanonicalField | null {
  const res = RESOLUTION_INDEX.get(normalizeHeader(header));
  return res && res.kind === "canonical" ? res.canonical : null;
}

/** The result of mapping one raw Advantage2.0 row. */
export interface Advantage2MappedRow {
  /** canonical-38 row (only fields present in the source are set) */
  row: Row;
  /**
   * Overflow captured for `repair_orders.payload_jsonb` (recommendation B):
   * `{ payType?, insuranceAgent?: { firstName?, … } }`. Empty values are
   * dropped; an empty object means no overflow present.
   */
  payload: Advantage2Payload;
}

/** Structured overflow destined for `payload_jsonb.advantage2`. */
export interface Advantage2Payload {
  payType?: string;
  insuranceAgent?: {
    firstName?: string;
    lastName?: string;
    address1?: string;
    address2?: string;
    city?: string;
    state?: string;
    zip?: string;
  };
}

function setOverflow(payload: Advantage2Payload, path: Advantage2OverflowPath, value: string): void {
  if (path === "payType") {
    payload.payType = value;
    return;
  }
  const key = path.slice("insuranceAgent.".length) as keyof NonNullable<Advantage2Payload["insuranceAgent"]>;
  payload.insuranceAgent ??= {};
  payload.insuranceAgent[key] = value;
}

/**
 * Map a raw Advantage2.0/CCI export row (header → value, in any of the 3
 * namings) onto a canonical-38 `Row` plus the `payload_jsonb` overflow.
 *
 * - Canonical fields resolve via `resolveAdvantage2Header` (FieldName >
 *   MASTER_DisplayName > RC_*).
 * - Pay Type + the insurance-agent sub-record route to `payload`.
 * - Blank/whitespace-only values are skipped (no empty canonical keys, no empty
 *   overflow entries) — keeps the canonical row and payload clean for dedup.
 * - Unrecognized headers (survey `SQ_*`, demographics, metadata) are ignored.
 */
export function mapAdvantage2Row(raw: Record<string, string | null | undefined>): Advantage2MappedRow {
  const row: Row = {};
  const payload: Advantage2Payload = {};
  for (const [header, rawValue] of Object.entries(raw)) {
    if (rawValue == null) continue;
    const value = String(rawValue).trim();
    if (value.length === 0) continue;
    const res = RESOLUTION_INDEX.get(normalizeHeader(header));
    if (!res) continue;
    if (res.kind === "canonical") {
      row[res.canonical] = value;
    } else {
      setOverflow(payload, res.path, value);
    }
  }
  return { row, payload };
}

/**
 * Assert the profile covers all 37 canonical-38 fields exactly once. Throws on
 * any gap, duplicate, or stray (non-canonical) target. Called by the unit suite;
 * exported so callers can fail fast at startup if desired.
 */
export function assertAdvantage2Coverage(): void {
  const canonicalSet = new Set<string>(CANONICAL_FIELDS);
  const seen = new Set<string>();
  for (const spec of ADVANTAGE2_FIELD_MAP) {
    if (!canonicalSet.has(spec.canonical)) {
      throw new Error(`Advantage2 profile maps unknown canonical field: ${spec.canonical}`);
    }
    if (seen.has(spec.canonical)) {
      throw new Error(`Advantage2 profile maps canonical field twice: ${spec.canonical}`);
    }
    seen.add(spec.canonical);
  }
  const missing = CANONICAL_FIELDS.filter((f) => !seen.has(f));
  if (missing.length > 0) {
    throw new Error(`Advantage2 profile missing canonical fields: ${missing.join(", ")}`);
  }
}
