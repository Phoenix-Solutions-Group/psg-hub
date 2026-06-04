import { NextResponse } from "next/server";
import twilio from "twilio";
import { createServiceClient } from "@/lib/supabase/service";

/**
 * Twilio webhook — handles BOTH outbound delivery status callbacks AND inbound
 * SMS on one route (ROADMAP: `/api/webhooks/twilio` (SMS delivery + inbound)).
 * Mirrors the SendGrid webhook (verify → idempotent service-role upsert → ack
 * only after persist), with Twilio's three structural divergences:
 *
 *  1. Signature = HMAC-SHA1 over the PUBLIC request URL + sorted POST params,
 *     keyed by TWILIO_AUTH_TOKEN (twilio.validateRequest) — NOT raw-body ECDSA.
 *  2. Body is application/x-www-form-urlencoded — parsed, never JSON.parse'd.
 *     The PARSED params (not the raw body) are folded into the HMAC.
 *  3. Idempotency key is the composite UNIQUE(message_sid, status) — one
 *     message_sid legitimately spans multiple lifecycle rows (queued/sent/
 *     delivered), while a replayed (message_sid, status) dedupes.
 *
 * The signed URL is rebuilt from TWILIO_WEBHOOK_BASE_URL (NOT request.url /
 * X-Forwarded-*, which are proxy/attacker-mutable on Vercel). Live signature
 * verification is exercised in 03-04, once the Vercel re-link provides a stable
 * public URL — the clean parallel to SendGrid's deferred webhook-row verify.
 */

export async function POST(request: Request) {
  const authToken = process.env.TWILIO_AUTH_TOKEN;
  if (!authToken) {
    // Fail closed on misconfiguration rather than accept unverifiable requests.
    console.error("[twilio-webhook] TWILIO_AUTH_TOKEN not set");
    return NextResponse.json({ error: "Webhook not configured" }, { status: 500 });
  }
  const baseUrl = process.env.TWILIO_WEBHOOK_BASE_URL;
  if (!baseUrl) {
    // Without the public base URL the signature cannot be verified — fail closed.
    console.error("[twilio-webhook] TWILIO_WEBHOOK_BASE_URL not set");
    return NextResponse.json({ error: "Webhook not configured" }, { status: 500 });
  }

  const signature = request.headers.get("X-Twilio-Signature");
  if (!signature) {
    return NextResponse.json({ error: "Missing signature" }, { status: 400 });
  }

  // Twilio posts application/x-www-form-urlencoded — read raw once, parse to params.
  const rawBody = await request.text();
  const params = Object.fromEntries(new URLSearchParams(rawBody));

  // Rebuild the EXACT public URL Twilio signed (path + query preserved). Env-based,
  // because request.url is the internal proxy URL on Vercel and forwarded headers
  // are attacker-mutable. A trailing-slash / query mismatch is the #1 false failure.
  const requestUrl = new URL(request.url);
  // Strip trailing slash(es) from the base: a pasted "https://host/" would
  // otherwise yield a double slash ("https://host//api/...") whose HMAC mismatches
  // the signature for 100% of legitimate traffic (fails closed — a silent outage).
  const base = baseUrl.replace(/\/+$/, "");
  const signedUrl = `${base}${requestUrl.pathname}${requestUrl.search}`;

  // HMAC-SHA1 over (signedUrl + alphabetically-sorted POST params). Pass the PARSED
  // params, not the raw body — folding params into the HMAC is what Twilio signs.
  let verified = false;
  try {
    verified = twilio.validateRequest(authToken, signature, signedUrl, params);
  } catch (err) {
    console.error(
      "[twilio-webhook] signature verification error:",
      err instanceof Error ? err.message : "unknown"
    );
    verified = false;
  }
  if (!verified) {
    return NextResponse.json({ error: "Invalid signature" }, { status: 403 });
  }

  const messageSid = params.MessageSid;
  if (!messageSid) {
    // A validly-signed Twilio webhook always carries a MessageSid; its absence is
    // malformed. Reject rather than write a row with a null half of the unique key.
    return NextResponse.json({ error: "Missing MessageSid" }, { status: 400 });
  }

  // Status callbacks carry MessageStatus; inbound messages do not (they carry
  // SmsStatus="received"). This presence check is the route discriminator.
  const isStatusCallback = typeof params.MessageStatus === "string";
  // `status` is the second half of the idempotency key — it must NEVER be null
  // (Postgres treats NULLs in a unique index as distinct → silent dedup failure).
  const status = params.MessageStatus ?? params.SmsStatus ?? "received";
  const errorCodeRaw = params.ErrorCode;
  const errorCode =
    errorCodeRaw !== undefined &&
    errorCodeRaw !== "" &&
    !Number.isNaN(Number(errorCodeRaw))
      ? Number(errorCodeRaw)
      : null;

  const row = {
    message_sid: messageSid,
    status,
    direction: isStatusCallback ? "outbound" : "inbound",
    from_number: params.From ?? null,
    to_number: params.To ?? null,
    error_code: errorCode,
    payload: params,
  };

  const supabase = createServiceClient();
  // ignoreDuplicates + UNIQUE(message_sid, status) = idempotent replay; distinct
  // lifecycle transitions still persist as separate rows.
  const { error } = await supabase
    .from("sms_events")
    .upsert([row], { onConflict: "message_sid,status", ignoreDuplicates: true });

  if (error) {
    // Genuine persistence failure → 500 so Twilio retries; the unique key keeps
    // the retry idempotent.
    console.error("[twilio-webhook] persist failed:", error.message);
    return NextResponse.json({ error: "Persist failed" }, { status: 500 });
  }

  // Ack AFTER persist. Status callbacks expect a bare 2xx (TwiML is ignored);
  // inbound expects TwiML with Content-Type text/xml (a 200 with the wrong
  // content-type makes Twilio log 11200/12300). Empty <Response/> = no auto-reply.
  if (isStatusCallback) {
    return new Response(null, { status: 204 });
  }
  return new Response(
    '<?xml version="1.0" encoding="UTF-8"?><Response></Response>',
    { status: 200, headers: { "Content-Type": "text/xml" } }
  );
}
