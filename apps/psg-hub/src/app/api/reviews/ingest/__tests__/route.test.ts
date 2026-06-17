import { describe, it, expect, vi, beforeEach } from "vitest";

// Mocks declared before importing the handler.
type User = { id: string } | null;
let mockUser: User = null;
let mockMembership: { shop_id: string } | null = null;

const ingestMock = vi.fn();

function serverClient() {
  return {
    auth: { getUser: vi.fn().mockResolvedValue({ data: { user: mockUser } }) },
    from: vi.fn(() => ({
      select: vi.fn().mockReturnThis(),
      eq: vi.fn().mockReturnThis(),
      maybeSingle: vi.fn().mockResolvedValue({ data: mockMembership, error: null }),
    })),
  };
}

vi.mock("@/lib/supabase/server", () => ({
  createClient: vi.fn(async () => serverClient()),
}));
vi.mock("@/lib/supabase/service", () => ({
  createServiceClient: vi.fn(() => ({ __service: true })),
}));
vi.mock("@/lib/google-oauth/gbp-reviews-sync", () => ({
  syncGbpReviewsForShop: (...args: unknown[]) => ingestMock(...args),
}));

import { POST } from "../route";

function req(body: unknown) {
  return new Request("http://localhost/api/reviews/ingest", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body ?? {}),
  });
}

beforeEach(() => {
  mockUser = null;
  mockMembership = null;
  ingestMock.mockReset();
});

describe("POST /api/reviews/ingest", () => {
  it("401 when unauthed; ingest never called", async () => {
    mockUser = null;
    const res = await POST(req({ shop_id: "shop-1" }));
    expect(res.status).toBe(401);
    expect(ingestMock).not.toHaveBeenCalled();
  });

  it("400 when shop_id is missing", async () => {
    mockUser = { id: "u1" };
    const res = await POST(req({}));
    expect(res.status).toBe(400);
    expect(ingestMock).not.toHaveBeenCalled();
  });

  it("403 for a non-member; ingest never called", async () => {
    mockUser = { id: "u1" };
    mockMembership = null;
    const res = await POST(req({ shop_id: "shop-1" }));
    expect(res.status).toBe(403);
    expect(ingestMock).not.toHaveBeenCalled();
  });

  it("200 returns { inserted, skipped, errors } for a member (no longer 501)", async () => {
    mockUser = { id: "u1" };
    mockMembership = { shop_id: "shop-1" };
    ingestMock.mockResolvedValue({ inserted: 3, skipped: 0, errors: 0 });
    const res = await POST(req({ shop_id: "shop-1" }));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ inserted: 3, skipped: 0, errors: 0 });
    expect(ingestMock).toHaveBeenCalledWith({ __service: true }, "shop-1");
  });
});
