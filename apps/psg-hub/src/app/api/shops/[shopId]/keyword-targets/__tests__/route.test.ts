import { describe, it, expect, vi, beforeEach } from "vitest";
import type { KeywordTarget } from "@/types/keyword-target";

// Mutable mock state (names must start with `mock` to satisfy vi.mock hoisting).
let mockUser: { id: string } | null = { id: "user_1" };
let mockMembership: { role: string } | null = { role: "owner" };
let mockTargets: KeywordTarget[] = [];
let mockLoaderThrows = false;
let lastTopic: string | undefined;

vi.mock("@/lib/supabase/server", () => ({
  createClient: async () => ({
    auth: { getUser: async () => ({ data: { user: mockUser } }) },
    from: (table: string) => {
      if (table === "shop_users") {
        return {
          select: () => ({
            eq: () => ({
              eq: () => ({
                maybeSingle: async () => ({ data: mockMembership, error: null }),
              }),
            }),
          }),
        };
      }
      throw new Error(`unexpected table: ${table}`);
    },
  }),
}));

vi.mock("@/lib/supabase/service", () => ({
  createServiceClient: () => ({ __service: true }),
}));

vi.mock("@/lib/bsm/keyword-targets", () => ({
  fetchKeywordTargets: async (
    _client: unknown,
    _shopId: string,
    topic?: string,
  ) => {
    lastTopic = topic;
    if (mockLoaderThrows) throw new Error("db down");
    return mockTargets;
  },
}));

import { GET } from "../route";

const VALID_SHOP = "11111111-1111-1111-1111-111111111111";

function call(shopId: string, query = "") {
  return GET(new Request(`http://test/api/shops/${shopId}/keyword-targets${query}`), {
    params: Promise.resolve({ shopId }),
  });
}

beforeEach(() => {
  mockUser = { id: "user_1" };
  mockMembership = { role: "owner" };
  mockTargets = [];
  mockLoaderThrows = false;
  lastTopic = undefined;
});

describe("GET /api/shops/[shopId]/keyword-targets", () => {
  it("400 on a non-UUID shopId", async () => {
    const res = await call("not-a-uuid");
    expect(res.status).toBe(400);
  });

  it("401 when unauthenticated", async () => {
    mockUser = null;
    const res = await call(VALID_SHOP);
    expect(res.status).toBe(401);
  });

  it("403 when the user is not a member of the shop", async () => {
    mockMembership = null;
    const res = await call(VALID_SHOP);
    expect(res.status).toBe(403);
  });

  it("200 returns the KeywordTarget[] for a member", async () => {
    mockTargets = [
      {
        keyword: "collision repair lincoln ne",
        search_volume: 1200,
        competitor_presence: 4,
        gap_opportunity: true,
        priority: "HIGH",
        source: "seo-auditor",
      },
    ];
    const res = await call(VALID_SHOP);
    expect(res.status).toBe(200);
    const body = (await res.json()) as KeywordTarget[];
    expect(Array.isArray(body)).toBe(true);
    expect(body).toHaveLength(1);
    expect(body[0].keyword).toBe("collision repair lincoln ne");
  });

  it("passes the topic query through to the loader", async () => {
    await call(VALID_SHOP, "?topic=bumper");
    expect(lastTopic).toBe("bumper");
  });

  it("treats a blank topic as undefined", async () => {
    await call(VALID_SHOP, "?topic=%20%20");
    expect(lastTopic).toBeUndefined();
  });

  it("500 when the loader throws", async () => {
    mockLoaderThrows = true;
    const res = await call(VALID_SHOP);
    expect(res.status).toBe(500);
  });
});
