// One-off Twilio live verification (psg-hub Phase 3 / Plan 03-02).
// Run: node --env-file=.env.local scripts/send-test-sms.mjs +15558675310
// Mirrors the adapter's call path (messages.create). Secrets come from --env-file.
import twilio from "twilio";

const accountSid = process.env.TWILIO_ACCOUNT_SID;
const authToken = process.env.TWILIO_AUTH_TOKEN;
const messagingServiceSid = process.env.TWILIO_MESSAGING_SERVICE_SID;
const from = process.env.TWILIO_PHONE_NUMBER;
const to = process.argv[2];

if (!accountSid || !authToken) {
  console.error(
    "Missing TWILIO_ACCOUNT_SID or TWILIO_AUTH_TOKEN. Load with: node --env-file=.env.local"
  );
  process.exit(1);
}
if (!messagingServiceSid && !from) {
  console.error("Set TWILIO_MESSAGING_SERVICE_SID (preferred) or TWILIO_PHONE_NUMBER.");
  process.exit(1);
}
if (!to) {
  console.error(
    "Usage: node --env-file=.env.local scripts/send-test-sms.mjs <destination E.164, e.g. +15558675310>"
  );
  process.exit(1);
}

const client = twilio(accountSid, authToken);

try {
  const msg = await client.messages.create({
    to,
    ...(messagingServiceSid ? { messagingServiceSid } : { from }),
    body: "PSG Hub — Twilio live test (Phase 3 / 03-02). If you got this, the SMS adapter + sender are working.",
  });
  console.log(
    `OK  sid=${msg.sid}  status=${msg.status}  to=${to}  sender=${messagingServiceSid ?? from}`
  );
} catch (err) {
  // Twilio puts the HTTP status in .status and the vendor error code in .code
  // (inverse of SendGrid) — surface both.
  console.error(`FAILED  http=${err?.status ?? "?"}  code=${err?.code ?? "?"}  ${err?.message ?? ""}`);
  if (err?.moreInfo) console.error(err.moreInfo);
  process.exit(1);
}
