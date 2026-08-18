import { describe, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";

const contentItem = {
  id: "article_1",
  shop_id: "riverside_shop",
  title: "Riverside Collision July repair tips",
  content_type: "blog_post",
  status: "pending_review",
  updated_at: "2026-07-31T12:00:00.000Z",
  body: "# Riverside Collision July repair tips\n\nReview-ready body.",
};

let contentFilters: Array<[string, string]> = [];
let mockContentItem: typeof contentItem | null = contentItem;
let mockUserEmail = "nick@phoenixsolutionsgroup.net";
let mockShops = [{ id: "stale_shop", name: "Old Demo Shop", role: "owner" }];
let mockActiveShopId = "stale_shop";
let mockServiceRiversideShop: { id: string; name: string } | null = {
  id: "riverside_shop",
  name: "Riverside Collision",
};

function contentItemQuery() {
  const query = {
    select: vi.fn(() => query),
    eq: vi.fn((column: string, value: string) => {
      contentFilters.push([column, value]);
      return query;
    }),
    single: vi.fn(async () => ({ data: mockContentItem })),
  };
  return query;
}

vi.mock("next/headers", () => ({
  headers: vi.fn(async () => ({
    get: (name: string) => (name === "host" ? "hub.psgweb.me" : null),
  })),
}));

vi.mock("next/navigation", () => ({
  notFound: vi.fn(() => {
    throw new Error("not found");
  }),
}));

vi.mock("@/lib/supabase/server", () => ({
  createClient: vi.fn(async () => ({
    auth: {
      getUser: vi.fn().mockResolvedValue({
        data: {
          user: { id: "user_1", email: mockUserEmail },
        },
      }),
    },
    from: vi.fn((table: string) => {
      if (table === "content_items") {
        return contentItemQuery();
      }

      throw new Error(`unexpected customer table:${table}`);
    }),
  })),
}));

vi.mock("@/lib/supabase/service", () => ({
  createServiceClient: vi.fn(() => ({
    from: vi.fn((table: string) => {
      if (table === "shops") {
        return {
          select: vi.fn(() => ({
            eq: vi.fn(() => ({
              maybeSingle: vi.fn(async () => ({
                data: mockServiceRiversideShop,
              })),
            })),
          })),
        };
      }

      if (table === "content_items") {
        return contentItemQuery();
      }

      throw new Error(`unexpected table:${table}`);
    }),
  })),
}));

vi.mock("@/lib/shop/context", () => ({
  getActiveShopContext: vi.fn(async () => ({
    shops: mockShops,
    activeShopId: mockActiveShopId,
  })),
}));

vi.mock("@/components/dashboard/content-preview", () => ({
  ContentPreview: ({ body }: { body: string }) => <article>{body}</article>,
}));

vi.mock("@/components/dashboard/approval-actions", () => ({
  ApprovalActions: ({ contentId }: { contentId: string }) => (
    <div>approval actions for {contentId}</div>
  ),
}));

const ContentDetailPage = (await import("@/app/dashboard/content/[id]/page"))
  .default;

describe("ContentDetailPage Riverside demo fallback", () => {
  it("opens seeded Riverside content through the demo host with shop-scoped lookup", async () => {
    mockUserEmail = "nick@phoenixsolutionsgroup.net";
    mockShops = [{ id: "stale_shop", name: "Old Demo Shop", role: "owner" }];
    mockActiveShopId = "stale_shop";
    mockServiceRiversideShop = {
      id: "riverside_shop",
      name: "Riverside Collision",
    };
    mockContentItem = contentItem;
    contentFilters = [];

    const html = renderToStaticMarkup(
      await ContentDetailPage({ params: Promise.resolve({ id: "article_1" }) })
    );

    expect(contentFilters).toContainEqual(["id", "article_1"]);
    expect(contentFilters).toContainEqual(["shop_id", "riverside_shop"]);
    expect(html).toContain("Riverside Collision July repair tips");
    expect(html).toContain("pending review");
    expect(html).toContain("Review-ready body.");
    expect(html).toContain("approval actions for article_1");
  });

  it("opens Riverside member content when the active-shop cookie points elsewhere", async () => {
    mockUserEmail = "customer@example.test";
    mockShops = [
      { id: "stale_shop", name: "Old Demo Shop", role: "owner" },
      { id: "riverside_shop", name: "Riverside Collision", role: "owner" },
    ];
    mockActiveShopId = "stale_shop";
    mockServiceRiversideShop = null;
    mockContentItem = contentItem;
    contentFilters = [];

    const html = renderToStaticMarkup(
      await ContentDetailPage({ params: Promise.resolve({ id: "article_1" }) })
    );

    expect(contentFilters).toContainEqual(["id", "article_1"]);
    expect(contentFilters).toContainEqual(["shop_id", "riverside_shop"]);
    expect(html).toContain("Riverside Collision July repair tips");
    expect(html).toContain("pending review");
  });

  it("opens the private Riverside demo article for the demo shop customer when the seed row is missing", async () => {
    mockUserEmail = "owner@e2e.test";
    mockShops = [{ id: "stale_shop", name: "Old Demo Shop", role: "owner" }];
    mockActiveShopId = "stale_shop";
    mockServiceRiversideShop = {
      id: "riverside_shop",
      name: "Riverside Collision",
    };
    mockContentItem = null;
    contentFilters = [];

    const html = renderToStaticMarkup(
      await ContentDetailPage({
        params: Promise.resolve({
          id: "11111111-cccc-4ccc-8ccc-111111111111",
        }),
      })
    );

    expect(contentFilters).toContainEqual([
      "id",
      "11111111-cccc-4ccc-8ccc-111111111111",
    ]);
    expect(contentFilters).toContainEqual(["shop_id", "riverside_shop"]);
    expect(html).toContain("Riverside Collision July repair tips");
    expect(html).toContain("pending review");
    expect(html).toContain("PSG prepared this customer-facing article");
  });
});
