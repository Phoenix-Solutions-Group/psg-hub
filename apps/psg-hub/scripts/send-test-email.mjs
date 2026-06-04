// One-off SendGrid live verification (psg-hub Phase 3 / Plan 03-01).
// Run: node --env-file=.env.local scripts/send-test-email.mjs [recipient@example.com]
// Mirrors the adapter's call path (setApiKey + send). Secrets come from --env-file.
import sgMail from "@sendgrid/mail";

const apiKey = process.env.SENDGRID_API_KEY;
const from = process.env.SENDGRID_FROM_EMAIL;
const to = process.argv[2] || "nick@phoenixsolutionsgroup.net";

if (!apiKey || !from) {
  console.error(
    "Missing SENDGRID_API_KEY or SENDGRID_FROM_EMAIL. Load with: node --env-file=.env.local"
  );
  process.exit(1);
}

sgMail.setApiKey(apiKey);

try {
  const [res] = await sgMail.send({
    to,
    from,
    subject: "PSG Hub — SendGrid live test (Phase 3 / 03-01)",
    text: "If you received this, SendGrid domain auth + sender are working. — psg-hub",
    html: "<p>If you received this, SendGrid domain authentication and the verified sender are working.</p><p>— psg-hub Phase 3 / 03-01</p>",
  });
  console.log(
    `OK  status=${res.statusCode}  message-id=${res.headers["x-message-id"] ?? "n/a"}  to=${to}  from=${from}`
  );
} catch (err) {
  console.error(`FAILED  status=${err?.code ?? "?"}`);
  const body = err?.response?.body;
  console.error(typeof body === "string" ? body : JSON.stringify(body, null, 2));
  process.exit(1);
}
