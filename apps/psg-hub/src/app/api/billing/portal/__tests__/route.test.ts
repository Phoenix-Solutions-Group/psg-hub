import { beforeEach, describe, expect, it, vi } from "vitest";

const portalCreate = vi.fn();
let mockUser: { id: string } | null = { id: "user_1" };
let mockMembership: { shops: { stripe_customer_id: string | null } } | null = {
  shops: { stripe_customer_id: "cus_123" },
};

vi.mock("@/lib/stripe", () => ({
  getStripe: vi.fn(() => ({
    billingPortal: {
      sessions: {
        create: portalCreate,
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

const { POST } = await import("@/app/api/billing/portal/route");

function request(body: Record<string, string>) {
  return new Request("https://hub.test/api/billing/portal", {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams(body),
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  process.env.NEXT_PUBLIC_APP_URL = "https://hub.psgweb.me";
  mockUser = { id: "user_1" };
  mockMembership = { shops: { stripe_customer_id: "cus_123" } };
  portalCreate.mockResolvedValue({ url: "https://stripe.test/portal" });
});

describe("billing portal route shop scoping", () => {
  it("rejects portal requests when shop_id is missing", async () => {
    const res = await POST(request({}));

    expect(res.status).toBe(400);
    await expect(res.json()).resolves.toEqual({ error: "Missing shop_id" });
    expect(portalCreate).not.toHaveBeenCalled();
  });

  it("rejects portal requests when the selected shop has no billing account", async () => {
    mockMembership = null;

    const res = await POST(request({ shop_id: "shop_b" }));

    expect(res.status).toBe(404);
    await expect(res.json()).resolves.toEqual({
      error: "No billing account found",
    });
    expect(portalCreate).not.toHaveBeenCalled();
  });

  it("returns to Billing for the same selected shop", async () => {
    const res = await POST(request({ shop_id: "shop_b" }));

    expect(res.status).toBe(303);
    expect(portalCreate).toHaveBeenCalledWith({
      customer: "cus_123",
      return_url: "https://hub.psgweb.me/dashboard/billing?shop_id=shop_b",
    });
  });
});
