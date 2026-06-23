// PSG-248 — CAN-SPAM unsubscribe endpoint (email; works without sign-in).
//
// The unsubscribe link in every solicitation email carries an HMAC-signed token
// (../../lib/ops/solicitation/token.ts). We verify the signature, then record an
// immutable opt-out for the token's contact. Two entry points:
//   - GET  ?token=… — a human clicking the link → returns a small HTML confirmation.
//   - POST          — RFC 8058 "List-Unsubscribe=One-Click" (mailbox providers POST
//                     the link automatically) → returns 200, no body needed.
// Both are idempotent: the opt-out event_ref is derived from the verified contact,
// so clicking twice (or a GET then a POST) collapses to one opt-out.
export const runtime = "nodejs";

import { NextResponse } from "next/server";
import { createServiceClient } from "@/lib/supabase/service";
import { supabaseSolicitationStore } from "@/lib/ops/solicitation/store";
import { verifyUnsubscribeToken } from "@/lib/ops/solicitation/token";
import { contactHash } from "@/lib/ops/solicitation/contact";
import type { SolicitationChannel } from "@/lib/ops/solicitation/types";

function htmlPage(message: string, status: number): NextResponse {
  const body = `<!doctype html><html lang="en"><head><meta charset="utf-8"/>
<meta name="viewport" content="width=device-width, initial-scale=1"/>
<title>Unsubscribe</title></head>
<body style="font-family:system-ui,sans-serif;max-width:32rem;margin:4rem auto;padding:0 1rem;color:#161616">
<p>${message}</p></body></html>`;
  return new NextResponse(body, {
    status,
    headers: { "Content-Type": "text/html; charset=utf-8" },
  });
}

/** Record the opt-out for a verified token. Returns true on success. */
async function applyUnsubscribe(token: string | null): Promise<boolean> {
  const verified = verifyUnsubscribeToken(token);
  if (!verified) return false;
  const channel: SolicitationChannel = verified.channel;
  const ch = contactHash(channel, verified.contact);
  if (ch === "") return false;

  const store = supabaseSolicitationStore(createServiceClient());
  await store.recordOptOutEvent({
    channel,
    contact_hash: ch,
    state: "opted_out",
    reason: channel === "email" ? "email_unsubscribe" : "sms_stop",
    source: "unsubscribe_link",
    // Idempotent + PII-free: keyed by the verified contact, not the raw value.
    event_ref: `unsub:${channel}:${ch}`,
  });
  return true;
}

export async function GET(request: Request) {
  const token = new URL(request.url).searchParams.get("token");
  let ok = false;
  try {
    ok = await applyUnsubscribe(token);
  } catch (err) {
    console.error("[unsubscribe] persist failed:", err instanceof Error ? err.message : err);
    return htmlPage("Something went wrong. Please try again later.", 500);
  }
  return ok
    ? htmlPage("You're unsubscribed. You won't get any more review requests from us.", 200)
    : htmlPage("This unsubscribe link is invalid or has expired.", 400);
}

export async function POST(request: Request) {
  // One-click (RFC 8058): the token rides in the query string of the
  // List-Unsubscribe URL; some providers also post it as a form field.
  let token = new URL(request.url).searchParams.get("token");
  if (!token) {
    try {
      const form = new URLSearchParams(await request.text());
      token = form.get("token");
    } catch {
      token = null;
    }
  }
  try {
    const ok = await applyUnsubscribe(token);
    return ok
      ? NextResponse.json({ unsubscribed: true })
      : NextResponse.json({ error: "Invalid token" }, { status: 400 });
  } catch (err) {
    console.error("[unsubscribe] persist failed:", err instanceof Error ? err.message : err);
    return NextResponse.json({ error: "Persist failed" }, { status: 500 });
  }
}
