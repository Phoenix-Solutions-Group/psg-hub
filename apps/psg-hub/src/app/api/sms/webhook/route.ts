// PSG-248 — Twilio inbound SMS webhook: STOP / START / HELP handling (TCPA).
//
// Twilio POSTs application/x-www-form-urlencoded (From, Body, MessageSid, …) with
// an X-Twilio-Signature header. We verify the signature over the EXACT URL Twilio
// was configured with (raw params), classify the body, and record an immutable
// opt-out (STOP) / opt-in (START) event — idempotent on MessageSid. HELP gets an
// info reply and writes nothing. The response is TwiML; an empty <Response/> means
// "no app-generated reply" (a Messaging Service with Advanced Opt-Out sends the
// carrier-standard confirmation itself — this route is the durable backstop).
export const runtime = "nodejs";

import { NextResponse } from "next/server";
import twilio from "twilio";
import { createServiceClient } from "@/lib/supabase/service";
import { supabaseSolicitationStore } from "@/lib/ops/solicitation/store";
import { classifyInboundSms } from "@/lib/ops/solicitation/optout";
import { contactHash } from "@/lib/ops/solicitation/contact";

function twiml(body: string): NextResponse {
  const xml = `<?xml version="1.0" encoding="UTF-8"?><Response>${body}</Response>`;
  return new NextResponse(xml, {
    status: 200,
    headers: { "Content-Type": "text/xml" },
  });
}

export async function POST(request: Request) {
  const authToken = process.env.TWILIO_AUTH_TOKEN;
  if (!authToken) {
    // Fail closed: an unverifiable webhook must not be able to opt people in/out.
    console.error("[sms-webhook] TWILIO_AUTH_TOKEN not set");
    return NextResponse.json({ error: "Webhook not configured" }, { status: 500 });
  }

  // Parse the form body into the exact param map Twilio signed.
  const raw = await request.text();
  const params: Record<string, string> = {};
  for (const [k, v] of new URLSearchParams(raw)) params[k] = v;

  // Twilio signs the configured webhook URL. Allow an explicit override (proxies /
  // rewrites change request.url) and fall back to the incoming URL.
  const url = process.env.TWILIO_SMS_WEBHOOK_URL ?? request.url;
  const signature = request.headers.get("X-Twilio-Signature") ?? "";
  const valid = twilio.validateRequest(authToken, signature, url, params);
  if (!valid) {
    return NextResponse.json({ error: "Invalid signature" }, { status: 403 });
  }

  const from = params.From ?? "";
  const body = params.Body ?? "";
  const messageSid = params.MessageSid ?? params.SmsSid ?? "";
  const intent = classifyInboundSms(body);

  // HELP (and ordinary replies) change no state.
  if (intent === null) return twiml("");
  if (intent === "help") {
    return twiml(
      "<Message>Reply STOP to stop texts. Msg &amp; data rates may apply.</Message>"
    );
  }

  const ch = contactHash("sms", from);
  if (ch === "" || messageSid === "") {
    // Nothing to key on — acknowledge so Twilio does not retry.
    return twiml("");
  }

  const store = supabaseSolicitationStore(createServiceClient());
  try {
    await store.recordOptOutEvent({
      channel: "sms",
      contact_hash: ch,
      state: intent === "stop" ? "opted_out" : "opted_in",
      reason: intent === "stop" ? "sms_stop" : "sms_start",
      source: "sms_webhook",
      // Idempotent: the inbound MessageSid is globally unique per message.
      event_ref: `sms:${messageSid}`,
    });
  } catch (err) {
    // Genuine persistence failure → 500 so Twilio retries; event_ref keeps the
    // retry idempotent.
    console.error("[sms-webhook] persist failed:", err instanceof Error ? err.message : err);
    return NextResponse.json({ error: "Persist failed" }, { status: 500 });
  }

  return twiml("");
}
