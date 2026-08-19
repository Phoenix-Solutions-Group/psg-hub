import "server-only";
import { createHmac, timingSafeEqual } from "node:crypto";
import { mapLobStatus } from "./lob";
import type { MailWebhookEvent } from "./types";

/**
 * Lob webhook verification + event normalization (v1.3).
 *
 * Mirrors the SendGrid / Twilio webhook discipline (PROJECT.md: every webhook
 * verifies a signature and fails closed). Lob signs each delivery with:
 *
 *   - `Lob-Signature-Timestamp`: unix timestamp string
 *   - `Lob-Signature`: hex HMAC-SHA256 of `${timestamp}.${rawBody}`, keyed by
 *     the endpoint's webhook secret (Lob Dashboard → Webhooks).
 *
 * We additionally enforce a timestamp tolerance to defeat replay, and compare
 * the digest with a constant-time equality check. The raw body (never a
 * re-serialized object) is what gets HMAC'd — re-stringifying JSON would change
 * key order / whitespace and break verification for legitimate traffic.
 */

export interface LobSignatureInput {
  /** Exact raw request body as received (string), pre-JSON.parse. */
  rawBody: string;
  /** `Lob-Signature` header (hex). */
  signature: string | null | undefined;
  /** `Lob-Signature-Timestamp` header. */
  timestamp: string | null | undefined;
  /** Endpoint webhook secret (LOB_WEBHOOK_SECRET). */
  secret: string;
  /** Max allowed clock skew in seconds. Default 300 (5 min). */
  toleranceSeconds?: number;
  /** Injectable clock (ms) — default Date.now. Tests pass a fixed value. */
  nowMs?: number;
}

export type LobVerifyResult =
  | { valid: true }
  | { valid: false; reason: "missing" | "stale" | "mismatch" };

function lobTimestampToMs(timestamp: string): number | null {
  const value = Number(timestamp);
  if (!Number.isFinite(value)) {
    return null;
  }
  // Lob signs the timestamp as an opaque string. Current live webhooks use Unix
  // seconds, while earlier tests used Unix milliseconds. Use the parsed value
  // only for replay-window age checks; the HMAC input still uses the raw string.
  return value < 1_000_000_000_000 ? value * 1000 : value;
}

/** Verify a Lob webhook signature. Returns a typed result; never throws on bad input. */
export function verifyLobSignature(input: LobSignatureInput): LobVerifyResult {
  const { rawBody, signature, timestamp, secret } = input;
  if (!signature || !timestamp || !secret) {
    return { valid: false, reason: "missing" };
  }

  const toleranceSeconds = input.toleranceSeconds ?? 300;
  const nowMs = input.nowMs ?? Date.now();
  const tsMs = lobTimestampToMs(timestamp);
  if (tsMs === null) {
    return { valid: false, reason: "missing" };
  }
  // Reject timestamps outside the tolerance window (replay defense). Guard both
  // directions: future-dated and too-old.
  if (Math.abs(nowMs - tsMs) > toleranceSeconds * 1000) {
    return { valid: false, reason: "stale" };
  }

  const expected = createHmac("sha256", secret)
    .update(`${timestamp}.${rawBody}`, "utf8")
    .digest("hex");

  // Constant-time compare. Length-mismatched buffers would throw in
  // timingSafeEqual, so bail to mismatch first.
  const provided = signature.trim();
  if (provided.length !== expected.length) {
    return { valid: false, reason: "mismatch" };
  }
  const ok = timingSafeEqual(Buffer.from(provided, "utf8"), Buffer.from(expected, "utf8"));
  return ok ? { valid: true } : { valid: false, reason: "mismatch" };
}

interface LobWebhookBody {
  event_type?: { id?: string };
  reference_id?: string;
  date_created?: string;
  body?: {
    id?: string;
    expected_delivery_date?: string;
  };
}

/**
 * Normalize a parsed Lob webhook payload into a `MailWebhookEvent`. Lob wraps
 * the affected resource under `body` and the event kind under `event_type.id`
 * (e.g. "postcard.delivered"); the resource id (`body.id`, "psc_..."/"ltr_...")
 * is the vendor job id our `mail_vendor_jobs` rows key on.
 */
export function normalizeLobEvent(parsed: unknown): MailWebhookEvent | null {
  if (!parsed || typeof parsed !== "object") return null;
  const body = parsed as LobWebhookBody;
  const eventType = body.event_type?.id;
  const externalId = body.body?.id;
  if (!eventType || !externalId) return null;

  return {
    vendor: "lob",
    externalId,
    status: mapLobStatus(eventType),
    eventType,
    occurredAt: body.date_created ?? null,
    raw: parsed,
  };
}
