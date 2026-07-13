import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { createServiceClient } from "@/lib/supabase/service";

type SendHistoryRow = {
  piece_code: string | null;
  piece_variant: string | null;
  sent_date: string | null;
  batch_ref: string | null;
};

type PriorRow = {
  piece_code: string | null;
  ab_variant: string | null;
  n_sent: number | null;
  n_outcome: number | null;
  outcome_rate: number | string | null;
};

export type DirectMailPieceSummary = {
  pieceCode: string;
  variant: string | null;
  sent: number;
  outcomes: number;
  outcomeRate: number;
};

export type DirectMailMetrics = {
  totalSent: number;
  recentSent: number;
  latestSentDate: string | null;
  recentTopPiece: DirectMailPieceSummary | null;
  totalOutcomes: number;
  outcomeRate: number | null;
  bestPiece: DirectMailPieceSummary | null;
};

export const EMPTY_DIRECT_MAIL_METRICS: DirectMailMetrics = {
  totalSent: 0,
  recentSent: 0,
  latestSentDate: null,
  recentTopPiece: null,
  totalOutcomes: 0,
  outcomeRate: null,
  bestPiece: null,
};

export function summarizeDirectMailMetrics({
  totalSent,
  recentSent,
  latestSentDate,
  recentRows,
  priorRows,
}: {
  totalSent: number;
  recentSent: number;
  latestSentDate: string | null;
  recentRows: SendHistoryRow[];
  priorRows: PriorRow[];
}): DirectMailMetrics {
  const recentPieces = new Map<string, DirectMailPieceSummary>();
  for (const row of recentRows) {
    const pieceCode = normalizePiece(row.piece_code);
    if (!pieceCode) continue;
    const variant = normalizeVariant(row.piece_variant);
    const key = `${pieceCode}\u0000${variant ?? ""}`;
    const current =
      recentPieces.get(key) ??
      ({
        pieceCode,
        variant,
        sent: 0,
        outcomes: 0,
        outcomeRate: 0,
      } satisfies DirectMailPieceSummary);
    current.sent += 1;
    recentPieces.set(key, current);
  }

  const priorsByPiece = new Map<string, DirectMailPieceSummary>();
  for (const row of priorRows) {
    const pieceCode = normalizePiece(row.piece_code);
    if (!pieceCode) continue;
    const variant = normalizeVariant(row.ab_variant);
    const key = `${pieceCode}\u0000${variant ?? ""}`;
    const current =
      priorsByPiece.get(key) ??
      ({
        pieceCode,
        variant,
        sent: 0,
        outcomes: 0,
        outcomeRate: 0,
      } satisfies DirectMailPieceSummary);
    current.sent += toFiniteNumber(row.n_sent);
    current.outcomes += toFiniteNumber(row.n_outcome);
    priorsByPiece.set(key, current);
  }

  const priorPieces = [...priorsByPiece.values()].map((piece) => ({
    ...piece,
    outcomeRate: piece.sent > 0 ? piece.outcomes / piece.sent : 0,
  }));
  const totalPriorSent = priorPieces.reduce((sum, row) => sum + row.sent, 0);
  const totalOutcomes = priorPieces.reduce((sum, row) => sum + row.outcomes, 0);

  return {
    totalSent,
    recentSent,
    latestSentDate,
    recentTopPiece: pickMostSent([...recentPieces.values()]),
    totalOutcomes,
    outcomeRate: totalPriorSent > 0 ? totalOutcomes / totalPriorSent : null,
    bestPiece: pickBestOutcomePiece(priorPieces),
  };
}

export async function getDirectMailMetrics({
  authorizedShopNames,
  from,
  client,
}: {
  authorizedShopNames: string[];
  from: string;
  client?: SupabaseClient;
}): Promise<DirectMailMetrics> {
  const shopNames = [...new Set(authorizedShopNames.map((s) => s.trim()).filter(Boolean))];
  if (shopNames.length === 0) return EMPTY_DIRECT_MAIL_METRICS;

  const db = client ?? createServiceClient();
  const [totalSent, recentSent, latestSentDate, recentRows, priorRows] =
    await Promise.all([
      countSendRows(db, shopNames),
      countSendRows(db, shopNames, from),
      getLatestSendDate(db, shopNames),
      getRecentRows(db, shopNames, from),
      getPriorRows(db),
    ]);

  return summarizeDirectMailMetrics({
    totalSent,
    recentSent,
    latestSentDate,
    recentRows,
    priorRows,
  });
}

async function countSendRows(
  db: SupabaseClient,
  shopNames: string[],
  from?: string
): Promise<number> {
  let query = db
    .from("mail_send_history")
    .select("id", { count: "exact", head: true })
    .in("shop_name", shopNames);
  if (from) query = query.gte("sent_date", from);

  const { count, error } = await query;
  if (error) throw new Error(`countSendRows failed: ${error.message}`);
  return count ?? 0;
}

async function getLatestSendDate(
  db: SupabaseClient,
  shopNames: string[]
): Promise<string | null> {
  const { data, error } = await db
    .from("mail_send_history")
    .select("sent_date")
    .in("shop_name", shopNames)
    .order("sent_date", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (error) throw new Error(`getLatestSendDate failed: ${error.message}`);
  return typeof data?.sent_date === "string" ? data.sent_date : null;
}

async function getRecentRows(
  db: SupabaseClient,
  shopNames: string[],
  from: string
): Promise<SendHistoryRow[]> {
  const { data, error } = await db
    .from("mail_send_history")
    .select("piece_code,piece_variant,sent_date,batch_ref")
    .in("shop_name", shopNames)
    .gte("sent_date", from)
    .order("sent_date", { ascending: false })
    .limit(5000);

  if (error) throw new Error(`getRecentRows failed: ${error.message}`);
  return (data ?? []) as SendHistoryRow[];
}

async function getPriorRows(db: SupabaseClient): Promise<PriorRow[]> {
  const { data, error } = await db
    .from("mail_send_priors")
    .select("piece_code,ab_variant,n_sent,n_outcome,outcome_rate")
    .gt("n_sent", 0)
    .limit(10000);

  if (error) throw new Error(`getPriorRows failed: ${error.message}`);
  return (data ?? []) as PriorRow[];
}

function pickMostSent(rows: DirectMailPieceSummary[]): DirectMailPieceSummary | null {
  if (rows.length === 0) return null;
  return rows.sort((a, b) => b.sent - a.sent || a.pieceCode.localeCompare(b.pieceCode))[0];
}

function pickBestOutcomePiece(
  rows: DirectMailPieceSummary[]
): DirectMailPieceSummary | null {
  const candidates = rows.filter((row) => row.sent > 0);
  if (candidates.length === 0) return null;
  return candidates.sort(
    (a, b) =>
      b.outcomeRate - a.outcomeRate ||
      b.outcomes - a.outcomes ||
      b.sent - a.sent ||
      a.pieceCode.localeCompare(b.pieceCode)
  )[0];
}

function normalizePiece(value: string | null): string {
  return value?.trim() ?? "";
}

function normalizeVariant(value: string | null): string | null {
  const trimmed = value?.trim();
  return trimmed ? trimmed : null;
}

function toFiniteNumber(value: number | string | null): number {
  const n = typeof value === "string" ? Number(value) : value;
  return typeof n === "number" && Number.isFinite(n) ? n : 0;
}
