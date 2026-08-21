import { describe, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { getActiveShopContext } from "@/lib/shop/context";
import { getSnapshotsForShops } from "@/lib/analytics/snapshots";

vi.mock("next/navigation", () => ({
  redirect: vi.fn((path: string) => {
    throw new Error(`redirect:${path}`);
  }),
}));

vi.mock("next/headers", () => ({
  headers: vi.fn(async () => ({
    get: (name: string) =>
      name === "host" ? "psg-private-preview.vercel.app" : null,
  })),
}));

vi.mock("@/lib/supabase/server", () => ({
  createClient: vi.fn(async () => ({
    auth: {
      getUser: vi.fn().mockResolvedValue({
        data: {
          user: { id: "user_1", email: "nick@phoenixsolutionsgroup.net" },
        },
      }),
    },
  })),
}));

vi.mock("@/lib/supabase/service", () => ({
  createServiceClient: vi.fn(() => ({
    from: vi.fn((table: string) => {
      if (table !== "shops") throw new Error(`unexpected table:${table}`);
      return {
        select: vi.fn(() => ({
          eq: vi.fn(() => ({
            maybeSingle: vi.fn(async () => ({
              data: {
                id: "riverside_shop",
                name: "Riverside Collision",
              },
            })),
          })),
        })),
      };
    }),
  })),
}));

vi.mock("@/lib/shop/context", () => ({
  getActiveShopContext: vi.fn(async () => ({
    shops: [{ id: "stale_shop", name: "Old Demo Shop", role: "owner" }],
    activeShopId: "stale_shop",
  })),
}));

vi.mock("@/lib/analytics/snapshots", () => ({
  getSnapshots: vi.fn(async () => []),
  getSnapshotsForShops: vi.fn(async () => []),
  getLatestMonthlySnapshot: vi.fn(async () => null),
}));

vi.mock("@/lib/local-falcon/store", () => ({
  getLatestLocalFalconSnapshot: vi.fn(async () => null),
}));

vi.mock("@/lib/reviews/sentiment-summary", () => ({
  getReviewSentimentSummary: vi.fn(async () => null),
}));

vi.mock("@/lib/analytics/direct-mail", () => ({
  EMPTY_DIRECT_MAIL_METRICS: {
    activity: { lettersMailedLifetime: 0 },
    sources: { sendHistoryRows: 0, productionRows: 0, resultRows: 0 },
  },
  getDirectMailMetrics: vi.fn(async () => ({
    activity: { lettersMailedLifetime: 0 },
    sources: { sendHistoryRows: 0, productionRows: 0, resultRows: 0 },
  })),
  getRiversidePreviewDirectMailMetrics: vi.fn(() => ({
    activity: { lettersMailedLifetime: 5 },
    sources: { sendHistoryRows: 4, productionRows: 1, resultRows: 2 },
    privacy: { rawRecipientFieldsIncluded: false },
  })),
  isDirectMailMetricsEmpty: vi.fn(
    (metrics: {
      sources?: {
        sendHistoryRows?: number;
        productionRows?: number;
        resultRows?: number;
      };
    }) =>
      (metrics.sources?.sendHistoryRows ?? 0) === 0 &&
      (metrics.sources?.productionRows ?? 0) === 0 &&
      (metrics.sources?.resultRows ?? 0) === 0,
  ),
}));

vi.mock("@/lib/analytics/google-ads-dashboard", async (importOriginal) => {
  const actual =
    await importOriginal<
      typeof import("@/lib/analytics/google-ads-dashboard")
    >();
  return {
    ...actual,
    getRecentGoogleAdsChanges: vi.fn(async () => []),
  };
});

vi.mock("@/components/analytics/charts", () => ({
  LineChartCard: ({
    title,
    caption,
    ariaLabel,
  }: {
    title: string;
    caption?: string;
    ariaLabel: string;
  }) => (
    <section aria-label={ariaLabel}>
      <h3>{title}</h3>
      {caption ? <p>{caption}</p> : null}
    </section>
  ),
  BarChartCard: ({
    title,
    caption,
    ariaLabel,
  }: {
    title: string;
    caption?: string;
    ariaLabel: string;
  }) => (
    <section aria-label={ariaLabel}>
      <h3>{title}</h3>
      {caption ? <p>{caption}</p> : null}
    </section>
  ),
  Sparkline: ({ ariaLabel }: { ariaLabel: string }) => (
    <span role="img" aria-label={ariaLabel} />
  ),
}));

vi.mock("@/components/analytics/direct-mail-panel", () => ({
  DirectMailPanel: ({
    metrics,
  }: {
    metrics: { activity?: { lettersMailedLifetime?: number } };
  }) => (
    <section>
      Direct mail {metrics.activity?.lettersMailedLifetime ?? 0} lifetime
      letters
    </section>
  ),
}));

vi.mock("../link-google-button", () => ({
  LinkGoogleButton: () => <button>Connect Google</button>,
}));

vi.mock("../link-gbp-button", () => ({
  LinkGbpButton: () => <button>Connect Business Profile</button>,
}));

const AnalyticsPage = (await import("@/app/dashboard/analytics/page")).default;

describe("AnalyticsPage private preview", () => {
  it("renders measurable demo metrics and connection next actions", async () => {
    const html = renderToStaticMarkup(
      await AnalyticsPage({ searchParams: Promise.resolve({}) }),
    );

    expect(html).toContain("Riverside Collision");
    expect(html).toContain("Last synced Aug 5, 2026");
    expect(html).toContain("Private preview note");
    expect(html).toContain("Spend");
    expect(html).toContain("$1,480");
    expect(html).toContain("Sessions");
    expect(html).toContain(">392<");
    expect(html).toContain("Search clicks");
    expect(html).toContain(">58<");
    expect(html).toContain("Profile calls");
    expect(html).toContain(">27<");
    expect(html).toContain("Rating · 186 reviews");
    expect(html).toContain("41.8%");
    expect(html).toContain("Share of Local Voice");
    expect(html).toContain("Google Analytics &amp; Search Console");
    expect(html).toContain("Google Ads");
    expect(html).toContain("Open Google Ads connection");
    expect(html).toContain("Direct mail 5 lifetime letters");
    expect(html).not.toContain("Google Ads account connection");
  });

  it("updates applicable metric labels and links for the selected date range", async () => {
    const html = renderToStaticMarkup(
      await AnalyticsPage({ searchParams: Promise.resolve({ days: "90" }) }),
    );

    expect(html).toContain("Reporting period");
    expect(html).toContain("trailing 90 days");
    expect(html).toContain("Website sessions over the last 90 days");
    expect(html).toContain('href="/dashboard/analytics?days=90"');
  });

  it("keeps preview disclosure and honest per-shop states in all-shops scope", async () => {
    vi.mocked(getActiveShopContext).mockResolvedValueOnce({
      shops: [
        { id: "riverside_shop", name: "Riverside Collision", role: "owner" },
        { id: "second_shop", name: "Second Demo Shop", role: "owner" },
      ],
      activeShopId: "riverside_shop",
    });
    vi.mocked(getSnapshotsForShops).mockResolvedValue([
      {
        id: "snapshot_1",
        shop_id: "riverside_shop",
        location_id: null,
        source: "ga4",
        period: "daily",
        date: "2026-08-05",
        synced_at: "2026-08-05T14:00:00.000Z",
        created_at: "2026-08-05T14:00:00.000Z",
        metrics: {
          organic_traffic: 1,
          organic_keywords: 1,
          organic_traffic_cost: 1,
          backlinks: 1,
          spend: 1,
          impressions: 1,
          clicks: 1,
          conversions: 1,
          sessions: 1,
          total_users: 1,
          key_events: 1,
          call_clicks: 1,
          website_clicks: 1,
          direction_requests: 1,
          impressions_total: 1,
        },
      },
    ]);

    const html = renderToStaticMarkup(
      await AnalyticsPage({
        searchParams: Promise.resolve({ scope: "all", days: "90" }),
      }),
    );

    expect(html).toContain("Local map visibility");
    expect(html).toContain("Review sentiment");
    expect(html).toContain("cannot be combined accurately across shops");
    expect(html).toContain("cannot be combined responsibly across shops");
    expect(html).toContain("Private preview note");
    expect(html).toContain('href="/dashboard/analytics?scope=all&amp;days=90"');
  });
});
