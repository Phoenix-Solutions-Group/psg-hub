import { beforeEach, describe, expect, it, vi } from "vitest";

let mockUser: { id: string } | null = { id: "user_1" };
let mockMembership: { role: string } | null = { role: "owner" };
let mockMetrics: Record<string, unknown> = {
  activity: { lettersMailed: 3 },
  sources: { sendHistoryRows: 3, productionRows: 0, resultRows: 0 },
  privacy: { rawRecipientFieldsIncluded: false },
};
let mockFallbackShop: { id: string; name: string } | null = null;
let mockMetricsError: Error | null = null;
let mockMetricsArgs: Record<string, unknown> | null = null;

vi.mock("next/headers", () => ({
  headers: vi.fn(async () => ({
    get: (name: string) =>
      name === "host" ? "psg-private-preview.vercel.app" : null,
  })),
}));

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
  createServiceClient: vi.fn(() => ({})),
}));

vi.mock("@/lib/analytics/direct-mail", () => ({
  getDirectMailMetrics: async (args: Record<string, unknown>) => {
    mockMetricsArgs = args;
    if (mockMetricsError) throw mockMetricsError;
    return mockMetrics;
  },
  getRiversidePreviewDirectMailMetrics: ({
    shopId,
    from,
    to,
  }: {
    shopId: string;
    from: string;
    to: string | null;
  }) => ({
    shopIds: [shopId],
    range: { from, to },
    activity: { lettersMailed: 5 },
    sources: { sendHistoryRows: 4, productionRows: 1, resultRows: 2 },
    privacy: { rawRecipientFieldsIncluded: false },
  }),
  isDirectMailMetricsEmpty: (metrics: Record<string, unknown>) => {
    const activity = metrics.activity as { lettersMailedLifetime?: number } | undefined;
    const sources =
      metrics.sources as
        | { sendHistoryRows?: number; productionRows?: number; resultRows?: number }
        | undefined;
    return (
      (activity?.lettersMailedLifetime ?? 0) === 0 &&
      (sources?.sendHistoryRows ?? 0) === 0 &&
      (sources?.productionRows ?? 0) === 0 &&
      (sources?.resultRows ?? 0) === 0
    );
  },
}));

vi.mock("@/lib/bsm/riverside-analytics-demo", () => ({
  getRiversideAnalyticsPreviewShop: async () => mockFallbackShop,
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
    sources: { sendHistoryRows: 3, productionRows: 0, resultRows: 0 },
    privacy: { rawRecipientFieldsIncluded: false },
  };
  mockFallbackShop = null;
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

  it("uses Riverside private-preview fallback when authorized metrics are empty", async () => {
    mockMetrics = {
      activity: { lettersMailedLifetime: 0 },
      sources: { sendHistoryRows: 0, productionRows: 0, resultRows: 0 },
      privacy: { rawRecipientFieldsIncluded: false },
    };
    mockFallbackShop = { id: VALID_SHOP, name: "Riverside Collision" };

    const res = await call(VALID_SHOP, "?from=2026-08-01&to=2026-08-05");

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.activity.lettersMailed).toBe(5);
    expect(body.shopIds).toEqual([VALID_SHOP]);
    expect(body.privacy.rawRecipientFieldsIncluded).toBe(false);
  });

  it("500 when the reader errors", async () => {
    mockMetricsError = new Error("db down");
    const res = await call(VALID_SHOP);
    expect(res.status).toBe(500);
  });
});
