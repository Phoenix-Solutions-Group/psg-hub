import { describe, it, expect, vi, beforeEach } from "vitest";
import React from "react";

const redirect = vi.fn((url: string) => {
  throw new Error(`REDIRECT:${url}`);
});
vi.mock("next/navigation", () => ({ redirect }));

const subscriptionEq = vi.fn();
let mockUser: { id: string } | null = { id: "user_1" };
let mockActiveShopId: string | null = "shop_a";
let mockShops: Array<{ id: string }> = [{ id: "shop_a" }, { id: "shop_b" }];
let mockSubscription: { tier: string; status: string; current_period_end: string | null } | null = {
  tier: "growth",
  status: "active",
  current_period_end: null,
};

vi.mock("@/lib/supabase/server", () => ({
  createClient: vi.fn(async () => ({
    auth: {
      getUser: vi.fn().mockResolvedValue({ data: { user: mockUser } }),
    },
    from: vi.fn(() => ({
      select: vi.fn().mockReturnThis(),
      eq: subscriptionEq.mockReturnThis(),
      maybeSingle: vi
        .fn()
        .mockImplementation(() =>
          Promise.resolve({ data: mockSubscription, error: null })
        ),
    })),
  })),
}));

vi.mock("@/lib/shop/context", () => ({
  getActiveShopContext: vi.fn(async () => ({
    shops: mockShops,
    activeShopId: mockActiveShopId,
  })),
}));

const BillingPage = (await import("@/app/dashboard/billing/page")).default;

function collectPricingProps(
  node: React.ReactNode,
  values: Array<{ tier: string; shopId: string; current?: boolean }> = []
) {
  if (!React.isValidElement(node)) return values;
  const props = node.props as {
    tier?: string;
    shopId?: string;
    current?: boolean;
    children?: React.ReactNode;
  };
  if (props.tier && props.shopId) {
    values.push({
      tier: props.tier,
      shopId: props.shopId,
      current: props.current,
    });
  }
  React.Children.forEach(props.children, (child) =>
    collectPricingProps(child, values)
  );
  return values;
}

beforeEach(() => {
  redirect.mockClear();
  subscriptionEq.mockClear();
  mockUser = { id: "user_1" };
  mockActiveShopId = "shop_a";
  mockShops = [{ id: "shop_a" }, { id: "shop_b" }];
  mockSubscription = {
    tier: "growth",
    status: "active",
    current_period_end: null,
  };
});

describe("BillingPage shop scoping", () => {
  it("uses the requested member shop for the current plan and billing actions", async () => {
    const result = await BillingPage({
      searchParams: Promise.resolve({ shop_id: "shop_b" }),
    });

    expect(subscriptionEq).toHaveBeenCalledWith("shop_id", "shop_b");
    const renderedPricingProps = collectPricingProps(result);
    expect(renderedPricingProps.map((props) => props.shopId)).toEqual([
      "shop_b",
      "shop_b",
      "shop_b",
    ]);
    expect(renderedPricingProps.find((props) => props.tier === "growth")).toMatchObject({
      current: true,
    });
  });

  it("rejects a shop_id outside the user's shop list", async () => {
    await expect(
      BillingPage({ searchParams: Promise.resolve({ shop_id: "shop_x" }) })
    ).rejects.toThrow("REDIRECT:/dashboard");
  });
});
