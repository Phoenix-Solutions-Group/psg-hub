import { describe, it, expect, vi, beforeEach } from "vitest";

// --- mutable test state ---
type User = { id: string } | null;
let mockUser: User = null;
let mockItem: Record<string, unknown> | null = null;
let mockMembership: { role: string } | null = null;
let updatePayload: Record<string, unknown> | null = null;
let updateEqFilters: Array<[string, unknown]> = [];
let updateResult: { data: unknown; error: { message: string } | null } = {
  data: { id: "ci-1", status: "published", published_at: "2026-06-22T00:00:00.000Z" },
  error: null,
};

function serverClient() {
  return {
    auth: {
      getUser: vi.fn().mockResolvedValue({ data: { user: mockUser } }),
    },
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
    from: vi.fn().mockImplementation((table: string) => {
      if (table === "content_items") {
        return {
          update: vi.fn((payload: Record<string, unknown>) => {
            updatePayload = payload;
            updateEqFilters = [];
            const chain = {
              eq: vi.fn((col: string, val: unknown) => {
                updateEqFilters.push([col, val]);
                return chain;
              }),
              select: vi.fn().mockReturnValue({
                single: vi.fn().mockResolvedValue(updateResult),
              }),
            };
            return chain;
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

import { POST } from "../route";

const ctx = { params: Promise.resolve({ id: "ci-1" }) };
const req = () => new Request("http://test/api/content/ci-1/publish", { method: "POST" });

const ship = { verdict: "ship", hardFail: false, violations: [] };
const reject = { verdict: "reject", hardFail: true, violations: [{ code: "x" }] };

beforeEach(() => {
  mockUser = { id: "user-1" };
  mockMembership = { role: "owner" };
  mockItem = {
    id: "ci-1",
    shop_id: "shop-1",
    status: "approved",
    claim_integrity_verdict: ship,
    gate_verdict: ship,
  };
  updatePayload = null;
  updateEqFilters = [];
  updateResult = {
    data: { id: "ci-1", status: "published", published_at: "2026-06-22T00:00:00.000Z" },
    error: null,
  };
});

describe("POST /api/content/[id]/publish", () => {
  it("publishes an approved, fully-shipped item and stamps published_at", async () => {
    const res = await POST(req(), ctx);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.status).toBe("published");
    expect(updatePayload?.status).toBe("published");
    expect(updatePayload?.published_at).toBeTruthy();
    // optimistic guard: only updates a row still in `approved`
    expect(updateEqFilters).toContainEqual(["status", "approved"]);
  });

  it("rejects when status is not approved (409, no write)", async () => {
    mockItem = { ...(mockItem as object), status: "draft" } as Record<string, unknown>;
    const res = await POST(req(), ctx);
    expect(res.status).toBe(409);
    expect(updatePayload).toBeNull();
  });

  it("refuses to publish a non-ship claim_integrity_verdict (409, no write)", async () => {
    mockItem = {
      ...(mockItem as object),
      claim_integrity_verdict: reject,
    } as Record<string, unknown>;
    const res = await POST(req(), ctx);
    expect(res.status).toBe(409);
    const body = await res.json();
    expect(body.claimIntegrityVerdict).toBe("reject");
    expect(updatePayload).toBeNull();
  });

  it("refuses to publish a non-ship gate_verdict (409, no write)", async () => {
    mockItem = {
      ...(mockItem as object),
      gate_verdict: { verdict: "revise" },
    } as Record<string, unknown>;
    const res = await POST(req(), ctx);
    expect(res.status).toBe(409);
    expect(updatePayload).toBeNull();
  });

  it("refuses to publish when a verdict is missing entirely (409)", async () => {
    mockItem = {
      ...(mockItem as object),
      gate_verdict: null,
    } as Record<string, unknown>;
    const res = await POST(req(), ctx);
    expect(res.status).toBe(409);
    expect(updatePayload).toBeNull();
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

  it("403 when the caller is not owner/manager", async () => {
    mockMembership = { role: "viewer" };
    const res = await POST(req(), ctx);
    expect(res.status).toBe(403);
  });

  it("403 when the caller has no membership on the shop", async () => {
    mockMembership = null;
    const res = await POST(req(), ctx);
    expect(res.status).toBe(403);
  });

  it("400 when the DB update errors", async () => {
    updateResult = { data: null, error: { message: "boom" } };
    const res = await POST(req(), ctx);
    expect(res.status).toBe(400);
  });
});
