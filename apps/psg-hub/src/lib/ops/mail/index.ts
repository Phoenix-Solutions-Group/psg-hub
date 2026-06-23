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
export {
  DEFAULT_MAIL_HASH_SALT,
  mailHashSalt,
  normalizeRecipientName,
  normalizeMailAddress,
  householdKey,
  recipientHash,
} from "./recipient-hash";
export type { NormalizedMailAddress } from "./recipient-hash";
