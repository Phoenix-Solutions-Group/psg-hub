import { describe, it, expect, vi, beforeEach } from "vitest";

// --- mocks ---
vi.mock("@/lib/google-ads/oauth", () => {
  class StateError extends Error {
    constructor(public code: string) {
      super(code);
      this.name = "StateError";
    }
  }
  return { StateError, consumePendingSelection: vi.fn() };
});
vi.mock("@/lib/google-ads/link", () => ({ persistLinkedAccount: vi.fn() }));

let mockUser: { id: string } | null = { id: "u1" };
vi.mock("@/lib/supabase/server", () => ({
  createClient: async () => ({
    auth: { getUser: async () => ({ data: { user: mockUser } }) },
  }),
}));
vi.mock("@/lib/supabase/service", () => ({
  createServiceClient: () => ({
    from: () => ({ insert: async () => ({ error: null }) }),
  }),
}));

const { consumePendingSelection, StateError } = await import("@/lib/google-ads/oauth");
const { persistLinkedAccount } = await import("@/lib/google-ads/link");
const { POST } = await import("@/app/api/ads/google/select/route");

function req(body: unknown) {
  return new Request("http://localhost/api/ads/google/select", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

const PENDING = {
  encryptedTokenHex: "\\xabcd",
  keyVersion: 1,
  scope: "scope",
  loginCustomerId: "6935795509",
  customers: [
    { id: "6048611995", name: "Wallace" },
    { id: "1234567890", name: "Tracy's" },
  ],
};

beforeEach(() => {
  mockUser = { id: "u1" };
  vi.mocked(consumePendingSelection).mockReset();
  vi.mocked(persistLinkedAccount).mockReset();
  vi.mocked(persistLinkedAccount).mockResolvedValue({ error: null });
});

describe("POST /api/ads/google/select", () => {
  it("valid pick → persists the chosen account + success", async () => {
    vi.mocked(consumePendingSelection).mockResolvedValue({
      userId: "u1",
      shopId: "s1",
      pending: PENDING,
    });
    const res = await POST(req({ state: "st", customer_id: "6048611995" }));
    expect(res.status).toBe(200);
    expect(await res.text()).toContain("linked");
    expect(persistLinkedAccount).toHaveBeenCalledWith(
      expect.objectContaining({
        shopId: "s1",
        customerId: "6048611995",
        loginCustomerId: "6935795509",
        encryptedTokenHex: "\\xabcd",
        keyVersion: 1,
        linkedBy: "u1",
      })
    );
  });

  it("a customer that was not offered → 400, no persist", async () => {
    vi.mocked(consumePendingSelection).mockResolvedValue({
      userId: "u1",
      shopId: "s1",
      pending: PENDING,
    });
    const res = await POST(req({ state: "st", customer_id: "9999999999" }));
    expect(res.status).toBe(400);
    expect(persistLinkedAccount).not.toHaveBeenCalled();
  });

  it("session user != state user → 403, no persist", async () => {
    mockUser = { id: "intruder" };
    vi.mocked(consumePendingSelection).mockResolvedValue({
      userId: "u1",
      shopId: "s1",
      pending: PENDING,
    });
    const res = await POST(req({ state: "st", customer_id: "6048611995" }));
    expect(res.status).toBe(403);
    expect(persistLinkedAccount).not.toHaveBeenCalled();
  });

  it("not signed in → 401", async () => {
    mockUser = null;
    const res = await POST(req({ state: "st", customer_id: "6048611995" }));
    expect(res.status).toBe(401);
  });

  it("missing params → 400", async () => {
    const res = await POST(req({ state: "st" }));
    expect(res.status).toBe(400);
  });

  it("replayed/invalid state → 400", async () => {
    vi.mocked(consumePendingSelection).mockRejectedValue(new StateError("replayed"));
    const res = await POST(req({ state: "st", customer_id: "6048611995" }));
    expect(res.status).toBe(400);
  });
});
