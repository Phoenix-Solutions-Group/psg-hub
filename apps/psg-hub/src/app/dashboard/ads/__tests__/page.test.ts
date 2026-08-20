import { beforeEach, describe, expect, it, vi } from "vitest";

const redirect = vi.fn((url: string) => {
  throw new Error(`REDIRECT:${url}`);
});
vi.mock("next/navigation", () => ({ redirect }));

type User = { id: string } | null;
let mockUser: User = null;
let mockActiveShopId: string | null = null;
let mockExplicitMembership: { role: string } | null = null;
let mockTierMeets = false;

vi.mock("@/lib/supabase/server", () => ({
  createClient: vi.fn(async () => ({
    auth: {
      getUser: vi.fn().mockResolvedValue({ data: { user: mockUser } }),
    },
    from: vi.fn(() => ({
      select: vi.fn().mockReturnThis(),
      eq: vi.fn().mockReturnThis(),
      maybeSingle: vi
        .fn()
        .mockResolvedValue({ data: mockExplicitMembership, error: null }),
    })),
  })),
}));

vi.mock("@/lib/shop/context", () => ({
  getActiveShopContext: vi.fn(async () => ({
    shops: [],
    activeShopId: mockActiveShopId,
  })),
}));

vi.mock("@/lib/tier/gate", () => ({
  shopHasTier: vi.fn(async () => mockTierMeets),
}));

const { default: AdsPage, adsPageHeading } = await import("@/app/dashboard/ads/page");

function run(shop_id?: string) {
  return AdsPage({ searchParams: Promise.resolve(shop_id ? { shop_id } : {}) });
}

beforeEach(() => {
  redirect.mockClear();
  mockUser = { id: "u1" };
  mockActiveShopId = null;
  mockExplicitMembership = null;
  mockTierMeets = false;
});

describe("AdsPage shop resolution", () => {
  it("names the authorized shop in the customer review heading", () => {
    expect(adsPageHeading("Riverside Collision")).toBe("Riverside Collision Google Ads");
    expect(adsPageHeading(null)).toBe("Your Google Ads");
  });
  it("uses the active shop when no explicit shop is supplied", async () => {
    mockActiveShopId = "shopB";
    await expect(run()).rejects.toThrow("REDIRECT:/dashboard/ads?shop_id=shopB");
  });

  it("returns to the dashboard when no active shop exists", async () => {
    await expect(run()).rejects.toThrow("REDIRECT:/dashboard");
  });

  it("rejects an explicit shop without a matching membership", async () => {
    await expect(run("shopX")).rejects.toThrow("REDIRECT:/dashboard");
  });

  it("accepts an explicit member shop without redirecting", async () => {
    mockExplicitMembership = { role: "owner" };
    const result = await run("shopB");
    expect(result).toBeTruthy();
    expect(redirect).not.toHaveBeenCalled();
  });

  it("redirects signed-out visitors to login", async () => {
    mockUser = null;
    await expect(run()).rejects.toThrow("REDIRECT:/login");
  });
});
