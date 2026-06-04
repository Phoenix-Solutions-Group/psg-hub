import { describe, it, expect, vi, beforeEach } from "vitest";

type Shop = { id: string; slug: string } | null;
type Sub = { status: string; tier: string } | null;

let mockShop: Shop = null;
let mockSub: Sub = null;

function serviceClient() {
  return {
    from: vi.fn((table: string) => {
      if (table === "shops") {
        return {
          select: vi.fn().mockReturnThis(),
          eq: vi.fn().mockReturnThis(),
          maybeSingle: vi
            .fn()
            .mockResolvedValue({ data: mockShop, error: null }),
        };
      }
      if (table === "subscriptions") {
        return {
          select: vi.fn().mockReturnThis(),
          eq: vi.fn().mockReturnThis(),
          maybeSingle: vi
            .fn()
            .mockResolvedValue({ data: mockSub, error: null }),
        };
      }
      throw new Error(`unexpected table: ${table}`);
    }),
  };
}

vi.mock("@/lib/supabase/service", () => ({
  createServiceClient: () => serviceClient(),
}));

const { TIER_RANK, tierMeets, getShopTier, shopHasTier, assertShopTier } =
  await import("@/lib/tier/gate");

beforeEach(() => {
  mockShop = null;
  mockSub = null;
  process.env.SHOP_ADS_TIER_OVERRIDE = "";
});

describe("TIER_RANK + tierMeets", () => {
  it("ranks essentials < growth < performance", () => {
    expect(TIER_RANK.essentials).toBeLessThan(TIER_RANK.growth);
    expect(TIER_RANK.growth).toBeLessThan(TIER_RANK.performance);
  });

  it("meets when current rank >= min rank", () => {
    expect(tierMeets("performance", "performance")).toBe(true);
    expect(tierMeets("performance", "growth")).toBe(true);
    expect(tierMeets("growth", "growth")).toBe(true);
    expect(tierMeets("growth", "essentials")).toBe(true);
    expect(tierMeets("essentials", "essentials")).toBe(true);
  });

  it("does not meet when current rank < min rank", () => {
    expect(tierMeets("growth", "performance")).toBe(false);
    expect(tierMeets("essentials", "performance")).toBe(false);
    expect(tierMeets("essentials", "growth")).toBe(false);
  });

  it("null/undefined/unknown current never meets", () => {
    expect(tierMeets(null, "essentials")).toBe(false);
    expect(tierMeets(undefined, "essentials")).toBe(false);
    // unknown DB value outside the union
    expect(tierMeets("legacy" as never, "essentials")).toBe(false);
  });
});

describe("getShopTier", () => {
  it("returns non-meeting state when shop is missing", async () => {
    mockShop = null;
    await expect(getShopTier("missing")).resolves.toEqual({
      tier: null,
      active: false,
      overridden: false,
    });
  });

  it("reflects subscription tier + active status", async () => {
    mockShop = { id: "s1", slug: "acme" };
    mockSub = { status: "active", tier: "growth" };
    await expect(getShopTier("s1")).resolves.toEqual({
      tier: "growth",
      active: true,
      overridden: false,
    });
  });

  it("flags overridden shops", async () => {
    mockShop = { id: "s1", slug: "psg-internal" };
    mockSub = null;
    process.env.SHOP_ADS_TIER_OVERRIDE = "psg-internal,other-internal";
    await expect(getShopTier("s1")).resolves.toEqual({
      tier: null,
      active: false,
      overridden: true,
    });
  });
});

describe("shopHasTier", () => {
  it("override bypasses at min=performance with no subscription", async () => {
    mockShop = { id: "s1", slug: "psg-internal" };
    mockSub = null;
    process.env.SHOP_ADS_TIER_OVERRIDE = "psg-internal";
    await expect(shopHasTier("s1", "performance")).resolves.toBe(true);
  });

  it("override bypasses at lower mins too, even inactive sub", async () => {
    mockShop = { id: "s1", slug: "psg-internal" };
    mockSub = { status: "canceled", tier: "essentials" };
    process.env.SHOP_ADS_TIER_OVERRIDE = "psg-internal";
    await expect(shopHasTier("s1", "essentials")).resolves.toBe(true);
    await expect(shopHasTier("s1", "performance")).resolves.toBe(true);
  });

  it("active performance passes performance", async () => {
    mockShop = { id: "s1", slug: "acme" };
    mockSub = { status: "active", tier: "performance" };
    await expect(shopHasTier("s1", "performance")).resolves.toBe(true);
  });

  it("active growth fails performance but passes growth/essentials", async () => {
    mockShop = { id: "s1", slug: "acme" };
    mockSub = { status: "active", tier: "growth" };
    await expect(shopHasTier("s1", "performance")).resolves.toBe(false);
    await expect(shopHasTier("s1", "growth")).resolves.toBe(true);
    await expect(shopHasTier("s1", "essentials")).resolves.toBe(true);
  });

  it("missing subscription fails any min", async () => {
    mockShop = { id: "s1", slug: "acme" };
    mockSub = null;
    await expect(shopHasTier("s1", "essentials")).resolves.toBe(false);
  });

  it("inactive subscription fails even at its own tier", async () => {
    mockShop = { id: "s1", slug: "acme" };
    mockSub = { status: "canceled", tier: "performance" };
    await expect(shopHasTier("s1", "performance")).resolves.toBe(false);
  });

  it("missing shop fails", async () => {
    mockShop = null;
    await expect(shopHasTier("missing", "essentials")).resolves.toBe(false);
  });
});

describe("assertShopTier", () => {
  it("resolves when the shop meets the minimum", async () => {
    mockShop = { id: "s1", slug: "acme" };
    mockSub = { status: "active", tier: "performance" };
    await expect(
      assertShopTier("s1", "performance")
    ).resolves.toBeUndefined();
  });

  it("throws the supplied factory error on failure", async () => {
    mockShop = { id: "s1", slug: "acme" };
    mockSub = { status: "active", tier: "essentials" };
    class TestError extends Error {
      constructor(public code: string, message: string) {
        super(message);
      }
    }
    await expect(
      assertShopTier(
        "s1",
        "performance",
        (msg) => new TestError("tier_required", msg)
      )
    ).rejects.toMatchObject({ code: "tier_required" });
  });

  it("throws a plain Error when no factory is supplied", async () => {
    mockShop = { id: "s1", slug: "acme" };
    mockSub = null;
    await expect(assertShopTier("s1", "growth")).rejects.toThrow(
      "growth tier required"
    );
  });
});
