// v1.1 / PSG-38 — RO/Estimate Import: shared types.
//
// This module absorbs the standalone `psg-import` utility into the ops backbone
// as a first-class Data Import module. The flow is:
//
//   upload file  ->  parse to a RawTable (headers + string rows)
//                ->  apply a per-company field mapping (template)
//                ->  validate + normalize against the canonical RO/Estimate
//                    field catalog (incl. address validation + smart-resolution)
//                ->  preview (row-level errors/warnings)  ->  commit.
//
// Templates live in public.import_templates (company_id, kind, name,
// field_mapping_jsonb). The field_mapping maps a canonical target field key to
// the source column header it should read from.

// "ccc_estimate" ingests a CIECA BMS estimate XML document (CCC Secure Share,
// PSG-261) rather than a tabular RO/estimate list — its parse step routes to the
// BMS parser/mapper in src/lib/ccc-secure-share/bms; the rest of the pipeline
// (suggest/validate/normalize/commit) is shared with the tabular kinds.
export type ImportKind = "ro" | "estimate" | "ccc_estimate";

/**
 * Supported upload encodings. csv/txt parse natively; the spreadsheet formats
 * (xlsx/xlsm/xlsb, legacy binary xls, and Excel-2003 SpreadsheetML xml) decode
 * through SheetJS. Real pilot RO exports ship in all of these (PSG-51b).
 */
export type ImportFileFormat = "csv" | "txt" | "xlsx" | "xlsb" | "xls" | "xml";

/** A parsed file: ordered headers + rows keyed by header. Values are strings. */
export type RawTable = {
  format: ImportFileFormat;
  headers: string[];
  rows: Array<Record<string, string>>;
};

/**
 * field_mapping_jsonb shape: canonical target field key -> source column header.
 * e.g. { "ro_number": "RO #", "customer_last_name": "Last Name" }.
 */
export type FieldMapping = Record<string, string>;

/** One canonical target field a template can map onto. */
export type FieldDef = {
  /** Stable key used in field_mapping_jsonb and downstream records. */
  key: string;
  /** Human label shown in the mapping UI. */
  label: string;
  /** Required fields fail validation when blank/unmapped. */
  required: boolean;
  /** Coercion + validation applied to the source value. */
  type: "string" | "number" | "boolean" | "date" | "phone" | "email" | "zip" | "state";
  /**
   * Lowercased header fragments used to auto-suggest a mapping ("smart
   * resolution" of columns). First alias that a header contains wins.
   */
  aliases: string[];
  /** Optional help text for the mapping UI. */
  hint?: string;
};

/** A single normalized + validated import row, ready for preview/commit. */
export type ValidatedRow = {
  /** 1-based source row index (excludes the header row). */
  index: number;
  /** Canonical field key -> coerced value (string | number | boolean | null). */
  values: Record<string, string | number | boolean | null>;
  /** Hard failures that block commit for this row. */
  errors: string[];
  /** Non-blocking notes (e.g. an address that was auto-corrected). */
  warnings: string[];
};

export type ValidationSummary = {
  kind: ImportKind;
  total: number;
  valid: number;
  invalid: number;
  rows: ValidatedRow[];
  /** Canonical fields with no source column mapped. */
  unmappedRequired: string[];
};
