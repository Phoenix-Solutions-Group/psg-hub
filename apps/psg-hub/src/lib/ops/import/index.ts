// v1.1 / PSG-38 — RO/Estimate Import orchestration (public surface).
//
// Ties the pipeline together: parse -> (suggest|apply) mapping -> validate, and
// shapes validated rows into the customer + RO/estimate insert payloads the
// commit route writes. Importing from "@/lib/ops/import" gives callers the whole
// module without reaching into individual files.

import {
  CCC_BMS_PAYLOAD_FIELD,
  bmsEstimatePayloadJsonb,
  bmsRepairOrderPayloadJsonb,
  bmsXmlToCanonical,
  canonicalToRawTable,
  parseCarriedEstimate,
} from "@/lib/ccc-secure-share/bms";
import { dollarsToCents, normalizePayType, type PayType } from "./amounts";
import { parseFile } from "./parse";
import { applyMapping, suggestMapping } from "./template";
import { validateRecords } from "./validate";
import type {
  FieldMapping,
  ImportKind,
  RawTable,
  ValidatedRow,
  ValidationSummary,
} from "./types";

export * from "./types";
export { fieldsFor, requiredFields } from "./fields";
export { suggestMapping, applyMapping, missingRequiredMappings } from "./template";
export {
  parseFile,
  detectFormat,
  detectCiecaInterchange,
  UnsupportedSpreadsheetError,
  CiecaInterchangeError,
  NonTabularSpreadsheetError,
} from "./parse";
export { validateRecords } from "./validate";
export {
  resolveAddress,
  normalizeState,
  normalizeZip,
  normalizePhone,
  normalizeStreet,
} from "./address";

export type PreviewResult = {
  table: { format: RawTable["format"]; headers: string[]; rowCount: number };
  mapping: FieldMapping;
  validation: ValidationSummary;
};

/**
 * Parse an uploaded file into a RawTable for the given kind. Tabular kinds
 * (ro/estimate) route to the generic format parser; `ccc_estimate` routes to the
 * CIECA BMS parser/mapper (PSG-261), which projects the estimate document onto a
 * single canonical-keyed row. This is the one kind-aware step — the rest of the
 * pipeline (suggest/validate/normalize/commit) is shared across kinds.
 */
export async function parseImportTable(
  kind: ImportKind,
  filename: string,
  buffer: Buffer,
): Promise<RawTable> {
  if (kind === "ccc_estimate") {
    return canonicalToRawTable(bmsXmlToCanonical(buffer.toString("utf8")));
  }
  return parseFile(filename, buffer);
}

/**
 * Full preview from an uploaded file. When `mapping` is omitted, columns are
 * auto-resolved from the headers (smart resolution); callers can then let the
 * operator adjust before commit.
 */
export async function previewImport(args: {
  kind: ImportKind;
  filename: string;
  buffer: Buffer;
  mapping?: FieldMapping;
}): Promise<PreviewResult> {
  const table = await parseImportTable(args.kind, args.filename, args.buffer);
  const mapping = args.mapping ?? suggestMapping(args.kind, table.headers);
  const records = applyMapping(table, mapping);
  const validation = validateRecords(args.kind, mapping, records);
  return {
    table: { format: table.format, headers: table.headers, rowCount: table.rows.length },
    mapping,
    validation,
  };
}

export type CustomerInsert = {
  first_name: string;
  last_name: string;
  phone: string | null;
  email: string | null;
  address: Record<string, string | null>;
};

export type CommitRecord = {
  index: number;
  customer: CustomerInsert;
  /** RO fields when kind=ro. */
  ro?: {
    ro_number: string;
    total_loss_flag: boolean;
    dates_json: Record<string, string>;
    payload_jsonb: Record<string, unknown>;
    vehicle_make: string | null;
    vehicle_model: string | null;
    /**
     * Canonical invoiced amount in integer cents (PSG-352). null = not sourced
     * from this importer — never coerced to 0 (honest sourcing). The raw
     * per-source figure is also retained in payload_jsonb for audit.
     */
    repair_amount_cents: number | null;
    /** Canonical normalized pay type (PSG-352); null when none/unrecognized. */
    pay_type: PayType | null;
  };
  /** Estimate fields when kind=estimate. */
  estimate?: {
    estimate_number: string;
    payload_jsonb: Record<string, unknown>;
  };
};

function str(v: ValidatedRow["values"][string]): string | null {
  return v == null ? null : String(v);
}

