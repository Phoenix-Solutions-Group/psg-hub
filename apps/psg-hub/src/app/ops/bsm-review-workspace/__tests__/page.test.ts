import { describe, expect, it, vi } from "vitest";
import { normalizeCompanyShops } from "@/app/ops/bsm-review-workspace/page";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { ReviewWorkspaceConsole } from "@/app/ops/bsm-review-workspace/review-workspace-console";

const { redirect } = vi.hoisted(() => ({
  redirect: vi.fn((url: string) => {
    throw new Error(`REDIRECT:${url}`);
  }),
}));

vi.mock("next/navigation", () => ({ redirect }));

const BsmReviewWorkspacePage = (await import("@/app/ops/bsm-review-workspace/page")).default;

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

describe("BsmReviewWorkspacePage", () => {
  it("redirects the old Review Workspace admin route into Content Approvals", async () => {
    await expect(BsmReviewWorkspacePage()).rejects.toThrow("REDIRECT:/ops/bsm-content-approvals");
    expect(redirect).toHaveBeenCalledWith("/ops/bsm-content-approvals");
  });
});

describe("ReviewWorkspaceConsole upload entry", () => {
  it("links staff to the consolidated document form with the selected shop context", () => {
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

  it("renders existing workspaces with the superadmin remove action", () => {
    const html = renderToStaticMarkup(
      createElement(ReviewWorkspaceConsole, {
        shops: [{ id: "shop-a", name: "Alpha Auto Body" }],
        defaultShopId: "shop-a",
        canRemoveWorkspaces: true,
        initialWorkspaces: [{
          id: "workspace-a",
          shopId: "shop-a",
          shopName: "Alpha Auto Body",
          title: "July homepage proof",
          status: "active",
          currentRoundId: "round-a",
          updatedAt: "2026-07-28T19:00:00.000Z",
          createdAt: "2026-07-28T18:00:00.000Z",
          role: "superadmin",
        }],
      }),
    );

    expect(html).toContain("Existing workspaces");
    expect(html).toContain("July homepage proof");
    expect(html).toContain("Open workspace");
    expect(html).toContain("Remove workspace");
  });

  it("hides the remove action for non-superadmin ops users", () => {
    const html = renderToStaticMarkup(
      createElement(ReviewWorkspaceConsole, {
        shops: [{ id: "shop-a", name: "Alpha Auto Body" }],
        defaultShopId: "shop-a",
        canRemoveWorkspaces: false,
        initialWorkspaces: [{
          id: "workspace-a",
          shopId: "shop-a",
          shopName: "Alpha Auto Body",
          title: "July homepage proof",
          status: "active",
          currentRoundId: "round-a",
          updatedAt: "2026-07-28T19:00:00.000Z",
          createdAt: "2026-07-28T18:00:00.000Z",
          role: "collaborator",
        }],
      }),
    );

    expect(html).toContain("July homepage proof");
    expect(html).toContain("Open workspace");
    expect(html).not.toContain("Remove workspace");
  });
});
