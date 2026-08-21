import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import {
  filterToolLocations,
  portfolioStatusLabel,
  ToolDashboard,
} from "@/components/dashboard/tool-dashboard";
import {
  buildDashboardPortfolio,
  type DashboardStatusRow,
} from "@/lib/dashboard/tools";

const shops = [
  { id: "a", name: "Alpha Collision", role: "owner" },
  { id: "b", name: "Beta Auto Body", role: "viewer" },
];

const rows: DashboardStatusRow[] = shops.map((shop, index) => ({
  shop_id: shop.id,
  shop_url: index === 0 ? "https://alpha.example.com" : null,
  subscription_tier: index === 0 ? "performance" : "growth",
  subscription_active: true,
  linked_google_sources: index === 0 ? ["ga4", "gsc", "gbp"] : [],
  ads_linked: index === 0,
  live_analytics_sources: index === 0 ? ["semrush", "ga4"] : [],
  pending_content_count: index === 0 ? 2 : 0,
  draft_review_response_count: 0,
}));

describe("ToolDashboard", () => {
  it("renders the agreed client tool catalog and account utilities", () => {
    const html = renderToStaticMarkup(
      <ToolDashboard
        portfolio={buildDashboardPortfolio(shops, rows)}
        firstName="sam"
      />,
    );

    expect(html).toContain("Your PSG tools");
    expect(html).toContain("Content Approvals");
    expect(html).toContain("Reviews &amp; Reputation");
    expect(html).toContain("Marketing Analytics");
    expect(html).toContain("Google Ads");
    expect(html).toContain("Plan &amp; Billing");
    expect(html).toContain("Shop Settings");
    expect(html).toContain("2 awaiting review");
    expect(html).not.toContain("Agents");
    expect(html.indexOf("Content Approvals")).toBeLessThan(
      html.indexOf("Marketing Analytics"),
    );
  });

  it("filters locations and summarizes mixed portfolio states", () => {
    const portfolio = buildDashboardPortfolio(shops, rows);
    const ads = portfolio.tools.find((tool) => tool.id === "ads")!;

    expect(
      filterToolLocations(ads.locations, "beta").map((shop) => shop.id),
    ).toEqual(["b"]);
    expect(portfolioStatusLabel(ads)).toBe("1 ready · 1 need upgrade");
  });
});
