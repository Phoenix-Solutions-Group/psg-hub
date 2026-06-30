// v1.1 / PSG-38 — Canonical target-field catalog for RO/Estimate import.
//
// These are the fields a per-company template can map source columns onto. The
// `aliases` drive smart column auto-resolution (see template.suggestMapping).
// Required fields gate commit; address parts are optional but, when present,
// flow through address validation + smart-resolution.
//
// Aliases include the PSG canonical export names (the `Owner*` / `Vehicle*`
// vocabulary emitted by CCC ONE and the FileMaker bridge — see
// docs/Filemaker Exports). They are listed in their exact concatenated form
// (e.g. "ownerstateprovince") so the resolver matches them whole-header and
// never has to guess from a loose substring. (PSG-51 real-export hardening.)

import { CCC_BMS_PAYLOAD_FIELD } from "@/lib/ccc-secure-share/bms";
import type { FieldDef, ImportKind } from "./types";

const CUSTOMER_FIELDS: FieldDef[] = [
  {
    // Optional: commercial / fleet ROs (e.g. "OMAHA GLASS CO", "CARMAX") carry
    // the business name in the last-name field with no personal first name.
    // Last name is the required identity anchor; see customer_last_name.
    // (PSG-51 real-export hardening.)
    key: "customer_first_name",
    label: "Customer first name",
    required: false,
    type: "string",
    aliases: ["first name", "firstname", "fname", "first", "ownerfname", "owner first name"],
  },
  {
    // Required identity anchor — holds the person's surname OR, for commercial /
    // fleet repair orders, the business name.
    key: "customer_last_name",
    label: "Customer last name",
    required: true,
    type: "string",
    aliases: ["last name", "lastname", "lname", "last", "surname", "ownerlname", "owner last name"],
  },
  {
    key: "customer_phone",
    label: "Customer phone",
    required: false,
    type: "phone",
    // "phone1" / "phone 1" cover the FileMaker RC primary-phone column
    // (RC_Phone1) so the customer phone locks onto it over a secondary phone.
    // (PSG-461.)
    aliases: ["phone", "phone1", "phone 1", "cell", "mobile", "telephone", "contact number", "ownercellphone", "owner cell phone"],
  },
  {
    key: "customer_email",
    label: "Customer email",
    required: false,
    type: "email",
    aliases: ["email", "e-mail", "mail", "owneremail", "owner email"],
  },
  {
    key: "address_line1",
    label: "Address line 1",
    required: false,
    type: "string",
    aliases: ["address", "address1", "street", "addr", "address 1", "address line 1", "line1", "owneraddress1", "owner address 1"],
  },
  {
    key: "address_line2",
    label: "Address line 2",
    required: false,
    type: "string",
    aliases: ["address2", "address 2", "address line 2", "line2", "unit", "apt", "suite", "owneraddress2", "owner address 2"],
  },
  {
    key: "address_city",
    label: "City",
    required: false,
    type: "string",
    aliases: ["city", "town", "ownercity", "owner city"],
  },
  {
    key: "address_state",
    label: "State",
    required: false,
    type: "state",
    aliases: ["state", "province", "st", "ownerstateprovince", "owner state province", "owner state"],
  },
  {
    key: "address_zip",
    label: "ZIP",
    required: false,
    type: "zip",
    aliases: ["zip", "postal", "postcode", "zip code", "postal code", "ownerpostalzip", "owner postal zip", "owner zip"],
  },
];

const RO_FIELDS: FieldDef[] = [
  ...CUSTOMER_FIELDS,
  {
    key: "ro_number",
    label: "RO number",
    required: true,
    type: "string",
    aliases: ["ro #", "ro number", "ro no", "ro#", "repair order", "ro", "ronumber", "ro number(s)"],
  },
  {
    key: "vehicle_make",
    label: "Vehicle make",
    required: false,
    type: "string",
    aliases: ["make", "vehicle make", "veh make", "vehiclemake"],
  },
  {
    key: "vehicle_model",
    label: "Vehicle model",
    required: false,
    type: "string",
    aliases: ["model", "vehicle model", "veh model", "vehiclemodel"],
  },
  {
    key: "total_loss_flag",
    label: "Total loss",
    required: false,
    type: "boolean",
    aliases: ["total loss", "tl", "totaled", "total_loss", "totalloss"],
  },
  {
    // PSG-352 — optional canonical invoiced amount. Aliases include the
    // Advantage2.0/CCI source names (GrossAmount / Repair_Total / RC_Repair_Dlz)
    // so a real Advantage2 export imported through the generic RO path resolves
    // here; coerced to cents (dollarsToCents) at commit. Absent → null, never 0.
    key: "repair_amount",
    label: "Repair amount",
    required: false,
    type: "number",
    aliases: [
      "repair amount",
      "amount",
      "gross amount",
      "grossamount",
      "repair total",
      "repair_total",
      "rc repair dlz",
      "rc_repair_dlz",
      "invoice total",
      "invoiced amount",
    ],
  },
  {
    // PSG-352 — optional pay type, normalized onto the canonical bucket
    // (insurance/customer/internal/warranty) at commit. Aliases cover the
    // Advantage2.0 source names (Cust_Demo_Pay_Type / RC_PayType / String4).
    key: "pay_type",
    label: "Pay type",
    required: false,
    type: "string",
    aliases: [
      "pay type",
      "paytype",
      "pay_type",
      "cust demo pay type",
      "cust_demo_pay_type",
      "rc paytype",
      "rc_paytype",
      "payment type",
    ],
  },
  {
    key: "date_in",
    label: "Date in",
    required: false,
    type: "date",
    aliases: ["date in", "in date", "received", "drop off", "dropoff", "vehiclearriveddate", "vehicle arrived date", "vehicle arrived", "arrived"],
  },
  {
    key: "date_out",
    label: "Date out",
    required: false,
    type: "date",
    aliases: ["date out", "out date", "delivered", "completed", "completion", "delivereddate", "delivered date"],
  },
];

