import { beforeEach, describe, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import type { ShopAuditReport } from "@/lib/seo-audit/types";

let mockUser: { id: string; email?: string } | null = {
  id: "user_1",
  email: "owner@example.com",
};
let mockActiveShopId: string | null = "shop_1";
let mockCounts = {
  all: 0,
  pending_review: 0,
  published: 0,
};
let mockLatestAudit: { report: ShopAuditReport } | null = null;
let mockLocalFalcon: {
  capturedAt: string;
  shareOfLocalVoice: number | null;
} | null = null;
let mockPresenceRow: { metrics: Record<string, unknown> } | null = null;
let mockGscRows: { date: string; metrics: Record<string, unknown> }[] = [];
let mockGaRows: { date: string; metrics: Record<string, unknown> }[] = [];
let mockPaidRows: { date: string; metrics: Record<string, unknown> }[] = [];
let mockPreviewShop: { id: string; name: string } | null = null;
const recordBsmPilotEvent = vi.fn();

vi.mock("@/lib/supabase/server", () => ({
  createClient: vi.fn(async () => ({
    auth: {
      getUser: vi.fn().mockResolvedValue({ data: { user: mockUser } }),
    },
  })),
}));

class CountQuery {
  private status: string | null = null;

  select() {
    return this;
  }

  eq(column: string, value: string) {
    if (column === "status") {
      this.status = value;
    }
    return this;
  }

  then<TResult1 = { count: number }, TResult2 = never>(
    onfulfilled?:
      | ((value: { count: number }) => TResult1 | PromiseLike<TResult1>)
      | null,
    onrejected?: ((reason: unknown) => TResult2 | PromiseLike<TResult2>) | null,
  ) {
    const key = this.status ?? "all";
    return Promise.resolve({ count: mockCounts[key as keyof typeof mockCounts] }).then(
      onfulfilled,
      onrejected,
    );
  }
}

vi.mock("@/lib/supabase/service", () => ({
  createServiceClient: vi.fn(() => ({
    from: vi.fn(() => new CountQuery()),
  })),
}));

vi.mock("@/lib/shop/context", () => ({
  getActiveShopContext: vi.fn(async () => ({
    shops: mockActiveShopId
      ? [{ id: mockActiveShopId, name: "Tracy's Collision" }]
      : [],
    activeShopId: mockActiveShopId,
  })),
}));

vi.mock("@/lib/seo-audit/run", () => ({
  getLatestShopAudit: vi.fn(async () => mockLatestAudit),
}));

vi.mock("@/lib/local-falcon/store", () => ({
  getLatestLocalFalconSnapshot: vi.fn(async () => mockLocalFalcon),
}));

vi.mock("@/lib/analytics/snapshots", () => ({
  getLatestMonthlySnapshot: vi.fn(async () => mockPresenceRow),
  getSnapshots: vi.fn(async (_service, args: { source: string }) =>
    args.source === "gsc"
      ? mockGscRows
      : args.source === "google_ads"
        ? mockPaidRows
        : mockGaRows,
  ),
}));

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
}));

vi.mock("@/lib/bsm/riverside-analytics-demo", () => ({
  getRiversideAnalyticsPreviewShop: vi.fn(async () => mockPreviewShop),
}));

