// PSG-248 — channel contact normalization + PII-min hashing.
//
// The opt-out list and the send-audit match contacts by a salted HMAC, never the
// raw email/phone (mirrors the mail household-key posture in ../mail/household.ts).
// Normalization is the join: STOP from +1 (555) 867-5309 must match a solicitation
// addressed to 5558675309, and Unsubscribe from "Jordan@Shop.COM " must match
// "jordan@shop.com". Both sides hash the SAME normalized form.

import { createHmac } from "node:crypto";
import type { SolicitationChannel } from "./types";

/** Non-secret fallback salt for local dev + unit tests (NOT for production). */
const DEV_FALLBACK_SALT = "psg-bsm-solicitation-dev-salt-v0";

export type ContactHashOptions = { salt?: string };

function saltOf(explicit?: string): string {
  // Reuse MAIL_HASH_SALT when a dedicated solicitation salt is not set, so the
  // whole BSM PII surface shares one rotateable secret in production.
  return (
    explicit ??
    process.env.SOLICITATION_HASH_SALT ??
    process.env.MAIL_HASH_SALT ??
    DEV_FALLBACK_SALT
  );
}

function hmac(value: string, salt: string): string {
  return createHmac("sha256", salt).update(value).digest("hex");
}

/** lower-case + trim an email. Returns "" when there is no usable address. */
export function normalizeEmail(raw: string | null | undefined): string {
  const e = (raw ?? "").trim().toLowerCase();
  // Minimal shape guard — a value with no "@x.y" can never be a deliverable
  // address, so treat it as "no contact" rather than hashing junk.
  return /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(e) ? e : "";
}

/**
 * Normalize a phone to E.164 (US default). Strips formatting; a bare 10-digit
 * number is assumed US (+1), an 11-digit 1-prefixed number is +1, an already
 * +-prefixed number is kept as its digits. Returns "" when not a plausible number.
 */
export function normalizePhone(raw: string | null | undefined): string {
  const input = (raw ?? "").trim();
  if (input === "") return "";
  const hasPlus = input.startsWith("+");
  const digits = input.replace(/\D/g, "");
  if (hasPlus) {
    // International number already in E.164 form — keep verbatim (7–15 digits).
    return digits.length >= 7 && digits.length <= 15 ? `+${digits}` : "";
  }
  if (digits.length === 10) return `+1${digits}`;
  if (digits.length === 11 && digits.startsWith("1")) return `+${digits}`;
  return "";
}

/** Normalize the raw contact value for a channel (email or phone). */
export function normalizeContact(
  channel: SolicitationChannel,
  raw: string | null | undefined
): string {
  return channel === "email" ? normalizeEmail(raw) : normalizePhone(raw);
}

/**
 * Salted, channel-prefixed HMAC of a contact. Returns "" for an unusable contact
 * so callers can skip matching on a missing key. The channel is bound into the
 * hash so an email and a phone that happen to normalize alike never collide.
 */
export function contactHash(
  channel: SolicitationChannel,
  raw: string | null | undefined,
  opts?: ContactHashOptions
): string {
  const normalized = normalizeContact(channel, raw);
  if (normalized === "") return "";
  const prefix = channel === "email" ? "em_" : "ph_";
  return `${prefix}${hmac(`${channel}:${normalized}`, saltOf(opts?.salt))}`;
}
