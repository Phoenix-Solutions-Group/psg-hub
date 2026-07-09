/**
 * Production mail adapter — provider-agnostic surface (v1.3, PSG core revenue).
 *
 * PSG's Production module mails physical pieces (thank-you cards, warranty
 * letters, envelopes) for body-shop programs. Per Decision 53 (PLANNING.md Q4)
 * two vendors ship behind ONE `MailAdapter` interface: `LobAdapter` (Lob.com
 * API + address verification + webhook) and a fast-follow in-house print queue
 * adapter. Vendor is selected per template or per shop; the rest of the system
 * only ever sees this interface.
 *
 * This file is deliberately free of any DB / Supabase / Sanity import: the
 * adapter layer is the integration spine and is independent of the v1.1 ops
 * data model (`production_batches`, `production_documents`, `mail_vendor_jobs`),
 * which lands with the Ops Foundation (B1 / PSG-25).
 */

/** Which production vendor handled / will handle a piece. Mirrors the `mail_vendor_jobs.vendor` enum. */
export type MailVendor = "lob" | "inhouse";

/** Physical piece format. Lob maps these to its postcard / letter endpoints. */
export type MailPieceType = "postcard" | "letter" | "self_mailer";

/** A US mailing address in PSG-canonical shape (vendor payloads derive from this). */
export interface MailAddress {
  /** Recipient or sender name / company. */
  name: string;
  addressLine1: string;
  addressLine2?: string;
  city: string;
  /** 2-letter US state code. */
  state: string;
  /** 5- or 9-digit ZIP. */
  zip: string;
  /** ISO country; defaults to "US" at the adapter boundary. */
  country?: string;
}

/**
 * A single print-ready piece to mail. `documentId` is the caller's stable id
 * (eventually `production_documents.id`) used for correlation + vendor-side
 * idempotency, so a retried submit never double-mails.
 */
export interface MailDocument {
  documentId: string;
  pieceType: MailPieceType;
  to: MailAddress;
  from: MailAddress;
  /**
   * Print-ready content. For postcards, `front`/`back` are HTML or hosted-asset
   * URLs. For letters, `file` is the letter PDF (HTML or hosted URL). The
   * mail-merge render (Sanity templates → PDF) feeds these fields.
   */
  front?: string;
  back?: string;
  file?: string;
  /** Letters and self-mailers only: true = color print, false/undefined = black & white. */
  color?: boolean;
  /** Mail size, e.g. "4x6" | "6x9" | "6x11" | "8.5x11". Defaults per vendor. */
  size?: string;
  /** Human-readable description shown in the vendor dashboard. */
  description?: string;
  /** Flat string→string metadata echoed back on webhooks for correlation. */
  metadata?: Record<string, string>;
}

/**
 * Canonical mail lifecycle status. Vendor-specific event names map onto this
 * closed set so the rest of the hub (print queue, historical search, audit)
 * never reasons about Lob-specific strings.
 */
export type MailJobStatus =
  | "created"
  | "rendered"
  | "mailed"
  | "in_transit"
  | "in_local_area"
  | "processed_for_delivery"
  | "delivered"
  | "re_routed"
  | "returned_to_sender"
  | "failed"
  | "cancelled"
  | "unknown";

/** True once the piece has reached a terminal lifecycle state. */
export function isTerminalMailStatus(status: MailJobStatus): boolean {
  return (
    status === "delivered" ||
    status === "returned_to_sender" ||
    status === "failed" ||
    status === "cancelled"
  );
}

export interface MailSubmissionResult {
  vendor: MailVendor;
  /** Vendor job id (Lob postcard `psc_...` / letter `ltr_...`). */
  externalId: string;
  status: MailJobStatus;
  /** Vendor's expected delivery date (ISO yyyy-mm-dd) when provided. */
  expectedDeliveryDate?: string | null;
  /** Vendor-hosted proof / thumbnail URL when available. */
  proofUrl?: string | null;
}

/**
 * Address deliverability, normalized across vendors. Only `deliverable` is safe
 * to auto-mail; everything else routes to human review before send.
 */
export type AddressDeliverability =
  | "deliverable"
  | "deliverable_with_unit_correction"
  | "deliverable_missing_unit"
  | "undeliverable"
  | "unknown";

export interface AddressVerificationResult {
  deliverability: AddressDeliverability;
  /** Convenience: true only when safe to mail without human review. */
  deliverable: boolean;
  /** Vendor-corrected address when verification returns a normalized form. */
  normalized?: MailAddress;
  /** Raw vendor payload, retained for audit / debugging. */
  raw?: unknown;
}

/**
 * A normalized inbound vendor webhook event (e.g. a Lob status callback),
 * after signature verification. Persisted to `mail_vendor_jobs` once that table
 * exists (B1).
 */
export interface MailWebhookEvent {
  vendor: MailVendor;
  /** Vendor job id the event is about. */
  externalId: string;
  status: MailJobStatus;
  /** Raw vendor event type (e.g. "postcard.delivered") for the audit trail. */
  eventType: string;
  /** When the vendor recorded the event (ISO), when present. */
  occurredAt?: string | null;
  raw?: unknown;
}

/**
 * The single interface the hub programs against. Both `LobAdapter` and the
 * fast-follow in-house adapter implement it; selection is per template / shop.
 */
export interface MailAdapter {
  readonly vendor: MailVendor;
  /** Verify + normalize a US address before mailing. */
  verifyAddress(address: MailAddress): Promise<AddressVerificationResult>;
  /** Submit a print-ready document for production + mailing. */
  submit(document: MailDocument): Promise<MailSubmissionResult>;
  /** Best-effort cancel of an in-flight piece by vendor job id. */
  cancel(externalId: string): Promise<void>;
}

/** Typed production-mail failure. `retryable` reflects whether the error was transient. */
export class MailProductionError extends Error {
  readonly statusCode?: number;
  readonly retryable: boolean;
  readonly vendor: MailVendor;

  constructor(
    message: string,
    options: {
      vendor: MailVendor;
      statusCode?: number;
      retryable: boolean;
      cause?: unknown;
    }
  ) {
    super(message);
    this.name = "MailProductionError";
    this.vendor = options.vendor;
    this.statusCode = options.statusCode;
    this.retryable = options.retryable;
    if (options.cause !== undefined) {
      (this as { cause?: unknown }).cause = options.cause;
    }
  }
}
