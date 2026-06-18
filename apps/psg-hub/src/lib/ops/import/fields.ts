// v1.1 / PSG-38 — Canonical target-field catalog for RO/Estimate import.
//
// These are the fields a per-company template can map source columns onto. The
// `aliases` drive smart column auto-resolution (see template.suggestMapping).
// Required fields gate commit; address parts are optional but, when present,
// flow through address validation + smart-resolution.

import type { FieldDef, ImportKind } from "./types";

const CUSTOMER_FIELDS: FieldDef[] = [
  {
    key: "customer_first_name",
    label: "Customer first name",
    required: true,
    type: "string",
    aliases: ["first name", "firstname", "fname", "first"],
  },
  {
    key: "customer_last_name",
    label: "Customer last name",
    required: true,
    type: "string",
    aliases: ["last name", "lastname", "lname", "last", "surname"],
  },
  {
    key: "customer_phone",
    label: "Customer phone",
    required: false,
    type: "phone",
    aliases: ["phone", "cell", "mobile", "telephone", "contact number"],
  },
  {
    key: "customer_email",
    label: "Customer email",
    required: false,
    type: "email",
    aliases: ["email", "e-mail", "mail"],
  },
  {
    key: "address_line1",
    label: "Address line 1",
    required: false,
    type: "string",
    aliases: ["address", "street", "addr", "address 1", "address line 1", "line1"],
  },
  {
    key: "address_line2",
    label: "Address line 2",
    required: false,
    type: "string",
    aliases: ["address 2", "address line 2", "line2", "unit", "apt", "suite"],
  },
  {
    key: "address_city",
    label: "City",
    required: false,
    type: "string",
    aliases: ["city", "town"],
  },
  {
    key: "address_state",
    label: "State",
    required: false,
    type: "state",
    aliases: ["state", "province", "st"],
  },
  {
    key: "address_zip",
    label: "ZIP",
    required: false,
    type: "zip",
    aliases: ["zip", "postal", "postcode", "zip code", "postal code"],
  },
];

const RO_FIELDS: FieldDef[] = [
  ...CUSTOMER_FIELDS,
  {
    key: "ro_number",
    label: "RO number",
    required: true,
    type: "string",
    aliases: ["ro #", "ro number", "ro no", "ro#", "repair order", "ro"],
  },
  {
    key: "vehicle_make",
    label: "Vehicle make",
    required: false,
    type: "string",
    aliases: ["make", "vehicle make", "veh make"],
  },
  {
    key: "vehicle_model",
    label: "Vehicle model",
    required: false,
    type: "string",
    aliases: ["model", "vehicle model", "veh model"],
  },
  {
    key: "total_loss_flag",
    label: "Total loss",
    required: false,
    type: "boolean",
    aliases: ["total loss", "tl", "totaled", "total_loss"],
  },
  {
    key: "date_in",
    label: "Date in",
    required: false,
    type: "date",
    aliases: ["date in", "in date", "received", "drop off", "dropoff"],
  },
  {
    key: "date_out",
    label: "Date out",
    required: false,
    type: "date",
    aliases: ["date out", "out date", "delivered", "completed", "completion"],
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

const CATALOG: Record<ImportKind, FieldDef[]> = {
  ro: RO_FIELDS,
  estimate: ESTIMATE_FIELDS,
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
