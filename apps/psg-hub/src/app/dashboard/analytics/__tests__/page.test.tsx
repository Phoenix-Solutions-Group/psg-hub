import { describe, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";

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
      const maybeSingle = vi.fn(async () => ({
        data: {
          id: "riverside_shop",
          name: "Riverside Collision",
        },
      }));
      return {
        select: vi.fn(() => ({
          eq: vi.fn(() => ({
            maybeSingle,
          })),
          or: vi.fn(() => ({
            limit: vi.fn(() => ({
              maybeSingle,
            })),
          })),
        })),
      };
    }),
  })),
}));

vi.mock("@/lib/shop/context", () => ({
  getActiveShopContext: vi.fn(async () => ({
    shops: [{ id: "stale_shop", name: "Tedesco Auto Body", role: "owner" }],
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
    (metrics: { sources?: { sendHistoryRows?: number; productionRows?: number; resultRows?: number } }) =>
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
      Direct mail {metrics.activity?.lettersMailedLifetime ?? 0} lifetime letters
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
  it("renders direct-mail preview metrics for Nick when his resolved shop is empty", async () => {
    vi.stubEnv("VERCEL_ENV", "preview");

    const html = renderToStaticMarkup(
      await AnalyticsPage({ searchParams: Promise.resolve({}) }),
    );

    expect(html).toContain("Riverside Collision");
    expect(html).toContain("Direct mail 5 lifetime letters");
    expect(html).not.toContain("Direct mail 0 lifetime letters");
  });
});
