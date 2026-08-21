import { describe, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { ApprovalCard, type ApprovalCardRow } from "@/components/dashboard/approval-card";

vi.mock("next/navigation", () => ({
  useRouter: () => ({ refresh: vi.fn() }),
}));

const pendingRow: ApprovalCardRow = {
  id: "apr-1",
  actionType: "gbp_post",
  title: "Spring estimate offer",
  summary: "Free estimates this week.",
  payload: { summary: "Free estimates this week." },
  status: "pending",
  proposedBy: "BSM assistant",
  createdAt: "2026-07-08T12:00:00.000Z",
  publishError: null,
};

describe("ApprovalCard publish guardrail", () => {
  it("starts on the exact preview before showing the publish button", () => {
    const html = renderToStaticMarkup(<ApprovalCard row={pendingRow} />);

    expect(html).toContain("Post preview");
    expect(html).toContain("Continue to confirmation");
    expect(html).toContain("Reject request");
    expect(html).not.toContain("Approve and publish on Google");
  });

  it("keeps failed publishes visible with a retry entry point", () => {
    const html = renderToStaticMarkup(
      <ApprovalCard
        row={{
          ...pendingRow,
          status: "publish_failed",
          publishError: "Google rejected the post",
        }}
      />
    );

    expect(html).toContain("Publish failed");
    expect(html).toContain("Google rejected the post");
    expect(html).toContain("Continue to retry");
    expect(html).not.toContain("Reject request");
  });

  it("shows the exact email and text-message drafts for a customer review request", () => {
    const html = renderToStaticMarkup(
      <ApprovalCard
        row={{
          ...pendingRow,
          actionType: "review_solicitation",
          payload: {
            draft: {
              email: { subject: "How did we do?", text: "Please share your experience." },
              sms: { body: "Would you leave us a review?" },
            },
          },
        }}
      />,
    );

    expect(html).toContain("Subject: How did we do?");
    expect(html).toContain("Please share your experience.");
    expect(html).toContain("Would you leave us a review?");
    expect(html).toContain("Customer review request");
    expect(html).toContain("Continue to confirmation");
  });
});
