import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { RequestList, type RequestListItem } from "@/app/dashboard/approvals/page";

const activeRequest: RequestListItem = {
  id: "quick-1",
  title: "Weekly Google Business Profile update",
  kind: "Google Business Profile post",
  detail: "Review the exact post before it goes live.",
  status: "Needs decision",
  updatedAt: "2026-08-21T12:00:00.000Z",
  href: "/dashboard/approvals/quick-1",
  actionLabel: "Review and decide",
};

describe("Review Requests list", () => {
  it("links active work to a focused request page", () => {
    const html = renderToStaticMarkup(
      <RequestList
        items={[activeRequest]}
        emptyTitle="Empty"
        emptyDetail="Nothing here"
      />,
    );

    expect(html).toContain('href="/dashboard/approvals/quick-1"');
    expect(html).toContain("Needs decision");
    expect(html).toContain("Review and decide");
  });

  it("renders history rows without decision links", () => {
    const html = renderToStaticMarkup(
      <RequestList
        items={[{ ...activeRequest, status: "Superseded", href: null }]}
        emptyTitle="Empty"
        emptyDetail="Nothing here"
      />,
    );

    expect(html).toContain("Superseded");
    expect(html).not.toContain("<a");
  });

  it("explains an empty active inbox", () => {
    const html = renderToStaticMarkup(
      <RequestList
        items={[]}
        emptyTitle="You are all caught up"
        emptyDetail="New requests appear only when your decision is needed."
      />,
    );

    expect(html).toContain("You are all caught up");
    expect(html).toContain("only when your decision is needed");
  });
});
