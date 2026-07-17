import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { ApprovedContentArchiveRow } from "@/components/dashboard/approved-content-archive-table";

type ArchiveItemRecord = {
  id: string;
  title: string;
  content_type: string;
};

type ArchiveVersionRecord = {
  id: string;
  version_number: number;
  original_filename: string | null;
  storage_path: string | null;
  preview_type: string | null;
  source_content_item_id: string | null;
  source_metadata_jsonb: Record<string, unknown> | null;
};

type ArchiveDecisionRecord = {
  id: string;
  decision: string;
  actor_profile_id: string | null;
  created_at: string;
  item: ArchiveItemRecord | ArchiveItemRecord[] | null;
  version: ArchiveVersionRecord | ArchiveVersionRecord[] | null;
};

function one<T>(value: T | T[] | null): T | null {
  if (Array.isArray(value)) return value[0] ?? null;
  return value;
}

function previewHref(version: ArchiveVersionRecord): string | null {
  const metadata = version.source_metadata_jsonb ?? {};
  const previewUrl = typeof metadata.previewUrl === "string" ? metadata.previewUrl : null;
  const generatedPagePath = typeof metadata.generatedPagePath === "string" ? metadata.generatedPagePath : null;
  if (previewUrl) return previewUrl;
  if (generatedPagePath) return generatedPagePath;
  if (version.source_content_item_id) {
    return `/dashboard/content/${encodeURIComponent(version.source_content_item_id)}`;
  }
  if (version.storage_path) return null;
  return null;
}

function sourceKind(item: ArchiveItemRecord, version: ArchiveVersionRecord): string {
  if (item.content_type === "generated_page" || version.preview_type === "generated_page") {
    return "generated_page";
  }
  return "uploaded_file";
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
        sourceKind: sourceKind(item, version),
        versionNumber: version.version_number,
        versionLabel: version.original_filename,
        decision: record.decision,
        approver: record.actor_profile_id,
        approvedAt: record.created_at,
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
        actor_profile_id,
        created_at,
        item:bsm_content_review_items!inner (
          id,
          title,
          content_type
        ),
        version:bsm_content_review_versions!inner (
          id,
          version_number,
          original_filename,
          storage_path,
          preview_type,
          source_content_item_id,
          source_metadata_jsonb
        )
      `
    )
    .eq("shop_id", shopId)
    .eq("decision", "approve")
    .order("created_at", { ascending: false })
    .limit(limit);

  if (error) {
    throw new Error(`approved-content archive query failed: ${error.message}`);
  }

  return mapApprovedContentArchiveRows((data ?? []) as ArchiveDecisionRecord[]);
}
