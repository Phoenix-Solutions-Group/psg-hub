import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  CONTENT_APPROVAL_VISIBILITY_OPTIONS,
  contentApprovalVisibilityLabel,
  isContentApprovalVisibility,
} from "../content-approval-visibility";

const APPROVAL_RECORD_TABLES = [
  "content_approval_files",
  "content_approval_comments",
  "content_approval_decisions",
  "content_approval_versions",
  "content_approval_restore_requests",
  "content_approval_archives",
] as const;

describe("content approval visibility choices", () => {
  it("keeps the first-release customer choices simple and understandable", () => {
    expect(CONTENT_APPROVAL_VISIBILITY_OPTIONS).toEqual([
      {
        value: "shop",
        label: "Visible to customer",
        description: "The shop account can see this comment or approval record.",
      },
      {
        value: "psg_internal",
        label: "Private PSG note",
        description: "Only PSG team members can see this. It is hidden from the customer.",
      },
    ]);
    expect(contentApprovalVisibilityLabel("shop")).toBe("Visible to customer");
    expect(contentApprovalVisibilityLabel("psg_internal")).toBe("Private PSG note");
  });

  it("rejects unknown visibility values", () => {
    expect(isContentApprovalVisibility("shop")).toBe(true);
    expect(isContentApprovalVisibility("psg_internal")).toBe(true);
    expect(isContentApprovalVisibility("customer_group")).toBe(false);
    expect(isContentApprovalVisibility(null)).toBe(false);
  });
});

describe("content approval visibility migration", () => {
  const migration = readFileSync(
    join(
      process.cwd(),
      "supabase/migrations/20260717023000_bsm_content_approval_visibility.sql",
    ),
    "utf8",
  );

  it("protects every approval-adjacent record type with the same read rule", () => {
    for (const table of APPROVAL_RECORD_TABLES) {
      expect(migration).toContain(`alter table public.${table} enable row level security`);
      expect(migration).toContain(`create policy ${table}_select on public.${table}`);
      expect(migration).toContain(
        "private.user_can_read_content_approval_record(content_item_id, visibility)",
      );
    }
  });

  it("keeps PSG-only records hidden from shop users by checking both visibility and shop membership", () => {
    expect(migration).toContain("record_visibility = 'shop'");
    expect(migration).toContain("ci.shop_id in (select public.user_shop_ids())");
    expect(migration).toContain("private.current_user_is_psg()");
  });
});
