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
  it("starts with preview only, not a direct publish button", () => {
    const html = renderToStaticMarkup(<ApprovalCard row={pendingRow} />);

    expect(html).toContain("Preview post");
    expect(html).not.toContain("Approve &amp; publish");
    expect(html).not.toContain("Confirm and publish publicly now");
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
    expect(html).toContain("Review before retry");
    expect(html).not.toContain("Reject");
  });
});
