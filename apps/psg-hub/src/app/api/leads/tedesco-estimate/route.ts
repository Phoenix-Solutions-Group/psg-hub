import { type NextRequest, NextResponse } from "next/server";
import { sendEmail } from "@/lib/mail/sendgrid";
import type { MailAttachment } from "@/lib/mail/types";

// Tedesco Auto Body estimate-form lead capture (PSG-790, parent PSG-783).
//
// The landing page posts multipart/form-data here. The client's contract is
// simple and honest: ANY 2xx => it shows a "we'll call you shortly" card; ANY
// non-2xx / network error => it shows the call/text fallback and never a false
// success. So we return 2xx ONLY once the lead is safely handed off (email
// accepted by SendGrid); otherwise we return an error so the visitor is told to
// call/text instead of being falsely reassured.
//
// Data minimization (PSG-790): we capture only what the shop needs to prepare an
// estimate — name, phone, vehicle, description, optional photo. No tracking or
// marketing fields, and we do not persist the lead anywhere beyond the email.

// File upload + multipart require the Node.js runtime (not edge).
export const runtime = "nodejs";

const MAX_PHOTO_BYTES = 10 * 1024 * 1024; // 10 MB
const ALLOWED_PHOTO_TYPES = new Set([
  "image/jpeg",
  "image/png",
  "image/webp",
  "image/heic",
  "image/heif",
  "image/gif",
]);

const MAX_FIELD_LEN = 2000;

// Best-effort in-memory rate limit. On serverless this is per-instance only, so
// it is a first line of defense, not a hard guarantee — the honeypot and (later)
// an edge/WAF limit are the real backstops. The issue treats this as "welcome,
// not a blocker".
const RATE_LIMIT_MAX = 5;
const RATE_LIMIT_WINDOW_MS = 10 * 60 * 1000;
const hits = new Map<string, number[]>();

function isRateLimited(key: string, now: number): boolean {
  const recent = (hits.get(key) ?? []).filter((t) => now - t < RATE_LIMIT_WINDOW_MS);
  recent.push(now);
  hits.set(key, recent);
  return recent.length > RATE_LIMIT_MAX;
}

function clientKey(request: NextRequest): string {
  const fwd = request.headers.get("x-forwarded-for");
  return (fwd?.split(",")[0].trim() || request.headers.get("x-real-ip") || "unknown");
}

