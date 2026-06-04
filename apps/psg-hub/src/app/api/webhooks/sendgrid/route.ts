import { NextResponse } from "next/server";
import { EventWebhook, EventWebhookHeader } from "@sendgrid/eventwebhook";
import { createServiceClient } from "@/lib/supabase/service";

/**
 * SendGrid Event Webhook — mirrors the Stripe webhook (src/app/api/webhooks/stripe):
 * raw body, signature verification, service-role write. Idempotent via the
 * email_events.sg_event_id UNIQUE constraint (PROJECT.md: idempotency on every webhook).
 *
 * Next 16: route handler shape matches the in-repo Stripe webhook (the Next 16
 * docs bundle is not present in this install; mirrored the proven pattern).
 */

interface SendGridEvent {
  sg_event_id?: string;
  sg_message_id?: string;
  event?: string;
  email?: string;
  timestamp?: number;
  [key: string]: unknown;
}

export async function POST(request: Request) {
  const verificationKey = process.env.SENDGRID_WEBHOOK_VERIFICATION_KEY;
  if (!verificationKey) {
    // Fail closed on misconfiguration rather than accept unverifiable events.
    console.error("[sendgrid-webhook] SENDGRID_WEBHOOK_VERIFICATION_KEY not set");
    return NextResponse.json({ error: "Webhook not configured" }, { status: 500 });
  }

  const body = await request.text();
  const signature = request.headers.get(EventWebhookHeader.SIGNATURE());
  const timestamp = request.headers.get(EventWebhookHeader.TIMESTAMP());

  if (!signature || !timestamp) {
    return NextResponse.json({ error: "Missing signature" }, { status: 400 });
  }

  // ECDSA signature verification over the raw payload (must precede JSON parse).
  let verified = false;
  try {
    const ew = new EventWebhook();
    const ecdsaKey = ew.convertPublicKeyToECDSA(verificationKey);
    verified = ew.verifySignature(ecdsaKey, body, signature, timestamp);
  } catch (err) {
    console.error(
      "[sendgrid-webhook] signature verification error:",
      err instanceof Error ? err.message : "unknown"
    );
    verified = false;
  }
  if (!verified) {
    return NextResponse.json({ error: "Invalid signature" }, { status: 400 });
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(body);
  } catch {
    return NextResponse.json({ error: "Invalid payload" }, { status: 400 });
  }
  const events: SendGridEvent[] = Array.isArray(parsed)
    ? (parsed as SendGridEvent[])
    : [parsed as SendGridEvent];

  const rows = events
    .filter((e) => typeof e.sg_event_id === "string")
    .map((e) => ({
      sg_event_id: e.sg_event_id as string,
      event: typeof e.event === "string" ? e.event : "unknown",
      email: typeof e.email === "string" ? e.email : null,
      message_id: typeof e.sg_message_id === "string" ? e.sg_message_id : null,
      payload: e,
      occurred_at:
        typeof e.timestamp === "number"
          ? new Date(e.timestamp * 1000).toISOString()
          : null,
    }));

  if (rows.length > 0) {
    const supabase = createServiceClient();
    // ignoreDuplicates + UNIQUE(sg_event_id) = idempotent replay.
    const { error } = await supabase
      .from("email_events")
      .upsert(rows, { onConflict: "sg_event_id", ignoreDuplicates: true });

    if (error) {
      // Genuine persistence failure → 500 so SendGrid retries; the unique key
      // keeps the retry idempotent.
      console.error("[sendgrid-webhook] persist failed:", error.message);
      return NextResponse.json({ error: "Persist failed" }, { status: 500 });
    }
  }

  return NextResponse.json({ received: true });
}
