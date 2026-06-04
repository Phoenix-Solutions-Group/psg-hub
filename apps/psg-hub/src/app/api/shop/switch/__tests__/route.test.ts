import { describe, it, expect, vi, beforeEach } from "vitest";

type User = { id: string } | null;
let mockUser: User = null;
// rows as returned by shop_users.select("shop_id, role, shops(name)")
let mockMemberships: Array<{
  shop_id: string;
  role: string;
  shops: { name: string };
}> = [];

function serverClient() {
  return {
    auth: {
      getUser: vi.fn().mockResolvedValue({ data: { user: mockUser } }),
    },
  };
}

function serviceClient() {
  return {
    from: vi.fn((table: string) => {
      if (table === "shop_users") {
        return {
          select: vi.fn().mockReturnThis(),
          eq: vi.fn().mockResolvedValue({ data: mockMemberships, error: null }),
        };
      }
      throw new Error(`unexpected table ${table}`);
    }),
  };
}

vi.mock("@/lib/supabase/server", () => ({
  createClient: vi.fn(async () => serverClient()),
}));
vi.mock("@/lib/supabase/service", () => ({
  createServiceClient: vi.fn(() => serviceClient()),
}));

const { POST } = await import("@/app/api/shop/switch/route");

function req(body?: unknown) {
  return new Request("http://localhost/api/shop/switch", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body ?? {}),
  });
}

beforeEach(() => {
  mockUser = null;
  mockMemberships = [];
});

describe("POST /api/shop/switch", () => {
  it("401 when unauthenticated", async () => {
    mockUser = null;
    const res = await POST(req({ shop_id: "s1" }));
    expect(res.status).toBe(401);
  });

  it("400 when shop_id missing/blank", async () => {
    mockUser = { id: "u1" };
    const res = await POST(req({ shop_id: "   " }));
    expect(res.status).toBe(400);
  });

  it("403 when shop_id is not a current membership (cookie never authorizes)", async () => {
    mockUser = { id: "u1" };
    mockMemberships = [{ shop_id: "s1", role: "owner", shops: { name: "A" } }];
    const res = await POST(req({ shop_id: "s2" }));
    expect(res.status).toBe(403);
    // no Set-Cookie on a rejected switch
    expect(res.headers.get("set-cookie")).toBeNull();
  });

  it("200 + sets psg_active_shop cookie for a member shop", async () => {
    mockUser = { id: "u1" };
    mockMemberships = [
      { shop_id: "s1", role: "owner", shops: { name: "A" } },
      { shop_id: "s2", role: "viewer", shops: { name: "B" } },
    ];
    const res = await POST(req({ shop_id: "s2" }));
    expect(res.status).toBe(200);
    const setCookie = res.headers.get("set-cookie") ?? "";
    expect(setCookie).toContain("psg_active_shop=s2");
    expect(setCookie.toLowerCase()).toContain("httponly");
    expect(setCookie.toLowerCase()).toContain("samesite=lax");
    expect(setCookie).toContain("Path=/");
  });
});
