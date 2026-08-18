import { describe, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";

const contentItems = [
  {
    id: "article_1",
    title: "Riverside Collision July repair tips",
    content_type: "blog_post",
    status: "pending_review",
    updated_at: "2026-07-31T12:00:00.000Z",
  },
];

let lastContentShopId: string | null = null;

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
        return {
          select: vi.fn(() => ({
            eq: vi.fn((_column: string, value: string) => {
              lastContentShopId = value;
              return {
                order: vi.fn(async () => ({ data: contentItems })),
              };
            }),
          })),
        };
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

vi.mock("@/components/dashboard/content-table", () => ({
  ContentTable: ({
    items,
  }: {
    items: Array<{ title: string; status: string }>;
  }) => (
    <ul>
      {items.map((item) => (
        <li key={item.title}>
          {item.title} {item.status}
        </li>
      ))}
    </ul>
  ),
}));

const ContentPage = (await import("@/app/dashboard/content/page")).default;

describe("ContentPage Riverside preview fallback", () => {
  it("loads seeded Riverside content when the demo account has stale shop context", async () => {
    const html = renderToStaticMarkup(await ContentPage());

    expect(lastContentShopId).toBe("riverside_shop");
    expect(html).toContain("Riverside Collision July repair tips");
    expect(html).toContain("pending_review");
  });
});
