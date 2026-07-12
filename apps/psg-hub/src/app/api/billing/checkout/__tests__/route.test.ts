import { beforeEach, describe, expect, it, vi } from "vitest";

const checkoutCreate = vi.fn();
let mockUser: { id: string; email?: string } | null = {
  id: "user_1",
  email: "qa@example.com",
};
let mockMembership: { shop_id: string } | null = { shop_id: "shop_b" };

vi.mock("@/lib/stripe", () => ({
  getStripe: vi.fn(() => ({
    checkout: {
      sessions: {
        create: checkoutCreate,
      },
    },
  })),
}));

vi.mock("@/lib/supabase/server", () => ({
  createClient: vi.fn(async () => ({
    auth: {
      getUser: vi.fn().mockResolvedValue({ data: { user: mockUser } }),
    },
    from: vi.fn(() => ({
      select: vi.fn().mockReturnThis(),
      eq: vi.fn().mockReturnThis(),
      maybeSingle: vi
        .fn()
        .mockImplementation(() =>
          Promise.resolve({ data: mockMembership, error: null })
        ),
    })),
  })),
}));

const { POST } = await import("@/app/api/billing/checkout/route");

function request(body: Record<string, string>) {
  return new Request("https://hub.test/api/billing/checkout", {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams(body),
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  process.env.STRIPE_PERFORMANCE_PRICE_ID = "price_performance";
  process.env.NEXT_PUBLIC_APP_URL = "https://hub.psgweb.me";
  mockUser = { id: "user_1", email: "qa@example.com" };
  mockMembership = { shop_id: "shop_b" };
  checkoutCreate.mockResolvedValue({ url: "https://stripe.test/checkout" });
});

describe("billing checkout route shop scoping", () => {
  it("rejects checkout when shop_id is missing", async () => {
    const res = await POST(request({ tier: "performance" }));

    expect(res.status).toBe(400);
    await expect(res.json()).resolves.toEqual({ error: "Missing shop_id" });
    expect(checkoutCreate).not.toHaveBeenCalled();
  });

  it("rejects checkout for a shop the user does not belong to", async () => {
    mockMembership = null;

    const res = await POST(
      request({ tier: "performance", shop_id: "shop_b" })
    );

    expect(res.status).toBe(403);
    await expect(res.json()).resolves.toEqual({ error: "Forbidden" });
    expect(checkoutCreate).not.toHaveBeenCalled();
  });

  it("passes the selected shop_id to Stripe metadata and return URLs", async () => {
    const res = await POST(
      request({ tier: "performance", shop_id: "shop_b" })
    );

    expect(res.status).toBe(303);
    expect(checkoutCreate).toHaveBeenCalledTimes(1);
    expect(checkoutCreate.mock.calls[0][0]).toMatchObject({
      mode: "subscription",
      line_items: [{ price: "price_performance", quantity: 1 }],
      metadata: { user_id: "user_1", shop_id: "shop_b", tier: "performance" },
      success_url:
        "https://hub.psgweb.me/dashboard/billing?shop_id=shop_b&success=true",
      cancel_url: "https://hub.psgweb.me/dashboard/billing?shop_id=shop_b",
    });
  });
});
