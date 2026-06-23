// W0 / PSG-223 — Direct-mail send-history importer: shared types.
//
// The send-history importer decodes a FileMaker / production-center send export
// (today: the dated production-center envelope batch) and maps each addressed
// recipient to a public.mail_send_history row, per spec
// docs/specs/002-mail-send-history-w0/spec.md §3.1.
//
// PII posture (AC4): raw name/address live ONLY on ParsedRecipient (the staging
// shape) and are dropped once the persistable MailSendHistoryRecord — which
// carries only salted hashes — is built.

/** The numbered legacy pieces PSG's Master Follow-Up Program mails. */
export type PieceVariant = "letter" | "envelope" | "warranty" | "survey";

/**
 * A recipient block parsed out of a production-center envelope artifact, BEFORE
 * normalization/validation. Carries raw PII — never persisted, never logged.
 */
export type ParsedRecipient = {
  /** PSGID token printed on the piece, e.g. 'PS218' — the stable shop key. */
  psgid: string;
  /** Recipient name line as printed, e.g. 'Mr. Stephen Moore'. */
  rawName: string;
  /** Street/unit line(s) as printed (0..n). */
  rawStreetLines: string[];
  /** The 'City, State ZIP' line as printed, when present. */
  rawCityStateZip: string | null;
  /** Position of this block within its source file (1-based) — for reconciliation. */
  index: number;
};

/** Why a parsed recipient block could not be persisted. */
export type RejectReason =
  | "missing_psgid"
  | "missing_name"
  | "missing_street"
  | "unparseable_city_state_zip";

/** A persistable public.mail_send_history row. No raw PII. */
export type MailSendHistoryRecord = {
  shop_name: string;
  ro_number: string | null;
  piece_code: string;
  piece_variant: PieceVariant | null;
  sent_date: string; // ISO date 'YYYY-MM-DD'
  recipient_hash: string;
  household_key: string;
  batch_ref: string | null;
  send_ref: string;
  source: string;
};

/** One rejected block, with enough context to fix the source. */
export type RejectedRecipient = {
  file: string;
  index: number;
  reason: RejectReason;
  /** Redaction-safe hint: piece + which fields were present (no raw PII). */
  detail: string;
};

/** Per-file reconciliation breakdown. */
export type FileReconciliation = {
  file: string;
  pieceCode: string;
  pieceVariant: PieceVariant | null;
  blocksParsed: number;
  accepted: number;
  rejected: number;
};

/**
 * AC1 reconciliation report: source-rows-in vs persisted vs rejected-with-reason.
 * Invariant: sourceRowsIn === persisted + deduplicated + rejected.
 */
export type ReconciliationReport = {
  batchRef: string | null;
  /** Total recipient blocks parsed across all source files. */
  sourceRowsIn: number;
  /** Unique records ready to upsert (after send_ref dedup). */
  persisted: number;
  /** Blocks collapsed because they shared a send_ref (idempotency, not an error). */
  deduplicated: number;
  /** Blocks that could not be mapped to a record. */
  rejected: number;
  /** Count by reject reason. */
  rejectedByReason: Record<RejectReason, number>;
  /** Per-file breakdown. */
  files: FileReconciliation[];
  /** Full rejection detail (PII-safe). */
  rejectedDetail: RejectedRecipient[];
};

/** Output of an import run: the records + the reconciliation report. */
export type SendHistoryImportResult = {
  records: MailSendHistoryRecord[];
  report: ReconciliationReport;
};
