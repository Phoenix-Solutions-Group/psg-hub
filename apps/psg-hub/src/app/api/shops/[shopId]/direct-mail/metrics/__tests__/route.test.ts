import { beforeEach, describe, expect, it, vi } from "vitest";

let mockUser: { id: string } | null = { id: "user_1" };
let mockMembership: { role: string } | null = { role: "owner" };
let mockMetrics: Record<string, unknown> = {
  activity: { lettersMailed: 3 },
  privacy: { rawRecipientFieldsIncluded: false },
};
let mockMetricsError: Error | null = null;
let mockMetricsArgs: Record<string, unknown> | null = null;

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

vi.mock("@/lib/analytics/direct-mail", () => ({
  getDirectMailMetrics: async (args: Record<string, unknown>) => {
    mockMetricsArgs = args;
    if (mockMetricsError) throw mockMetricsError;
    return mockMetrics;
  },
}));

import { GET } from "../route";

const VALID_SHOP = "11111111-1111-1111-1111-111111111111";

function call(shopId: string, query = "") {
  return GET(new Request(`http://test/api/shops/${shopId}/direct-mail/metrics${query}`), {
    params: Promise.resolve({ shopId }),
  });
}

beforeEach(() => {
  mockUser = { id: "user_1" };
  mockMembership = { role: "owner" };
  mockMetrics = {
    activity: { lettersMailed: 3 },
    privacy: { rawRecipientFieldsIncluded: false },
  };
  mockMetricsError = null;
  mockMetricsArgs = null;
});

describe("GET /api/shops/[shopId]/direct-mail/metrics", () => {
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

  it("200 with privacy-safe metrics for a member", async () => {
    const res = await call(VALID_SHOP, "?from=2026-07-01&to=2026-07-13");
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.activity.lettersMailed).toBe(3);
    expect(body.privacy.rawRecipientFieldsIncluded).toBe(false);
    expect(mockMetricsArgs).toMatchObject({
      authorizedShopIds: [VALID_SHOP],
      from: "2026-07-01",
      to: "2026-07-13",
    });
  });

  it("500 when the reader errors", async () => {
    mockMetricsError = new Error("db down");
    const res = await call(VALID_SHOP);
    expect(res.status).toBe(500);
  });
});
