import { describe, it, expect, vi, beforeEach } from "vitest";

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

import { POST } from "../route";

function post(body: unknown): Request {
  return new Request("https://psg.example/api/leads/inbound", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: typeof body === "string" ? body : JSON.stringify(body),
  });
}

beforeEach(() => {
  vi.clearAllMocks();
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
});
