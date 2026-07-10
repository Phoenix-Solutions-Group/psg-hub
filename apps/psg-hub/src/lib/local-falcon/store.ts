import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import type {
  LocalFalconReport,
  LocalFalconVisibilitySnapshot,
  LocalFalconVisibilitySnapshotInsert,
} from "./types";

const TABLE = "local_falcon_visibility_snapshots";

export async function upsertLocalFalconSnapshot(
  service: SupabaseClient,
  row: LocalFalconVisibilitySnapshotInsert
): Promise<void> {
  const { error } = await service
    .from(TABLE)
    .upsert(row, {
      onConflict: "shop_id,captured_at,source_file_name",
      ignoreDuplicates: false,
    });

  if (error) {
    throw new Error(`upsertLocalFalconSnapshot failed: ${error.message}`);
  }
}

export async function getLatestLocalFalconSnapshot(
  client: SupabaseClient,
  { shopId }: { shopId: string }
): Promise<LocalFalconReport | null> {
  const { data, error } = await client
    .from(TABLE)
    .select("*")
    .eq("shop_id", shopId)
    .order("captured_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (error) {
    throw new Error(`getLatestLocalFalconSnapshot failed: ${error.message}`);
  }
  if (!data) return null;
  return toReport(data as LocalFalconVisibilitySnapshot);
}

function toReport(row: LocalFalconVisibilitySnapshot): LocalFalconReport {
  return {
    capturedAt: row.captured_at,
    sourceFileName: row.source_file_name,
    campaignName: row.campaign_name,
    gridSize: row.grid_size,
    shareOfLocalVoice: row.share_of_local_voice,
    averageRank: row.average_rank,
    priorityNotes: row.priority_notes ?? [],
    keywordSummaries: row.keyword_summaries ?? [],
  };
}
