import { NextResponse } from "next/server";
import { verifyLobSignature, normalizeLobEvent } from "@/lib/production/webhook";

/**
 * Lob webhook — production-mail status callbacks (v1.3, ROADMAP `/api/webhooks/lob`).
 *
 * Mirrors the SendGrid / Twilio webhooks (verify signature → fail closed →
 * normalize → persist → ack only after persist). Lob signs with
 * `Lob-Signature` (hex HMAC-SHA256 of `${timestamp}.${rawBody}`) +
 * `Lob-Signature-Timestamp`; verification + replay defense live in
 * `src/lib/production/webhook.ts`.
 *
 * PERSISTENCE SEAM: the `mail_vendor_jobs` lifecycle table is part of the v1.1
 * Ops Foundation data model (B1 / PSG-25) and does not exist yet. Until it
 * lands, this handler fully verifies + normalizes the event and acks; the
 * marked TODO is the exact one-call insertion point for the idempotent
 * upsert (UNIQUE(external_id, status), matching the Twilio pattern). The route
 * is intentionally shipped now so the Lob endpoint URL + secret can be
 * configured and live signature verification exercised independently of B1.
 */
export async function POST(request: Request) {
  const secret = process.env.LOB_WEBHOOK_SECRET;
  if (!secret) {
    // Fail closed on misconfiguration rather than accept unverifiable requests.
    console.error("[lob-webhook] LOB_WEBHOOK_SECRET not set");
    return NextResponse.json({ error: "Webhook not configured" }, { status: 500 });
  }

  const signature = request.headers.get("Lob-Signature");
  const timestamp = request.headers.get("Lob-Signature-Timestamp");
  if (!signature || !timestamp) {
    return NextResponse.json({ error: "Missing signature" }, { status: 400 });
  }

  // Read the raw body ONCE — the HMAC is over the exact bytes received, so we
  // must verify against the string and only JSON.parse after.
  const rawBody = await request.text();

  const verification = verifyLobSignature({ rawBody, signature, timestamp, secret });
  if (!verification.valid) {
    const status = verification.reason === "stale" ? 400 : 401;
    return NextResponse.json({ error: `Signature ${verification.reason}` }, { status });
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(rawBody);
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const event = normalizeLobEvent(parsed);
  if (!event) {
    // Verified but unrecognized shape — ack so Lob stops retrying, but log it.
    console.warn("[lob-webhook] verified event with unrecognized shape");
    return NextResponse.json({ received: true });
  }

  // TODO(B1 / PSG-25): idempotent upsert into mail_vendor_jobs
  //   { vendor: 'lob', external_id: event.externalId, status: event.status,
  //     event_type: event.eventType, occurred_at: event.occurredAt }
  //   keyed UNIQUE(external_id, status) — then update production_documents status.
  console.info(
    `[lob-webhook] ${event.eventType} → ${event.status} for ${event.externalId}`
  );

  return NextResponse.json({ received: true });
}
