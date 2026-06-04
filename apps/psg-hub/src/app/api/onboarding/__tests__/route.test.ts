import { describe, it, expect, vi, beforeEach } from "vitest";

// --- mutable test state ---
type User = { id: string } | null;
let mockUser: User = null;
let clientInsertPayload: Record<string, unknown> | null = null;
let shopInsertPayload: Record<string, unknown> | null = null;
let shopUsersInsertPayload: Record<string, unknown> | null = null;
let roleInsertPayload: Record<string, unknown> | null = null;
let shopInsertError: { message: string } | null = null;
let memberInsertError: { message: string } | null = null;
let existingRole: { profile_id: string } | null = null;
const clientsDelete = vi.fn();
const shopsDelete = vi.fn();

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
      if (table === "clients") {
        return {
          insert: vi.fn((payload: Record<string, unknown>) => {
            clientInsertPayload = payload;
            return {
              select: vi.fn().mockReturnValue({
                single: vi
                  .fn()
                  .mockResolvedValue({ data: { id: "client-new" }, error: null }),
              }),
            };
          }),
          delete: vi.fn(() => ({
            eq: vi.fn((...args: unknown[]) => {
              clientsDelete(...args);
              return Promise.resolve({ error: null });
            }),
          })),
        };
      }
      if (table === "shops") {
        return {
          insert: vi.fn((payload: Record<string, unknown>) => {
            shopInsertPayload = payload;
            return {
              select: vi.fn().mockReturnValue({
                single: vi.fn().mockResolvedValue({
                  data: shopInsertError ? null : { id: "shop-new" },
                  error: shopInsertError,
                }),
              }),
            };
          }),
          delete: vi.fn(() => ({
            eq: vi.fn((...args: unknown[]) => {
              shopsDelete(...args);
              return Promise.resolve({ error: null });
            }),
          })),
        };
      }
      if (table === "shop_users") {
        return {
          insert: vi.fn((payload: Record<string, unknown>) => {
            shopUsersInsertPayload = payload;
            return Promise.resolve({ error: memberInsertError });
          }),
        };
      }
      if (table === "app_user_roles") {
        return {
          select: vi.fn().mockReturnValue({
            eq: vi.fn().mockReturnValue({
              maybeSingle: vi
                .fn()
                .mockResolvedValue({ data: existingRole, error: null }),
            }),
          }),
          insert: vi.fn((payload: Record<string, unknown>) => {
            roleInsertPayload = payload;
            return Promise.resolve({ error: null });
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

const { POST } = await import("@/app/api/onboarding/route");

function req(body?: unknown) {
  return new Request("http://localhost/api/onboarding", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body ?? {}),
  });
}

beforeEach(() => {
  mockUser = null;
  clientInsertPayload = null;
  shopInsertPayload = null;
  shopUsersInsertPayload = null;
  roleInsertPayload = null;
  shopInsertError = null;
  memberInsertError = null;
  existingRole = null;
  clientsDelete.mockReset();
  shopsDelete.mockReset();
});

describe("POST /api/onboarding", () => {
  it("401 when unauthenticated; writes nothing", async () => {
    mockUser = null;
    const res = await POST(req({ shopName: "Acme" }));
    expect(res.status).toBe(401);
    expect(clientInsertPayload).toBeNull();
    expect(shopInsertPayload).toBeNull();
  });

  it("400 when shopName empty; writes nothing", async () => {
    mockUser = { id: "u1" };
    const res = await POST(req({ shopName: "   " }));
    expect(res.status).toBe(400);
    expect(clientInsertPayload).toBeNull();
  });

  it("happy path: creates client + shop (real columns) + owner + customer role", async () => {
    mockUser = { id: "u1" };
    const res = await POST(
      req({
        shopName: "Acme Collision",
        address: "1 Main St",
        city: "Lincoln",
        state: "NE",
        websiteUrl: "https://acme.example.com",
        phone: "402-555-1212",
      })
    );
    expect(res.status).toBe(200);
    const json = (await res.json()) as { shop_id: string };
    expect(json.shop_id).toBe("shop-new");

    // client created (owns the shop)
    expect(clientInsertPayload).toMatchObject({
      name: "Acme Collision",
      website_url: "https://acme.example.com",
      created_by: "u1",
    });

    // shop: real columns + client_id, NO phantom website_url/city/state/address
    expect(shopInsertPayload).toMatchObject({
      client_id: "client-new",
      name: "Acme Collision",
      slug: "acme-collision",
      address_street: "1 Main St",
      address_locality: "Lincoln",
      address_region: "NE",
      url: "https://acme.example.com",
      telephone: "402-555-1212",
    });
    expect(shopInsertPayload).not.toHaveProperty("website_url");
    expect(shopInsertPayload).not.toHaveProperty("city");
    expect(shopInsertPayload).not.toHaveProperty("state");
    expect(shopInsertPayload).not.toHaveProperty("address");

    expect(shopUsersInsertPayload).toEqual({
      user_id: "u1",
      shop_id: "shop-new",
      role: "owner",
    });
    expect(roleInsertPayload).toEqual({ profile_id: "u1", role: "customer" });
    expect(clientsDelete).not.toHaveBeenCalled();
    expect(shopsDelete).not.toHaveBeenCalled();
  });

  it("does not downgrade an existing role", async () => {
    mockUser = { id: "u1" };
    existingRole = { profile_id: "u1" };
    const res = await POST(req({ shopName: "Acme" }));
    expect(res.status).toBe(200);
    expect(roleInsertPayload).toBeNull();
  });

  it("compensating: shop insert fails -> deletes client, 500", async () => {
    mockUser = { id: "u1" };
    shopInsertError = { message: "shop boom" };
    const res = await POST(req({ shopName: "Acme" }));
    expect(res.status).toBe(500);
    expect(clientsDelete).toHaveBeenCalledWith("id", "client-new");
    expect(shopsDelete).not.toHaveBeenCalled();
  });

  it("compensating: membership insert fails -> deletes shop + client, 500", async () => {
    mockUser = { id: "u1" };
    memberInsertError = { message: "rls denied" };
    const res = await POST(req({ shopName: "Acme" }));
    expect(res.status).toBe(500);
    expect(shopsDelete).toHaveBeenCalledWith("id", "shop-new");
    expect(clientsDelete).toHaveBeenCalledWith("id", "client-new");
  });
});
