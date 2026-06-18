/**
 * Production vendor selection — pure, testable (v1.3, PLANNING.md Decision 53 / Q4).
 *
 * Both production vendors ship behind one `MailAdapter` (src/lib/production/types.ts):
 * `LobAdapter` (Lob.com) and `InHouseAdapter` (PSG facility / print-partner). Which
 * one handles a given piece is decided **per template / per shop** — that decision
 * is persisted onto `production_batches.vendor` at queue time and mirrored onto each
 * `production_documents.vendor`, then honoured at print time.
 *
 * This function is the single source of that precedence. It is deliberately free of
 * any DB / network import so it can be unit-tested in isolation and reused at both
 * batch-queue time (compute the vendor to store) and print time (resolve which
 * adapter to submit through).
 */

import type { MailVendor } from "./types";

/**
 * Default vendor for an unconfigured template/shop. Lob is the verified primary
 * path (USPS address verification + delivery webhooks); a `test_*` LOB_API_KEY
 * exercises it with no per-piece spend, and live spend is separately gated behind
 * board gate G4. An explicit template/shop override flips a program to in-house.
 */
export const DEFAULT_MAIL_VENDOR: MailVendor = "lob";

/**
 * Selection inputs, in precedence order. Any combination may be absent; the first
 * defined vendor wins, falling back to {@link DEFAULT_MAIL_VENDOR}.
 *
 * - `documentVendor` — a vendor already chosen + persisted for this exact piece
 *   (`production_documents.vendor`). Honoured first so a re-print never silently
 *   switches vendors after the original send.
 * - `batchVendor` — the vendor selected for the parent batch
 *   (`production_batches.vendor`).
 * - `templateVendor` — per-template override (e.g. a Sanity mail-merge template's
 *   `mailVendor` field). A template is more specific than the shop it renders for.
 * - `shopVendor` — per-shop / per-company override (e.g. a company's configured
 *   production vendor).
 */
export interface VendorSelectionInput {
  documentVendor?: MailVendor | null;
  batchVendor?: MailVendor | null;
  templateVendor?: MailVendor | null;
  shopVendor?: MailVendor | null;
}

/**
 * Resolve the production vendor for a piece. Pure: same input → same output, no
 * side effects. Precedence (most specific first):
 * document → batch → template → shop → default.
 */
export function selectVendor(input: VendorSelectionInput = {}): MailVendor {
  return (
    input.documentVendor ??
    input.batchVendor ??
    input.templateVendor ??
    input.shopVendor ??
    DEFAULT_MAIL_VENDOR
  );
}
