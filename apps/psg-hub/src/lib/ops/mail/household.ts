// W0 / PSG-221 — household-dedup key + recipient hash derivation.
//
// The single source of truth for the two PII-minimized keys the direct-mail
// engine joins on. SHARED by mail_suppression (this issue) and mail_send_history
// (PSG-216a) so an "already_mailed (piece, household)" suppression row matches a
// recipient by exactly the same key the send was logged under.
//
// PII posture (PSG-129/132/133): raw name/address never leave the import staging
// path. Everything persisted is a salted HMAC-SHA256 hash:
//   - household_key  = hash(normalized address)        — collapses same-address
//                                                          recipients (dedup unit)
//   - recipient_hash = hash(normalized name + address) — distinguishes people at
//                                                          one address
// The salt comes from MAIL_HASH_SALT (a per-environment secret). It MUST be
// stable across imports or the keys won't match historical rows; the dev/test
// fallback below is intentionally non-secret and is only used when the env var
// is unset (local + unit tests).

import { createHmac } from "node:crypto";
import { resolveAddress, type AddressInput } from "../import/address";

/** Non-secret fallback salt for local dev + unit tests (NOT for production). */
const DEV_FALLBACK_SALT = "psg-bsm-household-dev-salt-v0";

function saltOf(explicit?: string): string {
  return explicit ?? process.env.MAIL_HASH_SALT ?? DEV_FALLBACK_SALT;
}

function hmac(value: string, salt: string): string {
  return createHmac("sha256", salt).update(value).digest("hex");
}

/**
 * Canonicalize an address into a stable, order-fixed string for hashing.
 * Runs the same USPS normalization the importer uses (St → Street, state →
 * 2-letter, zip → 5/ZIP+4) then upper-cases + collapses so trivial formatting
 * differences ("123 Main St" vs "123 MAIN STREET") map to one household.
 * Returns "" when the address has no usable parts (caller treats as "no key").
 */
export function canonicalAddress(input: AddressInput): string {
  const { address } = resolveAddress(input);
  const parts = [
    address.line1,
    address.line2,
    address.city,
    address.state,
    address.zip,
  ].map((p) => (p ?? "").toUpperCase().replace(/\s+/g, " ").trim());
  // No usable address → empty canonical form (no household key).
  if (parts.every((p) => p === "")) return "";
  return parts.join("|");
}

/** Normalize a person name: upper-case, strip punctuation, collapse spaces. */
export function normalizePersonName(raw: string | null | undefined): string {
  return (raw ?? "")
    .toUpperCase()
    .replace(/[^A-Z0-9 ]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

export type HashOptions = {
  /** Override the salt (tests / explicit per-environment salt). */
  salt?: string;
};

/**
 * Address-derived household dedup key (salted hash). Two recipients at the same
 * normalized address produce the SAME key — that is the dedup unit. Returns ""
 * for an empty/unusable address so callers can skip suppressing on a missing key.
 */
export function householdKey(input: AddressInput, opts?: HashOptions): string {
  const canon = canonicalAddress(input);
  if (canon === "") return "";
  return `hh_${hmac(canon, saltOf(opts?.salt))}`;
}

/**
 * Recipient hash (salted hash of normalized name + address). Distinguishes
 * different people at the same address. Returns "" when both name and address
 * are empty.
 */
export function recipientHash(
  name: string | null | undefined,
  input: AddressInput,
  opts?: HashOptions
): string {
  const canonName = normalizePersonName(name);
  const canonAddr = canonicalAddress(input);
  if (canonName === "" && canonAddr === "") return "";
  return `rc_${hmac(`${canonName}::${canonAddr}`, saltOf(opts?.salt))}`;
}
