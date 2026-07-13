import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { createServiceClient } from "@/lib/supabase/service";

const MIN_RESULT_SENDS = 25;

const SENT_PRODUCTION_STATUSES = [
  "mailed",
  "in_transit",
  "in_local_area",
  "processed_for_delivery",
  "delivered",
  "re_routed",
  "returned_to_sender",
] as const;

const PIECE_LABELS: Record<string, string> = {
  t: "Total-loss thank-you",
  "04": "Thank-you and warranty",
  "04b": "Thank-you and warranty, variant B",
  "07": "Thank-you, warranty, and survey notice",
  "10": "Survey reminder",
  "10b": "Survey thank-you and referral ask",
  "12": "Driver's license renewal reminder",
  "13": "Birthday greeting",
  "14": "Follow-up letter",
  "15": "Follow-up letter",
  "16": "Follow-up letter",
  b: "Birthday greeting",
  postcard: "Postcard",
  letter: "Letter",
  self_mailer: "Self-mailer",
};

type CompanyRow = {
  id: string;
  name: string | null;
  shop_id: string | null;
};

type SendHistoryRow = {
  id?: string | null;
  piece_code: string | null;
  piece_variant: string | null;
  sent_date: string | null;
  household_key?: string | null;
  updated_at?: string | null;
  company_id?: string | null;
  shop_name?: string | null;
};

type ProductionRow = {
  id?: string | null;
  piece_type: string | null;
  status: string | null;
  created_at: string | null;
  updated_at?: string | null;
  company_id?: string | null;
};

type SentEvent = {
  source: "history" | "production";
  pieceCode: string;
  variant: string | null;
  sentDate: string;
  householdKey: string | null;
  updatedAt: string | null;
};

type PriorRow = {
  id?: string | null;
  company_id?: string | null;
  shop_name?: string | null;
  piece_code: string | null;
  ab_variant: string | null;
  n_sent: number | null;
  n_outcome: number | null;
  outcome_rate: number | string | null;
  computed_at?: string | null;
};

export type DirectMailPieceSummary = {
  pieceCode: string;
  label: string;
  variant: string | null;
  sent: number;
  outcomes: number;
  outcomeRate: number | null;
};

export type DirectMailRecentActivity = {
  date: string;
  sent: number;
  pieces: DirectMailPieceSummary[];
};

export type DirectMailResultStatus =
  | "ready"
  | "insufficient_data"
  | "unavailable";

export type DirectMailResults = {
  status: DirectMailResultStatus;
  responsesOrOutcomes: number;
  responseRate: number | null;
  bestPerformingPiece: DirectMailPieceSummary | null;
  lastUpdatedAt: string | null;
  message: string | null;
};

export type DirectMailActivity = {
  lettersMailed: number;
  householdsReached: number | null;
  piecesByType: DirectMailPieceSummary[];
  recentSendActivity: DirectMailRecentActivity[];
  latestSentDate: string | null;
  lastUpdatedAt: string | null;
};

export type DirectMailMetrics = {
  shopIds: string[];
  range: {
    from: string;
    to: string | null;
  };
  activity: DirectMailActivity;
  results: DirectMailResults;
  sources: {
    sendHistoryRows: number;
    productionRows: number;
    resultRows: number;
    legacyNameFallbackUsed: boolean;
  };
  privacy: {
    rawRecipientFieldsIncluded: false;
  };
  totalSent: number;
  recentSent: number;
  latestSentDate: string | null;
  recentTopPiece: DirectMailPieceSummary | null;
  totalOutcomes: number;
  outcomeRate: number | null;
  bestPiece: DirectMailPieceSummary | null;
};

