import "server-only";
import { createHmac } from "node:crypto";
import { createServiceClient } from "@/lib/supabase/service";

/**
 * PSG-503 — Inbound lead-form abuse control.
 *
 * Bounds how many submissions a single client IP — and the endpoint globally — may make
 * in a sliding window, so a bot that skips the honeypot (PSG-499) cannot flood Pipedrive
 * (and our write quota) with junk deals. Counts rows in public.inbound_lead_submissions
 * via the service-role client; mirrors the reviews / ads-mutations limiter idiom
 * (src/lib/reviews/rate-limit.ts).
 *
 * A DURABLE table is required: an in-process counter resets on every Vercel cold start,
 * so a flood spread across serverless instances would never trip an in-memory limit.
 */

export class LeadRateLimitError extends Error {
  constructor(
    public scope: "per_ip" | "global",
    public limit: number,
    public windowMinutes: number,
  ) {
    super(
      `Inbound lead rate limit exceeded: ${scope} (${limit} per ${windowMinutes} min)`,
    );
    this.name = "LeadRateLimitError";
  }
}

// Generous for a human (a shop submits once), tight for a bot. Tunable here.
const PER_IP_LIMIT = 5;
const PER_IP_WINDOW_MIN = 10;
const GLOBAL_LIMIT = 60;
const GLOBAL_WINDOW_MIN = 10;

/** Non-secret fallback salt for local dev + unit tests (NOT for production). */
const DEV_FALLBACK_SALT = "psg-bsm-leads-dev-salt-v0";

function saltOf(explicit?: string): string {
  // Reuse MAIL_HASH_SALT when a dedicated leads salt is not set, so the whole BSM PII
  // surface shares one rotateable secret in production (mirrors solicitation/contact.ts).
  return (
    explicit ??
    process.env.LEADS_HASH_SALT ??
    process.env.MAIL_HASH_SALT ??
    DEV_FALLBACK_SALT
  );
}

/**
 * Derive the client IP from the `x-forwarded-for` chain. Behind Vercel the FIRST hop is
 * the real client; the trailing hops are proxies. Falls back to `x-real-ip`, then a
 * single shared "unknown" bucket (the safe direction — unknowns throttle together rather
 * than each getting an unlimited budget).
 */
export function clientIp(request: Request): string {
  const xff = request.headers.get("x-forwarded-for");
  if (xff) {
    const first = xff.split(",")[0]?.trim();
    if (first) return first;
  }
  return request.headers.get("x-real-ip")?.trim() || "unknown";
}

/** Salted HMAC of an IP — the stored key. The raw IP is never stored or logged. */
export function hashIp(ip: string, opts?: { salt?: string }): string {
  return createHmac("sha256", saltOf(opts?.salt)).update(ip).digest("hex");
}

/**
 * Throw LeadRateLimitError when the per-IP or global window cap is reached. A query
 * (infrastructure) failure throws a generic Error — the route maps that to a fail-closed
 * 503 rather than letting an outage become an open floodgate.
 */
export async function assertWithinLeadLimits(input: {
  ipHash: string;
}): Promise<void> {
  const service = createServiceClient();

  const ipWindowStart = new Date(
    Date.now() - PER_IP_WINDOW_MIN * 60 * 1000,
  ).toISOString();
  const { count: ipCount, error: ipErr } = await service
    .from("inbound_lead_submissions")
    .select("id", { count: "exact", head: true })
    .eq("ip_hash", input.ipHash)
    .gte("created_at", ipWindowStart);
  if (ipErr) throw new Error(`lead rate-limit check failed: ${ipErr.message}`);
  if ((ipCount ?? 0) >= PER_IP_LIMIT) {
    throw new LeadRateLimitError("per_ip", PER_IP_LIMIT, PER_IP_WINDOW_MIN);
  }

  const globalWindowStart = new Date(
    Date.now() - GLOBAL_WINDOW_MIN * 60 * 1000,
  ).toISOString();
  const { count: globalCount, error: globalErr } = await service
    .from("inbound_lead_submissions")
    .select("id", { count: "exact", head: true })
    .gte("created_at", globalWindowStart);
  if (globalErr) throw new Error(`lead rate-limit check failed: ${globalErr.message}`);
  if ((globalCount ?? 0) >= GLOBAL_LIMIT) {
    throw new LeadRateLimitError("global", GLOBAL_LIMIT, GLOBAL_WINDOW_MIN);
  }
}

/**
 * Record one submission attempt so it counts toward future windows. Best-effort: a log
 * failure must never fail the user's lead, but is surfaced server-side. Recorded for both
 * honeypot hits and accepted leads so a bot flood is throttled regardless of which path
 * it takes.
 */
export async function recordLeadSubmission(input: {
  ipHash: string;
  outcome: "honeypot" | "accepted";
}): Promise<void> {
  try {
    const service = createServiceClient();
    const { error } = await service
      .from("inbound_lead_submissions")
      .insert({ ip_hash: input.ipHash, outcome: input.outcome });
    if (error) {
      console.error("[leads/inbound] submission log failed:", error.message);
    }
  } catch (err) {
    console.error(
      "[leads/inbound] submission log threw:",
      err instanceof Error ? err.message : "unknown error",
    );
  }
}
