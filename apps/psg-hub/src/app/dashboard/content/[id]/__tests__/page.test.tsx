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
          user: { id: "user_1", email: "nick@phoenixsolutionsgroup.net" },
        },
      }),
    },
    from: vi.fn(() => {
      throw new Error("customer reader should not be used for preview fallback");
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
                data: {
                  id: "riverside_shop",
                  name: "Riverside Collision",
                },
              })),
            })),
          })),
        };
      }

      if (table === "content_items") {
        const query = {
          select: vi.fn(() => query),
          eq: vi.fn((column: string, value: string) => {
            contentFilters.push([column, value]);
            return query;
          }),
          single: vi.fn(async () => ({ data: contentItem })),
        };
        return query;
      }

      throw new Error(`unexpected table:${table}`);
    }),
  })),
}));

vi.mock("@/lib/shop/context", () => ({
  getActiveShopContext: vi.fn(async () => ({
    shops: [{ id: "stale_shop", name: "Old Demo Shop", role: "owner" }],
    activeShopId: "stale_shop",
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
});
