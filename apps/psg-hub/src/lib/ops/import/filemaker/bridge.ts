// PSG-133 — Bridge: psg-hub canonical-38 (../fields.ts) -> import-repo canonical.
//
// The harvested Layer-2 map (canonical-fields.ts) is keyed on the import repo's
// canonical vocabulary (OwnerFName, RONumber, ...). psg-hub's OWN import module
// (ported by PSG-38, ../fields.ts) uses a different canonical vocabulary
// (customer_first_name, ro_number, ...). This module is the small, psg-hub-side
// glue that lets the v1.3 cutover (PSG-44) feed real psg-hub RO rows into the
// Import Flush v5 exporter. It is NOT harvested IP — it is local integration.
//
// Only psg-hub canonical keys that have a downstream FM target (i.e. appear in
// CANONICAL_TO_FM_MAP) are bridged. psg-hub fields with no FM home are listed in
// HUB_FIELDS_WITHOUT_FM_TARGET for PSG-44 to decide on before cutover.

import type { ValidatedRow } from "../types";
import type { CanonicalRow } from "./export-flush";

/** psg-hub canonical field key -> import-repo canonical field key. */
export const HUB_TO_IMPORT_CANONICAL: Record<string, string> = {
  customer_first_name: "OwnerFName",
  customer_last_name: "OwnerLName",
  customer_phone: "OwnerCellPhone",
  customer_email: "OwnerEmail",
  address_line1: "OwnerAddress1",
  address_line2: "OwnerAddress2",
  address_city: "OwnerCity",
  address_state: "OwnerStateProvince",
  address_zip: "OwnerPostalZip",
  ro_number: "RONumber",
  vehicle_make: "VehicleMake",
  vehicle_model: "VehicleModel",
  date_in: "VehicleArrivedDate",
  date_out: "DeliveredDate",
  estimate_total: "GrossAmount",
};

/**
 * psg-hub canonical fields that currently have NO Import Flush target through
 * the harvested map. Surfaced so PSG-44 can decide whether the FM layout needs
 * R_TotalLoss / estimate columns wired before cutover.
 */
export const HUB_FIELDS_WITHOUT_FM_TARGET = [
  "total_loss_flag",
  "estimate_number",
  "estimate_date",
] as const;

function toStr(v: string | number | boolean | null | undefined): string {
  if (v == null) return "";
  return String(v);
}

/**
 * Convert one psg-hub validated import row into an import-repo CanonicalRow that
 * the Import Flush exporter understands. Unmapped psg-hub keys are dropped (they
 * have no FM target); FM columns with no source flush to "" downstream.
 */
export function hubRowToCanonical(values: ValidatedRow["values"]): CanonicalRow {
  const out: CanonicalRow = {};
  for (const [hubKey, importKey] of Object.entries(HUB_TO_IMPORT_CANONICAL)) {
    if (hubKey in values) out[importKey] = toStr(values[hubKey]);
  }
  return out;
}

/** Convert many psg-hub validated rows into import-repo CanonicalRows. */
export function hubRowsToCanonical(rows: ValidatedRow[]): CanonicalRow[] {
  return rows.map((r) => hubRowToCanonical(r.values));
}
