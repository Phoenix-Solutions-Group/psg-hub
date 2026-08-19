import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";

// redirect() returns `never` in Next; emulate by throwing a sentinel we can read.
const redirect = vi.fn((url: string) => {
  throw new Error(`REDIRECT:${url}`);
});
vi.mock("next/navigation", () => ({
  redirect,
  useRouter: () => ({ refresh: vi.fn(), push: vi.fn() }),
}));
vi.mock("next/headers", () => ({
  headers: vi.fn(async () => new Headers({ host: mockHost })),
}));

type User = { id: string; email?: string } | null;
let mockUser: User = null;
let mockActiveShopId: string | null = null;
// maybeSingle() result for the explicit-param membership re-validation
let mockExplicitMembership: { role: string } | null = null;
let mockTierMeets = false;
let mockHost = "hub.psgweb.me";
let mockShopName = "Shop";
let mockAccounts: Array<Record<string, unknown>> = [];
let mockSnapshots: Array<{ date: string; metrics: Record<string, number> }> = [];
const getActiveShopContext = vi.fn(async () => ({
  shops: [],
  activeShopId: mockActiveShopId,
}));

vi.mock("@/lib/supabase/server", () => ({
  createClient: vi.fn(async () => ({
    auth: {
      getUser: vi.fn().mockResolvedValue({ data: { user: mockUser } }),
    },
    from: vi.fn((table: string) => ({
      select: vi.fn().mockReturnThis(),
      eq: vi.fn().mockReturnThis(),
      order: vi.fn().mockResolvedValue({
        data: table === "google_ads_accounts" ? mockAccounts : [],
        error: null,
      }),
      maybeSingle: vi.fn().mockResolvedValue({
        data: table === "shop_users" ? mockExplicitMembership : null,
        error: null,
      }),
    })),
  })),
}));

vi.mock("@/lib/supabase/service", () => ({
  createServiceClient: vi.fn(() => ({
    from: vi.fn((table: string) => ({
      select: vi.fn().mockReturnThis(),
      eq: vi.fn().mockReturnThis(),
      in: vi.fn().mockReturnThis(),
      order: vi.fn().mockReturnThis(),
      limit: vi.fn().mockResolvedValue({ data: [], error: null }),
      maybeSingle: vi.fn().mockResolvedValue({
        data: table === "shops" ? { id: "s1", name: mockShopName } : null,
        error: null,
      }),
    })),
  })),
}));

vi.mock("@/lib/analytics/snapshots", () => ({
  getSnapshots: vi.fn(async () => mockSnapshots),
}));

vi.mock("@/lib/shop/context", () => ({
  getActiveShopContext,
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
  getActiveShopContext.mockClear();
  mockUser = { id: "u1" };
  mockActiveShopId = null;
  mockExplicitMembership = null;
  mockTierMeets = false;
  mockHost = "hub.psgweb.me";
  mockShopName = "Shop";
  mockAccounts = [];
  mockSnapshots = [];
});

describe("AdsPage shop resolution", () => {
  it("AC-1: no param + active-shop cookie -> redirects to that shop", async () => {
    mockActiveShopId = "shopB";
    await expect(run()).rejects.toThrow("REDIRECT:/dashboard/ads?shop_id=shopB");
  });

  it("prefers the authorized Riverside membership for the approved demo login", async () => {
    mockUser = { id: "u1", email: "test@psghub.me" };
    mockActiveShopId = "riverside";

    await expect(run()).rejects.toThrow("REDIRECT:/dashboard/ads?shop_id=riverside");
    expect(getActiveShopContext).toHaveBeenCalledWith(
      "u1",
      "Riverside Collision",
    );
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

  it("shows the complete seeded Ads dashboard for Riverside in the private preview", async () => {
    mockUser = { id: "u1", email: "test@psghub.me" };
    mockExplicitMembership = { role: "owner" };
    mockTierMeets = true;
    mockShopName = "Riverside Collision";

    const html = renderToStaticMarkup(await run("riverside"));

    expect(html).toContain("Your Google Ads");
    expect(html).toContain("How your ads are doing");
    expect(html).toContain("Collision Repair Search");
    expect(html).toContain("Ask PSG for help");
    expect(html).toContain("Private preview note");
    expect(html).not.toContain("No Google Ads account linked yet");
    expect(html).not.toContain("Tedesco");
  });

  it("preserves the unlinked-account screen outside the private preview", async () => {
    mockUser = { id: "u1", email: "customer@example.com" };
    mockExplicitMembership = { role: "owner" };
    mockTierMeets = true;
    mockShopName = "Ordinary Collision";

    const html = renderToStaticMarkup(await run("ordinary"));

    expect(html).toContain("No Google Ads account linked yet");
    expect(html).not.toContain("Your Google Ads");
    expect(html).not.toContain("Riverside");
  });

  it("unauthenticated -> redirects to /login", async () => {
    mockUser = null;
    await expect(run()).rejects.toThrow("REDIRECT:/login");
  });
});
