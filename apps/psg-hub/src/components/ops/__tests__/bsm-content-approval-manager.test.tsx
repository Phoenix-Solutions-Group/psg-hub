import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import {
  BSM_CONTENT_APPROVAL_FILE_ACCEPT,
  BSM_CONTENT_APPROVAL_UNSUPPORTED_FILE_MESSAGE,
  BsmContentApprovalManager,
  getBsmReviewWorkspaceStartBlocker,
  getBsmContentApprovalFileValidationError,
  getBsmContentApprovalStorageContentType,
} from "@/components/ops/bsm-content-approval-manager";

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

  it("allows admins to select PDF, Markdown, and HTML documents from the file picker", () => {
    const html = renderToStaticMarkup(
      <BsmContentApprovalManager initialApprovals={[]} activeShopId={null} shops={[]} />,
    );

    expect(html).toContain(`accept="${BSM_CONTENT_APPROVAL_FILE_ACCEPT}"`);
    expect(BSM_CONTENT_APPROVAL_FILE_ACCEPT).toContain(".pdf");
    expect(BSM_CONTENT_APPROVAL_FILE_ACCEPT).toContain(".md");
    expect(BSM_CONTENT_APPROVAL_FILE_ACCEPT).toContain(".markdown");
    expect(BSM_CONTENT_APPROVAL_FILE_ACCEPT).toContain(".html");
    expect(BSM_CONTENT_APPROVAL_FILE_ACCEPT).toContain(".htm");
  });

  it("returns the promised unsupported-file message for blocked uploads", () => {
    expect(
      getBsmContentApprovalFileValidationError(
        new File(["not a supported review document"], "installer.exe", {
          type: "application/x-msdownload",
        }),
      ),
    ).toBe(BSM_CONTENT_APPROVAL_UNSUPPORTED_FILE_MESSAGE);
  });

  it("uses storage-safe content types for HTML and Markdown uploads", () => {
    expect(
      getBsmContentApprovalStorageContentType(
        new File(["<html></html>"], "landing.html", {
          type: "text/html",
        }),
      ),
    ).toBe("text/plain");
    expect(
      getBsmContentApprovalStorageContentType(
        new File(["# Proof"], "proof.md", {
          type: "text/markdown",
        }),
      ),
    ).toBe("text/plain");
    expect(
      getBsmContentApprovalStorageContentType(
        new File(["%PDF"], "proof.pdf", {
          type: "application/pdf",
        }),
      ),
    ).toBe("application/pdf");
  });

  it("renders a required Review Workspace picker scoped to the selected shop", () => {
    const html = renderToStaticMarkup(
      <BsmContentApprovalManager
        initialApprovals={[]}
        activeShopId="shop-a"
        shops={[
          { id: "shop-a", name: "Tracy's Collision" },
          { id: "shop-b", name: "Wallace Auto Body" },
        ]}
        workspaces={[
          {
            id: "workspace-a",
            shopId: "shop-a",
            title: "July proof review",
            status: "active",
            currentRoundId: "round-a",
            documentCount: 2,
          },
          {
            id: "workspace-b",
            shopId: "shop-b",
            title: "Wallace review",
            status: "active",
            currentRoundId: "round-b",
            documentCount: 1,
          },
        ]}
      />,
    );

    expect(html).toContain("Review Workspace");
    expect(html).toContain("July proof review");
    expect(html).toContain("Choose a Review Workspace");
    expect(html).not.toContain("Wallace review");
  });

  it("preselects the linked Review Workspace from the Review Workspace upload entry point", () => {
    const html = renderToStaticMarkup(
      <BsmContentApprovalManager
        initialApprovals={[]}
        activeShopId="shop-a"
        activeWorkspaceProjectId="workspace-a"
        shops={[
          { id: "shop-a", name: "Tracy's Collision" },
          { id: "shop-b", name: "Wallace Auto Body" },
        ]}
        workspaces={[
          {
            id: "workspace-a",
            shopId: "shop-a",
            title: "July proof review",
            status: "active",
            currentRoundId: "round-a",
            documentCount: 2,
          },
        ]}
      />,
    );

    expect(html).toContain('<option value="workspace-a" selected="">July proof review');
  });

  it("keeps a requested workspace selectable when the shop only comes from the workspace", () => {
    const html = renderToStaticMarkup(
      <BsmContentApprovalManager
        initialApprovals={[]}
        activeShopId="workspace-shop"
        activeWorkspaceProjectId="workspace-a"
        shops={[{ id: "workspace-shop", name: "workspace-shop" }]}
        workspaces={[
          {
            id: "workspace-a",
            shopId: "workspace-shop",
            title: "Production upload retest",
            status: "active",
            currentRoundId: "round-a",
            documentCount: 0,
          },
        ]}
      />,
    );

    expect(html).toContain('<option value="workspace-a" selected="">Production upload retest');
    expect(html).not.toContain("No Review Workspaces for this shop");
  });

  it("renders an edit action for uploaded review items", () => {
    const html = renderToStaticMarkup(
      <BsmContentApprovalManager
        initialApprovals={[
          {
            id: "item-1",
            shopId: "shop-a",
            customerProfileId: null,
            title: "July proof",
            status: "in_review",
            processingStatus: "ready",
            contentType: "pdf",
            sourceKind: "uploaded_file",
            contextNote: "Confirm the offer.",
            updatedAt: "2026-07-29T20:00:00.000Z",
            currentVersion: {
              id: "version-1",
              originalFilename: "proof.pdf",
              contentType: "application/pdf",
              byteSize: 2048,
              storagePath: "shop-a/item-1/version-1/proof.pdf",
              previewType: "file",
              sourceMetadata: {},
              createdAt: "2026-07-29T20:00:00.000Z",
            },
            latestDecision: null,
            replyAttachments: [],
            commentCount: 0,
            reviewWorkspace: {
              projectId: "workspace-a",
              projectTitle: "July proof review",
              roundId: "round-a",
            },
          },
        ]}
        activeShopId="shop-a"
        shops={[{ id: "shop-a", name: "Tracy's Collision" }]}
      />,
    );

    expect(html).toContain("July proof review");
    expect(html).toContain("Edit");
  });

  it("renders workspace-first controls for creating a workspace, adding reviewers, previewing, and starting review", () => {
    const html = renderToStaticMarkup(
      <BsmContentApprovalManager
        initialApprovals={[]}
        activeShopId="shop-a"
        shops={[{ id: "shop-a", name: "Tracy's Collision" }]}
        reviewerContacts={[{ email: "owner@example.com", name: "Shop Owner" }]}
      />,
    );

    expect(html).toContain("Workspace title");
    expect(html).toContain("Reviewer instructions");
    expect(html).toContain("Shop Owner · owner@example.com");
    expect(html).toContain("Preview read-only");
    expect(html).toContain("Start review");
  });

  it("blocks review start until documents are ready and a reviewer is selected", () => {
    expect(
      getBsmReviewWorkspaceStartBlocker({
        workspaceId: "",
        documents: [],
        reviewers: [],
      }),
    ).toBe("Create or select a Review Workspace first.");
    expect(
      getBsmReviewWorkspaceStartBlocker({
        workspaceId: "workspace-a",
        documents: [],
        reviewers: [{ email: "owner@example.com" }],
      }),
    ).toBe("Add at least one document before starting review.");
    expect(
      getBsmReviewWorkspaceStartBlocker({
        workspaceId: "workspace-a",
        documents: [{ processingStatus: "pending" }],
        reviewers: [{ email: "owner@example.com" }],
      }),
    ).toBe("Start review is available after every document finishes processing successfully.");
    expect(
      getBsmReviewWorkspaceStartBlocker({
        workspaceId: "workspace-a",
        documents: [{ processingStatus: "ready" }],
        reviewers: [],
      }),
    ).toBe("Choose at least one reviewer before starting review.");
    expect(
      getBsmReviewWorkspaceStartBlocker({
        workspaceId: "workspace-a",
        documents: [{ processingStatus: "ready" }],
        reviewers: [{ email: "owner@example.com" }],
      }),
    ).toBeNull();
  });
});
