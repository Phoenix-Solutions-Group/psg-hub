import "server-only";

import { cache } from "react";
import { getUserShops, type UserShop } from "@/lib/shop/context";
import { createServiceClient } from "@/lib/supabase/service";
import { tierMeets, type Tier } from "@/lib/tier/gate";

export type DashboardToolId = "content" | "reviews" | "analytics" | "ads";
export type ToolStatus =
  | "ready"
  | "partial"
  | "setup"
  | "upgrade"
  | "unavailable";

export type ToolLocation = UserShop & {
  status: ToolStatus;
  statusDetail?: string;
  attentionCount: number;
  href: string;
};

export type PortfolioTool = {
  id: DashboardToolId;
  name: string;
  description: string;
  href: string;
  attentionLabel?: string;
  locations: ToolLocation[];
  statusCounts: Record<ToolStatus, number>;
  attentionCount: number;
};

export type DashboardPortfolio = {
  shops: UserShop[];
  tools: PortfolioTool[];
  canRequestPortfolioAccess: boolean;
};

export const TOOL_CATALOG: ReadonlyArray<
  Pick<PortfolioTool, "id" | "name" | "description" | "href" | "attentionLabel">
> = [
  {
    id: "content",
    name: "Content Approvals",
    description: "Review and approve PSG-created content before it goes live.",
    href: "/dashboard/content",
    attentionLabel: "awaiting review",
  },
  {
    id: "reviews",
    name: "Reviews & Reputation",
    description: "Monitor customer feedback and approve prepared response drafts.",
    href: "/dashboard/reviews",
    attentionLabel: "drafts awaiting approval",
  },
  {
    id: "analytics",
    name: "Marketing Analytics",
    description: "See search, website, business profile, and paid performance in one place.",
    href: "/dashboard/analytics",
  },
  {
    id: "ads",
    name: "Google Ads",
    description: "View and manage paid search campaigns built for collision repair.",
    href: "/dashboard/ads",
  },
] as const;

export type DashboardStatusRow = {
  shop_id: string;
  shop_url: string | null;
  subscription_tier: Tier | null;
  subscription_active: boolean;
  linked_google_sources: string[] | null;
  ads_linked: boolean;
  live_analytics_sources: string[] | null;
  pending_content_count: number | string | null;
  draft_review_response_count: number | string | null;
};

const EMPTY_COUNTS: Record<ToolStatus, number> = {
  ready: 0,
  partial: 0,
  setup: 0,
  upgrade: 0,
  unavailable: 0,
};

function numberOf(value: number | string | null | undefined): number {
  const parsed = Number(value ?? 0);
  return Number.isFinite(parsed) ? parsed : 0;
}

function effectivePerformance(row: DashboardStatusRow): boolean {
  return row.subscription_active && tierMeets(row.subscription_tier, "performance");
}

function analyticsStatus(
  row: DashboardStatusRow
): Pick<ToolLocation, "status" | "statusDetail"> {
  const expected = new Set(["ga4", "gsc", "gbp"]);
  if (row.shop_url) expected.add("semrush");
  if (effectivePerformance(row)) expected.add("google_ads");

  const reporting = new Set(
    (row.live_analytics_sources ?? []).filter((source) => expected.has(source))
  );
  const status =
    reporting.size === 0
      ? "setup"
      : reporting.size >= expected.size
        ? "ready"
        : "partial";

  return {
    status,
    statusDetail: `${reporting.size} of ${expected.size} sources reporting`,
  };
}

function locationFor(
  toolId: DashboardToolId,
  shop: UserShop,
  row: DashboardStatusRow | undefined
): ToolLocation {
  const href = TOOL_CATALOG.find((tool) => tool.id === toolId)!.href;
  if (!row) {
    return { ...shop, href, status: "unavailable", attentionCount: 0 };
  }

  if (toolId === "content") {
    return {
      ...shop,
      href,
      status: "ready",
      attentionCount: numberOf(row.pending_content_count),
    };
  }

  if (toolId === "reviews") {
    return {
      ...shop,
      href,
      status: (row.linked_google_sources ?? []).includes("gbp") ? "ready" : "setup",
      attentionCount: numberOf(row.draft_review_response_count),
    };
  }

  if (toolId === "analytics") {
    return { ...shop, href, ...analyticsStatus(row), attentionCount: 0 };
  }

  return {
    ...shop,
    href,
    status: effectivePerformance(row)
      ? row.ads_linked
        ? "ready"
        : "setup"
      : "upgrade",
    attentionCount: 0,
  };
}

export function buildDashboardPortfolio(
  shops: UserShop[],
  rows: DashboardStatusRow[] | null
): DashboardPortfolio {
  const rowsByShop = new Map((rows ?? []).map((row) => [row.shop_id, row]));
  const tools = TOOL_CATALOG.map((tool) => {
    const locations = shops.map((shop) =>
      locationFor(tool.id, shop, rowsByShop.get(shop.id))
    );
    const statusCounts = locations.reduce(
      (counts, location) => {
        counts[location.status] += 1;
        return counts;
      },
      { ...EMPTY_COUNTS }
    );
    return {
      ...tool,
      locations,
      statusCounts,
      attentionCount: locations.reduce(
        (total, location) => total + location.attentionCount,
        0
      ),
    };
  });

  return {
    shops,
    tools,
    canRequestPortfolioAccess: shops.some(
      (shop) => shop.role === "owner" || shop.role === "manager"
    ),
  };
}

export function usableToolNav(portfolio: DashboardPortfolio) {
  return portfolio.tools
    .filter((tool) =>
      tool.locations.some(
        (location) => location.status !== "upgrade" && location.status !== "unavailable"
      )
    )
    .map(({ href, name }) => ({ href, label: name }));
}

export const getDashboardPortfolio = cache(
  async (userId: string): Promise<DashboardPortfolio> => {
    const shops = await getUserShops(userId);
    if (shops.length === 0) return buildDashboardPortfolio([], []);

    const service = createServiceClient();
    const { data, error } = await service.rpc("dashboard_tool_statuses", {
      p_shop_ids: shops.map((shop) => shop.id),
    });

    if (error) {
      console.error("[dashboard-tools] status summary failed:", error.message);
      return buildDashboardPortfolio(shops, null);
    }

    return buildDashboardPortfolio(shops, (data ?? []) as DashboardStatusRow[]);
  }
);
