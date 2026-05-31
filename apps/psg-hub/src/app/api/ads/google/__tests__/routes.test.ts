import { describe, it, expect, vi, beforeEach } from "vitest";

// --- Mock google-ads-api before any import chain pulls it in ---
const campaignsCreate = vi.fn();
const campaignBudgetsCreate = vi.fn();
const campaignsUpdate = vi.fn();
const campaignQuery = vi.fn();

vi.mock("google-ads-api", () => ({
  GoogleAdsApi: vi.fn().mockImplementation(() => ({
    Customer: vi.fn().mockImplementation(() => ({
      campaigns: { create: campaignsCreate, update: campaignsUpdate },
      campaignBudgets: { create: campaignBudgetsCreate },
      query: campaignQuery,
    })),
  })),
}));

// --- Mock the campaigns helper so we don't exercise crypto/fetch in route tests ---
const fetchMetricsMock = vi.fn();
const createCampaignMock = vi.fn();
const updateCampaignMock = vi.fn();

vi.mock("@/lib/google-ads/campaigns", () => ({
  fetchCampaignMetrics: (...args: unknown[]) => fetchMetricsMock(...args),
  createCampaign: (...args: unknown[]) => createCampaignMock(...args),
  updateCampaign: (...args: unknown[]) => updateCampaignMock(...args),
}));

// --- Mock fetch (for Google OAuth token exchange + revoke) ---
const fetchMock = vi.fn();
vi.stubGlobal("fetch", fetchMock);

// --- Mock supabase ---
type User = { id: string } | null;
let mockUser: User = null;
let mockMembership: { role: "owner" | "manager" | "viewer" } | null = null;
let mockShop:
  | {
      id: string;
      slug: string;
      name?: string;
      address?: string | null;
      city?: string | null;
      state?: string | null;
      website_url?: string | null;
      service_radius_miles?: number | null;
      max_daily_ad_budget_micros?: number | null;
    }
  | null = null;
let mockSub: { status: string; tier: string } | null = null;
let mockCampaign:
  | {
      id: string;
      shop_id: string;
      external_resource_name: string;
      external_id: string;
      status: "paused" | "enabled" | "removed";
      daily_budget_micros: number;
    }
  | null = null;
let rateLimitCount = 0;
let mockCampaignsList: Array<{ id: string; external_id: string }> = [];

function builder<T>(data: T) {
  return {
    select: vi.fn().mockReturnThis(),
    eq: vi.fn().mockReturnThis(),
    neq: vi.fn().mockReturnThis(),
    in: vi.fn().mockReturnThis(),
    gte: vi.fn().mockReturnThis(),
    is: vi.fn().mockReturnThis(),
    order: vi.fn().mockReturnThis(),
    limit: vi.fn().mockReturnThis(),
    maybeSingle: vi.fn().mockResolvedValue({ data, error: null }),
    single: vi.fn().mockResolvedValue({ data, error: null }),
  };
}

function serverClient() {
  return {
    auth: { getUser: vi.fn().mockResolvedValue({ data: { user: mockUser } }) },
    from: vi.fn().mockImplementation((table: string) => {
      if (table === "shop_members") return builder(mockMembership);
      if (table === "google_ads_campaigns")
        return {
          select: vi.fn().mockReturnThis(),
          eq: vi.fn().mockReturnThis(),
          neq: vi.fn().mockReturnThis(),
          order: vi.fn().mockResolvedValue({ data: [], error: null }),
        };
      if (table === "google_ads_accounts")
        return {
          select: vi.fn().mockReturnThis(),
          eq: vi.fn().mockReturnThis(),
          order: vi.fn().mockResolvedValue({ data: [], error: null }),
        };
      return builder(null);
    }),
  };
}

