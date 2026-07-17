import { describe, expect, it } from "vitest";
import { mapApprovedContentArchiveRows } from "../approved-content-archive";

describe("mapApprovedContentArchiveRows", () => {
  it("keeps the approved version, approver, approval time, and generated-page source together", () => {
    const rows = mapApprovedContentArchiveRows([
      {
        id: "decision-1",
        decision: "approve",
        actor_profile_id: "profile-1",
        created_at: "2026-07-17T02:20:00.000Z",
        item: {
          id: "item-1",
          title: "July homepage refresh",
          content_type: "generated_page",
        },
        version: {
          id: "version-2",
          version_number: 2,
          original_filename: null,
          storage_path: null,
          preview_type: "generated_page",
          source_content_item_id: null,
          source_metadata_jsonb: {
            generatedPagePath: "/preview/july-homepage",
          },
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
        versionLabel: null,
        decision: "approve",
        approver: "profile-1",
        approvedAt: "2026-07-17T02:20:00.000Z",
        previewHref: "/preview/july-homepage",
      },
    ]);
  });

  it("maps uploaded content-item approvals through the same archive row shape", () => {
    const rows = mapApprovedContentArchiveRows([
      {
        id: "decision-2",
        decision: "approve",
        actor_profile_id: null,
        created_at: "2026-07-17T02:25:00.000Z",
        item: [
          {
            id: "item-2",
            title: "Before and after graphic",
            content_type: "image/png",
          },
        ],
        version: [
          {
            id: "version-1",
            version_number: 1,
            original_filename: "before-after.png",
            storage_path: "shop/item/version/before-after.png",
            preview_type: "image",
            source_content_item_id: "content-1",
            source_metadata_jsonb: {},
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
