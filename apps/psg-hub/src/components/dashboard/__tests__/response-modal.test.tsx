import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { ResponseModal } from "@/components/dashboard/response-modal";

describe("ResponseModal team comments", () => {
  it("shows an internal comment control without changing response decisions", () => {
    const html = renderToStaticMarkup(
      <ResponseModal
        review={{ id: "review-1", author: "Taylor", rating: 5, body: "Great work", platform: "google" }}
        userRole="manager"
        existing={{
          id: "response-1",
          body: "Thank you!",
          status: "draft",
          tone_preset: "warm",
          version: 1,
          safety_flags: [],
          safety_overridden: false,
          approved_at: null,
        }}
        onClose={vi.fn()}
        onSaved={vi.fn()}
      />
    );

    expect(html).toContain("Team comments");
    expect(html).toContain("Add comment");
    expect(html).toContain("Internal only");
    expect(html).toContain('maxLength="2000"');
    expect(html).toContain("Approve");
    expect(html).toContain("Reject");
  });
});