export const EMPTY_DIRECT_MAIL_METRICS: DirectMailMetrics = {
  shopIds: [],
  range: { from: "", to: null },
  activity: {
    lettersMailed: 0,
    householdsReached: null,
    piecesByType: [],
    recentSendActivity: [],
    latestSentDate: null,
    lastUpdatedAt: null,
  },
  results: {
    status: "unavailable",
    responsesOrOutcomes: 0,
    responseRate: null,
    bestPerformingPiece: null,
    lastUpdatedAt: null,
    message: "Direct-mail results are not available yet.",
  },
  sources: {
    sendHistoryRows: 0,
    productionRows: 0,
    resultRows: 0,
    legacyNameFallbackUsed: false,
  },
  privacy: { rawRecipientFieldsIncluded: false },
  totalSent: 0,
  recentSent: 0,
  latestSentDate: null,
  recentTopPiece: null,
  totalOutcomes: 0,
  outcomeRate: null,
  bestPiece: null,
};

export function summarizeDirectMailMetrics({
  shopIds = [],
  from,
  to = null,
  sendHistoryRows,
  productionRows = [],
  priorRows = [],
  legacyNameFallbackUsed = false,
}: {
  shopIds?: string[];
  from: string;
  to?: string | null;
  sendHistoryRows: SendHistoryRow[];
  productionRows?: ProductionRow[];
  priorRows?: PriorRow[];
  legacyNameFallbackUsed?: boolean;
}): DirectMailMetrics {
  const sentEvents: SentEvent[] = [
    ...sendHistoryRows.flatMap((row): SentEvent[] => {
      const pieceCode = normalizePiece(row.piece_code);
      const sentDate = normalizeDate(row.sent_date);
      if (!pieceCode || !sentDate) return [];
      return [
        {
          source: "history",
          pieceCode,
          variant: normalizeVariant(row.piece_variant),
          sentDate,
          householdKey: normalizeKey(row.household_key),
          updatedAt: normalizeDateTime(row.updated_at),
        },
      ];
    }),
    ...productionRows.flatMap((row): SentEvent[] => {
      const pieceCode = normalizePiece(row.piece_type);
      const sentDate = normalizeDate(row.created_at);
      if (!pieceCode || !sentDate) return [];
      return [
        {
          source: "production",
          pieceCode,
          variant: null,
          sentDate,
          householdKey: null,
          updatedAt:
            normalizeDateTime(row.updated_at) ?? normalizeDateTime(row.created_at),
        },
      ];
    }),
  ];

  const pieces = new Map<string, DirectMailPieceSummary>();
  const recentByDate = new Map<string, Map<string, DirectMailPieceSummary>>();
  const households = new Set<string>();

  for (const row of sentEvents) {
    const key = pieceKey(row.pieceCode, row.variant);
    const current = pieces.get(key) ?? newPiece(row.pieceCode, row.variant);
    current.sent += 1;
    pieces.set(key, current);

    const day = row.sentDate;
    const dayPieces = recentByDate.get(day) ?? new Map<string, DirectMailPieceSummary>();
    const dayPiece = dayPieces.get(key) ?? newPiece(row.pieceCode, row.variant);
    dayPiece.sent += 1;
    dayPieces.set(key, dayPiece);
    recentByDate.set(day, dayPieces);

    if (row.source === "history" && row.householdKey) {
      households.add(row.householdKey);
    }
  }

  const priorPieces = summarizePriors(priorRows);
  const totalPriorSent = priorPieces.reduce((sum, row) => sum + row.sent, 0);
  const totalOutcomes = priorPieces.reduce((sum, row) => sum + row.outcomes, 0);
  const latestSentDate = maxString(sentEvents.map((row) => row.sentDate));
  const latestActivityUpdate = maxString(
    sentEvents.map((row) => row.updatedAt ?? row.sentDate)
  );
  const latestPriorUpdate = maxString(
    priorRows.map((row) => normalizeDateTime(row.computed_at))
  );
  const resultStatus: DirectMailResultStatus =
    priorRows.length === 0
      ? "unavailable"
      : totalPriorSent < MIN_RESULT_SENDS
        ? "insufficient_data"
        : "ready";
  const responseRate =
    resultStatus === "ready" && totalPriorSent > 0
      ? totalOutcomes / totalPriorSent
      : null;
  const bestPiece =
    resultStatus === "ready" ? pickBestOutcomePiece(priorPieces) : null;

  const metrics: DirectMailMetrics = {
    shopIds: [...new Set(shopIds)],
    range: { from, to },
    activity: {
      lettersMailed: sentEvents.length,
      householdsReached: households.size > 0 ? households.size : null,
      piecesByType: [...pieces.values()].sort(bySentThenPiece),
      recentSendActivity: [...recentByDate.entries()]
        .sort(([a], [b]) => b.localeCompare(a))
        .map(([date, pieceMap]) => ({
          date,
          sent: [...pieceMap.values()].reduce((sum, row) => sum + row.sent, 0),
          pieces: [...pieceMap.values()].sort(bySentThenPiece),
        }))
        .slice(0, 14),
      latestSentDate,
      lastUpdatedAt: latestActivityUpdate,
    },
    results: {
      status: resultStatus,
      responsesOrOutcomes: resultStatus === "ready" ? totalOutcomes : 0,
      responseRate,
      bestPerformingPiece: bestPiece,
      lastUpdatedAt: resultStatus === "ready" ? latestPriorUpdate : null,
      message: resultMessage(resultStatus, totalPriorSent),
    },
    sources: {
      sendHistoryRows: sendHistoryRows.length,
      productionRows: productionRows.length,
      resultRows: priorRows.length,
      legacyNameFallbackUsed,
    },
    privacy: { rawRecipientFieldsIncluded: false },
    totalSent: sentEvents.length,
    recentSent: sentEvents.length,
    latestSentDate,
    recentTopPiece: pickMostSent([...pieces.values()]),
    totalOutcomes: resultStatus === "ready" ? totalOutcomes : 0,
    outcomeRate: responseRate,
    bestPiece,
  };

  return metrics;
}

