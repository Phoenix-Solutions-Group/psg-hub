import { timingSafeEqual } from "node:crypto";
import { NextResponse } from "next/server";
import { sendEmail } from "@/lib/mail/sendgrid";
import {
  BriefingUnavailableError,
  briefingDocUrl,
  dateLabelFor,
  fetchBriefing,
  parseRecipients,
  subjectFor,
} from "@/lib/board-briefing/briefing";
import { renderBriefingHtml, wrapBriefingEmail } from "@/lib/board-briefing/render";

// PSG-846: daily board-briefing email. Vercel Cron fires GET (with
// `Authorization: Bearer ${CRON_SECRET}`) at ~12:10 UTC, 10 min after the
// briefing routine regenerates the `daily-briefing` doc; POST supports manual
// operator triggers under the SAME gate. The gate runs BEFORE any config read,
// API fetch, or send — an unauthorized call does zero work and sends nothing.
//
// Honest failure: a missing/empty briefing, or a send failure, returns a 5xx and
// logs an alarm — we never email a blank briefing or silently drop the send.
//
// runtime=nodejs: node:crypto timing-safe compare + SendGrid adapter are
// server-only.
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

  // The briefing lives on the Paperclip control plane; both the base URL and a
  // scoped read token are deploy-time config. Missing config is a designed
  // not-configured state, not a runtime failure — 503, no send, no alarm noise.
  const apiUrl = process.env.PAPERCLIP_API_URL?.trim();
  const token = process.env.PAPERCLIP_READ_TOKEN?.trim();
  if (!apiUrl || !token) {
    return NextResponse.json(
      { error: "board_briefing_not_configured" },
      { status: 503 }
    );
  }

  // Fetch the freshest briefing. Any failure/empty body throws → we alarm + 5xx
  // and send nothing (never a blank email).
  let briefing;
  try {
    briefing = await fetchBriefing({ apiUrl, token });
  } catch (error) {
    const status =
      error instanceof BriefingUnavailableError ? error.status : 502;
    console.error(
      "[cron/board-briefing-email] briefing unavailable — not sending:",
      error instanceof Error ? error.message : error
    );
    return NextResponse.json(
      { error: "briefing_unavailable" },
      { status }
    );
  }

  const recipients = parseRecipients(process.env.BOARD_BRIEFING_RECIPIENTS);
  const subject = subjectFor(briefing.updatedAt);
  const docUrl = briefingDocUrl(apiUrl, briefing.issueId);
  const bodyHtml = renderBriefingHtml(briefing.body);
  const html = wrapBriefingEmail({
    bodyHtml,
    docUrl,
    dateLabel: dateLabelFor(briefing.updatedAt),
  });
  // Plain-text alternative is the raw briefing markdown plus the live-doc link —
  // readable in any client and safe for text-only recipients.
  const text = `${briefing.body}\n\n---\nOpen the live briefing: ${docUrl}`;

  // Send one email per recipient so a single bad address can't block the rest,
  // and so "exactly one email per recipient" holds even on partial failure.
  const sent: string[] = [];
  const failed: { to: string; error: string }[] = [];
  for (const to of recipients) {
    try {
      await sendEmail({
        to,
        subject,
        html,
        text,
        // Internal board notification — do not rewrite links through the
        // marketing click-tracking subdomain.
        clickTracking: false,
      });
      sent.push(to);
    } catch (error) {
      failed.push({
        to,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  if (failed.length > 0) {
    // Surface the failure the way our other crons alarm — no silent failure.
    console.error(
      `[cron/board-briefing-email] ${failed.length}/${recipients.length} sends failed:`,
      failed.map((f) => `${f.to}: ${f.error}`).join("; ")
    );
    return NextResponse.json(
      { ok: false, sent, failed },
      { status: 502 }
    );
  }

  return NextResponse.json({ ok: true, sent, subject });
}

export async function GET(request: Request): Promise<NextResponse> {
  return handle(request);
}

export async function POST(request: Request): Promise<NextResponse> {
  return handle(request);
}