const ESTIMATE_FIELDS: FieldDef[] = [
  ...CUSTOMER_FIELDS,
  {
    key: "estimate_number",
    label: "Estimate number",
    required: true,
    type: "string",
    aliases: ["estimate #", "estimate number", "est #", "est no", "estimate", "est"],
  },
  {
    key: "estimate_total",
    label: "Estimate total",
    required: false,
    type: "number",
    aliases: ["total", "estimate total", "amount", "grand total", "est total"],
  },
  {
    key: "estimate_date",
    label: "Estimate date",
    required: false,
    type: "date",
    aliases: ["date", "estimate date", "est date", "written"],
  },
];

// CCC Secure Share estimate (CIECA BMS XML) — PSG-261. The BMS parser/mapper
// projects an estimate onto a single row keyed by these canonical field keys, so
// the headers it emits auto-resolve 1:1; the aliases also let a flattened CCC
// *tabular* export resolve through the same catalog later. The reserved carry
// field (CCC_BMS_PAYLOAD_FIELD) ferries the non-tabular detail (line items,
// supplements, BMS overflow) through validate to toCommitRecord — it is a system
// field, never an operator-mapped column.
const CCC_ESTIMATE_FIELDS: FieldDef[] = [
  ...CUSTOMER_FIELDS,
  {
    key: "estimate_number",
    label: "Estimate number",
    required: true,
    type: "string",
    aliases: ["estimate #", "estimate number", "estimate id", "est #", "est no", "estimate", "est"],
  },
  {
    key: "ro_number",
    label: "RO number",
    required: false,
    type: "string",
    aliases: ["ro #", "ro number", "repair order number", "ro no", "ro#", "repair order", "ro"],
  },
  {
    key: "claim_number",
    label: "Claim number",
    required: false,
    type: "string",
    aliases: ["claim #", "claim number", "claim no", "claim", "claimnumber"],
  },
  {
    key: "vehicle_vin",
    label: "VIN",
    required: false,
    type: "string",
    aliases: ["vin", "vin number", "vehicle vin", "vinnumber"],
  },
  {
    key: "vehicle_year",
    label: "Vehicle year",
    required: false,
    type: "string",
    aliases: ["year", "model year", "vehicle year", "modelyear"],
  },
  {
    key: "vehicle_make",
    label: "Vehicle make",
    required: false,
    type: "string",
    aliases: ["make", "vehicle make", "veh make", "vehiclemake", "make description"],
  },
  {
    key: "vehicle_model",
    label: "Vehicle model",
    required: false,
    type: "string",
    aliases: ["model", "vehicle model", "veh model", "vehiclemodel", "model name"],
  },
  {
    key: "estimate_status",
    label: "Estimate status",
    required: false,
    type: "string",
    aliases: ["status", "estimate status", "est status", "estimatestatus"],
  },
  {
    key: "estimate_total",
    label: "Estimate total",
    required: false,
    type: "number",
    aliases: ["total", "estimate total", "net total", "grand total", "amount", "est total"],
  },
  {
    // System carry field — see CCC_BMS_PAYLOAD_FIELD. Holds the full canonical
    // estimate JSON so non-tabular detail reaches commit; not shown for manual
    // mapping. Its unique key never collides with a real CCC/BMS header.
    key: CCC_BMS_PAYLOAD_FIELD,
    label: "CCC BMS payload (system)",
    required: false,
    type: "string",
    aliases: ["ccc bms payload"],
  },
];

const CATALOG: Record<ImportKind, FieldDef[]> = {
  ro: RO_FIELDS,
  estimate: ESTIMATE_FIELDS,
  ccc_estimate: CCC_ESTIMATE_FIELDS,
};

export function fieldsFor(kind: ImportKind): FieldDef[] {
  return CATALOG[kind];
}

export function requiredFields(kind: ImportKind): FieldDef[] {
  return CATALOG[kind].filter((f) => f.required);
}

export function fieldByKey(kind: ImportKind, key: string): FieldDef | undefined {
  return CATALOG[kind].find((f) => f.key === key);
}