export async function getDirectMailMetrics({
  authorizedShopIds,
  authorizedShopNames,
  from,
  to = null,
  client,
}: {
  authorizedShopIds?: string[];
  authorizedShopNames?: string[];
  from: string;
  to?: string | null;
  client?: SupabaseClient;
}): Promise<DirectMailMetrics> {
  const shopIds = uniqueStrings(authorizedShopIds ?? []);
  const legacyShopNames = uniqueStrings(authorizedShopNames ?? []);
  if (shopIds.length === 0 && legacyShopNames.length === 0) {
    return { ...EMPTY_DIRECT_MAIL_METRICS, range: { from, to } };
  }

  const db = client ?? createServiceClient();
  const companies =
    shopIds.length > 0 ? await getCompaniesForShops(db, shopIds) : [];
  const companyIds = companies.map((company) => company.id);
  const companyNames = companies
    .map((company) => company.name)
    .filter((name): name is string => Boolean(name?.trim()));
  const scopedNames = uniqueStrings([...companyNames, ...legacyShopNames]);

  if (companyIds.length === 0 && scopedNames.length === 0) {
    return { ...EMPTY_DIRECT_MAIL_METRICS, shopIds, range: { from, to } };
  }

  const [sendHistoryRows, productionRows, priorRows] = await Promise.all([
    getSendHistoryRows(db, { companyIds, shopNames: scopedNames, from, to }),
    getProductionRows(db, { companyIds, from, to }),
    getPriorRows(db, { companyIds, shopNames: scopedNames }),
  ]);

  return summarizeDirectMailMetrics({
    shopIds,
    from,
    to,
    sendHistoryRows,
    productionRows,
    priorRows,
    legacyNameFallbackUsed: scopedNames.length > 0,
  });
}

