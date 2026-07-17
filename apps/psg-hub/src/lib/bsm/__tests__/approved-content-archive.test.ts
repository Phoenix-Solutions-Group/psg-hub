import { describe, expect, it } from "vitest";
import { mapApprovedContentArchiveRows } from "../approved-content-archive";

describe("mapApprovedContentArchiveRows", () => {
  it("keeps the approved version, approver, approval time, and generated-page source together", () => {
    const rows = mapApprovedContentArchiveRows([
      {
        id: "decision-1",
        decision: "approved",
        actor_display_name: "Jamie Owner",
        decided_at: "2026-07-17T02:20:00.000Z",
        item: {
          id: "item-1",
          title: "July homepage refresh",
          content_type: "generated_page",
          source_kind: "generated_page",
        },
        version: {
          id: "version-2",
          version_number: 2,
          version_label: "Customer approved",
          preview_url: null,
          generated_page_path: "/preview/july-homepage",
          source_content_item_id: null,
        },
      },
    ]);

    expect(rows).toEqual([
      {
        id: "decision-1",
        title: "July homepage refresh",
        contentType: "generated_page",
        sourceKind: "generated_page",
        versionNumber: 2,
        versionLabel: "Customer approved",
        decision: "approved",
        approver: "Jamie Owner",
        approvedAt: "2026-07-17T02:20:00.000Z",
        previewHref: "/preview/july-homepage",
      },
    ]);
  });

  it("maps uploaded content-item approvals through the same archive row shape", () => {
    const rows = mapApprovedContentArchiveRows([
      {
        id: "decision-2",
        decision: "approved",
        actor_display_name: null,
        decided_at: "2026-07-17T02:25:00.000Z",
        item: [
          {
            id: "item-2",
            title: "Before and after graphic",
            content_type: "image/png",
            source_kind: "uploaded_file",
          },
        ],
        version: [
          {
            id: "version-1",
            version_number: 1,
            version_label: null,
            preview_url: null,
            generated_page_path: null,
            source_content_item_id: "content-1",
          },
        ],
      },
    ]);

    expect(rows[0]).toMatchObject({
      sourceKind: "uploaded_file",
      versionNumber: 1,
      previewHref: "/dashboard/content/content-1",
    });
  });
});
