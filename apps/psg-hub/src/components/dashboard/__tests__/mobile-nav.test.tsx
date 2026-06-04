import { describe, it, expect, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { MobileNav, MobileNavPanel } from "@/components/dashboard/mobile-nav";

// ShopSwitcher uses client hooks (useRouter) that can't render in the node test
// env — stub it with a sentinel so we can assert the panel includes/excludes it.
vi.mock("@/components/dashboard/shop-switcher", () => ({
  ShopSwitcher: () => "[[SWITCHER]]",
}));

const NAV = [
  { href: "/dashboard", label: "Dashboard" },
  { href: "/dashboard/reviews", label: "Reviews" },
];

describe("MobileNavPanel render branches", () => {
  it("renders the same NAV links", () => {
    const html = renderToStaticMarkup(
      <MobileNavPanel nav={NAV} shops={[]} activeShopId={null} />
    );
    expect(html).toContain("Dashboard");
    expect(html).toContain("Reviews");
    expect(html).toContain('href="/dashboard/reviews"');
  });

  it("0 shops: no switcher", () => {
    const html = renderToStaticMarkup(
      <MobileNavPanel nav={NAV} shops={[]} activeShopId={null} />
    );
    expect(html).not.toContain("[[SWITCHER]]");
  });

  it(">=1 shop: switcher present", () => {
    const html = renderToStaticMarkup(
      <MobileNavPanel
        nav={NAV}
        shops={[
          { id: "s1", name: "Shop A", role: "owner" },
          { id: "s2", name: "Shop B", role: "viewer" },
        ]}
        activeShopId="s1"
      />
    );
    expect(html).toContain("[[SWITCHER]]");
  });
});

describe("MobileNav disclosure (closed initial state)", () => {
  it("renders the hamburger toggle and keeps the panel collapsed", () => {
    const html = renderToStaticMarkup(
      <MobileNav nav={NAV} shops={[]} activeShopId={null} />
    );
    // Toggle button is present...
    expect(html).toContain('aria-label="Open navigation menu"');
    expect(html).toContain('aria-expanded="false"');
    // ...and the panel (NAV links / switcher) is not rendered until opened.
    expect(html).not.toContain('href="/dashboard/reviews"');
    expect(html).not.toContain("[[SWITCHER]]");
  });
});