async function getCompaniesForShops(
  db: SupabaseClient,
  shopIds: string[]
): Promise<CompanyRow[]> {
  const { data, error } = await db
    .from("companies")
    .select("id,name,shop_id")
    .in("shop_id", shopIds);

  if (error) throw new Error(`getCompaniesForShops failed: ${error.message}`);
  return (data ?? []) as CompanyRow[];
}

async function getSendHistoryRows(
  db: SupabaseClient,
  {
    companyIds,
    shopNames,
    from,
    to,
  }: {
    companyIds: string[];
    shopNames: string[];
    from: string;
    to: string | null;
  }
): Promise<SendHistoryRow[]> {
  const [companyRows, legacyRows] = await Promise.all([
    companyIds.length > 0
      ? selectSendHistory(db, "company_id", companyIds, from, to)
      : Promise.resolve([]),
    shopNames.length > 0
      ? selectSendHistory(db, "shop_name", shopNames, from, to)
      : Promise.resolve([]),
  ]);

  const deduped = new Map<string, SendHistoryRow>();
  for (const row of [...companyRows, ...legacyRows]) {
    deduped.set(row.id ?? `${row.shop_name}:${row.piece_code}:${row.sent_date}`, row);
  }
  return [...deduped.values()];
}

async function selectSendHistory(
  db: SupabaseClient,
  scopeColumn: "company_id" | "shop_name",
  scopeValues: string[],
  from: string,
  to: string | null
): Promise<SendHistoryRow[]> {
  let query = db
    .from("mail_send_history")
    .select("id,company_id,shop_name,piece_code,piece_variant,sent_date,household_key,updated_at")
    .in(scopeColumn, scopeValues)
    .gte("sent_date", from);
  if (to) query = query.lte("sent_date", to);

  const { data, error } = await query
    .order("sent_date", { ascending: false })
    .limit(10000);
  if (error) throw new Error(`selectSendHistory failed: ${error.message}`);
  return (data ?? []) as SendHistoryRow[];
}

async function getProductionRows(
  db: SupabaseClient,
  {
    companyIds,
    from,
    to,
  }: {
    companyIds: string[];
    from: string;
    to: string | null;
  }
): Promise<ProductionRow[]> {
  if (companyIds.length === 0) return [];
  let query = db
    .from("production_documents")
    .select("id,company_id,piece_type,status,created_at,updated_at")
    .in("company_id", companyIds)
    .in("status", [...SENT_PRODUCTION_STATUSES])
    .gte("created_at", from);
  if (to) query = query.lte("created_at", to);

  const { data, error } = await query
    .order("created_at", { ascending: false })
    .limit(10000);
  if (error) throw new Error(`getProductionRows failed: ${error.message}`);
  return (data ?? []) as ProductionRow[];
}

async function getPriorRows(
  db: SupabaseClient,
  {
    companyIds,
    shopNames,
  }: {
    companyIds: string[];
    shopNames: string[];
  }
): Promise<PriorRow[]> {
  const [companyRows, legacyRows] = await Promise.all([
    companyIds.length > 0
      ? selectPriors(db, "company_id", companyIds)
      : Promise.resolve([]),
    shopNames.length > 0
      ? selectPriors(db, "shop_name", shopNames)
      : Promise.resolve([]),
  ]);

  const deduped = new Map<string, PriorRow>();
  for (const row of [...companyRows, ...legacyRows]) {
    deduped.set(
      row.id ??
        `${row.company_id ?? ""}:${row.shop_name ?? ""}:${row.piece_code}:${row.ab_variant}`,
      row
    );
  }
  return [...deduped.values()];
}

async function selectPriors(
  db: SupabaseClient,
  scopeColumn: "company_id" | "shop_name",
  scopeValues: string[]
): Promise<PriorRow[]> {
  const { data, error } = await db
    .from("mail_send_priors")
    .select(
      "id,company_id,shop_name,piece_code,ab_variant,n_sent,n_outcome,outcome_rate,computed_at"
    )
    .in(scopeColumn, scopeValues)
    .order("computed_at", { ascending: false })
    .limit(10000);

  if (error) throw new Error(`selectPriors failed: ${error.message}`);
  return (data ?? []) as PriorRow[];
}

