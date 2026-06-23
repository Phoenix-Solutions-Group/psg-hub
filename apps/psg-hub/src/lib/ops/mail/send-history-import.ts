// W0 / PSG-223 — Send-history importer + reconciliation report (spec §3.1, AC1).
//
// Maps the raw recipient blocks parsed out of a production-center send batch to
// persistable public.mail_send_history records and emits a reconciliation report:
// source-rows-in vs persisted vs deduplicated vs rejected-with-reason.
//
// The importer is a pure function: file contents + a MailHasher in, records +
// report out. It performs NO DB I/O and defines NO hashing of its own — the
// caller injects the ONE shared MailHasher (src/lib/ops/mail/household.ts,
// PSG-221) so mail_send_history keys match mail_suppression's exactly (spec
// §3.1/§3.2). Live wiring (service-client upsert ON CONFLICT (send_ref)) is a
// later, G4-gated step, exactly as the RO importer (PSG-132/139) shipped
// additive-and-unwired. Raw PII is consumed here and dropped: only salted hashes
// survive onto MailSendHistoryRecord (AC4).

import type { AddressInput } from "../import/address";
import {
  parseEnvelopeFilename,
  parseEnvelopeMarkdown,
  splitCityStateZip,
} from "./parse-production-batch";
import type {
  FileReconciliation,
  MailHasher,
  MailSendHistoryRecord,
  ParsedRecipient,
  RejectReason,
  RejectedRecipient,
  ReconciliationReport,
  SendHistoryImportResult,
} from "./types";

/** One source file handed to the importer. */
export type EnvelopeSource = {
  /** Filename (used for piece metadata + reconciliation labels), e.g. '13-envelope-09-07.md'. */
  filename: string;
  /** Raw markdown content of the envelope artifact. */
  content: string;
};

export type ImportOptions = {
  /** Send date for every row in the batch, ISO 'YYYY-MM-DD' (the batch date). */
  sentDate: string;
  /** Production-center batch id, e.g. '2021-09-07'. Defaults to sentDate. */
  batchRef?: string;
  source?: string;
};

const EMPTY_REASON_COUNTS = (): Record<RejectReason, number> => ({
  missing_psgid: 0,
  missing_name: 0,
  missing_street: 0,
  unparseable_city_state_zip: 0,
});

type ResolvedOptions = Required<Pick<ImportOptions, "sentDate" | "batchRef" | "source">>;

/**
 * Build a persistable record from one parsed recipient block, or a rejection.
 * Validation order mirrors what a human would check on an envelope: a shop code,
 * a name, a street, and a parseable city/state/zip. The injected hasher turns the
 * raw name+address into the salted keys; the raw values never leave this function.
 */
function buildRecord(
  block: ParsedRecipient,
  meta: { pieceCode: string; pieceVariant: MailSendHistoryRecord["piece_variant"] },
  opts: ResolvedOptions,
  hasher: MailHasher,
): { record: MailSendHistoryRecord } | { reason: RejectReason } {
  if (!block.psgid) return { reason: "missing_psgid" };
  if (!block.rawName.trim()) return { reason: "missing_name" };
  if (block.rawStreetLines.length === 0) return { reason: "missing_street" };

  const csz = splitCityStateZip(block.rawCityStateZip);
  if (!csz) return { reason: "unparseable_city_state_zip" };

  // Raw address parts handed to the shared hasher, which owns USPS normalization
  // (so "123 Main St" === "123 Main Street" collapse to one household). line2
  // carries any unit line; line1 is the street.
  const address: AddressInput = {
    line1: block.rawStreetLines[0] ?? null,
    line2: block.rawStreetLines.slice(1).join(" ") || null,
    city: csz.city,
    state: csz.state,
    zip: csz.zip,
  };

  const recipientHash = hasher.recipientHash(block.rawName, address);
  const householdKey = hasher.householdKey(address);
  // A hasher returns "" for an unusable address; treat as an unparseable address.
  if (!recipientHash || !householdKey) {
    return { reason: "unparseable_city_state_zip" };
  }

  const shopName = block.psgid;
  const sendRef = `${shopName}:${recipientHash}:${meta.pieceCode}:${opts.sentDate}`;

  return {
    record: {
      shop_name: shopName,
      ro_number: null,
      piece_code: meta.pieceCode,
      piece_variant: meta.pieceVariant,
      sent_date: opts.sentDate,
      recipient_hash: recipientHash,
      household_key: householdKey,
      batch_ref: opts.batchRef,
      send_ref: sendRef,
      source: opts.source,
    },
  };
}

