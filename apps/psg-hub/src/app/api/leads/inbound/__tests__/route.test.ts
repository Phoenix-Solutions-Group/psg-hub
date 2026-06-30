import { describe, it, expect, vi, beforeEach } from "vitest";
import { LeadRateLimitError } from "@/lib/leads/rate-limit";

// Mock the server-only intake module so the route test never needs a live token.
// vi.mock is hoisted, so the mock fns must be created via vi.hoisted.
const { captureInboundLead, createPipedriveIntakeClient } = vi.hoisted(() => ({
  captureInboundLead: vi.fn(),
  createPipedriveIntakeClient: vi.fn(() => ({}) as never),
}));
vi.mock("@/lib/leads/pipedrive-intake", () => ({
  captureInboundLead,
  createPipedriveIntakeClient,
}));

// Mock only the DB-touching limiter fns; keep the REAL clientIp / hashIp / error class so
// `instanceof LeadRateLimitError` in the route still matches. (PSG-503)
const { assertWithinLeadLimits, recordLeadSubmission } = vi.hoisted(() => ({
  assertWithinLeadLimits: vi.fn(),
  recordLeadSubmission: vi.fn(),
}));
vi.mock("@/lib/leads/rate-limit", async (importOriginal) => {
  const actual = (await importOriginal()) as Record<string, unknown>;
  return { ...actual, assertWithinLeadLimits, recordLeadSubmission };
});

import { POST } from "../route";

