import { describe, it, expect, vi, beforeEach } from "vitest";
import type { ContentBrief } from "@/types/content-brief";

// Mutable mock state (names must start with `mock` to satisfy vi.mock hoisting).
let mockUser: { id: string } | null = { id: "user_1" };
let mockMembership: { role: string } | null = { role: "owner" };
let mockBrief: ContentBrief | null = null;
let mockFetchThrows = false;

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
  createServiceClient: () => ({}),
}));

vi.mock("@/lib/bsm/content-briefs", () => ({
  fetchMarketResearchBrief: async () => {
    if (mockFetchThrows) throw new Error("query failed");
    return mockBrief;
  },
}));

import { GET } from "../route";

const VALID_SHOP = "11111111-1111-1111-1111-111111111111";

function call(shopId: string) {
  return GET(new Request("http://test/api/shops/x/content-briefs"), {
    params: Promise.resolve({ shopId }),
  });
}

const SAMPLE: ContentBrief = {
  id: "brief_1",
  shop_id: VALID_SHOP,
  topic: 'Content targeting "collision repair lincoln ne"',
  target_keywords: ["collision repair lincoln ne"],
  competitor_gap: "Publish a local collision-repair guide",
  audience_persona: "Local driver searching for a nearby, trustworthy collision shop",
  priority_score: 81,
  status: "draft",
  created_at: "2026-06-20T12:00:00.000Z",
};

beforeEach(() => {
  mockUser = { id: "user_1" };
  mockMembership = { role: "owner" };
  mockBrief = null;
  mockFetchThrows = false;
});

describe("GET /api/shops/[shopId]/content-briefs", () => {
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

  it("200 with the latest brief for a member", async () => {
    mockBrief = SAMPLE;
    const res = await call(VALID_SHOP);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.brief.id).toBe("brief_1");
    expect(body.brief.shop_id).toBe(VALID_SHOP);
  });

  it("200 with null when the shop has no brief yet", async () => {
    mockBrief = null;
    const res = await call(VALID_SHOP);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.brief).toBeNull();
  });

  it("500 when the loader errors", async () => {
    mockFetchThrows = true;
    const res = await call(VALID_SHOP);
    expect(res.status).toBe(500);
  });
});