/** Trim + clamp a free-text field; returns undefined for empty. */
function cleanField(value: FormDataEntryValue | null): string | undefined {
  if (typeof value !== "string") return undefined;
  const trimmed = value.trim();
  if (!trimmed) return undefined;
  return trimmed.slice(0, MAX_FIELD_LEN);
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

interface Lead {
  name: string;
  phone: string;
  car?: string;
  what?: string;
}

function renderText(lead: Lead, photoNote: string): string {
  return [
    "New estimate request from the Tedesco website",
    "",
    `Name:    ${lead.name}`,
    `Phone:   ${lead.phone}`,
    `Vehicle: ${lead.car ?? "(not provided)"}`,
    `Needs:   ${lead.what ?? "(not provided)"}`,
    "",
    `Photo:   ${photoNote}`,
    "",
    "— Sent by the Body Shop Marketer lead form.",
  ].join("\n");
}

function renderHtml(lead: Lead, photoNote: string): string {
  const row = (label: string, value: string) =>
    `<tr><td style="padding:4px 12px 4px 0;font-weight:600;vertical-align:top">${label}</td>` +
    `<td style="padding:4px 0">${value}</td></tr>`;
  return [
    `<h2 style="margin:0 0 12px">New estimate request from the Tedesco website</h2>`,
    `<table style="border-collapse:collapse;font-family:system-ui,Arial,sans-serif;font-size:15px">`,
    row("Name", escapeHtml(lead.name)),
    row("Phone", `<a href="tel:${encodeURIComponent(lead.phone)}">${escapeHtml(lead.phone)}</a>`),
    row("Vehicle", lead.car ? escapeHtml(lead.car) : "<em>(not provided)</em>"),
    row("Needs", lead.what ? escapeHtml(lead.what) : "<em>(not provided)</em>"),
    row("Photo", escapeHtml(photoNote)),
    `</table>`,
    `<p style="color:#667;font-size:13px;margin-top:16px">Sent by the Body Shop Marketer lead form.</p>`,
  ].join("");
}

export async function POST(request: NextRequest): Promise<NextResponse> {
  let form: FormData;
  try {
    form = await request.formData();
  } catch {
    return NextResponse.json({ error: "Expected multipart/form-data" }, { status: 400 });
  }

  // Honeypot: a hidden field bots tend to fill. If present, silently accept so
  // the bot believes it succeeded, but drop the submission (no email sent).
  const honeypot = cleanField(form.get("company"));
  if (honeypot) {
    return NextResponse.json({ ok: true });
  }

  const key = clientKey(request);
  if (isRateLimited(key, Date.now())) {
    return NextResponse.json({ error: "Too many requests" }, { status: 429 });
  }

  const name = cleanField(form.get("name"));
  const phone = cleanField(form.get("phone"));
  if (!name || !phone) {
    return NextResponse.json({ error: "Name and phone are required" }, { status: 400 });
  }

  const lead: Lead = {
    name,
    phone,
    car: cleanField(form.get("car")),
    what: cleanField(form.get("what")),
  };

  // Optional photo. If it is present but too large or not an image, we keep the
  // lead (name + phone are what matters) and just note the photo was dropped —
  // never fail the whole submission over an attachment.
  const attachments: MailAttachment[] = [];
  let photoNote = "none attached";
  const photo = form.get("photo");
  if (photo && typeof photo !== "string" && photo.size > 0) {
    if (photo.size > MAX_PHOTO_BYTES) {
      photoNote = `omitted — file too large (${Math.round(photo.size / 1024 / 1024)} MB)`;
    } else if (photo.type && !ALLOWED_PHOTO_TYPES.has(photo.type)) {
      photoNote = `omitted — unsupported type (${photo.type})`;
    } else {
      const buf = Buffer.from(await photo.arrayBuffer());
      attachments.push({
        content: buf.toString("base64"),
        filename: photo.name || "photo",
        type: photo.type || "application/octet-stream",
        disposition: "attachment",
      });
      photoNote = `attached (${photo.name || "photo"})`;
    }
  }

  // Where the lead is delivered. This MUST be the real, operator-confirmed shop
  // inbox — there is no fallback. If it is not configured we cannot durably
  // capture the lead, so we return a non-2xx and let the page show the honest
  // call/text fallback rather than emailing a black hole and falsely confirming.
  const inbox = process.env.TEDESCO_LEAD_INBOX?.trim();
  if (!inbox) {
    console.error(
      "[leads/tedesco-estimate] TEDESCO_LEAD_INBOX is not set — refusing to " +
        "confirm a lead we cannot deliver. Set the real shop inbox in the environment."
    );
    return NextResponse.json(
      { error: "Could not submit right now — please call or text the shop." },
      { status: 503 }
    );
  }

  try {
    await sendEmail({
      to: inbox,
      // Staff replies (or shared-inbox routing) go back to the shop inbox; the
      // From address is the verified system sender (SENDGRID_FROM_EMAIL).
      replyTo: inbox,
      subject: `New estimate request — ${lead.name}`,
      text: renderText(lead, photoNote),
      html: renderHtml(lead, photoNote),
      attachments,
      // Transactional internal notification — no marketing link rewriting.
      clickTracking: false,
    });
  } catch (error) {
    // Lead was NOT safely delivered. Return non-2xx so the page shows the
    // call/text fallback instead of a false "we'll call you" confirmation.
    console.error(
      "[leads/tedesco-estimate] lead email failed:",
      error instanceof Error ? error.message : error
    );
    return NextResponse.json(
      { error: "Could not submit right now — please call or text the shop." },
      { status: 502 }
    );
  }

  return NextResponse.json({ ok: true });
}
