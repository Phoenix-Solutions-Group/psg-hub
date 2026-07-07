import { describe, it, expect, vi, beforeEach } from "vitest";

/**
 * PSG-779 §6 — the campaign preflight was reading columns that do not exist
 * (address/city/state/website_url/max_daily_ad_budget_micros) and always 500'd.
 * These tests lock in the reconciliation to the REAL shops schema: the `missing`
 * keys are unchanged, and createCampaign receives geo/URL mapped from the real
 * columns.
 */

type User = { id: string } | null;
let mockUser: User = { id: "u1" };
let membershipRole: string | null = "owner";
let shopRow: Record<string, unknown> | null = null;
const createCampaignMock = vi.fn();

function serverClient() {
  return {
    auth: {
      getUser: vi.fn().mockResolvedValue({ data: { user: mockUser } }),
    },
    from: vi.fn().mockImplementation((table: string) => {
      if (table === "shop_users") {
        return {
          select: vi.fn().mockReturnValue({
            eq: vi.fn().mockReturnValue({
              eq: vi.fn().mockReturnValue({
                maybeSingle: vi.fn().mockResolvedValue({
                  data: membershipRole ? { role: membershipRole } : null,
                  error: null,
                }),
              }),
            }),
          }),
        };
      }
      throw new Error(`unexpected server table ${table}`);
    }),
  };
}

function serviceClient() {
  return {
    from: vi.fn().mockImplementation((table: string) => {
      if (table === "shops") {
        return {
          select: vi.fn().mockReturnValue({
            eq: vi.fn().mockReturnValue({
              maybeSingle: vi
                .fn()
                .mockResolvedValue({ data: shopRow, error: null }),
            }),
          }),
        };
      }
      if (table === "google_ads_campaigns") {
        return {
          insert: vi.fn().mockReturnValue({
            select: vi.fn().mockReturnValue({
              single: vi
                .fn()
                .mockResolvedValue({ data: { id: "camp-1" }, error: null }),
            }),
          }),
        };
      }
      throw new Error(`unexpected service table ${table}`);
    }),
  };
}

vi.mock("@/lib/supabase/server", () => ({
  createClient: vi.fn(async () => serverClient()),
}));
vi.mock("@/lib/supabase/service", () => ({
  createServiceClient: vi.fn(() => serviceClient()),
}));
vi.mock("@/lib/google-ads/tier", () => ({
  assertAdsTier: vi.fn(async () => undefined),
}));
vi.mock("@/lib/google-ads/templates", () => ({
  getTemplate: vi.fn(() => ({ name: "Collision Search" })),
}));
vi.mock("@/lib/google-ads/campaigns", () => ({
  createCampaign: (args: unknown) => {
    createCampaignMock(args);
    return Promise.resolve({
      accountId: "acct-1",
      externalResourceName: "customers/1/campaigns/2",
      externalId: "2",
    });
  },
}));

const { POST } = await import("@/app/api/ads/google/campaigns/route");

function req(body: Record<string, unknown>) {
  return new Request("http://localhost/api/ads/google/campaigns", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

const OK_BODY = {
  shop_id: "shop-1",
  template_id: "tmpl-1",
  daily_budget_micros: 50_000_000,
  name: "My Campaign",
};

const COMPLETE_SHOP = {
  id: "shop-1",
  name: "Shelton Collision",
  address_street: "421 River Rd",
  address_locality: "Shelton",
  address_region: "CT",
  url: "https://sheltoncollision.com",
  radius: 25,
};

beforeEach(() => {
  mockUser = { id: "u1" };
  membershipRole = "owner";
  shopRow = { ...COMPLETE_SHOP };
  createCampaignMock.mockReset();
});

describe("POST /api/ads/google/campaigns — reconciled preflight", () => {
  it("passes preflight and maps real columns into createCampaign", async () => {
    const res = await POST(req(OK_BODY));
    expect(res.status).toBe(200);
    expect(createCampaignMock).toHaveBeenCalledTimes(1);
    const args = createCampaignMock.mock.calls[0][0] as {
      finalUrl: string;
      geoTargeting: {
        address: string;
        city: string | null;
        state: string | null;
        radiusMiles: number;
      };
    };
    expect(args.finalUrl).toBe("https://sheltoncollision.com");
    expect(args.geoTargeting).toEqual({
      address: "421 River Rd",
      city: "Shelton",
      state: "CT",
      radiusMiles: 25,
    });
  });

  it("missing street → missing:['address'] (key preserved)", async () => {
    shopRow = { ...COMPLETE_SHOP, address_street: "" };
    const res = await POST(req(OK_BODY));
    expect(res.status).toBe(400);
    const json = (await res.json()) as { missing: string[] };
    expect(json.missing).toContain("address");
    expect(createCampaignMock).not.toHaveBeenCalled();
  });

  it("null radius → missing:['service_radius_miles'] (key preserved)", async () => {
    shopRow = { ...COMPLETE_SHOP, radius: null };
    const res = await POST(req(OK_BODY));
    expect(res.status).toBe(400);
    const json = (await res.json()) as { missing: string[] };
    expect(json.missing).toContain("service_radius_miles");
  });

  it("blank url → missing:['website_url']", async () => {
    shopRow = { ...COMPLETE_SHOP, url: "" };
    const res = await POST(req(OK_BODY));
    expect(res.status).toBe(400);
    const json = (await res.json()) as { missing: string[] };
    expect(json.missing).toContain("website_url");
  });

  it("http (not https) url → missing:['website_url_https']", async () => {
    shopRow = { ...COMPLETE_SHOP, url: "http://insecure.com" };
    const res = await POST(req(OK_BODY));
    expect(res.status).toBe(400);
    const json = (await res.json()) as { missing: string[] };
    expect(json.missing).toContain("website_url_https");
  });

  it("budget over the env cap → 400 (no per-shop column consulted)", async () => {
    const res = await POST(req({ ...OK_BODY, daily_budget_micros: 10 ** 12 }));
    expect(res.status).toBe(400);
    const json = (await res.json()) as { cap: number };
    // Default env cap is 500_000_000 (DEFAULT_MAX_MICROS).
    expect(json.cap).toBe(500_000_000);
    expect(createCampaignMock).not.toHaveBeenCalled();
  });
});
