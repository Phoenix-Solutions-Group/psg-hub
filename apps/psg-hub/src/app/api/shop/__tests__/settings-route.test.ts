import { describe, it, expect, vi, beforeEach } from "vitest";

// --- mutable test state ---
type User = { id: string; email?: string } | null;
let mockUser: User = null;
let mockShops: Array<{ id: string; name: string; role: string }> = [];
let mockActiveShopId: string | null = null;
let updatePayload: Record<string, unknown> | null = null;
let updateEqArg: unknown = null;
let updateError: { message: string } | null = null;

function serverClient() {
  return {
    auth: {
      getUser: vi.fn().mockResolvedValue({ data: { user: mockUser } }),
    },
  };
}

function serviceClient() {
  return {
    from: vi.fn().mockImplementation((table: string) => {
      if (table === "shops") {
        return {
          update: vi.fn((payload: Record<string, unknown>) => {
            updatePayload = payload;
            return {
              eq: vi.fn((_col: string, val: unknown) => {
                updateEqArg = val;
                return Promise.resolve({ error: updateError });
              }),
            };
          }),
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
vi.mock("@/lib/shop/context", () => ({
  getActiveShopContext: vi.fn(async () => ({
    shops: mockShops,
    activeShopId: mockActiveShopId,
  })),
}));

const { POST } = await import("@/app/api/shop/settings/route");

const VALID_BODY = {
  name: "Shelton Collision",
  telephone: "(203) 555-0148",
  url: "https://sheltoncollision.com",
  radius: "25",
  address_street: "421 River Rd",
  address_locality: "Shelton",
  address_region: "ct",
  address_postal_code: "06484",
  hours: "Mon–Fri 8–6",
};

function req(body?: unknown) {
  return new Request("http://localhost/api/shop/settings", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body ?? {}),
  });
}

beforeEach(() => {
  mockUser = null;
  mockShops = [];
  mockActiveShopId = null;
  updatePayload = null;
  updateEqArg = null;
  updateError = null;
});

describe("POST /api/shop/settings", () => {
  it("401 when unauthenticated; writes nothing", async () => {
    const res = await POST(req(VALID_BODY));
    expect(res.status).toBe(401);
    expect(updatePayload).toBeNull();
  });

  it("403 when no active shop; writes nothing", async () => {
    mockUser = { id: "u1" };
    mockActiveShopId = null;
    const res = await POST(req(VALID_BODY));
    expect(res.status).toBe(403);
    expect(updatePayload).toBeNull();
  });

  it("403 for a viewer role; writes nothing", async () => {
    mockUser = { id: "u1" };
    mockShops = [{ id: "shop-1", name: "S", role: "viewer" }];
    mockActiveShopId = "shop-1";
    const res = await POST(req(VALID_BODY));
    expect(res.status).toBe(403);
    expect(updatePayload).toBeNull();
  });

  it("400 with fieldErrors on invalid input; writes nothing", async () => {
    mockUser = { id: "u1" };
    mockShops = [{ id: "shop-1", name: "S", role: "owner" }];
    mockActiveShopId = "shop-1";
    const res = await POST(req({ ...VALID_BODY, url: "http://insecure.com" }));
    expect(res.status).toBe(400);
    const json = (await res.json()) as {
      fieldErrors: Record<string, string>;
    };
    expect(json.fieldErrors.url).toBeTruthy();
    expect(updatePayload).toBeNull();
  });

  it("owner: saves normalized values scoped to the active shop", async () => {
    mockUser = { id: "u1" };
    mockShops = [{ id: "shop-1", name: "S", role: "owner" }];
    mockActiveShopId = "shop-1";
    const res = await POST(req(VALID_BODY));
    expect(res.status).toBe(200);
    const json = (await res.json()) as { ok: boolean };
    expect(json.ok).toBe(true);

    // Update scoped to the server-derived shop id, NOT anything client-sent.
    expect(updateEqArg).toBe("shop-1");
    // Real columns; state upper-cased; radius coerced to int; no updated_at.
    expect(updatePayload).toMatchObject({
      name: "Shelton Collision",
      telephone: "(203) 555-0148",
      url: "https://sheltoncollision.com",
      radius: 25,
      address_street: "421 River Rd",
      address_locality: "Shelton",
      address_region: "CT",
      address_postal_code: "06484",
      hours: "Mon–Fri 8–6",
    });
    expect(updatePayload).not.toHaveProperty("updated_at");
  });

  it("manager may also save", async () => {
    mockUser = { id: "u1" };
    mockShops = [{ id: "shop-1", name: "S", role: "manager" }];
    mockActiveShopId = "shop-1";
    const res = await POST(req(VALID_BODY));
    expect(res.status).toBe(200);
  });

  it("ignores a client-sent shopId (derives shop server-side)", async () => {
    mockUser = { id: "u1" };
    mockShops = [{ id: "shop-1", name: "S", role: "owner" }];
    mockActiveShopId = "shop-1";
    const res = await POST(req({ ...VALID_BODY, shopId: "shop-999" }));
    expect(res.status).toBe(200);
    expect(updateEqArg).toBe("shop-1");
  });

  it("collapses blank optionals to null", async () => {
    mockUser = { id: "u1" };
    mockShops = [{ id: "shop-1", name: "S", role: "owner" }];
    mockActiveShopId = "shop-1";
    await POST(
      req({
        ...VALID_BODY,
        address_locality: "",
        address_region: "",
        address_postal_code: "",
        hours: "",
      })
    );
    expect(updatePayload).toMatchObject({
      address_locality: null,
      address_region: null,
      address_postal_code: null,
      hours: null,
    });
  });

  it("500 when the update errors", async () => {
    mockUser = { id: "u1" };
    mockShops = [{ id: "shop-1", name: "S", role: "owner" }];
    mockActiveShopId = "shop-1";
    updateError = { message: "boom" };
    const res = await POST(req(VALID_BODY));
    expect(res.status).toBe(500);
  });
});
