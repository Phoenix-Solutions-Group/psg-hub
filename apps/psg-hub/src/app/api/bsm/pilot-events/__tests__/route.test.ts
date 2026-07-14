import { beforeEach, describe, expect, it, vi } from "vitest";

let mockUser: { id: string } | null = null;
let mockActiveShopId: string | null = null;
let inserted: Record<string, unknown> | null = null;

vi.mock("@/lib/supabase/server", () => ({
  createClient: vi.fn(async () => ({
    auth: { getUser: vi.fn().mockResolvedValue({ data: { user: mockUser } }) },
  })),
}));

vi.mock("@/lib/shop/context", () => ({
  getActiveShopContext: vi.fn(async () => ({
    shops: mockActiveShopId ? [{ id: mockActiveShopId }] : [],
    activeShopId: mockActiveShopId,
  })),
}));

vi.mock("@/lib/supabase/service", () => ({
  createServiceClient: vi.fn(() => ({
    from: vi.fn(() => ({
      insert: vi.fn(async (row: Record<string, unknown>) => {
        inserted = row;
        return { error: null };
      }),
    })),
  })),
}));

const { POST } = await import("@/app/api/bsm/pilot-events/route");

function request(body: unknown) {
  return new Request("http://localhost/api/bsm/pilot-events", {
    method: "POST",
    body: JSON.stringify(body),
  }) as unknown as import("next/server").NextRequest;
}

beforeEach(() => {
  mockUser = null;
  mockActiveShopId = null;
  inserted = null;
});

describe("POST /api/bsm/pilot-events", () => {
  it("requires a signed-in user", async () => {
    const res = await POST(request({ eventName: "setup_started" }));
    expect(res.status).toBe(401);
    expect(inserted).toBeNull();
  });

  it("rejects unknown event names", async () => {
    mockUser = { id: "u1" };
    const res = await POST(request({ eventName: "private_payload_uploaded" }));
    expect(res.status).toBe(400);
    expect(inserted).toBeNull();
  });

  it("records an allowed count-only event for the active shop", async () => {
    mockUser = { id: "u1" };
    mockActiveShopId = "s1";

    const res = await POST(
      request({
        eventName: "connect_google_clicked",
        properties: {
          source: "analytics",
          ok: true,
          nested: { should: "drop" },
        },
      }),
    );

    expect(res.status).toBe(200);
    expect(inserted).toEqual({
      event_name: "connect_google_clicked",
      shop_id: "s1",
      user_id: "u1",
      properties: { source: "analytics", ok: true },
    });
  });
});
