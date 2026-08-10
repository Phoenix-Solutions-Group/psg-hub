import { describe, expect, it } from "vitest";
import { normalizeCompanyShops } from "@/app/ops/bsm-review-workspace/page";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { ReviewWorkspaceConsole } from "@/app/ops/bsm-review-workspace/review-workspace-console";

describe("normalizeCompanyShops", () => {
  it("returns one sorted shop option per shop id", () => {
    expect(
      normalizeCompanyShops([
        { shop_id: "shop-b", name: "Beta Collision" },
        { shop_id: "shop-a", name: "Alpha Auto Body" },
        { shop_id: "shop-b", name: "Beta Collision duplicate company" },
        { shop_id: "shop-c", name: "" },
        { shop_id: null, name: "Missing shop" },
      ]),
    ).toEqual([
      { id: "shop-a", name: "Alpha Auto Body" },
      { id: "shop-b", name: "Beta Collision" },
      { id: "shop-c", name: "shop-c" },
    ]);
  });
});

describe("ReviewWorkspaceConsole upload entry", () => {
  it("links staff to the upload form with the selected shop context", () => {
    const html = renderToStaticMarkup(
      createElement(ReviewWorkspaceConsole, {
        shops: [
          { id: "shop-a", name: "Alpha Auto Body" },
          { id: "shop-b", name: "Beta Collision" },
        ],
        defaultShopId: "shop-b",
      }),
    );

    expect(html).toContain("Add document");
    expect(html).toContain("/ops/bsm-content-approvals?shopId=shop-b");
  });
});
