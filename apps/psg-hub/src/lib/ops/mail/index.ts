// W0 / PSG-223 — Direct-mail send-history importer (public surface).
//
// Decodes a production-center send batch into public.mail_send_history records +
// an AC1 reconciliation report. Pure / no DB I/O; PII-min (salted hashes only).
// See docs/specs/002-mail-send-history-w0/spec.md §3.1 and
// docs/ops/mail/send-history-mapping.md.

export * from "./types";
export {
  parseEnvelopeFilename,
  parseEnvelopeMarkdown,
  splitCityStateZip,
} from "./parse-production-batch";
export {
  importSendBatch,
  formatReconciliationReport,
} from "./send-history-import";
export type { EnvelopeSource, ImportOptions } from "./send-history-import";
// PII-min keys come from the SHARED canonical hasher (PSG-221), so send-history
// and suppression resolve to byte-identical household / recipient keys.
export { canonicalAddress, householdKey, normalizePersonName, recipientHash } from "./household";
export type { HashOptions } from "./household";