function summarizePriors(priorRows: PriorRow[]): DirectMailPieceSummary[] {
  const pieces = new Map<string, DirectMailPieceSummary>();
  for (const row of priorRows) {
    const pieceCode = normalizePiece(row.piece_code);
    if (!pieceCode) continue;
    const variant = normalizeVariant(row.ab_variant);
    const key = pieceKey(pieceCode, variant);
    const current = pieces.get(key) ?? newPiece(pieceCode, variant);
    current.sent += toFiniteNumber(row.n_sent);
    current.outcomes += toFiniteNumber(row.n_outcome);
    pieces.set(key, current);
  }

  return [...pieces.values()].map((piece) => ({
    ...piece,
    outcomeRate: piece.sent > 0 ? piece.outcomes / piece.sent : null,
  }));
}

function pickMostSent(rows: DirectMailPieceSummary[]): DirectMailPieceSummary | null {
  if (rows.length === 0) return null;
  return rows.sort(bySentThenPiece)[0];
}

function pickBestOutcomePiece(
  rows: DirectMailPieceSummary[]
): DirectMailPieceSummary | null {
  const candidates = rows.filter(
    (row) => row.sent >= MIN_RESULT_SENDS && row.outcomeRate !== null
  );
  if (candidates.length === 0) return null;
  return candidates.sort(
    (a, b) =>
      (b.outcomeRate ?? 0) - (a.outcomeRate ?? 0) ||
      b.outcomes - a.outcomes ||
      b.sent - a.sent ||
      a.pieceCode.localeCompare(b.pieceCode)
  )[0];
}

function bySentThenPiece(a: DirectMailPieceSummary, b: DirectMailPieceSummary): number {
  return b.sent - a.sent || a.pieceCode.localeCompare(b.pieceCode);
}

function newPiece(pieceCode: string, variant: string | null): DirectMailPieceSummary {
  return {
    pieceCode,
    label: PIECE_LABELS[pieceCode] ?? `Piece ${pieceCode}`,
    variant,
    sent: 0,
    outcomes: 0,
    outcomeRate: null,
  };
}

function pieceKey(pieceCode: string, variant: string | null): string {
  return `${pieceCode}\u0000${variant ?? ""}`;
}

function resultMessage(status: DirectMailResultStatus, totalPriorSent: number): string | null {
  if (status === "ready") return null;
  if (status === "insufficient_data") {
    return `Not enough mailed pieces yet. Results need at least ${MIN_RESULT_SENDS} historical sends; this scope has ${totalPriorSent}.`;
  }
  return "Direct-mail results are waiting on shop-scoped mined send-history outcomes.";
}

function normalizePiece(value: string | null): string {
  return value?.trim() ?? "";
}

function normalizeVariant(value: string | null): string | null {
  const trimmed = value?.trim();
  return trimmed ? trimmed : null;
}

function normalizeKey(value: string | null | undefined): string | null {
  const trimmed = value?.trim();
  return trimmed ? trimmed : null;
}

function normalizeDate(value: string | null): string | null {
  const trimmed = value?.trim();
  return trimmed ? trimmed.slice(0, 10) : null;
}

function normalizeDateTime(value: string | null | undefined): string | null {
  const trimmed = value?.trim();
  return trimmed || null;
}

function toFiniteNumber(value: number | string | null): number {
  const n = typeof value === "string" ? Number(value) : value;
  return typeof n === "number" && Number.isFinite(n) ? n : 0;
}

function maxString(values: Array<string | null>): string | null {
  return values.filter((value): value is string => Boolean(value)).sort().at(-1) ?? null;
}

function uniqueStrings(values: string[]): string[] {
  return [...new Set(values.map((s) => s.trim()).filter(Boolean))];
}
