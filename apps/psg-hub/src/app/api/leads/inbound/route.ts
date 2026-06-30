import { NextResponse } from "next/server";
import {
  captureInboundLead,
  createPipedriveIntakeClient,
  type InboundLeadInput,
} from "@/lib/leads/pipedrive-intake";
import {
  assertWithinLeadLimits,
  clientIp,
  hashIp,
  LeadRateLimitError,
  recordLeadSubmission,
} from "@/lib/leads/rate-limit";

/**
 * PSG-499 — Inbound web lead capture. PSG-503 — public-input hardening.
 *
 * `POST /api/leads/inbound` is the permanent, reusable backend for inbound web leads
 * (parent PSG-493). The public form (PSG-495) and any future marketing site call it.
 * It creates an attribution-stamped Pipedrive deal (Lead Source Channel + raw UTMs) in
 * PSG Sales / New Lead, server-side only — the Pipedrive admin token (PIPEDRIVE_API_KEY)
 * is NEVER read in the browser, returned, or logged.
 *
 * Abuse control, in order (PSG-503 added 0, 1b, and the rate limit):
 *   0. Oversized-payload guard — reject by Content-Length before parsing, and cap every
 *      accepted field's length, so a bot cannot blow up memory or smuggle a giant value.
 *   1a. Rate limit (durable, serverless-safe) — per-IP + a global per-window cap so a bot
 *       that skips the honeypot cannot flood the CRM / burn our Pipedrive quota (429).
 *   1b. Honeypot field (`company_website`) — bots fill hidden fields; humans never do.
 *       A non-empty value returns a decoy 200 OK and creates NOTHING (we don't tip off the
 *       bot that it was caught).
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

// Reject the whole request before parsing when its declared body is absurdly large.
const MAX_BODY_BYTES = 64 * 1024;

// Per-field maximum character lengths (raw, pre-trim). Anything over → 400. These bound
// oversized-payload abuse and match the PSG-503 contract. snake_case UTM aliases share the
// same caps as their camelCase twins.
const FIELD_MAX_LEN: Record<string, number> = {
  shopName: 200,
  contactName: 200,
  email: 320, // RFC 5321 max addr length
  phone: 40,
  message: 5000,
  leadSourceChannel: 200,
  utmSource: 500,
  utmMedium: 500,
  utmCampaign: 500,
  utmContent: 500,
  utm_source: 500,
  utm_medium: 500,
  utm_campaign: 500,
  utm_content: 500,
  company_website: 200,
};

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
  // 0a. Oversized-payload guard — reject by declared size before we read/parse the body.
  const declaredLen = Number(request.headers.get("content-length") ?? "");
  if (Number.isFinite(declaredLen) && declaredLen > MAX_BODY_BYTES) {
    return NextResponse.json({ ok: false, error: "Payload too large" }, { status: 413 });
  }

  let body: LeadBody;
  try {
    body = (await request.json()) as LeadBody;
  } catch {
    return NextResponse.json({ ok: false, error: "Invalid JSON" }, { status: 400 });
  }
  if (typeof body !== "object" || body === null) {
    return NextResponse.json({ ok: false, error: "Invalid body" }, { status: 400 });
  }

  // 0b. Per-field length caps — bound every accepted string before anything else touches
  // it. Generic message (don't enumerate which field) to avoid handing bots a probe.
  const record = body as Record<string, unknown>;
  for (const [field, max] of Object.entries(FIELD_MAX_LEN)) {
    const v = record[field];
    if (typeof v === "string" && v.length > max) {
      return NextResponse.json(
        { ok: false, error: "A field exceeds the maximum allowed length" },
        { status: 400 },
      );
    }
  }

  // 1a. Rate limit — per-IP + global window cap (durable, serverless-safe). Fail CLOSED on
  // an infra error (503) so a DB outage cannot become an open floodgate.
  const ipHash = hashIp(clientIp(request));
  try {
    await assertWithinLeadLimits({ ipHash });
  } catch (err) {
    if (err instanceof LeadRateLimitError) {
      return NextResponse.json(
        { ok: false, error: "Too many requests. Please try again later." },
        { status: 429 },
      );
    }
    console.error(
      "[leads/inbound] rate-limit check error:",
      err instanceof Error ? err.message : "unknown error",
    );
    return NextResponse.json(
      { ok: false, error: "Service temporarily unavailable. Please try again." },
      { status: 503 },
    );
  }

  // 1b. Honeypot — decoy success, create nothing. (Don't reveal the trap to the bot.)
  // Still recorded so a honeypot flood counts against the caps above.
  const honeypot = body[HONEYPOT_FIELD];
  if (typeof honeypot === "string" && honeypot.trim() !== "") {
    await recordLeadSubmission({ ipHash, outcome: "honeypot" });
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

  // Record the genuine attempt BEFORE the Pipedrive call so it counts toward the window
  // even if the create fails — this is what stops a retry-flood from burning our quota.
  await recordLeadSubmission({ ipHash, outcome: "accepted" });

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
