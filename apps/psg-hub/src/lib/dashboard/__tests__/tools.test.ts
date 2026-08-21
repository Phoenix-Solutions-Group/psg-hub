import { describe, expect, it } from "vitest";
import {
  buildDashboardPortfolio,
  usableToolNav,
  type DashboardStatusRow,
} from "@/lib/dashboard/tools";

const shops = [
  { id: "shop-a", name: "North", role: "owner" },
  { id: "shop-b", name: "South", role: "viewer" },
];

function row(overrides: Partial<DashboardStatusRow> = {}): DashboardStatusRow {
  return {
    shop_id: "shop-a",
    shop_url: "https://north.example.com",
    subscription_tier: "performance",
    subscription_active: true,
    linked_google_sources: ["ga4", "gsc", "gbp"],
    ads_linked: true,
    live_analytics_sources: ["semrush", "ga4", "gsc", "gbp", "google_ads"],
    pending_content_count: 2,
    draft_review_response_count: 3,
    ...overrides,
  };
}

describe("buildDashboardPortfolio", () => {
  it("maps readiness, actionable counts, and portfolio request authority", () => {
    const portfolio = buildDashboardPortfolio(shops, [
      row(),
      row({
        shop_id: "shop-b",
        shop_url: null,
        subscription_tier: "essentials",
        linked_google_sources: ["ga4"],
        ads_linked: false,
        live_analytics_sources: ["ga4"],
        pending_content_count: "1",
        draft_review_response_count: "0",
      }),
    ]);

    expect(portfolio.canRequestPortfolioAccess).toBe(true);
    expect(portfolio.tools.map((tool) => tool.name)).toEqual([
      "Content Approvals",
      "Reviews & Reputation",
      "Marketing Analytics",
      "Google Ads",
    ]);

    const content = portfolio.tools[0];
    expect(content.attentionCount).toBe(3);
    expect(content.statusCounts.ready).toBe(2);

    const reviews = portfolio.tools[1];
    expect(reviews.attentionCount).toBe(3);
    expect(reviews.locations.map((location) => location.status)).toEqual([
      "ready",
      "setup",
    ]);

    const analytics = portfolio.tools[2];
    expect(analytics.locations[0]).toMatchObject({
      status: "ready",
      statusDetail: "5 of 5 sources reporting",
    });
    expect(analytics.locations[1]).toMatchObject({
      status: "partial",
      statusDetail: "1 of 3 sources reporting",
    });

    const ads = portfolio.tools[3];
    expect(ads.locations.map((location) => location.status)).toEqual([
      "ready",
      "upgrade",
    ]);
  });

  it("fails closed when a shop is absent from the summary", () => {
    const portfolio = buildDashboardPortfolio(shops, [row()]);
    for (const tool of portfolio.tools) {
      expect(tool.locations[1].status).toBe("unavailable");
    }
  });

  it("keeps upgrade-only tools out of the fast sidebar", () => {
    const portfolio = buildDashboardPortfolio(shops, [
      row({ subscription_tier: "growth", ads_linked: false }),
      row({
        shop_id: "shop-b",
        subscription_tier: "essentials",
        ads_linked: false,
      }),
    ]);

    expect(usableToolNav(portfolio).map((item) => item.label)).toEqual([
      "Content Approvals",
      "Reviews & Reputation",
      "Marketing Analytics",
    ]);
  });

  it("does not grant portfolio request authority to all-viewer users", () => {
    const portfolio = buildDashboardPortfolio(
      shops.map((shop) => ({ ...shop, role: "viewer" })),
      [row(), row({ shop_id: "shop-b" })]
    );
    expect(portfolio.canRequestPortfolioAccess).toBe(false);
  });
});
