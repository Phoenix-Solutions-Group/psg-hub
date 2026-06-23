// W0 / PSG-223 — Salted recipient + household hashing (PII-min, AC4).
//
// public.mail_send_history persists NO raw name/address — only a salted
// recipient_hash and an address-derived household_key, both opaque hex. These
// helpers are the single place raw PII is turned into those keys; callers drop
// the raw values immediately after.
//
// Determinism: same salt + same normalized input => same hash, so re-import
// upserts hit the same send_ref/household_key and never duplicate. The salt
// comes from MAIL_HASH_SALT (set per environment); a stable documented default
// keeps fixtures/tests deterministic without a secret.

import { createHash } from "node:crypto";
import {
  normalizeState,
  normalizeStreet,
  normalizeZip,
} from "@/lib/ops/import/address";

/** Documented default salt — overridden by MAIL_HASH_SALT in real environments. */
export const DEFAULT_MAIL_HASH_SALT = "psg-mail-w0";

export function mailHashSalt(): string {
  return process.env.MAIL_HASH_SALT?.trim() || DEFAULT_MAIL_HASH_SALT;
}

const HONORIFICS = new Set([
  "mr",
  "mrs",
  "ms",
  "miss",
  "dr",
  "mr.",
  "mrs.",
  "ms.",
  "dr.",
]);

/**
 * Normalize a printed name for hashing: drop honorifics, lowercase, strip
 * punctuation, collapse whitespace. "Mr. Stephen Moore" -> "stephen moore".
 */
export function normalizeRecipientName(raw: string): string {
  const tokens = raw
    .toLowerCase()
    .replace(/[^a-z0-9.\s]/g, " ")
    .split(/\s+/)
    .filter((t) => t.length > 0 && !HONORIFICS.has(t))
    .map((t) => t.replace(/\.$/, ""));
  return tokens.join(" ").trim();
}

export type NormalizedMailAddress = {
  street: string;
  city: string;
  state: string;
  zip: string;
};

/**
 * Canonicalize the address parts that define a household: USPS-style street
 * (via the shared import normalizer), title/loose city, 2-letter state, 5-digit
 * zip. Empty parts collapse to "" so the key stays stable.
 */
export function normalizeMailAddress(parts: {
  street?: string | null;
  city?: string | null;
  state?: string | null;
  zip?: string | null;
}): NormalizedMailAddress {
  const street = (normalizeStreet(parts.street).value ?? "").toLowerCase();
  const city = (parts.city ?? "")
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  const state = (normalizeState(parts.state) ?? "").toLowerCase();
  const zip = normalizeZip(parts.zip) ?? "";
  return { street, city, state, zip };
}

function sha256Hex(parts: string[]): string {
  return createHash("sha256").update(parts.join("")).digest("hex");
}

/** Address-only dedup key (household). No name => same household for a couple. */
export function householdKey(
  address: NormalizedMailAddress,
  salt: string = mailHashSalt(),
): string {
  return sha256Hex([
    salt,
    "hh",
    address.street,
    address.city,
    address.state,
    address.zip,
  ]);
}

/** Recipient-level key: name + address, salted. */
export function recipientHash(
  normalizedName: string,
  address: NormalizedMailAddress,
  salt: string = mailHashSalt(),
): string {
  return sha256Hex([
    salt,
    "rc",
    normalizedName,
    address.street,
    address.city,
    address.state,
    address.zip,
  ]);
}
