import { beforeEach, describe, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import type { ShopAuditReport } from "@/lib/seo-audit/types";

let mockUser: { id: string; email?: string } | null = {
  id: "user_1",
  email: "owner@example.com",
};
let mockActiveShopId: string | null = "shop_1";
let mockPendingContentCount = 0;
let mockLatestAudit: { report: ShopAuditReport } | null = null;
const recordBsmPilotEvent = vi.fn();

vi.mock("@/lib/supabase/server", () => ({
  createClient: vi.fn(async () => ({
    auth: {
      getUser: vi.fn().mockResolvedValue({ data: { user: mockUser } }),
    },
  })),
}));

vi.mock("@/lib/supabase/service", () => ({
  createServiceClient: vi.fn(() => ({})),
}));

vi.mock("@/lib/shop/context", () => ({
  getActiveShopContext: vi.fn(async () => ({
    shops: mockActiveShopId ? [{ id: mockActiveShopId }] : [],
    activeShopId: mockActiveShopId,
  })),
}));

vi.mock("@/lib/seo-audit/run", () => ({
  getLatestShopAudit: vi.fn(async () => mockLatestAudit),
}));

vi.mock("@/lib/bsm/pilot-events", () => ({
  recordBsmPilotEvent: (...a: unknown[]) => recordBsmPilotEvent(...a),
}));

function dashboardPortfolio() {
  const shop = { id: "shop_1", name: "Tracy's Collision", role: "owner" };
  const tool = (
    id: "content" | "reviews" | "analytics" | "ads",
    name: string,
    href: string,
  ) => ({
    id,
    name,
    description: `${name} description`,
    href,
    locations: [
      {
        ...shop,
        href,
        status: "ready" as const,
        attentionCount: id === "content" ? mockPendingContentCount : 0,
      },
    ],
    statusCounts: {
      ready: 1,
      partial: 0,
      setup: 0,
      upgrade: 0,
      unavailable: 0,
    },
    attentionCount: id === "content" ? mockPendingContentCount : 0,
    ...(id === "content" ? { attentionLabel: "awaiting review" } : {}),
  });

  return {
    shops: [shop],
    tools: [
      tool("content", "Content Approvals", "/dashboard/content"),
      tool("reviews", "Reviews & Reputation", "/dashboard/reviews"),
      tool("analytics", "Marketing Analytics", "/dashboard/analytics"),
      tool("ads", "Google Ads", "/dashboard/ads"),
    ],
    canRequestPortfolioAccess: true,
  };
}

vi.mock("@/lib/dashboard/tools", () => ({
  getDashboardPortfolio: vi.fn(async () => dashboardPortfolio()),
}));

const DashboardPage = (await import("@/app/dashboard/page")).default;

function report(overrides: Partial<ShopAuditReport> = {}): ShopAuditReport {
  return {
    shopId: "shop_1",
    businessName: "Tracy's Collision",
    domain: "https://example.com",
    generatedAt: "2026-07-14T00:00:00.000Z",
    mode: "audited",
    healthScore: 82,
    grade: "B",
    summary: {
      pagesCrawled: 3,
      keepCount: 2,
      improveCount: 1,
      findingsBySeverity: { critical: 0, high: 0, medium: 1, low: 0 },
      keywordOpportunities: 4,
      plan: null,
    },
    findings: [],
    recommendations: [],
    inventory: [],
    keywordTargets: [],
    ...overrides,
  };
}

beforeEach(() => {
  mockUser = { id: "user_1", email: "owner@example.com" };
  mockActiveShopId = "shop_1";
  mockPendingContentCount = 0;
  mockLatestAudit = null;
  recordBsmPilotEvent.mockReset();
});

describe("DashboardPage first-login trust state", () => {
  it("shows the first-login trust state before the portfolio tools", async () => {
    const html = renderToStaticMarkup(await DashboardPage());

    expect(html).toContain("Welcome back, owner.");
    expect(html).toContain("Your PSG tools");
    expect(html).toContain("Your first check has not run yet.");
    expect(html).toContain(
      "Run a quick, free shop check first. This does not connect Google, publish anything, or change your public listing.",
    );
    expect(html).toContain("Start free check");
    expect(html.indexOf("Your first check has not run yet.")).toBeLessThan(
      html.indexOf("Content Approvals"),
    );
    expect(recordBsmPilotEvent).toHaveBeenCalledWith(
      expect.anything(),
      {
        eventName: "first_login_card_viewed",
        shopId: "shop_1",
        userId: "user_1",
        properties: { state: "pending" },
      },
    );
  });

  it("keeps showing actionable portfolio counts after activity exists", async () => {
    mockPendingContentCount = 1;
    mockLatestAudit = { report: report() };

    const html = renderToStaticMarkup(await DashboardPage());

    expect(html).toContain("1 page needs attention.");
    expect(html).toContain("1 item is waiting for your review.");
    expect(html).toContain("1 awaiting review");
  });
});
