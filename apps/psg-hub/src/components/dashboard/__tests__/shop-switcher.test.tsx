import { describe, it, expect, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import {
  ShopSwitcher,
  filterShops,
  TYPEAHEAD_THRESHOLD,
} from "@/components/dashboard/shop-switcher";

// useRouter needs the app-router context — stub it for node static renders
// (same approach as mobile-nav.test.tsx; env=node, no jsdom).
vi.mock("next/navigation", () => ({
  useRouter: () => ({ refresh: vi.fn() }),
}));

const shop = (i: number) => ({ id: `s${i}`, name: `Shop ${i}` });
const shops = (n: number) => Array.from({ length: n }, (_, i) => shop(i + 1));

describe("filterShops (pure)", () => {
  const list = [
    { id: "a", name: "Tracy's Body Shop" },
    { id: "b", name: "Wallace Collision" },
    { id: "c", name: "Tedesco Auto Body" },
  ];

  it("case-insensitive substring match on name", () => {
    expect(filterShops(list, "tracy")).toEqual([list[0]]);
    expect(filterShops(list, "BODY")).toEqual([list[0], list[2]]);
  });

  it("empty / whitespace query returns all", () => {
    expect(filterShops(list, "")).toEqual(list);
    expect(filterShops(list, "   ")).toEqual(list);
  });

  it("no match returns []", () => {
    expect(filterShops(list, "zzz")).toEqual([]);
  });

  it("falls back to id when name is empty", () => {
    expect(filterShops([{ id: "abc-1", name: "" }], "abc")).toEqual([
      { id: "abc-1", name: "" },
    ]);
  });
});

describe("ShopSwitcher render branches", () => {
  it("0 shops: renders nothing", () => {
    const html = renderToStaticMarkup(
      <ShopSwitcher shops={[]} activeShopId={null} />
    );
    expect(html).toBe("");
  });

  it("1 shop: static label, no control", () => {
    const html = renderToStaticMarkup(
      <ShopSwitcher shops={[shop(1)]} activeShopId="s1" />
    );
    expect(html).toContain("Shop 1");
    expect(html).not.toContain("<select");
    expect(html).not.toContain("<input");
  });

  it("2 shops (< threshold): the plain select, NO search input (e2e contract)", () => {
    const html = renderToStaticMarkup(
      <ShopSwitcher shops={shops(2)} activeShopId="s1" />
    );
    expect(html).toContain('aria-label="Active shop"');
    expect(html).toContain("<select");
    expect(html).not.toContain('aria-label="Search shops"');
    expect((html.match(/<option/g) ?? []).length).toBe(2);
  });

  it("7 shops (threshold-1): still the plain select", () => {
    const html = renderToStaticMarkup(
      <ShopSwitcher shops={shops(TYPEAHEAD_THRESHOLD - 1)} activeShopId="s1" />
    );
    expect(html).not.toContain('aria-label="Search shops"');
  });

  it("8 shops (>= threshold): search input + live count + select with all options", () => {
    const html = renderToStaticMarkup(
      <ShopSwitcher shops={shops(TYPEAHEAD_THRESHOLD)} activeShopId="s1" />
    );
    expect(html).toContain('aria-label="Search shops"');
    expect(html).toContain('aria-live="polite"');
    expect(html).toContain(`${TYPEAHEAD_THRESHOLD} of ${TYPEAHEAD_THRESHOLD} shops`);
    expect((html.match(/<option/g) ?? []).length).toBe(TYPEAHEAD_THRESHOLD);
  });
});