function post(body: unknown, headers: Record<string, string> = {}): Request {
  return new Request("https://psg.example/api/leads/inbound", {
    method: "POST",
    headers: { "Content-Type": "application/json", ...headers },
    body: typeof body === "string" ? body : JSON.stringify(body),
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  assertWithinLeadLimits.mockResolvedValue(undefined);
  recordLeadSubmission.mockResolvedValue(undefined);
  captureInboundLead.mockResolvedValue({
    dealId: 1234,
    idempotent: false,
    channel: "Web Form (Direct)",
  });
});

describe("POST /api/leads/inbound", () => {
  it("creates a deal and returns a sanitized result on a valid submission", async () => {
    const res = await POST(
      post({
        shopName: "Smith Auto Body",
        contactName: "Jane",
        email: "jane@smithauto.com",
        utmSource: "google",
        utmMedium: "cpc",
        utmCampaign: "bsm",
        utmContent: "hero",
      }),
    );
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json).toEqual({ ok: true, dealId: 1234, idempotent: false });

    expect(captureInboundLead).toHaveBeenCalledTimes(1);
    const input = captureInboundLead.mock.calls[0][1];
    expect(input).toMatchObject({
      shopName: "Smith Auto Body",
      email: "jane@smithauto.com",
      utmSource: "google",
      utmMedium: "cpc",
    });
  });

  it("accepts snake_case utm_* params too", async () => {
    await POST(
      post({ shopName: "S", email: "a@b.com", utm_source: "fb", utm_medium: "paid_social" }),
    );
    const input = captureInboundLead.mock.calls[0][1];
    expect(input.utmSource).toBe("fb");
    expect(input.utmMedium).toBe("paid_social");
  });

  it("passes the idempotent flag through on a dedupe", async () => {
    captureInboundLead.mockResolvedValueOnce({
      dealId: 999,
      idempotent: true,
      channel: "Paid Search",
    });
    const res = await POST(post({ shopName: "Dup", email: "d@d.com" }));
    const json = await res.json();
    expect(json).toEqual({ ok: true, dealId: 999, idempotent: true });
  });

  // ── anti-spam ──────────────────────────────────────────────────────────────────
  it("silently drops a honeypot hit (decoy 200, NOTHING created)", async () => {
    const res = await POST(
      post({ shopName: "Bot", email: "bot@spam.com", company_website: "http://spam.ru" }),
    );
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true });
    expect(captureInboundLead).not.toHaveBeenCalled();
  });

  // ── validation ───────────────────────────────────────────────────────────────────
  it("rejects invalid JSON", async () => {
    const res = await POST(post("{not json"));
    expect(res.status).toBe(400);
    expect(captureInboundLead).not.toHaveBeenCalled();
  });

  it("requires a shop name", async () => {
    const res = await POST(post({ email: "a@b.com" }));
    expect(res.status).toBe(400);
    expect(captureInboundLead).not.toHaveBeenCalled();
  });

  it("requires a contact email or phone", async () => {
    const res = await POST(post({ shopName: "No Contact" }));
    expect(res.status).toBe(400);
    expect(captureInboundLead).not.toHaveBeenCalled();
  });

  it("rejects a malformed email", async () => {
    const res = await POST(post({ shopName: "Bad Email", email: "not-an-email" }));
    expect(res.status).toBe(400);
    expect(captureInboundLead).not.toHaveBeenCalled();
  });

  it("accepts a phone-only submission (no email)", async () => {
    const res = await POST(post({ shopName: "Phone Only", phone: "+1-555-123-4567" }));
    expect(res.status).toBe(200);
    expect(captureInboundLead).toHaveBeenCalledTimes(1);
  });

  // ── failure + token hygiene ────────────────────────────────────────────────────
  it("returns a generic 502 (no internals/token) when capture throws", async () => {
    const SECRET = "leaky-token-value";
    captureInboundLead.mockRejectedValueOnce(new Error(`boom api_token=${SECRET}`));
    const res = await POST(post({ shopName: "Err", email: "e@e.com" }));
    expect(res.status).toBe(502);
    const text = JSON.stringify(await res.json());
    expect(text).not.toContain(SECRET);
    expect(text).not.toContain("api_token");
  });

  it("never serializes a token to the client on success", async () => {
    const res = await POST(post({ shopName: "Clean", email: "c@c.com" }));
    const text = JSON.stringify(await res.json());
    expect(text).not.toMatch(/api_token|PIPEDRIVE_API_KEY/);
  });

  // ── PSG-503: rate limiting ───────────────────────────────────────────────────────
  it("returns a generic 429 (no internals) when the IP/global cap is hit", async () => {
    assertWithinLeadLimits.mockRejectedValueOnce(
      new LeadRateLimitError("per_ip", 5, 10),
    );
    const res = await POST(post({ shopName: "Flood", email: "f@f.com" }));
    expect(res.status).toBe(429);
    const text = JSON.stringify(await res.json());
    expect(text).not.toMatch(/per_ip|ip_hash|supabase|inbound_lead/i);
    expect(captureInboundLead).not.toHaveBeenCalled();
  });

  it("fails CLOSED with a generic 503 when the rate-limit check errors (infra down)", async () => {
    assertWithinLeadLimits.mockRejectedValueOnce(new Error("supabase unreachable"));
    const res = await POST(post({ shopName: "DbDown", email: "d@d.com" }));
    expect(res.status).toBe(503);
    const text = JSON.stringify(await res.json());
    expect(text).not.toContain("supabase");
    expect(captureInboundLead).not.toHaveBeenCalled();
  });

  it("records an accepted submission before creating the deal", async () => {
    await POST(post({ shopName: "Counted", email: "c@c.com" }));
    expect(recordLeadSubmission).toHaveBeenCalledWith(
      expect.objectContaining({ outcome: "accepted" }),
    );
    expect(captureInboundLead).toHaveBeenCalledTimes(1);
  });

  it("records a honeypot hit so floods still count against the cap", async () => {
    await POST(post({ shopName: "Bot", email: "b@b.com", company_website: "x.ru" }));
    expect(recordLeadSubmission).toHaveBeenCalledWith(
      expect.objectContaining({ outcome: "honeypot" }),
    );
    expect(captureInboundLead).not.toHaveBeenCalled();
  });

  // ── PSG-503: input length caps ───────────────────────────────────────────────────
  it("rejects an oversized field with a generic 400 (never reaches capture)", async () => {
    const res = await POST(
      post({ shopName: "A".repeat(201), email: "a@b.com" }),
    );
    expect(res.status).toBe(400);
    const text = JSON.stringify(await res.json());
    expect(text).toMatch(/maximum allowed length/);
    expect(captureInboundLead).not.toHaveBeenCalled();
    expect(assertWithinLeadLimits).not.toHaveBeenCalled(); // capped before the DB hit
  });

  it("rejects an oversized UTM value too", async () => {
    const res = await POST(
      post({ shopName: "Ok", email: "a@b.com", utm_campaign: "z".repeat(501) }),
    );
    expect(res.status).toBe(400);
    expect(captureInboundLead).not.toHaveBeenCalled();
  });

  it("accepts a field exactly at the cap boundary", async () => {
    const res = await POST(post({ shopName: "S".repeat(200), email: "a@b.com" }));
    expect(res.status).toBe(200);
  });

  it("rejects an over-large body by Content-Length before parsing (413)", async () => {
    // Behind Vercel the proxy sets Content-Length. (undici recomputes it from the real
    // body on a constructed Request, so we hand-roll one to assert the guard fires before
    // parsing.) Over MAX_BODY_BYTES (64 KB) → 413, no parse, no field check.
    const fakeReq = {
      headers: new Headers({ "content-length": String(65 * 1024) }),
      json: async () => {
        throw new Error("body must not be parsed when over-size");
      },
    } as unknown as Request;
    const res = await POST(fakeReq);
    expect(res.status).toBe(413);
    expect(captureInboundLead).not.toHaveBeenCalled();
    expect(assertWithinLeadLimits).not.toHaveBeenCalled();
  });
});
