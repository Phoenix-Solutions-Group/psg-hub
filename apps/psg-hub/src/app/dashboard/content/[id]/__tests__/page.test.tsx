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
let mockReviewItem: Record<string, unknown> | null = null;
let mockReviewVersions: Array<Record<string, unknown>> = [];
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

      if (table === "shop_users") {
        return {
          select: vi.fn(() => ({
            eq: vi.fn(() => ({
              eq: vi.fn(() => ({
                maybeSingle: vi.fn(async () => ({
                  data: { role: "owner" },
                  error: null,
                })),
              })),
            })),
          })),
        };
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

      if (table === "bsm_content_review_items") {
        return {
          select: vi.fn(() => ({
            eq: vi.fn(() => ({
              maybeSingle: vi.fn(async () => ({
                data: mockReviewItem,
                error: null,
              })),
            })),
          })),
        };
      }

      if (table === "shop_users") {
        return {
          select: vi.fn(() => ({
            eq: vi.fn(() => ({
              eq: vi.fn(() => ({
                maybeSingle: vi.fn(async () => ({
                  data: { role: "owner" },
                  error: null,
                })),
              })),
            })),
          })),
        };
      }

      if (table === "bsm_content_review_versions") {
        return {
          select: vi.fn(() => ({
            eq: vi.fn(() => ({
              order: vi.fn(async () => ({
                data: mockReviewVersions,
                error: null,
              })),
            })),
          })),
        };
      }

      if (
        table === "bsm_content_review_comments" ||
        table === "bsm_content_review_decisions" ||
        table === "bsm_content_restore_requests"
      ) {
        const emptyOrderedQuery = {
          order: vi.fn(async () => ({ data: [], error: null })),
        };
        return {
          select: vi.fn(() => ({
            eq: vi.fn(() => ({
              is: vi.fn(() => emptyOrderedQuery),
              order: emptyOrderedQuery.order,
            })),
          })),
        };
      }

      if (table === "bsm_content_review_comment_attachments") {
        return {
          select: vi.fn(() => ({
            eq: vi.fn(async () => ({ data: [], error: null })),
          })),
        };
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
    mockReviewItem = null;
    mockReviewVersions = [];
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
    mockReviewItem = null;
    mockReviewVersions = [];
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
    mockUserEmail = "owner@riversidecollision.example";
    mockShops = [{ id: "stale_shop", name: "Old Demo Shop", role: "owner" }];
    mockActiveShopId = "stale_shop";
    mockServiceRiversideShop = {
      id: "riverside_shop",
      name: "Riverside Collision",
    };
    mockContentItem = null;
    mockReviewItem = null;
    mockReviewVersions = [];
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

  it("opens the private Riverside demo email item when the seed row is missing", async () => {
    mockUserEmail = "owner@riversidecollision.example";
    mockShops = [{ id: "stale_shop", name: "Old Demo Shop", role: "owner" }];
    mockActiveShopId = "stale_shop";
    mockServiceRiversideShop = {
      id: "riverside_shop",
      name: "Riverside Collision",
    };
    mockContentItem = null;
    mockReviewItem = null;
    mockReviewVersions = [];
    contentFilters = [];

    const html = renderToStaticMarkup(
      await ContentDetailPage({
        params: Promise.resolve({
          id: "22222222-cccc-4ccc-8ccc-222222222222",
        }),
      })
    );

    expect(contentFilters).toContainEqual([
      "id",
      "22222222-cccc-4ccc-8ccc-222222222222",
    ]);
    expect(contentFilters).toContainEqual(["shop_id", "riverside_shop"]);
    expect(html).toContain("Post-repair sensor check reminder");
    expect(html).toContain("pending review");
    expect(html).toContain("modern safety systems may need calibration");
  });

  it("opens a BSM review item through the customer content detail path", async () => {
    mockUserEmail = "customer@example.test";
    mockShops = [{ id: "riverside_shop", name: "Riverside Collision", role: "owner" }];
    mockActiveShopId = "riverside_shop";
    mockServiceRiversideShop = null;
    mockContentItem = null;
    mockReviewItem = {
      id: "review_1",
      shop_id: "riverside_shop",
      title: "Riverside Collision July repair tips",
      status: "in_review",
      content_type: "generated_page",
      admin_context_note: "Customer can review this article before it goes live.",
      current_version_id: "version_1",
      updated_at: "2026-08-11T16:00:00.000Z",
    };
    mockReviewVersions = [
      {
        id: "version_1",
        version_number: 1,
        original_filename: "riverside-repair-tips.md",
        content_type: "text/markdown",
        storage_path: null,
        preview_type: "file",
        source_metadata_jsonb: {
          body: "# Riverside Collision July repair tips\n\nReview-ready BSM body.",
        },
        created_at: "2026-08-11T16:00:00.000Z",
      },
    ];
    contentFilters = [];

    const html = renderToStaticMarkup(
      await ContentDetailPage({ params: Promise.resolve({ id: "review_1" }) })
    );

    expect(contentFilters).toEqual([]);
    expect(html).toContain("Riverside Collision July repair tips");
    expect(html).toContain("in review");
    expect(html).toContain("Review-ready BSM body.");
  });
});
