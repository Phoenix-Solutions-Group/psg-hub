import { beforeEach, describe, expect, it, vi } from "vitest";

let mockUser: { id: string; email?: string } | null = null;
let mockShops: Array<{ id: string; name: string; role: string }> = [];
const sendEmail = vi.fn();

vi.mock("@/lib/supabase/server", () => ({
  createClient: vi.fn(async () => ({
    auth: { getUser: vi.fn(async () => ({ data: { user: mockUser } })) },
  })),
}));

vi.mock("@/lib/shop/context", () => ({
  getUserShops: vi.fn(async () => mockShops),
}));

vi.mock("@/lib/mail/sendgrid", () => ({ sendEmail }));

const { POST } = await import("@/app/api/dashboard/portfolio-access/route");

function request(body: unknown = { tool: "ads" }) {
  return new Request("https://hub.test/api/dashboard/portfolio-access", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

beforeEach(() => {
  mockUser = { id: "user-1", email: "owner@example.com" };
  mockShops = [
    { id: "shop-1", name: "North", role: "owner" },
    { id: "shop-2", name: "South", role: "viewer" },
  ];
  process.env.PORTFOLIO_ACCESS_RECIPIENT = "portfolio@psgweb.me";
  sendEmail.mockReset().mockResolvedValue({ statusCode: 202 });
});

describe("POST /api/dashboard/portfolio-access", () => {
  it("requires authentication before doing work", async () => {
    mockUser = null;
    const response = await POST(request());
    expect(response.status).toBe(401);
    expect(sendEmail).not.toHaveBeenCalled();
  });

  it("accepts only the supported upgradeable tool", async () => {
    expect((await POST(request({ tool: "agents" }))).status).toBe(400);
    expect((await POST(request({ tool: "__proto__" }))).status).toBe(400);
    expect(sendEmail).not.toHaveBeenCalled();
  });

  it("requires a portfolio and elevated access on at least one location", async () => {
    mockShops = [{ id: "shop-1", name: "North", role: "owner" }];
    expect((await POST(request())).status).toBe(400);

    mockShops = [
      { id: "shop-1", name: "North", role: "viewer" },
      { id: "shop-2", name: "South", role: "viewer" },
    ];
    expect((await POST(request())).status).toBe(403);
    expect(sendEmail).not.toHaveBeenCalled();
  });

  it("fails visibly when the recipient is not configured", async () => {
    delete process.env.PORTFOLIO_ACCESS_RECIPIENT;
    const response = await POST(request());
    expect(response.status).toBe(503);
    expect(sendEmail).not.toHaveBeenCalled();
  });

  it("emails server-derived user, location, and role context", async () => {
    const response = await POST(request());
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ sent: true });
    expect(sendEmail).toHaveBeenCalledWith(
      expect.objectContaining({
        to: "portfolio@psgweb.me",
        subject: "PSG Hub portfolio access request — Google Ads",
        clickTracking: false,
        text: expect.stringContaining("North (owner) [shop-1]"),
      })
    );
    expect(sendEmail.mock.calls[0][0].text).toContain("South (viewer) [shop-2]");
    expect(sendEmail.mock.calls[0][0].text).toContain("owner@example.com [user-1]");
  });

  it("does not show success when delivery fails", async () => {
    sendEmail.mockRejectedValueOnce(new Error("provider down"));
    const response = await POST(request());
    expect(response.status).toBe(502);
  });
});
