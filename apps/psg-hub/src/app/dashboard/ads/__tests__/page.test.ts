import { describe, it, expect, vi, beforeEach } from "vitest";

// redirect() returns `never` in Next; emulate by throwing a sentinel we can read.
const redirect = vi.fn((url: string) => {
  throw new Error(`REDIRECT:${url}`);
});
vi.mock("next/navigation", () => ({ redirect }));

type User = { id: string } | null;
let mockUser: User = null;
let mockActiveShopId: string | null = null;
// maybeSingle() result for the explicit-param membership re-validation
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

vi.mock("@/lib/supabase/service", () => ({
  createServiceClient: vi.fn(() => ({
    from: vi.fn(() => ({
      select: vi.fn().mockReturnThis(),
      eq: vi.fn().mockReturnThis(),
      maybeSingle: vi
        .fn()
        .mockResolvedValue({ data: { id: "s1", name: "Shop" }, error: null }),
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

const AdsPage = (await import("@/app/dashboard/ads/page")).default;

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
  it("AC-1: no param + active-shop cookie -> redirects to that shop", async () => {
    mockActiveShopId = "shopB";
    await expect(run()).rejects.toThrow("REDIRECT:/dashboard/ads?shop_id=shopB");
  });

  it("AC-1: no param + no memberships -> redirects to /dashboard", async () => {
    mockActiveShopId = null;
    await expect(run()).rejects.toThrow("REDIRECT:/dashboard");
  });

  it("AC-2: explicit param for a non-member shop -> redirects to /dashboard", async () => {
    mockExplicitMembership = null; // re-validation finds no membership
    await expect(run("shopX")).rejects.toThrow("REDIRECT:/dashboard");
  });

  it("AC-2: explicit param for a member shop wins (no redirect; tier-gated)", async () => {
    mockExplicitMembership = { role: "owner" };
    mockTierMeets = false; // below Performance -> TierGateCard, not a redirect
    const result = await run("shopB");
    expect(result).toBeTruthy();
    expect(redirect).not.toHaveBeenCalled();
  });

  it("unauthenticated -> redirects to /login", async () => {
    mockUser = null;
    await expect(run()).rejects.toThrow("REDIRECT:/login");
  });
});