/** Shape a validated row into commit-ready insert payloads. */
export function toCommitRecord(kind: ImportKind, row: ValidatedRow): CommitRecord {
  const v = row.values;
  const customer: CustomerInsert = {
    first_name: str(v.customer_first_name) ?? "",
    last_name: str(v.customer_last_name) ?? "",
    phone: str(v.customer_phone),
    email: str(v.customer_email),
    address: {
      line1: str(v.address_line1),
      line2: str(v.address_line2),
      city: str(v.address_city),
      state: str(v.address_state),
      postal_code: str(v.address_zip),
    },
  };

  if (kind === "ccc_estimate") {
    // The full canonical estimate rode through validate in the reserved carry
    // column; recover it to build payload_jsonb. A CCC estimate carries both an
    // estimate and (when present) its RO, so we emit both insert payloads.
    const canonical = parseCarriedEstimate(str(v[CCC_BMS_PAYLOAD_FIELD]));
    const record: CommitRecord = {
      index: row.index,
      customer,
      estimate: {
        estimate_number: str(v.estimate_number) ?? "",
        payload_jsonb: canonical
          ? bmsEstimatePayloadJsonb(canonical)
          : { source: "ccc_secure_share_bms" },
      },
    };
    const roNumber = str(v.ro_number);
    if (roNumber) {
      record.ro = {
        ro_number: roNumber,
        total_loss_flag: false,
        dates_json: {},
        vehicle_make: str(v.vehicle_make),
        vehicle_model: str(v.vehicle_model),
        payload_jsonb: canonical
          ? bmsRepairOrderPayloadJsonb(canonical)
          : { source: "ccc_secure_share_bms" },
        // PSG-352: canonical invoiced-$ from the BMS grand total (null when the
        // estimate carries none — never 0). bms.totals.grandTotal also stays in
        // payload_jsonb (bmsRepairOrderPayloadJsonb) for audit/back-compat.
        repair_amount_cents: dollarsToCents(canonical?.totals.grandTotal ?? null),
        // PSG-352 (Ada review, divergence #2): the commit route sets no
        // insurance linkage on the RO, so pay_type is the only channel by which
        // CCC/BMS insurance dollars reach the Volume pay-type breakdown. A CCC/DRP
        // estimate carrying a claim number IS an insurance job — this is a
        // derivation from recorded data (bms.claim.number), not a fabrication
        // (same insurer-signal pattern shipped in PSG-48). No claim number → NULL
        // (honest no-signal, never a bogus bucket).
        pay_type: canonical?.claimNumber ? "insurance" : null,
      };
    }
    return record;
  }

  if (kind === "ro") {
    const dates: Record<string, string> = {};
    if (v.date_in) dates.date_in = String(v.date_in);
    if (v.date_out) dates.date_out = String(v.date_out);
    // PSG-352: optional generic-RO amount + pay-type. repair_amount is a number
    // field (validate already coerces "$1,234.56" → 1234.56); pay_type is a free
    // string normalized onto the canonical bucket. Both null when absent. Real
    // Advantage2.0 exports imported through the generic RO path resolve here:
    // GrossAmount/Repair_Total → repair_amount, Cust_Demo_Pay_Type/RC_PayType →
    // pay_type (see fields.ts aliases).
    const repairAmount = typeof v.repair_amount === "number" ? v.repair_amount : null;
    const rawPayType = str(v.pay_type);
    // PSG-352: keep the RAW pay-type token in payload_jsonb.advantage2.payType
    // (the path the PSG-46 `audit` report reads) so that path stays truthful for
    // newly-imported rows, alongside the normalized canonical column below.
    const payload: Record<string, unknown> = { source: "import" };
    if (rawPayType) payload.advantage2 = { payType: rawPayType };
    return {
      index: row.index,
      customer,
      ro: {
        ro_number: str(v.ro_number) ?? "",
        total_loss_flag: v.total_loss_flag === true,
        dates_json: dates,
        vehicle_make: str(v.vehicle_make),
        vehicle_model: str(v.vehicle_model),
        payload_jsonb: payload,
        repair_amount_cents: dollarsToCents(repairAmount),
        pay_type: normalizePayType(rawPayType),
      },
    };
  }

  return {
    index: row.index,
    customer,
    estimate: {
      estimate_number: str(v.estimate_number) ?? "",
      payload_jsonb: {
        source: "import",
        total: v.estimate_total ?? null,
        estimate_date: v.estimate_date ?? null,
      },
    },
  };
}
