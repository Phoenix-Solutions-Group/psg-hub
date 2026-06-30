import { NextResponse } from "next/server";
import {
  captureInboundLead,
  createPipedriveIntakeClient,
  type InboundLeadInput,
} from "@/lib/leads/pipedrive-intake";

/**
 * PSG-499 — Inbound web lead capture.
 *
 * `POST /api/leads/inbound` is the permanent, reusable backend for inbound web leads
 * (parent PSG-493). The public form (PSG-495) and any future marketing site call it.
 * It creates an attribution-stamped Pipedrive deal (Lead Source Channel + raw UTMs) in
 * PSG Sales / New Lead, server-side only — the Pipedrive admin token (PIPEDRIVE_API_KEY)
 * is NEVER read in the browser, returned, or logged.
 *
 * Anti-spam, in order:
 *   1. Honeypot field (`company_website`) — bots fill hidden fields; humans never do.
 *      A non-empty value returns a decoy 200 OK and creates NOTHING (we don't tip off the
 *      bot that it was caught).
 *   2. Strict server-side validation (shop name + a real email or phone; valid email shape).
 *   3. Idempotency — the deal title is keyed on (shop + day); a double-submit dedupes to
 *      one deal (see captureInboundLead).
 */

// Node runtime: the intake client uses server-only env + Node fetch semantics.
export const runtime = "nodejs";

// The hidden honeypot input the public form renders off-screen. Real users leave it empty.
const HONEYPOT_FIELD = "company_website";

// Conservative email shape check (defense-in-depth; Pipedrive is the source of truth).
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

type LeadBody = {
  shopName?: unknown;
  contactName?: unknown;
  email?: unknown;
  phone?: unknown;
  message?: unknown;
  leadSourceChannel?: unknown;
  utmSource?: unknown;
  utmMedium?: unknown;
  utmCampaign?: unknown;
  utmContent?: unknown;
  // Honeypot (and tolerate the snake_case URL param naming too).
  company_website?: unknown;
  utm_source?: unknown;
  utm_medium?: unknown;
  utm_campaign?: unknown;
  utm_content?: unknown;
};

function str(v: unknown): string | null {
  return typeof v === "string" && v.trim() !== "" ? v.trim() : null;
}

export async function POST(request: Request) {
  let body: LeadBody;
  try {
    body = (await request.json()) as LeadBody;
  } catch {
    return NextResponse.json({ ok: false, error: "Invalid JSON" }, { status: 400 });
  }
  if (typeof body !== "object" || body === null) {
    return NextResponse.json({ ok: false, error: "Invalid body" }, { status: 400 });
  }

  // 1. Honeypot — decoy success, create nothing. (Don't reveal the trap to the bot.)
  const honeypot = body[HONEYPOT_FIELD];
  if (typeof honeypot === "string" && honeypot.trim() !== "") {
    return NextResponse.json({ ok: true });
  }

  // 2. Validate.
  const shopName = str(body.shopName);
  if (!shopName) {
    return NextResponse.json({ ok: false, error: "shopName is required" }, { status: 400 });
  }
  const email = str(body.email);
  const phone = str(body.phone);
  if (!email && !phone) {
    return NextResponse.json(
      { ok: false, error: "A contact email or phone is required" },
      { status: 400 },
    );
  }
  if (email && !EMAIL_RE.test(email)) {
    return NextResponse.json({ ok: false, error: "Invalid email" }, { status: 400 });
  }

  const input: InboundLeadInput = {
    shopName,
    contactName: str(body.contactName),
    email,
    phone,
    leadSourceChannel: str(body.leadSourceChannel),
    utmSource: str(body.utmSource) ?? str(body.utm_source),
    utmMedium: str(body.utmMedium) ?? str(body.utm_medium),
    utmCampaign: str(body.utmCampaign) ?? str(body.utm_campaign),
    utmContent: str(body.utmContent) ?? str(body.utm_content),
  };

  // 3. Create the attributed deal (server-only token).
  try {
    const client = createPipedriveIntakeClient();
    const result = await captureInboundLead(client, input);
    return NextResponse.json({
      ok: true,
      dealId: result.dealId,
      idempotent: result.idempotent,
    });
  } catch (err) {
    // Never leak token material or internals to the caller. Log server-side only.
    console.error(
      "[leads/inbound] capture failed:",
      err instanceof Error ? err.message : "unknown error",
    );
    return NextResponse.json(
      { ok: false, error: "Could not submit lead. Please try again." },
      { status: 502 },
    );
  }
}
