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
let mockContentItems = contentItems;
let mockUserEmail = "nick@phoenixsolutionsgroup.net";
let mockShops = [{ id: "stale_shop", name: "Old Demo Shop", role: "owner" }];
let mockActiveShopId = "stale_shop";
let mockServiceRiversideShop: { id: string; name: string } | null = {
  id: "riverside_shop",
  name: "Riverside Collision",
};

function contentItemsQuery() {
  return {
    select: vi.fn(() => ({
      eq: vi.fn((_column: string, value: string) => {
        lastContentShopId = value;
        return {
          order: vi.fn(async () => ({ data: mockContentItems })),
        };
      }),
    })),
  };
}

vi.mock("next/headers", () => ({
  headers: vi.fn(async () => ({
    get: (name: string) => (name === "host" ? "hub.psgweb.me" : null),
  })),
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
        return contentItemsQuery();
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
        return contentItemsQuery();
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
    mockUserEmail = "nick@phoenixsolutionsgroup.net";
    mockShops = [{ id: "stale_shop", name: "Old Demo Shop", role: "owner" }];
    mockActiveShopId = "stale_shop";
    mockServiceRiversideShop = {
      id: "riverside_shop",
      name: "Riverside Collision",
    };
    mockContentItems = contentItems;
    lastContentShopId = null;

    const html = renderToStaticMarkup(await ContentPage());

    expect(lastContentShopId).toBe("riverside_shop");
    expect(html).toContain("Riverside Collision July repair tips");
    expect(html).toContain("pending_review");
  });

  it("uses the Riverside membership when the demo active-shop cookie is stale", async () => {
    mockUserEmail = "customer@example.test";
    mockShops = [
      { id: "stale_shop", name: "Old Demo Shop", role: "owner" },
      { id: "riverside_shop", name: "Riverside Collision", role: "owner" },
    ];
    mockActiveShopId = "stale_shop";
    mockServiceRiversideShop = null;
    mockContentItems = contentItems;
    lastContentShopId = null;

    const html = renderToStaticMarkup(await ContentPage());

    expect(lastContentShopId).toBe("riverside_shop");
    expect(html).toContain("Riverside Collision July repair tips");
    expect(html).toContain("pending_review");
  });

  it("shows the private Riverside demo article to the demo shop customer when the seed row is missing", async () => {
    mockUserEmail = "owner@riversidecollision.example";
    mockShops = [{ id: "stale_shop", name: "Old Demo Shop", role: "owner" }];
    mockActiveShopId = "stale_shop";
    mockServiceRiversideShop = {
      id: "riverside_shop",
      name: "Riverside Collision",
    };
    mockContentItems = [];
    lastContentShopId = null;

    const html = renderToStaticMarkup(await ContentPage());

    expect(lastContentShopId).toBe("riverside_shop");
    expect(html).toContain("Riverside Collision July repair tips");
    expect(html).toContain("pending_review");
    expect(html).not.toContain("No content yet");
  });
});
