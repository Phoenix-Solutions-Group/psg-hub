import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";

// redirect() returns `never` in Next; emulate by throwing a sentinel we can read.
const redirect = vi.fn((url: string) => {
  throw new Error(`REDIRECT:${url}`);
});
vi.mock("next/navigation", () => ({
  redirect,
  useRouter: () => ({ refresh: vi.fn() }),
}));

type User = { id: string; email?: string } | null;
let mockUser: User = null;
let mockActiveShopId: string | null = null;
// maybeSingle() result for the explicit-param membership re-validation
let mockExplicitMembership: { role: string } | null = null;
let mockTierMeets = false;
let mockHost = "localhost:3000";
let mockRiversideShopId = "riverside";
const getActiveShopContext = vi.fn(async () => ({
  shops: [],
  activeShopId: mockActiveShopId,
}));

vi.mock("@/lib/supabase/server", () => ({
  createClient: vi.fn(async () => ({
    auth: {
      getUser: vi.fn().mockResolvedValue({ data: { user: mockUser } }),
    },
    from: vi.fn(() => ({
      select: vi.fn().mockReturnThis(),
      eq: vi.fn().mockReturnThis(),
      order: vi.fn().mockResolvedValue({ data: [], error: null }),
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
      maybeSingle: vi.fn().mockResolvedValue({ data: { id: mockRiversideShopId }, error: null }),
    })),
  })),
}));

vi.mock("next/headers", () => ({
  headers: vi.fn(async () => new Headers({ host: mockHost })),
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
  mockHost = "localhost:3000";
  mockRiversideShopId = "riverside";
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

  it("unauthenticated -> redirects to /login", async () => {
    mockUser = null;
    await expect(run()).rejects.toThrow("REDIRECT:/login");
  });

  it("shows the connected Riverside campaign and performance state to the approved QA login", async () => {
    mockUser = { id: "u1", email: "test@psghub.me" };
    mockExplicitMembership = { role: "owner" };
    mockTierMeets = true;
    mockHost = "psg-riverside-review.vercel.app";

    const html = renderToStaticMarkup(await run("riverside"));

    expect(html).toContain("Riverside Collision Google Ads");
    expect(html).toContain("Connected");
    expect(html).toContain("Collision Repair Search — Riverside");
    expect(html).toContain("30-day spend");
    expect(html).toContain("54 leads");
    expect(html).not.toContain("No Google Ads account linked yet");
  });

  it("does not leak Riverside demo data to another authorized shop", async () => {
    mockUser = { id: "u1", email: "test@psghub.me" };
    mockExplicitMembership = { role: "owner" };
    mockTierMeets = true;
    mockHost = "psg-riverside-review.vercel.app";
    mockRiversideShopId = "riverside";

    const html = renderToStaticMarkup(await run("other-shop"));
    expect(html).not.toContain("Riverside Collision Google Ads");
  });
});
