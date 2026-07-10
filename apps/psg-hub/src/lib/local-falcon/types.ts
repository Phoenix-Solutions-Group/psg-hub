export type LocalFalconKeywordSummary = {
  keyword: string;
  locations: number;
  averageRank: number | null;
  topThreeLocations: number;
  priorityNotes: string[];
};

export type LocalFalconVisibilitySnapshot = {
  id: string;
  shop_id: string;
  captured_at: string;
  source_file_name: string;
  campaign_name: string | null;
  grid_size: string | null;
  share_of_local_voice: number | null;
  average_rank: number | null;
  priority_notes: string[];
  keyword_summaries: LocalFalconKeywordSummary[];
  raw_rows: Record<string, string>[];
  imported_by_profile_id: string | null;
  created_at: string;
};

export type LocalFalconVisibilitySnapshotInsert = {
  shop_id: string;
  captured_at: string;
  source_file_name: string;
  campaign_name?: string | null;
  grid_size?: string | null;
  share_of_local_voice?: number | null;
  average_rank?: number | null;
  priority_notes?: string[];
  keyword_summaries: LocalFalconKeywordSummary[];
  raw_rows: Record<string, string>[];
  imported_by_profile_id?: string | null;
};

export type LocalFalconReport = {
  capturedAt: string;
  sourceFileName: string;
  campaignName: string | null;
  gridSize: string | null;
  shareOfLocalVoice: number | null;
  averageRank: number | null;
  priorityNotes: string[];
  keywordSummaries: LocalFalconKeywordSummary[];
};
