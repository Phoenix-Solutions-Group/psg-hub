import { beforeEach, describe, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";

let mockUser: { id: string; email?: string } | null = {
  id: "user_nick",
  email: "nick@phoenixsolutionsgroup.net",
};
let mockDashboardAccess = {
  role: null,
  shopIds: [] as string[],
};
let mockShopContext = {
  shops: [] as { id: string; name: string; role: string }[],
  activeShopId: null as string | null,
};

vi.mock("next/headers", () => ({
  headers: vi.fn(async () => ({
    get: (name: string) =>
      name === "host"
        ? "psg-hub-git-psg-2690-dashboard-review-path-psg-digital.vercel.app"
        : null,
  })),
}));

vi.mock("next/navigation", () => ({
  redirect: vi.fn((path: string) => {
    throw new Error(`redirect:${path}`);
  }),
}));

vi.mock("@/components/dashboard/onboarding-screen", () => ({
  OnboardingScreen: ({ email }: { email?: string | null }) => (
    <section>Onboarding for {email}</section>
  ),
}));

vi.mock("@/components/dashboard/shop-switcher", () => ({
  ShopSwitcher: ({
    shops,
    activeShopId,
  }: {
    shops: { id: string; name: string; role: string }[];
    activeShopId: string | null;
  }) => (
    <section>
      Shop switcher {activeShopId}{" "}
      {shops.map((shop) => shop.name).join(", ")}
    </section>
  ),
}));

vi.mock("@/components/dashboard/mobile-nav", () => ({
  MobileNav: () => <nav>Mobile nav</nav>,
}));

vi.mock("@/lib/supabase/server", () => ({
  createClient: vi.fn(async () => ({
    auth: {
      getUser: vi.fn().mockResolvedValue({ data: { user: mockUser } }),
    },
  })),
}));

vi.mock("@/lib/supabase/service", () => ({
  createServiceClient: vi.fn(() => ({
    from: vi.fn(() => ({
      select: vi.fn(() => ({
        eq: vi.fn(() => ({
          maybeSingle: vi.fn(async () => ({
            data: {
              id: "shop_riverside",
              name: "Riverside Collision",
            },
          })),
        })),
      })),
    })),
  })),
}));

vi.mock("@/lib/auth/shop-access", async () => {
  const actual = await vi.importActual<typeof import("@/lib/auth/shop-access")>(
    "@/lib/auth/shop-access",
  );
  return {
    ...actual,
    getDashboardAccess: vi.fn(async () => mockDashboardAccess),
  };
});

vi.mock("@/lib/auth/ops-access", () => ({
  getOpsAccess: vi.fn(async () => ({ role: null })),
  isOpsStaff: vi.fn(() => false),
}));

vi.mock("@/lib/shop/context", () => ({
  getActiveShopContext: vi.fn(async () => mockShopContext),
}));

const DashboardLayout = (await import("@/app/dashboard/layout")).default;

beforeEach(() => {
  mockUser = {
    id: "user_nick",
    email: "nick@phoenixsolutionsgroup.net",
  };
  mockDashboardAccess = {
    role: null,
    shopIds: [],
  };
  mockShopContext = {
    shops: [],
    activeShopId: null,
  };
});

describe("DashboardLayout private review fallback", () => {
  it("lets Nick's preview account see dashboard children even without a shop membership", async () => {
    const html = renderToStaticMarkup(
      await DashboardLayout({
        children: <main data-testid="analytics-page">Analytics child page</main>,
      }),
    );

    expect(html).toContain("Analytics child page");
    expect(html).toContain("Riverside Collision");
    expect(html).toContain("/dashboard/analytics");
    expect(html).not.toContain("Onboarding for");
  });

  it("keeps the onboarding gate for ordinary no-shop users", async () => {
    mockUser = {
      id: "user_customer",
      email: "customer@example.test",
    };

    const html = renderToStaticMarkup(
      await DashboardLayout({
        children: <main data-testid="analytics-page">Analytics child page</main>,
      }),
    );

    expect(html).not.toContain("Analytics child page");
    expect(html).toContain("Onboarding for customer@example.test");
  });
});
