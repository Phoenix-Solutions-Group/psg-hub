import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";

import { ContentTable } from "@/components/dashboard/content-table";

describe("ContentTable", () => {
  it("uses semantic badge variants for customer-visible content statuses", () => {
    const html = renderToStaticMarkup(
      <ContentTable
        items={[
          {
            id: "pending",
            title: "Riverside Collision July repair tips",
            content_type: "blog_post",
            status: "pending_review",
            updated_at: "2026-08-11T16:00:00.000Z",
          },
          {
            id: "approved",
            title: "Google review reply for finished repair",
            content_type: "review_response",
            status: "approved",
            updated_at: "2026-08-09T16:00:00.000Z",
          },
          {
            id: "declined",
            title: "Declined draft",
            content_type: "blog_post",
            status: "declined",
            updated_at: "2026-08-08T16:00:00.000Z",
          },
        ]}
      />
    );

    expect(html).toContain("bg-warning text-warning-foreground");
    expect(html).toContain("bg-success text-success-foreground");
    expect(html).toContain("text-destructive");
    expect(html).not.toContain("bg-yellow-100");
    expect(html).not.toContain("text-yellow-800");
  });
});