function serviceClient() {
  return {
    from: vi.fn().mockImplementation((table: string) => {
      if (table === "ads_api_call_log") {
        return {
          select: vi.fn().mockReturnThis(),
          eq: vi.fn().mockReturnThis(),
          in: vi.fn().mockReturnThis(),
          gte: vi
            .fn()
            .mockResolvedValue({ count: rateLimitCount, error: null }),
          insert: vi.fn().mockResolvedValue({ error: null }),
        };
      }
      if (table === "shops") return builder(mockShop);
      if (table === "subscriptions") return builder(mockSub);
      if (table === "google_ads_accounts") {
        return {
          ...builder({
            id: "acct-1",
            shop_id: mockShop?.id ?? "s1",
            customer_id: "1234567890",
            login_customer_id: null,
            encrypted_refresh_token: Buffer.alloc(60, 3),
            key_version: 1,
            scope: "https://www.googleapis.com/auth/adwords",
            status: "linked",
            linked_by: null,
            linked_at: new Date().toISOString(),
            revoked_at: null,
            last_error: null,
          }),
          upsert: vi.fn().mockResolvedValue({ error: null }),
          update: vi.fn().mockReturnValue({
            eq: vi.fn().mockResolvedValue({ error: null }),
          }),
        };
      }
      if (table === "google_ads_campaigns") {
        // update().eq() must be directly awaitable AND also support .select().single()
        function updateThenable() {
          const promise = Promise.resolve({ data: null, error: null });
          return Object.assign(promise, {
            select: () => ({
              single: () =>
                Promise.resolve({
                  data: { id: "camp-1", updated_at: new Date().toISOString() },
                  error: null,
                }),
            }),
          });
        }
        return {
          select: vi.fn().mockReturnThis(),
          eq: vi.fn().mockReturnThis(),
          in: vi
            .fn()
            .mockResolvedValue({ data: mockCampaignsList, error: null }),
          maybeSingle: vi
            .fn()
            .mockResolvedValue({ data: mockCampaign, error: null }),
          insert: vi.fn().mockReturnValue({
            select: vi.fn().mockReturnValue({
              single: vi.fn().mockResolvedValue({
                data: { id: "camp-new", shop_id: mockShop?.id ?? "s1" },
                error: null,
              }),
            }),
          }),
          update: vi.fn().mockReturnValue({
            eq: vi.fn(() => updateThenable()),
          }),
        };
      }
      return builder(null);
    }),
  };
}

vi.mock("@/lib/supabase/server", () => ({
  createClient: vi.fn(async () => serverClient()),
}));
vi.mock("@/lib/supabase/service", () => ({
  createServiceClient: vi.fn(() => serviceClient()),
}));

const { POST: authorizePOST } = await import(
  "@/app/api/ads/google/authorize/route"
);
const { POST: campaignsPOST, GET: campaignsGET } = await import(
  "@/app/api/ads/google/campaigns/route"
);
const { PUT: campaignPUT } = await import(
  "@/app/api/ads/google/campaigns/[id]/route"
);
const { POST: syncPOST } = await import(
  "@/app/api/ads/google/campaigns/sync/route"
);

function req(body?: unknown) {
  return new Request("http://localhost/x", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body ?? {}),
  });
}

function getReq(url = "http://localhost/x") {
  return new Request(url, { method: "GET" });
}

beforeEach(() => {
  campaignsCreate.mockReset();
  campaignBudgetsCreate.mockReset();
  campaignsUpdate.mockReset();
  campaignQuery.mockReset();
  fetchMetricsMock.mockReset();
  createCampaignMock.mockReset();
  updateCampaignMock.mockReset();
  fetchMock.mockReset();
  mockUser = null;
  mockMembership = null;
  mockShop = null;
  mockSub = null;
  mockCampaign = null;
  rateLimitCount = 0;
  mockCampaignsList = [];
  process.env.SHOP_ADS_TIER_OVERRIDE = "";
});

