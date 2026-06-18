import { NextResponse } from "next/server";
import { verifyLobSignature, normalizeLobEvent } from "@/lib/production/webhook";
import { recordMailVendorEvent } from "@/lib/production/jobs";

/**
 * Lob webhook — production-mail status callbacks (v1.3, ROADMAP `/api/webhooks/lob`).
 *
 * Mirrors the SendGrid / Twilio webhooks (verify signature → fail closed →
 * normalize → persist → ack only after persist). Lob signs with
 * `Lob-Signature` (hex HMAC-SHA256 of `${timestamp}.${rawBody}`) +
 * `Lob-Signature-Timestamp`; verification + replay defense live in
 * `src/lib/production/webhook.ts`. Persistence (idempotent upsert into
 * mail_vendor_jobs keyed UNIQUE(external_id, status) + document status advance)
 * lives in `src/lib/production/jobs.ts` against the v1.3 data model.
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

  try {
    await recordMailVendorEvent(event);
  } catch (error) {
    // Persistence failure → 500 so Lob retries; the UNIQUE(external_id, status)
    // key keeps the retry idempotent. Ack only after a successful persist.
    console.error(
      "[lob-webhook] persist failed:",
      error instanceof Error ? error.message : error
    );
    return NextResponse.json({ error: "Persist failed" }, { status: 500 });
  }

  return NextResponse.json({ received: true });
}
