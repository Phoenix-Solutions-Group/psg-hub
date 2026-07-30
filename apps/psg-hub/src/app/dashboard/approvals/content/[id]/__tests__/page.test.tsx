import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";
import BsmContentApprovalReviewPage from "../page";

const getBsmCustomerReviewItem = vi.hoisted(() => vi.fn());

vi.mock("@/lib/supabase/server", () => ({
  createClient: () =>
    Promise.resolve({
      auth: {
        getUser: () => Promise.resolve({ data: { user: { id: "user-1" } } }),
      },
    }),
}));

vi.mock("@/lib/bsm/customer-content-review", async () => {
  const actual = await vi.importActual<typeof import("@/lib/bsm/customer-content-review")>(
    "@/lib/bsm/customer-content-review",
  );
  return {
    ...actual,
    getBsmCustomerReviewItem,
  };
});

vi.mock("@/components/dashboard/bsm-content-review-actions", () => ({
  BsmContentReviewActions: () => <div data-testid="review-actions" />,
}));

const baseItem = {
  id: "11111111-1111-4111-8111-111111111111",
  shopId: "22222222-2222-4222-8222-222222222222",
  title: "July proof",
  status: "in_review",
  contentType: "document",
  contextNote: "Please review this file.",
  currentVersionId: "33333333-3333-4333-8333-333333333333",
  updatedAt: "2026-07-30T12:00:00.000Z",
  comments: [],
  decisions: [],
  versions: [],
  restoreRequests: [],
};

function itemWithFile(input: {
  filename: string;
  contentType: string;
  previewType: string;
}) {
  return {
    ...baseItem,
    currentVersion: {
      id: baseItem.currentVersionId,
      versionNumber: 1,
      originalFilename: input.filename,
      contentType: input.contentType,
      storagePath: `${baseItem.shopId}/${baseItem.id}/${baseItem.currentVersionId}/${input.filename}`,
      previewType: input.previewType,
      sourceMetadata: {},
      createdAt: "2026-07-30T12:00:00.000Z",
    },
  };
}

async function renderPage() {
  const element = await BsmContentApprovalReviewPage({
    params: Promise.resolve({ id: baseItem.id }),
  });
  return renderToStaticMarkup(element);
}

describe("BsmContentApprovalReviewPage uploaded file rendering", () => {
  beforeEach(() => {
    getBsmCustomerReviewItem.mockReset();
  });

  it("renders PDFs inline with an open-in-new-tab fallback", async () => {
    getBsmCustomerReviewItem.mockResolvedValueOnce(
      itemWithFile({ filename: "homepage-proof.pdf", contentType: "application/pdf", previewType: "file" }),
    );

    const html = await renderPage();

    expect(html).toContain("Review content");
    expect(html).toContain("<iframe");
    expect(html).toContain(`/api/bsm/content-approvals/${baseItem.id}/file`);
    expect(html).toContain("Open file in a new tab");
  });

  it("renders image uploads as images", async () => {
    getBsmCustomerReviewItem.mockResolvedValueOnce(
      itemWithFile({ filename: "before-after.png", contentType: "image/png", previewType: "image" }),
    );

    const html = await renderPage();

    expect(html).toContain("<img");
    expect(html).toContain("before-after.png");
    expect(html).toContain("Open file in a new tab");
  });

  it("does not inline uploaded HTML or Word documents", async () => {
    for (const file of [
      { filename: "landing.html", contentType: "text/html", previewType: "file" },
      {
        filename: "mailer.docx",
        contentType: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
        previewType: "file",
      },
    ]) {
      getBsmCustomerReviewItem.mockResolvedValueOnce(itemWithFile(file));

      const html = await renderPage();

      expect(html).toContain("Open file");
      expect(html).not.toContain("<iframe");
      expect(html).not.toContain("<img");
      expect(html).not.toContain("Open file in a new tab");
    }
  });
});
