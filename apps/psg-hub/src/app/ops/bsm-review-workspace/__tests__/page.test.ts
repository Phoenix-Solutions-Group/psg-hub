import { describe, expect, it } from "vitest";
import { normalizeCompanyShops } from "@/app/ops/bsm-review-workspace/page";

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
