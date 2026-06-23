import { describe, it, expect, vi, beforeEach } from "vitest";

const { recorded } = vi.hoisted(() => ({ recorded: [] as unknown[] }));
vi.mock("@/lib/supabase/service", () => ({ createServiceClient: () => ({}) }));
vi.mock("@/lib/ops/solicitation/store", () => ({
  supabaseSolicitationStore: () => ({
    recordOptOutEvent: async (e: unknown) => {
      recorded.push(e);
    },
  }),
}));

import { GET, POST } from "../route";
import { makeUnsubscribeToken } from "@/lib/ops/solicitation/token";

const BASE = "https://hub.psgweb.me/api/unsubscribe";

beforeEach(() => {
  recorded.length = 0;
});

describe("GET /api/unsubscribe", () => {
  it("records an opt-out for a valid signed token and confirms (200 html)", async () => {
    const token = makeUnsubscribeToken("email", "Jordan@Shop.com");
    const res = await GET(new Request(`${BASE}?token=${encodeURIComponent(token)}`));
    expect(res.status).toBe(200);
    expect(res.headers.get("Content-Type")).toContain("text/html");
    expect(recorded).toHaveLength(1);
    expect(recorded[0]).toMatchObject({
      channel: "email",
      state: "opted_out",
      reason: "email_unsubscribe",
      source: "unsubscribe_link",
    });
  });

  it("rejects an invalid/forged token (400), records nothing", async () => {
    const res = await GET(new Request(`${BASE}?token=garbage.sig`));
    expect(res.status).toBe(400);
    expect(recorded).toHaveLength(0);
  });

  it("is idempotent: clicking twice yields the same event_ref", async () => {
    const token = makeUnsubscribeToken("email", "jordan@shop.com");
    await GET(new Request(`${BASE}?token=${encodeURIComponent(token)}`));
    await GET(new Request(`${BASE}?token=${encodeURIComponent(token)}`));
    expect(recorded).toHaveLength(2);
    expect((recorded[0] as { event_ref: string }).event_ref).toBe(
      (recorded[1] as { event_ref: string }).event_ref
    );
  });
});

describe("POST /api/unsubscribe (RFC 8058 one-click)", () => {
  it("honors a token in the query string (200 json)", async () => {
    const token = makeUnsubscribeToken("email", "jordan@shop.com");
    const res = await POST(
      new Request(`${BASE}?token=${encodeURIComponent(token)}`, { method: "POST" })
    );
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ unsubscribed: true });
    expect(recorded).toHaveLength(1);
  });

  it("honors a token posted as a form field", async () => {
    const token = makeUnsubscribeToken("email", "jordan@shop.com");
    const res = await POST(
      new Request(BASE, {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({ token }).toString(),
      })
    );
    expect(res.status).toBe(200);
  });

  it("rejects a missing/invalid token (400)", async () => {
    const res = await POST(new Request(BASE, { method: "POST" }));
    expect(res.status).toBe(400);
    expect(recorded).toHaveLength(0);
  });
});