describe("POST /api/ads/google/authorize", () => {
  it("401 when unauthed; fetch/Google never called", async () => {
    mockUser = null;
    const res = await authorizePOST(req({ shop_id: "s1" }));
    expect(res.status).toBe(401);
    expect(createCampaignMock).not.toHaveBeenCalled();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("403 when not owner", async () => {
    mockUser = { id: "u1" };
    mockMembership = { role: "manager" };
    const res = await authorizePOST(req({ shop_id: "s1" }));
    expect(res.status).toBe(403);
  });

  it("402 when tier not Performance", async () => {
    mockUser = { id: "u1" };
    mockMembership = { role: "owner" };
    mockShop = { id: "s1", slug: "acme" };
    mockSub = null;
    const res = await authorizePOST(req({ shop_id: "s1" }));
    expect(res.status).toBe(402);
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

describe("GET /api/ads/google/campaigns", () => {
  it("401 unauthed", async () => {
    mockUser = null;
    const res = await campaignsGET(getReq("http://localhost/x?shop_id=s1"));
    expect(res.status).toBe(401);
  });

  it("402 when not tiered", async () => {
    mockUser = { id: "u1" };
    mockShop = { id: "s1", slug: "acme" };
    mockSub = null;
    const res = await campaignsGET(getReq("http://localhost/x?shop_id=s1"));
    expect(res.status).toBe(402);
  });
});

describe("POST /api/ads/google/campaigns (create)", () => {
  function tieredShop(extras: Record<string, unknown> = {}) {
    return {
      id: "s1",
      slug: "acme",
      name: "Acme",
      address: "123 Main St",
      city: "Lincoln",
      state: "NE",
      website_url: "https://acme.example.com",
      service_radius_miles: 25,
      max_daily_ad_budget_micros: null,
      ...extras,
    };
  }

  function setupBaseline() {
    mockUser = { id: "u1" };
    mockMembership = { role: "owner" };
    mockShop = tieredShop();
    mockSub = { status: "active", tier: "performance" };
  }

  it("401 unauthed; Google mock not called", async () => {
    const res = await campaignsPOST(
      req({
        shop_id: "s1",
        template_id: "storm-damage-response",
        daily_budget_micros: 50_000_000,
      })
    );
    expect(res.status).toBe(401);
    expect(createCampaignMock).not.toHaveBeenCalled();
  });

  it("402 when not tiered; Google mock not called", async () => {
    mockUser = { id: "u1" };
    mockMembership = { role: "owner" };
    mockShop = tieredShop();
    mockSub = null;
    const res = await campaignsPOST(
      req({
        shop_id: "s1",
        template_id: "storm-damage-response",
        daily_budget_micros: 50_000_000,
      })
    );
    expect(res.status).toBe(402);
    expect(createCampaignMock).not.toHaveBeenCalled();
  });

  it("400 when shop website_url missing; Google mock not called", async () => {
    setupBaseline();
    mockShop = tieredShop({ website_url: null });
    const res = await campaignsPOST(
      req({
        shop_id: "s1",
        template_id: "storm-damage-response",
        daily_budget_micros: 50_000_000,
      })
    );
    expect(res.status).toBe(400);
    const body = (await res.json()) as { missing: string[] };
    expect(body.missing).toContain("website_url");
    expect(createCampaignMock).not.toHaveBeenCalled();
  });

  it("400 when shop website_url non-https; Google mock not called", async () => {
    setupBaseline();
    mockShop = tieredShop({ website_url: "http://acme.example.com" });
    const res = await campaignsPOST(
      req({
        shop_id: "s1",
        template_id: "storm-damage-response",
        daily_budget_micros: 50_000_000,
      })
    );
    expect(res.status).toBe(400);
    const body = (await res.json()) as { missing: string[] };
    expect(body.missing).toContain("website_url_https");
    expect(createCampaignMock).not.toHaveBeenCalled();
  });

  it("400 when shop address missing; Google mock not called", async () => {
    setupBaseline();
    mockShop = tieredShop({ address: null });
    const res = await campaignsPOST(
      req({
        shop_id: "s1",
        template_id: "storm-damage-response",
        daily_budget_micros: 50_000_000,
      })
    );
    expect(res.status).toBe(400);
    const body = (await res.json()) as { missing: string[] };
    expect(body.missing).toContain("address");
    expect(createCampaignMock).not.toHaveBeenCalled();
  });

  it("400 when service_radius_miles missing", async () => {
    setupBaseline();
    mockShop = tieredShop({ service_radius_miles: null });
    const res = await campaignsPOST(
      req({
        shop_id: "s1",
        template_id: "storm-damage-response",
        daily_budget_micros: 50_000_000,
      })
    );
    expect(res.status).toBe(400);
    const body = (await res.json()) as { missing: string[] };
    expect(body.missing).toContain("service_radius_miles");
    expect(createCampaignMock).not.toHaveBeenCalled();
  });

  it("400 when budget exceeds cap; Google mock not called", async () => {
    setupBaseline();
    const res = await campaignsPOST(
      req({
        shop_id: "s1",
        template_id: "storm-damage-response",
        daily_budget_micros: 999_999_999_999,
      })
    );
    expect(res.status).toBe(400);
    expect(createCampaignMock).not.toHaveBeenCalled();
  });

  it("400 when template_id unknown", async () => {
    setupBaseline();
    const res = await campaignsPOST(
      req({
        shop_id: "s1",
        template_id: "does-not-exist",
        daily_budget_micros: 50_000_000,
      })
    );
    expect(res.status).toBe(400);
    expect(createCampaignMock).not.toHaveBeenCalled();
  });

  it("403 when viewer tries to create", async () => {
    setupBaseline();
    mockMembership = { role: "viewer" };
    const res = await campaignsPOST(
      req({
        shop_id: "s1",
        template_id: "storm-damage-response",
        daily_budget_micros: 50_000_000,
      })
    );
    expect(res.status).toBe(403);
    expect(createCampaignMock).not.toHaveBeenCalled();
  });
});

describe("PUT /api/ads/google/campaigns/[id]", () => {
  function setupBaseline() {
    mockUser = { id: "u1" };
    mockMembership = { role: "manager" };
    mockShop = { id: "s1", slug: "acme" };
    mockSub = { status: "active", tier: "performance" };
    mockCampaign = {
      id: "camp-1",
      shop_id: "s1",
      external_resource_name: "customers/1234567890/campaigns/5555",
      external_id: "5555",
      status: "paused",
      daily_budget_micros: 50_000_000,
    };
  }

  it("403 when manager tries to enable (first-enable requires owner)", async () => {
    setupBaseline();
    const res = await campaignPUT(req({ status: "enabled" }), {
      params: Promise.resolve({ id: "camp-1" }),
    });
    expect(res.status).toBe(403);
    expect(updateCampaignMock).not.toHaveBeenCalled();
  });

  it("409 when budget delta exceeds 50%", async () => {
    setupBaseline();
    const res = await campaignPUT(
      req({ daily_budget_micros: 200_000_000 }), // 50M → 200M = 300% increase
      { params: Promise.resolve({ id: "camp-1" }) }
    );
    expect(res.status).toBe(409);
    expect(updateCampaignMock).not.toHaveBeenCalled();
  });

  it("400 when requested budget > cap", async () => {
    setupBaseline();
    mockCampaign = {
      ...mockCampaign!,
      daily_budget_micros: 500_000_000, // $500 — at cap
    };
    const res = await campaignPUT(
      req({ daily_budget_micros: 750_000_000 }), // 50% delta OK, but > cap
      { params: Promise.resolve({ id: "camp-1" }) }
    );
    expect(res.status).toBe(400);
    expect(updateCampaignMock).not.toHaveBeenCalled();
  });
});

describe("POST /api/ads/google/campaigns/sync", () => {
  function setupBaseline() {
    mockUser = { id: "u1" };
    mockMembership = { role: "manager" };
    mockShop = { id: "s1", slug: "acme" };
    mockSub = { status: "active", tier: "performance" };
  }

  it("200 + partial:false when all succeed", async () => {
    setupBaseline();
    mockCampaignsList = [{ id: "c1", external_id: "111" }];
    fetchMetricsMock.mockResolvedValue({
      impressions: 100,
      clicks: 5,
      cost_micros: 1_000_000,
      conversions: 1,
    });
    const res = await syncPOST(req({ shop_id: "s1" }));
    expect(res.status).toBe(200);
    const body = (await res.json()) as { partial: boolean; synced: unknown[] };
    expect(body.partial).toBe(false);
    expect(body.synced.length).toBe(1);
  });

  it("207 + partial:true when at least one fails", async () => {
    setupBaseline();
    mockCampaignsList = [
      { id: "c1", external_id: "111" },
      { id: "c2", external_id: "222" },
    ];
    fetchMetricsMock
      .mockResolvedValueOnce({
        impressions: 10,
        clicks: 1,
        cost_micros: 1000,
        conversions: 0,
      })
      .mockRejectedValueOnce(new Error("upstream boom"));
    const res = await syncPOST(req({ shop_id: "s1" }));
    expect(res.status).toBe(207);
    const body = (await res.json()) as {
      partial: boolean;
      synced: unknown[];
      errors: unknown[];
    };
    expect(body.partial).toBe(true);
    expect(body.synced.length).toBe(1);
    expect(body.errors.length).toBe(1);
  });

  it("401 unauthed; fetchMetrics not called", async () => {
    mockUser = null;
    const res = await syncPOST(req({ shop_id: "s1" }));
    expect(res.status).toBe(401);
    expect(fetchMetricsMock).not.toHaveBeenCalled();
  });

  it("402 when not tiered; fetchMetrics not called", async () => {
    mockUser = { id: "u1" };
    mockShop = { id: "s1", slug: "acme" };
    mockSub = null;
    const res = await syncPOST(req({ shop_id: "s1" }));
    expect(res.status).toBe(402);
    expect(fetchMetricsMock).not.toHaveBeenCalled();
  });
});
