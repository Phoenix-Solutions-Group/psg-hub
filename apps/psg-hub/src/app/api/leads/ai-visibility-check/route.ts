import { type NextRequest, NextResponse } from "next/server";
import { sendEmail } from "@/lib/mail/sendgrid";

export const runtime = "nodejs";

const MAX_FIELD_LEN = 1200;
const RATE_LIMIT_MAX = 5;
const RATE_LIMIT_WINDOW_MS = 10 * 60 * 1000;
const hits = new Map<string, number[]>();

interface Lead {
  name: string;
  shopName: string;
  location: string;
  email?: string;
  phone?: string;
  notes?: string;
}

function cleanField(value: FormDataEntryValue | null): string | undefined {
  if (typeof value !== "string") return undefined;
  const trimmed = value.trim();
  if (!trimmed) return undefined;
  return trimmed.slice(0, MAX_FIELD_LEN);
}

function clientKey(request: NextRequest): string {
  const forwarded = request.headers.get("x-forwarded-for");
  return forwarded?.split(",")[0]?.trim() || request.headers.get("x-real-ip") || "unknown";
}

function isRateLimited(key: string, now: number): boolean {
  const recent = (hits.get(key) ?? []).filter((timestamp) => now - timestamp < RATE_LIMIT_WINDOW_MS);
  recent.push(now);
  hits.set(key, recent);
  return recent.length > RATE_LIMIT_MAX;
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function renderText(lead: Lead): string {
  return [
    "New AI Visibility Check request from the PSG whitepaper page",
    "",
    `Name:      ${lead.name}`,
    `Shop:      ${lead.shopName}`,
    `City/ZIP:  ${lead.location}`,
    `Email:     ${lead.email ?? "(not provided)"}`,
    `Phone:     ${lead.phone ?? "(not provided)"}`,
    `Notes:     ${lead.notes ?? "(not provided)"}`,
    "",
    "Source: The New Front Door whitepaper.",
  ].join("\n");
}

function renderHtml(lead: Lead): string {
  const row = (label: string, value: string) =>
    `<tr><td style="padding:4px 14px 4px 0;font-weight:600;vertical-align:top">${label}</td>` +
    `<td style="padding:4px 0">${value}</td></tr>`;

  return [
    `<h2 style="margin:0 0 12px">New AI Visibility Check request</h2>`,
    `<p style="margin:0 0 16px">This request came from PSG's "The New Front Door" whitepaper page.</p>`,
    `<table style="border-collapse:collapse;font-family:system-ui,Arial,sans-serif;font-size:15px">`,
    row("Name", escapeHtml(lead.name)),
    row("Shop", escapeHtml(lead.shopName)),
    row("City/ZIP", escapeHtml(lead.location)),
    row("Email", lead.email ? `<a href="mailto:${encodeURIComponent(lead.email)}">${escapeHtml(lead.email)}</a>` : "<em>(not provided)</em>"),
    row("Phone", lead.phone ? `<a href="tel:${encodeURIComponent(lead.phone)}">${escapeHtml(lead.phone)}</a>` : "<em>(not provided)</em>"),
    row("Notes", lead.notes ? escapeHtml(lead.notes) : "<em>(not provided)</em>"),
    `</table>`,
  ].join("");
}

export async function POST(request: NextRequest): Promise<NextResponse> {
  let form: FormData;
  try {
    form = await request.formData();
  } catch {
    return NextResponse.json({ error: "Expected form data" }, { status: 400 });
  }

  const honeypot = cleanField(form.get("company"));
  if (honeypot) {
    return NextResponse.json({ ok: true });
  }

  const key = clientKey(request);
  if (isRateLimited(key, Date.now())) {
    return NextResponse.json({ error: "Too many requests" }, { status: 429 });
  }

  const name = cleanField(form.get("name"));
  const shopName = cleanField(form.get("shopName"));
  const location = cleanField(form.get("location"));
  const email = cleanField(form.get("email"));
  const phone = cleanField(form.get("phone"));

  if (!name || !shopName || !location) {
    return NextResponse.json({ error: "Name, shop name, and city or ZIP are required" }, { status: 400 });
  }

  if (!email && !phone) {
    return NextResponse.json({ error: "Email or phone is required" }, { status: 400 });
  }

  const inbox =
    process.env.AI_VISIBILITY_CHECK_INBOX?.trim() ||
    process.env.PSG_AI_CHECK_INBOX?.trim() ||
    process.env.PSG_LEAD_INBOX?.trim();
  if (!inbox) {
    console.error(
      "[leads/ai-visibility-check] AI_VISIBILITY_CHECK_INBOX, PSG_AI_CHECK_INBOX, or PSG_LEAD_INBOX is not set"
    );
    return NextResponse.json(
      { error: "Could not submit right now. Please email Phoenix Solutions Group directly." },
      { status: 503 }
    );
  }

  const lead: Lead = {
    name,
    shopName,
    location,
    email,
    phone,
    notes: cleanField(form.get("notes")),
  };

  try {
    await sendEmail({
      to: inbox,
      replyTo: email ?? inbox,
      subject: `AI Visibility Check request - ${lead.shopName}`,
      text: renderText(lead),
      html: renderHtml(lead),
      clickTracking: false,
    });
  } catch (error) {
    console.error(
      "[leads/ai-visibility-check] lead email failed:",
      error instanceof Error ? error.message : error
    );
    return NextResponse.json(
      { error: "Could not submit right now. Please email Phoenix Solutions Group directly." },
      { status: 502 }
    );
  }

  return NextResponse.json({ ok: true });
}
