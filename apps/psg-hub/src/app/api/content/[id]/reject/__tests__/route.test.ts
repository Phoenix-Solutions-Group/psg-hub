import { describe, it, expect, vi, beforeEach } from "vitest";

// PSG-194 regression: the reject route writes status='rejected'. That value was
// NOT in the original content_items_status_check CHECK, so every reject failed
// at the DB with a 23514. Migration 20260622120000 adds 'rejected' to the
// constraint; this test pins the route's contract (it must keep writing
// 'rejected') so the migration and the route can never drift apart.

type User = { id: string } | null;
let mockUser: User = null;
let mockItem: Record<string, unknown> | null = null;
let mockMembership: { role: string } | null = null;
let updatePayload: Record<string, unknown> | null = null;
let updateResult: { data: unknown; error: { message: string } | null } = {
  data: { id: "ci-1", status: "rejected" },
  error: null,
};

function serverClient() {
  return {
    auth: { getUser: vi.fn().mockResolvedValue({ data: { user: mockUser } }) },
    from: vi.fn().mockImplementation((table: string) => {
      if (table === "content_items") {
        return {
          select: vi.fn().mockReturnValue({
            eq: vi.fn().mockReturnValue({
              maybeSingle: vi
                .fn()
                .mockResolvedValue({ data: mockItem, error: null }),
            }),
          }),
        };
      }
      if (table === "shop_users") {
        return {
          select: vi.fn().mockReturnValue({
            eq: vi.fn().mockReturnValue({
              eq: vi.fn().mockReturnValue({
                maybeSingle: vi
                  .fn()
                  .mockResolvedValue({ data: mockMembership, error: null }),
              }),
            }),
          }),
        };
      }
      throw new Error(`unexpected table ${table}`);
    }),
  };
}

function serviceClient() {
  return {
    from: vi.fn().mockImplementation(() => ({
      update: vi.fn((payload: Record<string, unknown>) => {
        updatePayload = payload;
        const chain = {
          eq: vi.fn(() => chain),
          select: vi.fn().mockReturnValue({
            single: vi.fn().mockResolvedValue(updateResult),
          }),
        };
        return chain;
      }),
    })),
  };
}

vi.mock("@/lib/supabase/server", () => ({
  createClient: vi.fn(async () => serverClient()),
}));
vi.mock("@/lib/supabase/service", () => ({
  createServiceClient: vi.fn(() => serviceClient()),
}));

import { POST } from "../route";

const ctx = { params: Promise.resolve({ id: "ci-1" }) };
const req = () => new Request("http://test/api/content/ci-1/reject", { method: "POST" });

beforeEach(() => {
  mockUser = { id: "user-1" };
  mockMembership = { role: "manager" };
  mockItem = { id: "ci-1", shop_id: "shop-1" };
  updatePayload = null;
  updateResult = { data: { id: "ci-1", status: "rejected" }, error: null };
});

describe("POST /api/content/[id]/reject", () => {
  it("writes status='rejected' (now valid per the constraint migration)", async () => {
    const res = await POST(req(), ctx);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.status).toBe("rejected");
    expect(updatePayload?.status).toBe("rejected");
  });

  it("401 when unauthenticated", async () => {
    mockUser = null;
    const res = await POST(req(), ctx);
    expect(res.status).toBe(401);
  });

  it("404 when the item does not exist", async () => {
    mockItem = null;
    const res = await POST(req(), ctx);
    expect(res.status).toBe(404);
  });

  it("403 when not owner/manager", async () => {
    mockMembership = { role: "viewer" };
    const res = await POST(req(), ctx);
    expect(res.status).toBe(403);
  });

  it("400 when the DB rejects the update (e.g. constraint not yet applied)", async () => {
    updateResult = { data: null, error: { message: "violates check constraint" } };
    const res = await POST(req(), ctx);
    expect(res.status).toBe(400);
  });
});
