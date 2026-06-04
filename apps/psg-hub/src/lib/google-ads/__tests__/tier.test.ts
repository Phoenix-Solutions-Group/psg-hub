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
          maybeSingle: vi.fn().mockResolvedValue({ data: mockShop, error: null }),
        };
      }
      if (table === "subscriptions") {
        return {
          select: vi.fn().mockReturnThis(),
          eq: vi.fn().mockReturnThis(),
          maybeSingle: vi.fn().mockResolvedValue({ data: mockSub, error: null }),
        };
      }
      throw new Error(`unexpected table: ${table}`);
    }),
  };
}

vi.mock("@/lib/supabase/service", () => ({
  createServiceClient: () => serviceClient(),
}));

const { assertAdsTier } = await import("@/lib/google-ads/tier");

beforeEach(() => {
  mockShop = null;
  mockSub = null;
  process.env.SHOP_ADS_TIER_OVERRIDE = "";
});

describe("assertAdsTier", () => {
  it("passes when shop has active Performance tier", async () => {
    mockShop = { id: "s1", slug: "acme" };
    mockSub = { status: "active", tier: "performance" };
    await expect(assertAdsTier("s1")).resolves.toBeUndefined();
  });

  it("throws tier_required with no subscription", async () => {
    mockShop = { id: "s1", slug: "acme" };
    mockSub = null;
    await expect(assertAdsTier("s1")).rejects.toMatchObject({
      code: "tier_required",
    });
  });

  it("throws tier_required with Essentials active", async () => {
    mockShop = { id: "s1", slug: "acme" };
    mockSub = { status: "active", tier: "essentials" };
    await expect(assertAdsTier("s1")).rejects.toMatchObject({
      code: "tier_required",
    });
  });

  it("throws tier_required with Performance but inactive", async () => {
    mockShop = { id: "s1", slug: "acme" };
    mockSub = { status: "canceled", tier: "performance" };
    await expect(assertAdsTier("s1")).rejects.toMatchObject({
      code: "tier_required",
    });
  });

  it("SHOP_ADS_TIER_OVERRIDE allowlist bypasses subscription check", async () => {
    mockShop = { id: "s1", slug: "psg-internal" };
    mockSub = null;
    process.env.SHOP_ADS_TIER_OVERRIDE = "psg-internal,other-internal";
    await expect(assertAdsTier("s1")).resolves.toBeUndefined();
  });

  it("throws when shop not found", async () => {
    mockShop = null;
    await expect(assertAdsTier("missing")).rejects.toMatchObject({
      code: "shop_preflight_failed",
    });
  });
});
