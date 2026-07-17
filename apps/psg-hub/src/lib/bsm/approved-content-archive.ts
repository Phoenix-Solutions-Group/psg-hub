import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { ApprovedContentArchiveRow } from "@/components/dashboard/approved-content-archive-table";

type ArchiveItemRecord = {
  id: string;
  title: string;
  content_type: string;
  source_kind: string;
};

type ArchiveVersionRecord = {
  id: string;
  version_number: number;
  version_label: string | null;
  preview_url: string | null;
  generated_page_path: string | null;
  source_content_item_id: string | null;
};

type ArchiveDecisionRecord = {
  id: string;
  decision: string;
  actor_display_name: string | null;
  decided_at: string;
  item: ArchiveItemRecord | ArchiveItemRecord[] | null;
  version: ArchiveVersionRecord | ArchiveVersionRecord[] | null;
};

function one<T>(value: T | T[] | null): T | null {
  if (Array.isArray(value)) return value[0] ?? null;
  return value;
}

function previewHref(version: ArchiveVersionRecord): string | null {
  if (version.preview_url) return version.preview_url;
  if (version.generated_page_path) return version.generated_page_path;
  if (version.source_content_item_id) {
    return `/dashboard/content/${encodeURIComponent(version.source_content_item_id)}`;
  }
  return null;
}

export function mapApprovedContentArchiveRows(
  records: ArchiveDecisionRecord[]
): ApprovedContentArchiveRow[] {
  return records.flatMap((record) => {
    const item = one(record.item);
    const version = one(record.version);
    if (!item || !version) return [];

    return [
      {
        id: record.id,
        title: item.title,
        contentType: item.content_type,
        sourceKind: item.source_kind,
        versionNumber: version.version_number,
        versionLabel: version.version_label,
        decision: record.decision,
        approver: record.actor_display_name,
        approvedAt: record.decided_at,
        previewHref: previewHref(version),
      },
    ];
  });
}

export async function listApprovedContentArchiveRows(
  client: SupabaseClient,
  shopId: string,
  limit = 50
): Promise<ApprovedContentArchiveRow[]> {
  const { data, error } = await client
    .from("bsm_content_review_decisions")
    .select(
      `
        id,
        decision,
        actor_display_name,
        decided_at,
        item:bsm_content_review_items!inner (
          id,
          title,
          content_type,
          source_kind
        ),
        version:bsm_content_review_versions!inner (
          id,
          version_number,
          version_label,
          preview_url,
          generated_page_path,
          source_content_item_id
        )
      `
    )
    .eq("shop_id", shopId)
    .eq("decision", "approved")
    .order("decided_at", { ascending: false })
    .limit(limit);

  if (error) {
    throw new Error(`approved-content archive query failed: ${error.message}`);
  }

  return mapApprovedContentArchiveRows((data ?? []) as ArchiveDecisionRecord[]);
}