/**
 * Import a whole production-center send batch (multiple envelope artifacts) into
 * mail_send_history records + a reconciliation report. send_ref-duplicate blocks
 * are collapsed (idempotency, not an error) and counted separately from rejects.
 *
 * @param hasher the shared salted-key contract — production passes household.ts
 *   (PSG-221) so keys match mail_suppression; tests pass a deterministic stand-in.
 */
export function importSendBatch(
  sources: EnvelopeSource[],
  options: ImportOptions,
  hasher: MailHasher,
): SendHistoryImportResult {
  const opts: ResolvedOptions = {
    sentDate: options.sentDate,
    batchRef: options.batchRef ?? options.sentDate,
    source: options.source ?? "filemaker",
  };

  const bySendRef = new Map<string, MailSendHistoryRecord>();
  const files: FileReconciliation[] = [];
  const rejectedDetail: RejectedRecipient[] = [];
  const rejectedByReason = EMPTY_REASON_COUNTS();
  let sourceRowsIn = 0;
  let deduplicated = 0;
  let rejected = 0;

  for (const source of sources) {
    const meta = parseEnvelopeFilename(source.filename);
    // Only the addressed *envelope* component is a send record; skip the letter/
    // warranty/survey content components (their recipients are a subset of the
    // envelope's, and counting them would double-count the send).
    if (!meta || meta.pieceVariant !== "envelope") continue;

    const blocks = parseEnvelopeMarkdown(source.content);
    let accepted = 0;
    let fileRejected = 0;

    for (const block of blocks) {
      sourceRowsIn += 1;
      const out = buildRecord(block, meta, opts, hasher);
      if ("reason" in out) {
        rejected += 1;
        fileRejected += 1;
        rejectedByReason[out.reason] += 1;
        rejectedDetail.push({
          file: source.filename,
          index: block.index,
          reason: out.reason,
          // PII-safe: piece + which fields were present, never the raw values.
          detail:
            `piece=${meta.pieceCode} ` +
            `name=${block.rawName ? "present" : "missing"} ` +
            `street=${block.rawStreetLines.length} ` +
            `csz=${block.rawCityStateZip ? "present" : "missing"}`,
        });
        continue;
      }
      if (bySendRef.has(out.record.send_ref)) {
        deduplicated += 1;
        continue;
      }
      bySendRef.set(out.record.send_ref, out.record);
      accepted += 1;
    }

    files.push({
      file: source.filename,
      pieceCode: meta.pieceCode,
      pieceVariant: meta.pieceVariant,
      blocksParsed: blocks.length,
      accepted,
      rejected: fileRejected,
    });
  }

  const records = [...bySendRef.values()];
  const report: ReconciliationReport = {
    batchRef: opts.batchRef,
    sourceRowsIn,
    persisted: records.length,
    deduplicated,
    rejected,
    rejectedByReason,
    files,
    rejectedDetail,
  };

  return { records, report };
}

/** Render the reconciliation report as a human-readable block (for logs/docs). */
export function formatReconciliationReport(report: ReconciliationReport): string {
  const lines: string[] = [
    `Send-history reconciliation — batch ${report.batchRef ?? "(unknown)"}`,
    `  source rows in: ${report.sourceRowsIn}`,
    `  persisted:      ${report.persisted}`,
    `  deduplicated:   ${report.deduplicated}`,
    `  rejected:       ${report.rejected}`,
  ];
  for (const [reason, n] of Object.entries(report.rejectedByReason)) {
    if (n > 0) lines.push(`    - ${reason}: ${n}`);
  }
  lines.push("  per file:");
  for (const f of report.files) {
    lines.push(
      `    ${f.file}: parsed=${f.blocksParsed} accepted=${f.accepted} rejected=${f.rejected}`,
    );
  }
  return lines.join("\n");
}
