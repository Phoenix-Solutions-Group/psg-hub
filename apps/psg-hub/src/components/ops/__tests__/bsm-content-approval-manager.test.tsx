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

  it("renders super-admin edit and remove controls for the selected Review Workspace", () => {
    const html = renderToStaticMarkup(
      <BsmContentApprovalManager
        initialApprovals={[]}
        activeShopId="shop-a"
        activeWorkspaceProjectId="workspace-a"
        canManageWorkspaces
        shops={[{ id: "shop-a", name: "Tracy's Collision" }]}
        workspaces={[
          {
            id: "workspace-a",
            shopId: "shop-a",
            title: "July proof review",
            status: "draft",
            currentRoundId: null,
            documentCount: 0,
          },
        ]}
      />,
    );

    expect(html).toContain("Super-admin workspace controls");
    expect(html).toContain("Edit workspace");
    expect(html).toContain("Remove workspace");
  });

  it("hides workspace edit and remove controls from non-superadmin staff", () => {
    const html = renderToStaticMarkup(
      <BsmContentApprovalManager
        initialApprovals={[]}
        activeShopId="shop-a"
        activeWorkspaceProjectId="workspace-a"
        shops={[{ id: "shop-a", name: "Tracy's Collision" }]}
        workspaces={[
          {
            id: "workspace-a",
            shopId: "shop-a",
            title: "July proof review",
            status: "draft",
            currentRoundId: null,
            documentCount: 0,
          },
        ]}
      />,
    );

    expect(html).not.toContain("Super-admin workspace controls");
    expect(html).not.toContain("Edit workspace");
    expect(html).not.toContain("Remove workspace");
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
        activeWorkspaceProjectId="workspace-a"
        shops={[{ id: "shop-a", name: "Tracy's Collision" }]}
        workspaces={[
          {
            id: "workspace-a",
            shopId: "shop-a",
            title: "July proof review",
            status: "active",
            currentRoundId: "round-a",
            documentCount: 1,
          },
        ]}
      />,
    );

    expect(html).toContain("July proof review");
    expect(html).toContain("Edit");
  });

  it("renders the board-requested order: workspace, documents, reviewers, then preview/start", () => {
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
    expect(html).toContain("Review Workspace for these documents");
    expect(html).toContain("Workspace documents");
    expect(html).toContain("Shop Owner · owner@example.com");
    expect(html).toContain("Preview read-only");
    expect(html).toContain("Start review");

    const workspaceIndex = html.indexOf(">Workspace<");
    const documentsIndex = html.indexOf(">Documents<");
    const documentWorkspacePickerIndex = html.indexOf("Review Workspace for these documents");
    const workspaceDocumentsIndex = html.indexOf(">Workspace documents<");
    const reviewersIndex = html.indexOf(">Reviewers<");
    const previewIndex = html.indexOf(">Preview or start review<");

    expect(workspaceIndex).toBeGreaterThanOrEqual(0);
    expect(documentsIndex).toBeGreaterThan(workspaceIndex);
    expect(documentWorkspacePickerIndex).toBeGreaterThan(documentsIndex);
    expect(workspaceDocumentsIndex).toBeGreaterThan(documentsIndex);
    expect(workspaceDocumentsIndex).toBeLessThan(reviewersIndex);
    expect(reviewersIndex).toBeGreaterThan(documentsIndex);
    expect(previewIndex).toBeGreaterThan(reviewersIndex);
  });

  it("shows only the selected Review Workspace documents in the workspace document section", () => {
    const html = renderToStaticMarkup(
      <BsmContentApprovalManager
        initialApprovals={[
          {
            id: "item-a",
            shopId: "shop-a",
            customerProfileId: null,
            title: "Selected workspace proof",
            status: "draft",
            processingStatus: "ready",
            contentType: "pdf",
            sourceKind: "uploaded_file",
            contextNote: "Confirm this selected proof.",
            updatedAt: "2026-07-29T20:00:00.000Z",
            currentVersion: {
              id: "version-a",
              originalFilename: "selected.pdf",
              contentType: "application/pdf",
              byteSize: 2048,
              storagePath: "shop-a/item-a/version-a/selected.pdf",
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
              roundId: null,
            },
          },
          {
            id: "item-b",
            shopId: "shop-a",
            customerProfileId: null,
            title: "Other workspace proof",
            status: "draft",
            processingStatus: "ready",
            contentType: "pdf",
            sourceKind: "uploaded_file",
            contextNote: "Do not show in the selected workspace.",
            updatedAt: "2026-07-29T20:00:00.000Z",
            currentVersion: null,
            latestDecision: null,
            replyAttachments: [],
            commentCount: 0,
            reviewWorkspace: {
              projectId: "workspace-b",
              projectTitle: "August proof review",
              roundId: null,
            },
          },
          {
            id: "item-c",
            shopId: "shop-a",
            customerProfileId: null,
            title: "Unassigned library proof",
            status: "draft",
            processingStatus: "ready",
            contentType: "pdf",
            sourceKind: "uploaded_file",
            contextNote: "Do not show in workspace documents.",
            updatedAt: "2026-07-29T20:00:00.000Z",
            currentVersion: null,
            latestDecision: null,
            replyAttachments: [],
            commentCount: 0,
            reviewWorkspace: null,
          },
        ]}
        activeShopId="shop-a"
        activeWorkspaceProjectId="workspace-a"
        shops={[{ id: "shop-a", name: "Tracy's Collision" }]}
        workspaces={[
          {
            id: "workspace-a",
            shopId: "shop-a",
            title: "July proof review",
            status: "draft",
            currentRoundId: null,
            documentCount: 1,
          },
          {
            id: "workspace-b",
            shopId: "shop-a",
            title: "August proof review",
            status: "draft",
            currentRoundId: null,
            documentCount: 1,
          },
        ]}
      />,
    );

    expect(html).toContain("Selected workspace proof");
    expect(html).not.toContain("Other workspace proof");
    expect(html).not.toContain("Unassigned library proof");
    expect(html).toContain("1 review item");
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
