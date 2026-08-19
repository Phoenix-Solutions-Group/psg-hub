import { parseDelimited } from "@/lib/ops/import/parse";
import type {
  LocalFalconKeywordSummary,
  LocalFalconVisibilitySnapshotInsert,
} from "./types";

type ParseArgs = {
  shopId: string;
  capturedAt: string;
  sourceFileName: string;
  csv: string;
  importedByProfileId?: string | null;
};

const HEADER_ALIASES = {
  keyword: ["keyword", "search term", "query"],
  location: ["location", "grid point", "grid location", "scan point", "geo"],
  rank: ["rank", "ranking", "map rank", "local rank", "position"],
  solv: ["share of local voice", "solv", "share_of_local_voice", "voice share"],
  note: ["note", "notes", "priority notes", "action", "recommendation"],
  campaign: ["campaign", "campaign name", "scan name"],
  grid: ["grid", "grid size", "scan grid"],
} as const;

function normalizeHeader(value: string): string {
  return value.toLowerCase().replace(/[%()]/g, "").replace(/[_-]+/g, " ").replace(/\s+/g, " ").trim();
}

function get(row: Record<string, string>, aliases: readonly string[]): string {
  const normalizedAliases = aliases.map(normalizeHeader);
  for (const [key, value] of Object.entries(row)) {
    if (normalizedAliases.includes(normalizeHeader(key))) return value.trim();
  }
  return "";
}

function parseNumber(value: string): number | null {
  const clean = value.replace(/[%,$]/g, "").trim();
  if (!clean) return null;
  const parsed = Number(clean);
  return Number.isFinite(parsed) ? parsed : null;
}

function mean(values: number[]): number | null {
  if (values.length === 0) return null;
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

function uniqueNonEmpty(values: string[]): string[] {
  return Array.from(new Set(values.map((v) => v.trim()).filter(Boolean)));
}

function keywordSummaries(rows: Record<string, string>[]): LocalFalconKeywordSummary[] {
  const byKeyword = new Map<
    string,
    { ranks: number[]; locations: Set<string>; notes: string[] }
  >();

  for (const row of rows) {
    const keyword = get(row, HEADER_ALIASES.keyword);
    if (!keyword) continue;
    const location = get(row, HEADER_ALIASES.location);
    const rank = parseNumber(get(row, HEADER_ALIASES.rank));
    const note = get(row, HEADER_ALIASES.note);
    const bucket =
      byKeyword.get(keyword) ?? { ranks: [], locations: new Set<string>(), notes: [] };
    if (location) bucket.locations.add(location);
    if (rank !== null) bucket.ranks.push(rank);
    if (note) bucket.notes.push(note);
    byKeyword.set(keyword, bucket);
  }

  return Array.from(byKeyword.entries()).map(([keyword, bucket]) => ({
    keyword,
    locations: bucket.locations.size || bucket.ranks.length,
    averageRank: mean(bucket.ranks),
    topThreeLocations: bucket.ranks.filter((rank) => rank > 0 && rank <= 3).length,
    priorityNotes: uniqueNonEmpty(bucket.notes),
  }));
}

export function parseLocalFalconCsv({
  shopId,
  capturedAt,
  sourceFileName,
  csv,
  importedByProfileId = null,
}: ParseArgs): LocalFalconVisibilitySnapshotInsert {
  const table = parseDelimited(csv, "csv");
  const rows = table.rows;
  const ranks = rows
    .map((row) => parseNumber(get(row, HEADER_ALIASES.rank)))
    .filter((value): value is number => value !== null);
  const solvValues = rows
    .map((row) => parseNumber(get(row, HEADER_ALIASES.solv)))
    .filter((value): value is number => value !== null);
  const summaries = keywordSummaries(rows);
  const notes = uniqueNonEmpty([
    ...rows.map((row) => get(row, HEADER_ALIASES.note)),
    ...summaries.flatMap((summary) => summary.priorityNotes),
  ]);

  return {
    shop_id: shopId,
    captured_at: capturedAt,
    source_file_name: sourceFileName,
    campaign_name: get(rows[0] ?? {}, HEADER_ALIASES.campaign) || null,
    grid_size: get(rows[0] ?? {}, HEADER_ALIASES.grid) || null,
    share_of_local_voice: mean(solvValues),
    average_rank: mean(ranks),
    priority_notes: notes,
    keyword_summaries: summaries,
    raw_rows: rows,
    imported_by_profile_id: importedByProfileId,
  };
}
