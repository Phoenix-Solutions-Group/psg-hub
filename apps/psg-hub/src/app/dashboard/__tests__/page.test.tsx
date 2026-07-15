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

    const html = renderToStaticMarkup(await DashboardPage());

    expect(html).toContain("1 page needs attention.");
    expect(html).toContain(">4<");
    expect(html).toContain(">1<");
    expect(html).toContain(">2<");
    expect(html).not.toContain("Not started yet");
  });
});
