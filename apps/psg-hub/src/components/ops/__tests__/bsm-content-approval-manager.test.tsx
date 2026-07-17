import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { BsmContentApprovalManager } from "@/components/ops/bsm-content-approval-manager";

describe("BsmContentApprovalManager", () => {
  it("preselects the active shop and renders readable shop names", () => {
    const html = renderToStaticMarkup(
      <BsmContentApprovalManager
        initialApprovals={[]}
        activeShopId="shop-b"
        shops={[
          { id: "shop-a", name: "Tracy's Collision" },
          { id: "shop-b", name: "Wallace Auto Body" },
        ]}
      />,
    );

    expect(html).toContain("Tracy&#x27;s Collision");
    expect(html).toContain("Wallace Auto Body");
    expect(html).toContain('<option value="shop-b" selected="">Wallace Auto Body</option>');
    expect(html).not.toContain(">shop-a</option>");
    expect(html).not.toContain(">shop-b</option>");
  });

  it("does not prompt staff with an internal shop ID when shops are unavailable", () => {
    const html = renderToStaticMarkup(
      <BsmContentApprovalManager initialApprovals={[]} activeShopId={null} shops={[]} />,
    );

    expect(html).toContain('placeholder="No shops available"');
    expect(html).not.toContain("00000000-0000-0000-0000-000000000000");
  });
});
