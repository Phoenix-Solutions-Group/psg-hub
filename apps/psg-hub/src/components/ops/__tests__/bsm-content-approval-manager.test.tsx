import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import {
  BSM_CONTENT_APPROVAL_FILE_ACCEPT,
  BSM_CONTENT_APPROVAL_UNSUPPORTED_FILE_MESSAGE,
  BsmContentApprovalManager,
  WorkspacePreviewProof,
  WorkspacePreviewScreen,
  getBsmContentApprovalsSelectionUrl,
  getBsmReviewWorkspaceStartBlocker,
  getBsmContentApprovalFileValidationError,
  getBsmContentApprovalStorageContentType,
  workspacePreviewDocumentKindLabel,
  workspacePreviewDocumentNeedsPreparation,
  type WorkspacePreviewDocument,
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
    expect(html).toContain(
      '<option value="shop-b" selected="">Wallace Auto Body</option>',
    );
    expect(html).not.toContain(">shop-a</option>");
    expect(html).not.toContain(">shop-b</option>");
  });

  it("keeps the selected shop and Review Workspace in the reloadable page URL", () => {
    expect(
      getBsmContentApprovalsSelectionUrl(
        "https://hub.test/ops/bsm-content-approvals?foo=bar#documents",
        { shopId: " shop-a ", workspaceId: " workspace-a " },
      ),
    ).toBe(
      "/ops/bsm-content-approvals?foo=bar&shopId=shop-a&workspaceId=workspace-a#documents",
    );

    expect(
      getBsmContentApprovalsSelectionUrl(
        "https://hub.test/ops/bsm-content-approvals?shopId=shop-a&workspaceId=workspace-a",
        { shopId: "shop-b", workspaceId: "" },
      ),
    ).toBe("/ops/bsm-content-approvals?shopId=shop-b");
  });

  it("does not prompt staff with an internal shop ID when shops are unavailable", () => {
    const html = renderToStaticMarkup(
      <BsmContentApprovalManager
        initialApprovals={[]}
        activeShopId={null}
        shops={[]}
      />,
    );

    expect(html).toContain('placeholder="Client shop"');
    expect(html).not.toContain("00000000-0000-0000-0000-000000000000");
  });

  it("allows admins to select every supported review document from the file picker", () => {
    expect(BSM_CONTENT_APPROVAL_FILE_ACCEPT).toContain(".pdf");
    expect(BSM_CONTENT_APPROVAL_FILE_ACCEPT).toContain(".png");
    expect(BSM_CONTENT_APPROVAL_FILE_ACCEPT).toContain(".md");
    expect(BSM_CONTENT_APPROVAL_FILE_ACCEPT).toContain(".txt");
    expect(BSM_CONTENT_APPROVAL_FILE_ACCEPT).toContain(".html");
    expect(BSM_CONTENT_APPROVAL_FILE_ACCEPT).toContain(".htm");
    expect(BSM_CONTENT_APPROVAL_FILE_ACCEPT).toContain(".doc");
    expect(BSM_CONTENT_APPROVAL_FILE_ACCEPT).toContain(".docx");
  });

  it("accepts image, Markdown, and text review files promised by the upload UI", () => {
    expect(
      getBsmContentApprovalFileValidationError(
        new File(["png"], "proof.png", { type: "image/png" }),
      ),
    ).toBeNull();
    expect(
      getBsmContentApprovalFileValidationError(
        new File(["# Proof"], "proof.md", { type: "text/markdown" }),
      ),
    ).toBeNull();
    expect(
      getBsmContentApprovalFileValidationError(
        new File(["Proof"], "proof.txt", { type: "text/plain" }),
      ),
    ).toBeNull();
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

  it("renders a review dashboard scoped to the selected shop", () => {
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

    expect(html).toContain("Review dashboard");
    expect(html).toContain("July proof review");
    expect(html).toContain("Open");
    expect(html).toContain("Share");
    expect(html).not.toContain("Wallace review");
  });

  it("puts the review delete action on the initial dashboard card for admins only", () => {
    const props = {
      initialApprovals: [],
      activeShopId: "shop-a",
      shops: [{ id: "shop-a", name: "Tracy's Collision" }],
      workspaces: [
        {
          id: "workspace-a",
          shopId: "shop-a",
          title: "July proof review",
          status: "active",
          currentRoundId: "round-a",
          documentCount: 1,
        },
      ],
    };

    const adminHtml = renderToStaticMarkup(
      <BsmContentApprovalManager {...props} canManageWorkspaces />,
    );
    const staffHtml = renderToStaticMarkup(
      <BsmContentApprovalManager {...props} />,
    );

    expect(adminHtml).toContain(">Delete</button>");
    expect(staffHtml).not.toContain(">Delete</button>");
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

    expect(html).toContain(
      '<h2 class="font-heading text-2xl font-semibold text-[#142838]">July proof review</h2>',
    );
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

    expect(html).toContain("Review settings");
    expect(html).toContain("Rename");
    expect(html).toContain("Remove review");
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

    expect(html).not.toContain("Review settings");
    expect(html).not.toContain("Remove review");
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

    expect(html).toContain(
      '<h2 class="font-heading text-2xl font-semibold text-[#142838]">Production upload retest</h2>',
    );
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

  it("renders the MarkUp-style primary review flow", () => {
    const html = renderToStaticMarkup(
      <BsmContentApprovalManager
        initialApprovals={[]}
        activeShopId="shop-a"
        shops={[{ id: "shop-a", name: "Tracy's Collision" }]}
        reviewerContacts={[{ email: "owner@example.com", name: "Shop Owner" }]}
      />,
    );

    expect(html).toContain("PSG Review Workspace");
    expect(html).toContain("Upload. Share. Resolve.");
    expect(html).toContain("New review");
    expect(html).toContain("Review name");
    expect(html).toContain("Continue to upload");
    expect(html).toContain("Upload files to start a review");
    expect(html).not.toContain("Customer profile ID");
    expect(html).not.toContain("Review Workspace for these documents");
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
    expect(html).toContain("1 file");
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
    ).toBe(
      "Start review is available after every document finishes processing successfully.",
    );
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

  it("renders the operator preview as selectable proof screens", () => {
    const documents: WorkspacePreviewDocument[] = [
      {
        itemId: "item-html",
        versionId: "version-html",
        versionNumber: 1,
        title: "Uploaded HTML proof",
        processingStatus: "ready",
        status: "draft",
        originalFilename: "homepage.html",
        contentType: "text/html",
        previewUrl: null,
        generatedPagePath: null,
        proofUrl: "https://storage.example/homepage.html",
        proofContent: null,
        wireframe: null,
        versionNote: null,
        markdownDiff: [],
      },
      {
        itemId: "item-page",
        versionId: "version-page",
        versionNumber: 1,
        title: "Generated page proof",
        processingStatus: "ready",
        status: "draft",
        originalFilename: null,
        contentType: "generated_page",
        previewUrl: "https://preview.example/generated-proof",
        generatedPagePath: "/generated/internal-only-proof",
        proofUrl: "/generated/internal-only-proof",
        proofContent: null,
        wireframe: null,
        versionNote: null,
        markdownDiff: [],
      },
    ];

    const html = renderToStaticMarkup(
      <WorkspacePreviewScreen
        documents={documents}
        selectedDocumentKey="item-page:version-page"
        onSelectDocument={() => undefined}
        onAddPinComment={async () => true}
        onSetThreadStatus={async () => true}
        immersive
        comments={[
          {
            id: "comment-1",
            invitationId: "invitation-1",
            reviewItemId: "item-page",
            versionId: "version-page",
            versionNumber: 1,
            roundId: "round-1",
            threadId: "thread-1",
            body: "Move this headline higher.",
            commentKind: "pin",
            pinNumber: 1,
            threadStatus: "open",
            draftStatus: "submitted",
            authorRole: "client",
            authorDisplayName: "Client reviewer",
            createdAt: "2026-08-21T12:00:00.000Z",
            viewport: null,
            xRatio: 0.25,
            yRatio: 0.5,
            selection: null,
          },
        ]}
        decisions={[]}
        reviewers={[
          {
            invitationId: "invitation-1",
            email: "reviewer@example.com",
            name: "Client reviewer",
            status: "reviewing",
            submittedAt: null,
            revokedAt: null,
          },
        ]}
      />,
    );

    expect(html).toContain("File 1");
    expect(html).toContain("File 2");
    expect(html).toContain("Uploaded HTML proof");
    expect(html).toContain("Generated page proof");
    expect(html).toContain("Review notes");
    expect(html).toContain('aria-label="Comment mode"');
    expect(html).toContain('aria-label="Place comment pin on document"');
    expect(html).toContain("Move this headline higher.");
    expect(html).toContain("Pin 1");
    expect(html).toContain("Resolved");
    expect(html).toContain("Declined");
    expect(html).toContain("Needs clarification");
    expect(html).toContain('src="https://preview.example/generated-proof"');
    expect(html).not.toContain("/generated/internal-only-proof");
    expect(workspacePreviewDocumentKindLabel(documents[0])).toBe(
      "Website proof",
    );
    expect(workspacePreviewDocumentKindLabel(documents[1])).toBe(
      "Generated page",
    );
    expect(workspacePreviewDocumentNeedsPreparation(documents[0])).toBe(false);
    expect(
      workspacePreviewDocumentNeedsPreparation({
        ...documents[0],
        proofUrl: null,
      }),
    ).toBe(true);

    const uploadedHtml = renderToStaticMarkup(
      <WorkspacePreviewProof document={documents[0]} />,
    );
    expect(uploadedHtml).toContain(
      'src="https://storage.example/homepage.html"',
    );
    expect(uploadedHtml).toContain('sandbox=""');
    expect(uploadedHtml).not.toContain("Open proof");
  });

  it("renders PDF and image proofs inline in the operator preview", () => {
    const pdfHtml = renderToStaticMarkup(
      <WorkspacePreviewProof
        document={{
          itemId: "item-pdf",
          versionId: "version-pdf",
          versionNumber: 1,
          title: "PDF proof",
          processingStatus: "ready",
          status: "draft",
          originalFilename: "proof.pdf",
          contentType: "application/pdf",
          previewUrl: null,
          generatedPagePath: null,
          proofUrl: "https://storage.example/proof.pdf",
          proofContent: null,
          wireframe: null,
          versionNote: null,
          markdownDiff: [],
        }}
      />,
    );
    const imageHtml = renderToStaticMarkup(
      <WorkspacePreviewProof
        document={{
          itemId: "item-image",
          versionId: "version-image",
          versionNumber: 1,
          title: "Image proof",
          processingStatus: "ready",
          status: "draft",
          originalFilename: "proof.jpg",
          contentType: "image/jpeg",
          previewUrl: null,
          generatedPagePath: null,
          proofUrl: "https://storage.example/proof.jpg",
          proofContent: null,
          wireframe: null,
          versionNote: null,
          markdownDiff: [],
        }}
      />,
    );

    expect(pdfHtml).toContain("<iframe");
    expect(pdfHtml).toContain('src="https://storage.example/proof.pdf"');
    expect(imageHtml).toContain("<img");
    expect(imageHtml).toContain('src="https://storage.example/proof.jpg"');
  });

  it("renders the immutable Content Wireframe contract in the operator preview", () => {
    const html = renderToStaticMarkup(
      <WorkspacePreviewProof
        document={{
          itemId: "item-wireframe",
          versionId: "version-wireframe",
          versionNumber: 2,
          title: "Homepage copy",
          processingStatus: "ready",
          status: "in_review",
          originalFilename: "content.md",
          contentType: "text/markdown",
          previewUrl: null,
          generatedPagePath: null,
          proofUrl: null,
          proofContent: null,
          wireframe: {
            contractVersion: 1,
            assetIds: [],
            blocks: [
              { id: "hero:1", kind: "hero", ordinal: 1, text: "Repairs without surprises" },
              { id: "cta:1", kind: "cta", ordinal: 1, text: "Request an estimate", href: "/estimate" },
            ],
          },
          versionNote: "Clarified the primary offer.",
          markdownDiff: [{ kind: "added", line: "Repairs without surprises" }],
        }}
      />,
    );

    expect(html).toContain("Content and structure review only");
    expect(html).toContain("Repairs without surprises");
    expect(html).toContain('href="/estimate"');
  });

  it("links Markdown documents to the scoped admin editor", () => {
    const html = renderToStaticMarkup(
      <BsmContentApprovalManager
        initialApprovals={[{
          id: "item-markdown",
          shopId: "shop-a",
          customerProfileId: null,
          title: "Homepage copy",
          status: "draft",
          processingStatus: "ready",
          contentType: "markdown",
          sourceKind: "uploaded_file",
          contextNote: null,
          updatedAt: "2026-08-21T20:00:00.000Z",
          currentVersion: {
            id: "version-markdown",
            originalFilename: "homepage.md",
            contentType: "text/markdown",
            byteSize: 512,
            storagePath: "shop-a/item-markdown/version-markdown/homepage.md",
            previewType: "file",
            sourceMetadata: {},
            createdAt: "2026-08-21T20:00:00.000Z",
          },
          latestDecision: null,
          replyAttachments: [],
          commentCount: 0,
          reviewWorkspace: { projectId: "project-a", projectTitle: "Website copy", roundId: null },
        }]}
        activeShopId="shop-a"
        activeWorkspaceProjectId="project-a"
        shops={[{ id: "shop-a", name: "Example Shop" }]}
        workspaces={[{
          id: "project-a",
          shopId: "shop-a",
          title: "Website copy",
          status: "draft",
          currentRoundId: null,
          documentCount: 1,
          role: "owner",
        }]}
      />,
    );

    expect(html).toContain("Edit Markdown");
    expect(html).toContain("Add collaborator");
    expect(html).toContain('/ops/bsm-content-approvals/project-a/documents/item-markdown/edit');
  });
});
