import { type NextRequest, NextResponse } from "next/server";
import { sendEmail } from "@/lib/mail/sendgrid";

export const runtime = "nodejs";

const MAX_FIELD_LEN = 320;
const RATE_LIMIT_MAX = 8;
const RATE_LIMIT_WINDOW_MS = 10 * 60 * 1000;
const hits = new Map<string, number[]>();

interface DownloadLead {
  email: string;
  name?: string;
  shopName?: string;
  referrer?: string;
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

function isValidEmail(value: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value);
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function renderText(lead: DownloadLead): string {
  return [
    "New flagship white paper PDF download lead",
    "",
    `Email:    ${lead.email}`,
    `Name:     ${lead.name ?? "(not provided)"}`,
    `Shop:     ${lead.shopName ?? "(not provided)"}`,
    `Referrer: ${lead.referrer ?? "(not provided)"}`,
    "",
    "Source: Found When It Matters Most white paper gated download.",
  ].join("\n");
}

function renderHtml(lead: DownloadLead): string {
  const row = (label: string, value: string) =>
    `<tr><td style="padding:4px 14px 4px 0;font-weight:600;vertical-align:top">${label}</td>` +
    `<td style="padding:4px 0">${value}</td></tr>`;

  return [
    `<h2 style="margin:0 0 12px">New flagship white paper PDF download lead</h2>`,
    `<table style="border-collapse:collapse;font-family:system-ui,Arial,sans-serif;font-size:15px">`,
    row("Email", `<a href="mailto:${encodeURIComponent(lead.email)}">${escapeHtml(lead.email)}</a>`),
    row("Name", lead.name ? escapeHtml(lead.name) : "<em>(not provided)</em>"),
    row("Shop", lead.shopName ? escapeHtml(lead.shopName) : "<em>(not provided)</em>"),
    row("Referrer", lead.referrer ? escapeHtml(lead.referrer) : "<em>(not provided)</em>"),
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

  const email = cleanField(form.get("email"));
  if (!email || !isValidEmail(email)) {
    return NextResponse.json({ error: "A valid email is required" }, { status: 400 });
  }

  const inbox =
    process.env.WHITEPAPER_DOWNLOAD_INBOX?.trim() ||
    process.env.PSG_LEAD_INBOX?.trim();
  if (!inbox) {
    console.error("[leads/whitepaper-download] WHITEPAPER_DOWNLOAD_INBOX or PSG_LEAD_INBOX is not set");
    return NextResponse.json(
      { error: "Could not unlock the PDF right now. Please email Phoenix Solutions Group directly." },
      { status: 503 }
    );
  }

  const lead: DownloadLead = {
    email,
    name: cleanField(form.get("name")),
    shopName: cleanField(form.get("shopName")),
    referrer: cleanField(form.get("referrer")),
  };

  try {
    await sendEmail({
      to: inbox,
      replyTo: email,
      subject: `White paper PDF download - ${lead.shopName ?? lead.email}`,
      text: renderText(lead),
      html: renderHtml(lead),
      clickTracking: false,
    });
  } catch (error) {
    console.error(
      "[leads/whitepaper-download] lead capture failed:",
      error instanceof Error ? error.message : error
    );
    return NextResponse.json(
      { error: "Could not unlock the PDF right now. Please email Phoenix Solutions Group directly." },
      { status: 502 }
    );
  }

  return NextResponse.json({ ok: true });
}