vi.mock("@/lib/bsm/pilot-events", () => ({
  recordBsmPilotEvent: (...a: unknown[]) => recordBsmPilotEvent(...a),
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
  mockCounts = {
    all: 0,
    pending_review: 0,
    published: 0,
  };
  mockLatestAudit = null;
  mockLocalFalcon = null;
  mockPresenceRow = null;
  mockGscRows = [];
  mockGaRows = [];
  mockPaidRows = [];
  mockPreviewShop = null;
  recordBsmPilotEvent.mockReset();
});

describe("DashboardPage first-login trust state", () => {
  it("shows a useful setup state before empty activity metrics", async () => {
    const html = renderToStaticMarkup(await DashboardPage());

    expect(html).toContain("Welcome, owner.");
    expect(html).not.toContain("Welcome back");
    expect(html).toContain("Your first check has not run yet.");
    expect(html).toContain(
      "Run a quick, free shop check first. This does not connect Google, publish anything, or change your public listing.",
    );
    expect(html).toContain("Start free check");
    expect(html).toContain("Not started yet");
    expect(html).toContain("None waiting");
    expect(html).toContain("Nothing live yet");
    expect(html).toContain(
      "Drafts will appear after BSM has enough shop signals to create them.",
    );
    expect(html).toContain("Marketing visibility");
    expect(html).toContain("Local map visibility");
    expect(html).toContain("Waiting on first scan");
    expect(html).toContain("Local presence");
    expect(html).toContain("Waiting on profile data");
    expect(html).toContain("Search performance");
    expect(html).toContain("Waiting on search data");
    expect(html).toContain("Google Analytics");
    expect(html).toContain("Not connected yet");
    expect(html).toContain("Google Ads");
    expect(html).toContain("Open Google Ads connection");
    expect(html).toContain("Google Analytics");
    expect(html).toContain("Open Analytics connection");
    expect(html).toContain("Search Console");
    expect(html).toContain("Open Search Console connection");
    expect(html).toContain("Business Profile");
    expect(html).toContain("Open Business Profile connection");
    expect(html).toContain("View full analytics");
    expect(html.indexOf("Your first check has not run yet.")).toBeLessThan(
      html.indexOf("Content Items"),
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

  it("keeps showing real counts after activity exists", async () => {
    mockCounts = {
      all: 4,
      pending_review: 1,
      published: 2,
    };
    mockLatestAudit = { report: report() };
    mockLocalFalcon = {
      capturedAt: "2026-08-01T00:00:00.000Z",
      shareOfLocalVoice: 42.6,
    };
    mockPresenceRow = {
      metrics: {
        average_rating: 4.7,
        total_review_count: 128,
      },
    };
    mockGscRows = [
      {
        date: "2026-08-02",
        metrics: {
          clicks: 37,
          impressions: 1420,
        },
      },
    ];
    mockGaRows = [
      {
        date: "2026-08-02",
        metrics: {
          sessions: 214,
          total_users: 177,
        },
      },
    ];
    mockPaidRows = [
      {
        date: "2026-08-02",
        metrics: {
          spend: 1480,
          conversions: 37,
        },
      },
    ];

    const html = renderToStaticMarkup(await DashboardPage());

    expect(html).toContain("1 page needs attention.");
    expect(html).toContain(">4<");
    expect(html).toContain(">1<");
    expect(html).toContain(">2<");
    expect(html).toContain("42.6%");
    expect(html).toContain("Share of Local Voice from the Aug 1 map scan.");
    expect(html).toContain("4.7 rating");
    expect(html).toContain("128 Google reviews currently counted.");
    expect(html).toContain("37 clicks");
    expect(html).toContain("1,420 search impressions");
    expect(html).toContain("214 sessions");
    expect(html).toContain("177 website users");
    expect(html).toContain("$1,480 spend");
    expect(html).toContain("37 paid leads");
    expect(html).toContain("Website visits trend");
    expect(html).not.toContain("Not started yet");
  });

  it("shows gated Riverside private preview value without live account data", async () => {
    mockPreviewShop = { id: "riverside_shop", name: "Riverside Collision" };

    const html = renderToStaticMarkup(await DashboardPage());

    expect(html).toContain("Private preview note");
    expect(html).toContain("Riverside Collision numbers are seeded demo data");
    expect(html).toContain("41.8%");
    expect(html).toContain("4.7 rating");
    expect(html).toContain("58 clicks");
    expect(html).toContain("392 sessions");
    expect(html).toContain("$1,480 spend");
    expect(html).toContain("37 paid leads");
    expect(html).toContain("Website visits trend");
    expect(html).toContain("Private preview demo trend for Riverside Collision");
    expect(html).toContain("Open Google Ads connection");
    expect(html).toContain("Open Analytics connection");
    expect(html).toContain("Open Search Console connection");
    expect(html).toContain("Open Business Profile connection");
  });
});
