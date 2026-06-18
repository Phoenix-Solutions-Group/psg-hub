// v1.4 / PSG-28 — Operational Reports framework: shared types.
//
// The framework is data-source-agnostic. Every one of the 26 (+1) named
// operational reports is declared exactly once as a ReportDefinition
// (metadata + parameter spec + columns + an async `run`), registered in
// registry.ts, and executed by runner.ts. Export (CSV / Excel / PDF) operates
// purely on the returned ReportResult — see export.ts.
//
// B1 dependency: the backing ops tables (companies / repair_orders / surveys —
// PSG-25 v1.1 Ops Foundation) are not built yet. Reports therefore declare a
// `dataStatus`; until their tables land, the runner serves deterministic
// `sampleRows` so the framework is fully exercisable end-to-end (the v1.4
// Phase-1 testable: "each report renders with sample data, parameterized
// correctly, exports cleanly"). Wiring each report's real `run()` is the
// mechanical fast-follow once B1 lands.

export type ReportBatchId =
  | "volume-invoicing"
  | "survey-csi"
  | "customer-insurance"
  | "individual-survey";

export type ColumnType =
  | "string"
  | "number"
  | "currency"
  | "percent"
  | "date"
  | "datetime";

export type ReportColumn = {
  key: string;
  label: string;
  type: ColumnType;
  /** Display alignment; defaults derived from type (numbers right, else left). */
  align?: "left" | "right" | "center";
};

export type FilterType = "string" | "enum" | "shop" | "number";

export type ReportFilterSpec = {
  key: string;
  label: string;
  type: FilterType;
  /** For `enum` filters. */
  options?: { value: string; label: string }[];
  required?: boolean;
};

export type ReportParamSpec = {
  /** Almost always true. A few point-in-time snapshot reports may set false. */
  dateRange: boolean;
  filters: ReportFilterSpec[];
};

/** Resolved + validated params handed to run(). */
export type ReportParams = {
  start: string | null; // 'YYYY-MM-DD'
  end: string | null; // 'YYYY-MM-DD'
  filters: Record<string, string>;
};

export type ReportCell = string | number | null;
export type ReportRow = Record<string, ReportCell>;

export type ReportResult = {
  columns: ReportColumn[];
  rows: ReportRow[];
  /** Optional summary footer (totals etc.), keyed by column. */
  totals?: ReportRow | null;
  /**
   * True when these rows are illustrative sample data because the report's
   * backing ops tables (B1 / PSG-25) are not live yet.
   */
  sample: boolean;
  generatedAt: string; // ISO, injected by the caller — keeps the path deterministic in tests
};

/**
 * Minimal DB surface the reports need. Typed loosely so pure unit tests can
 * pass a stub and so the lib does not hard-depend on the Supabase client.
 */
export type ReportDb = {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  from: (table: string) => any;
};

export type ReportContext = {
  /** Service/server Supabase surface, or null in sample/test mode. */
  db: ReportDb | null;
  /** Staff shop scope: a list of shop ids, or null for all shops. */
  shopIds: string[] | null;
  generatedAt: string;
};

export type DataStatus = "available" | "pending-data";

export type ReportDefinition = {
  slug: string;
  title: string;
  batch: ReportBatchId;
  description: string;
  params: ReportParamSpec;
  columns: ReportColumn[];
  /**
   * Whether the report's backing data exists yet. `pending-data` reports are
   * blocked on B1 (PSG-25 ops tables) and run from sample data only.
   */
  dataStatus: DataStatus;
  /**
   * Real data fn. The runner calls it only when dataStatus === 'available' AND
   * ctx.db is non-null; otherwise it falls back to sampleRows.
   */
  run?: (params: ReportParams, ctx: ReportContext) => Promise<ReportRow[]>;
  /** Deterministic sample rows for framework demonstration + tests. */
  sampleRows: (params: ReportParams) => ReportRow[];
};

export type ReportBatch = { id: ReportBatchId; label: string; order: number };

export const BATCHES: ReportBatch[] = [
  { id: "volume-invoicing", label: "Volume & Invoicing", order: 1 },
  { id: "survey-csi", label: "Survey & CSI", order: 2 },
  { id: "customer-insurance", label: "Customer & Insurance", order: 3 },
  { id: "individual-survey", label: "Individual Survey Responses", order: 4 },
];
