import "server-only";
import {
  MailProductionError,
  type AddressVerificationResult,
  type MailAddress,
  type MailAdapter,
  type MailDocument,
  type MailSubmissionResult,
} from "./types";

/**
 * In-house production-mail adapter — implements `MailAdapter` (src/lib/production/types.ts).
 *
 * The fast-follow second vendor of the v1.3 dual adapter (PLANNING.md Decision 53 /
 * Q4): instead of mailing through Lob.com, an in-house piece is rendered to a
 * print-ready PDF and handed off to a PSG facility printer / print partner. There is
 * **no Lob API call and no per-piece Lob spend** on this path — the same reason a
 * shop/template would choose it.
 *
 * Because the handoff is to PSG's own queue rather than a third-party API, this
 * adapter does no network I/O and therefore no circuit breaker / retry (those guard
 * external calls). The piece's forward lifecycle (mailed → delivered) is advanced by
 * the facility operator / queue, exactly the way Lob's webhook advances a Lob piece;
 * `submit` only records that the piece has been queued.
 *
 * IDEMPOTENCY: the in-house job id is derived deterministically from the caller's
 * `documentId`, so a retried submit yields the same id and the queue dedupes rather
 * than printing a second piece — mirroring Lob's `Idempotency-Key` guarantee.
 */

/** Prefix for in-house job ids, parallel to Lob's `psc_` / `ltr_`. */
export const INHOUSE_ID_PREFIX = "inhouse_";

export interface InHouseAdapterOptions {
  /** Override the job-id generator (tests inject a deterministic stub). */
  generateJobId?: (documentId: string) => string;
}

export class InHouseAdapter implements MailAdapter {
  readonly vendor = "inhouse" as const;

  private readonly generateJobId: (documentId: string) => string;

  constructor(options: InHouseAdapterOptions = {}) {
    this.generateJobId =
      options.generateJobId ?? ((documentId) => `${INHOUSE_ID_PREFIX}${documentId}`);
  }

  /**
   * In-house production has no USPS address-verification service. Report `unknown`
   * (never a false `deliverable: true`) so the ops layer routes the piece to human
   * review before mailing rather than trusting an unverified address.
   */
  async verifyAddress(_address: MailAddress): Promise<AddressVerificationResult> {
    return {
      deliverability: "unknown",
      deliverable: false,
    };
  }

  /**
   * Queue a print-ready piece for the in-house facility / print partner. Requires a
   * rendered asset (postcard `front`, letter `file`, or self-mailer `inside` /
   * `outside`) — without it there is nothing to print, which is a caller bug
   * (non-retryable), not a transient failure.
   */
  async submit(document: MailDocument): Promise<MailSubmissionResult> {
    const asset =
      document.pieceType === "postcard"
        ? document.front
        : document.pieceType === "self_mailer"
          ? document.inside ?? document.outside
          : document.file;
    if (!asset) {
      throw new MailProductionError(
        `In-house submit: ${document.pieceType} ${document.documentId} has no rendered asset`,
        { vendor: "inhouse", retryable: false }
      );
    }

    return {
      vendor: "inhouse",
      externalId: this.generateJobId(document.documentId),
      // Queued for the facility; the operator/queue advances it forward, like a webhook.
      status: "created",
      // The facility's mail-out schedule is not known at queue time.
      expectedDeliveryDate: null,
      // The print-ready asset doubles as the proof for an in-house piece.
      proofUrl: asset,
    };
  }

  /**
   * Best-effort cancel of a queued in-house piece. The facility queue can pull a
   * piece that has not yet been printed; there is no remote system to call, so this
   * resolves. The ops layer marks the corresponding row cancelled.
   */
  async cancel(_externalId: string): Promise<void> {
    // No external system — cancellation is a queue-side state change handled by ops.
  }
}

/** Default in-house adapter instance. Tests build their own. */
export function createInHouseAdapter(options: InHouseAdapterOptions = {}): InHouseAdapter {
  return new InHouseAdapter(options);
}
