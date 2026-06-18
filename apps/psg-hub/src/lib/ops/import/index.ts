// v1.1 / PSG-38 — RO/Estimate Import orchestration (public surface).
//
// Ties the pipeline together: parse -> (suggest|apply) mapping -> validate, and
// shapes validated rows into the customer + RO/estimate insert payloads the
// commit route writes. Importing from "@/lib/ops/import" gives callers the whole
// module without reaching into individual files.

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
export { parseFile, detectFormat, UnsupportedSpreadsheetError } from "./parse";
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
  const table = await parseFile(args.filename, args.buffer);
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

  if (kind === "ro") {
    const dates: Record<string, string> = {};
    if (v.date_in) dates.date_in = String(v.date_in);
    if (v.date_out) dates.date_out = String(v.date_out);
    return {
      index: row.index,
      customer,
      ro: {
        ro_number: str(v.ro_number) ?? "",
        total_loss_flag: v.total_loss_flag === true,
        dates_json: dates,
        vehicle_make: str(v.vehicle_make),
        vehicle_model: str(v.vehicle_model),
        payload_jsonb: { source: "import" },
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
