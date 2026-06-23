// PSG-248 — signed unsubscribe token (PURE, no I/O).
//
// The CAN-SPAM unsubscribe link must work WITHOUT the recipient logging in, so it
// carries who-to-unsubscribe in the URL. To stop anyone forging an unsubscribe for
// an arbitrary address, the token is HMAC-signed: `<payload>.<sig>` where payload =
// base64url("<channel>:<normalizedContact>") and sig = HMAC-SHA256(payload). The
// /api/unsubscribe route verifies the signature before honoring it. The token is
// also the idempotency key for the opt-out event (same link clicked twice = one
// opt-out).

import { createHmac, timingSafeEqual } from "node:crypto";
import type { SolicitationChannel } from "./types";
import { normalizeContact } from "./contact";

const DEV_FALLBACK_SECRET = "psg-bsm-unsub-token-dev-secret-v0";

function secretOf(explicit?: string): string {
  return (
    explicit ??
    process.env.UNSUBSCRIBE_TOKEN_SECRET ??
    process.env.MAIL_HASH_SALT ??
    DEV_FALLBACK_SECRET
  );
}

function b64url(input: string): string {
  return Buffer.from(input, "utf8").toString("base64url");
}
function unb64url(input: string): string {
  return Buffer.from(input, "base64url").toString("utf8");
}
function sign(payloadB64: string, secret: string): string {
  return createHmac("sha256", secret).update(payloadB64).digest("base64url");
}

export type UnsubscribeTokenOptions = { secret?: string };

/**
 * Mint a signed unsubscribe token for a contact on a channel. Returns "" when the
 * contact is unusable (no token to sign). The contact is normalized FIRST so the
 * token round-trips to the same value the opt-out list matches on.
 */
export function makeUnsubscribeToken(
  channel: SolicitationChannel,
  rawContact: string | null | undefined,
  opts?: UnsubscribeTokenOptions
): string {
  const normalized = normalizeContact(channel, rawContact);
  if (normalized === "") return "";
  const payloadB64 = b64url(`${channel}:${normalized}`);
  return `${payloadB64}.${sign(payloadB64, secretOf(opts?.secret))}`;
}

export interface VerifiedUnsubscribe {
  channel: SolicitationChannel;
  /** The normalized contact the token was minted for. */
  contact: string;
}

/**
 * Verify + decode an unsubscribe token. Returns the channel + normalized contact,
 * or null when the token is malformed or the signature does not match (constant
 * time). Callers MUST treat null as "do not opt anyone out".
 */
export function verifyUnsubscribeToken(
  token: string | null | undefined,
  opts?: UnsubscribeTokenOptions
): VerifiedUnsubscribe | null {
  if (!token || typeof token !== "string") return null;
  const dot = token.indexOf(".");
  if (dot <= 0) return null;
  const payloadB64 = token.slice(0, dot);
  const sig = token.slice(dot + 1);
  const expected = sign(payloadB64, secretOf(opts?.secret));
  // Constant-time compare; mismatched lengths are an immediate fail.
  const sigBuf = Buffer.from(sig);
  const expBuf = Buffer.from(expected);
  if (sigBuf.length !== expBuf.length || !timingSafeEqual(sigBuf, expBuf)) {
    return null;
  }
  let decoded: string;
  try {
    decoded = unb64url(payloadB64);
  } catch {
    return null;
  }
  const sep = decoded.indexOf(":");
  if (sep <= 0) return null;
  const channel = decoded.slice(0, sep);
  const contact = decoded.slice(sep + 1);
  if ((channel !== "email" && channel !== "sms") || contact === "") return null;
  return { channel, contact };
}
