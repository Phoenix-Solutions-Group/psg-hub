import { timingSafeEqual } from "node:crypto";
import { NextResponse } from "next/server";
import { sendEmail } from "@/lib/mail/sendgrid";
import {
  buildDigestDeliverer,
  createOverdueDigestClient,
  parseRecipients,
  runOverdueDigest,
} from "@/lib/pipedrive/overdue-digest";

// PSG-643 — Cross-client weekly "who's behind?" overdue digest trigger.
//
// Vercel Cron fires GET weekly (Monday, see vercel.json) with
// `Authorization: Bearer ${CRON_SECRET}`; POST is the manual/QA trigger on the same
// gate. The auth gate runs BEFORE any Pipedrive read, so an unauthorized call spends
// zero API calls and never touches the token.
//
// Read-only: the digest only issues GET requests to Pipedrive (no writes). Staff
// notification matches the existing pattern — operator-visible `[overdue-digest]`
// log lines (like analytics-health), plus a SendGrid staff email when
// OVERDUE_DIGEST_RECIPIENTS is set. A degraded run (Pipedrive read failure) returns
// 502 so the cron retries/alerts; a healthy run (including "all caught up") is 200.
//
// runtime=nodejs is REQUIRED: node:crypto timingSafeEqual + the SendGrid server-only
// mail adapter.
export const runtime = "nodejs";

function authorized(request: Request): boolean {
  const secret = process.env.CRON_SECRET;
  if (!secret) return false; // unconfigured = locked
  const header = request.headers.get("authorization") ?? "";
  const expected = `Bearer ${secret}`;
  const a = Buffer.from(header);
  const b = Buffer.from(expected);
  return a.length === b.length && timingSafeEqual(a, b);
}

async function handle(request: Request): Promise<NextResponse> {
  if (!authorized(request)) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  if (!process.env.PIPEDRIVE_API_TOKEN && !process.env.PIPEDRIVE_API_KEY) {
    return NextResponse.json({ error: "pipedrive_not_configured" }, { status: 503 });
  }

  const client = createOverdueDigestClient({
    companyDomain: process.env.PIPEDRIVE_COMPANY_DOMAIN ?? null,
  });

  // Email is optional: with no recipients wired the deliverer degrades to log-only,
  // so the digest is never lost even before staff addresses are configured.
  const recipients = parseRecipients(process.env.OVERDUE_DIGEST_RECIPIENTS);
  const deliver = buildDigestDeliverer({
    sendEmail,
    recipients,
    from: process.env.OVERDUE_DIGEST_FROM ?? process.env.SENDGRID_FROM_EMAIL,
  });

  const result = await runOverdueDigest({ client, deliver });
  return NextResponse.json(result, { status: result.ok ? 200 : 502 });
}

export async function GET(request: Request): Promise<NextResponse> {
  return handle(request);
}

export async function POST(request: Request): Promise<NextResponse> {
  return handle(request);
}
