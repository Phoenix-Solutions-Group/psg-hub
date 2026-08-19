import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { ContentTable } from "@/components/dashboard/content-table";

describe("ContentTable publication status", () => {
  it.each(["draft", "sent", "in_review", "updates_requested", "approved", "declined"])(
    "labels %s content as Draft until the separate publication gate completes",
    (status) => {
      const html = renderToStaticMarkup(
        <ContentTable
          items={[{
            id: "review-1",
            title: "Private generated content",
            content_type: "generated_page",
            status,
            updated_at: "2026-08-19T12:00:00.000Z",
          }]}
        />,
      );

      expect(html).toContain("Draft");
      expect(html).not.toContain(">Approved<");
    },
  );

  it("labels content Published only after publication", () => {
    const html = renderToStaticMarkup(
      <ContentTable
        items={[{
          id: "published-1",
          title: "Published content",
          content_type: "blog_post",
          status: "published",
          updated_at: "2026-08-19T12:00:00.000Z",
        }]}
      />,
    );

    expect(html).toContain("Published");
  });
});
