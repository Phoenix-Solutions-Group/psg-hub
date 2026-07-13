import { createHash } from "node:crypto";
import { beforeEach, describe, expect, it, vi } from "vitest";

const query = vi.fn();
const from = vi.fn();
const withAdsRateLimit = vi.fn((_shopId, _method, fn) => fn());
const logAdsCall = vi.fn();

vi.mock("@/lib/supabase/service", () => ({
  createServiceClient: () => ({ from }),
}));

vi.mock("@/lib/google-ads/client", () => ({
  getGoogleAdsClient: vi.fn(async () => ({
    customer: { query },
    account: {
      id: "acct-1",
      customer_id: "1234567890",
      login_customer_id: null,
    },
  })),
  logAdsCall: (...args: unknown[]) => logAdsCall(...args),
  mapGoogleAdsError: (err: unknown) => err,
  validateGaqlId: (value: string) => {
    if (!/^\d+$/.test(value)) throw new Error("bad id");
  },
  withAdsRateLimit: (...args: unknown[]) => withAdsRateLimit(...args),
}));

const { POST } = await import("../route");

function tokenHash(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

function req(token = "good-token"): Request {
  return new Request("https://hub.psgweb.me/api/ops/tedesco/google-ads-historical-pull", {
    method: "POST",
    headers: { authorization: `Bearer ${token}` },
  });
}

describe("POST /api/ops/tedesco/google-ads-historical-pull", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    process.env.VERCEL_ENV = "production";
    process.env.TEDESCO_ADS_PULL_TOKEN_SHA256 = tokenHash("good-token");
    process.env.GOOGLE_ADS_DEVELOPER_TOKEN = "dev-token";
    process.env.GOOGLE_ADS_CLIENT_ID = "client-id";
    process.env.GOOGLE_ADS_CLIENT_SECRET = "client-secret";
    process.env.NEXT_PUBLIC_SUPABASE_URL = "https://test.supabase.co";
    process.env.SUPABASE_SERVICE_ROLE_KEY = "service-role";

    from.mockReturnValue({
      select: () => ({
        ilike: () => ({
          limit: async () => ({
            data: [{ id: "shop-1", name: "Tedesco Auto Body" }],
            error: null,
          }),
        }),
      }),
    });
    query
      .mockResolvedValueOnce([
        {
          metrics: {
            cost_micros: 1_250_000,
            clicks: 10,
            impressions: 100,
            conversions: 2,
          },
        },
      ])
      .mockResolvedValueOnce([
        {
          metrics: {
            cost_micros: 3_000_000,
            clicks: 20,
            impressions: 300,
            conversions: 0,
          },
        },
      ]);
  });

  it("404s outside production before touching Supabase or Google", async () => {
    process.env.VERCEL_ENV = "preview";
    const res = await POST(req());

    expect(res.status).toBe(404);
    expect(from).not.toHaveBeenCalled();
    expect(query).not.toHaveBeenCalled();
  });

  it("401s on a bad bearer token before touching Supabase or Google", async () => {
    const res = await POST(req("bad-token"));

    expect(res.status).toBe(401);
    expect(from).not.toHaveBeenCalled();
    expect(query).not.toHaveBeenCalled();
  });

  it("returns the two approved aggregate windows", async () => {
    const res = await POST(req());
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(query).toHaveBeenCalledTimes(2);
    expect(query.mock.calls[0][0]).toContain(
      "segments.date BETWEEN '2026-06-11' AND '2026-07-11'"
    );
    expect(query.mock.calls[1][0]).toContain(
      "segments.date BETWEEN '2026-04-18' AND '2026-05-18'"
    );
    expect(body.windows).toEqual([
      {
        key: "post_fix",
        start: "2026-06-11",
        end: "2026-07-11",
        spend: 1.25,
        clicks: 10,
        impressions: 100,
        conversions: 2,
        cpl: 0.625,
        cost_micros: 1_250_000,
      },
      {
        key: "baseline",
        start: "2026-04-18",
        end: "2026-05-18",
        spend: 3,
        clicks: 20,
        impressions: 300,
        conversions: 0,
        cpl: null,
        cost_micros: 3_000_000,
      },
    ]);
    expect(logAdsCall).toHaveBeenCalledTimes(2);
  });
});
