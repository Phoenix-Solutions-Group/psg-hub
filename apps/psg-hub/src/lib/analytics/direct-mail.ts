import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { createServiceClient } from "@/lib/supabase/service";
import letterLibrary from "../../../../../docs/ops/mail/letter-library.json";

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

const FALLBACK_PIECE_LABELS: Record<string, string> = {
  postcard: "Postcard",
  letter: "Letter",
  self_mailer: "Self-mailer",
};

type LetterLibraryPiece = {
  piece_code?: string;
  name?: string;
};

const PIECE_LABELS: Record<string, string> = Object.fromEntries(
  ((letterLibrary as { pieces?: LetterLibraryPiece[] }).pieces ?? []).flatMap(
    (piece): Array<[string, string]> => {
      const code = piece.piece_code?.trim();
      const name = piece.name?.trim();
      return code && name ? [[code, name]] : [];
    }
  )
);

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

type RepairOrderAmountRow = {
  company_id?: string | null;
  repair_amount_cents: number | string | null;
};

type CompanyProgramAmountRow = {
  company_id?: string | null;
  quantity: number | string | null;
  unit_price_cents: number | string | null;
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
  monthlyTrend: DirectMailMonthlyResultTrendPoint[];
  lastUpdatedAt: string | null;
  message: string | null;
};

export type DirectMailMonthlyResultTrendPoint = {
  month: string;
  mailed: number;
  outcomes: number | null;
  outcomeRate: number | null;
  message: string | null;
};

export type DirectMailReachEstimate = {
  monthToDate: number;
  yearToDate: number;
  lifetime: number;
  multiplier: 3;
  label: string;
};

export type DirectMailPostRepairSalesShare = {
  status: "ready" | "unavailable";
  repairSalesCents: number | null;
  overallShopSalesCents: number | null;
  share: number | null;
  message: string | null;
};

export type DirectMailActivity = {
  lettersMailed: number;
  lettersMailedMonthToDate: number;
  lettersMailedYearToDate: number;
  lettersMailedLifetime: number;
  estimatedReferralReach: DirectMailReachEstimate;
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
  postRepairSalesShare: DirectMailPostRepairSalesShare;
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
    lettersMailedMonthToDate: 0,
    lettersMailedYearToDate: 0,
    lettersMailedLifetime: 0,
    estimatedReferralReach: {
      monthToDate: 0,
      yearToDate: 0,
      lifetime: 0,
      multiplier: 3,
      label: "Estimated reach: letters mailed x 3 people told",
    },
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
    monthlyTrend: [],
    lastUpdatedAt: null,
    message: "Direct-mail results are not available yet.",
  },
  postRepairSalesShare: {
    status: "unavailable",
    repairSalesCents: null,
    overallShopSalesCents: null,
    share: null,
    message:
      "Post-repair sales share is waiting on repair sales and package pricing.",
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

const RIVERSIDE_PREVIEW_DIRECT_MAIL_SYNC_DATE = "2026-08-05";

export function isDirectMailMetricsEmpty(metrics: DirectMailMetrics): boolean {
  return (
    metrics.activity.lettersMailedLifetime === 0 &&
    metrics.sources.sendHistoryRows === 0 &&
    metrics.sources.productionRows === 0 &&
    metrics.sources.resultRows === 0
  );
}

export function getRiversidePreviewDirectMailMetrics({
  shopId,
  from,
  to = null,
}: {
  shopId: string;
  from: string;
  to?: string | null;
}): DirectMailMetrics {
  return summarizeDirectMailMetrics({
    shopIds: [shopId],
    from,
    to,
    today: to ?? RIVERSIDE_PREVIEW_DIRECT_MAIL_SYNC_DATE,
    sendHistoryRows: [
      {
        piece_code: "07",
        piece_variant: "letter",
        sent_date: "2026-08-05",
        household_key: "riverside_preview_001",
        updated_at: `${RIVERSIDE_PREVIEW_DIRECT_MAIL_SYNC_DATE}T14:00:00.000Z`,
      },
      {
        piece_code: "07",
        piece_variant: "letter",
        sent_date: "2026-08-05",
        household_key: "riverside_preview_002",
        updated_at: `${RIVERSIDE_PREVIEW_DIRECT_MAIL_SYNC_DATE}T14:00:00.000Z`,
      },
      {
        piece_code: "10",
        piece_variant: "letter",
        sent_date: "2026-08-04",
        household_key: "riverside_preview_003",
        updated_at: `${RIVERSIDE_PREVIEW_DIRECT_MAIL_SYNC_DATE}T14:00:00.000Z`,
      },
      {
        piece_code: "14",
        piece_variant: "letter",
        sent_date: "2026-08-01",
        household_key: "riverside_preview_004",
        updated_at: `${RIVERSIDE_PREVIEW_DIRECT_MAIL_SYNC_DATE}T14:00:00.000Z`,
      },
    ],
    productionRows: [
      {
        piece_type: "postcard",
        status: "mailed",
        created_at: "2026-08-03T12:00:00.000Z",
        updated_at: `${RIVERSIDE_PREVIEW_DIRECT_MAIL_SYNC_DATE}T14:00:00.000Z`,
      },
    ],
    priorRows: [
      {
        piece_code: "07",
        ab_variant: "A",
        n_sent: 52,
        n_outcome: 11,
        outcome_rate: 11 / 52,
        computed_at: `${RIVERSIDE_PREVIEW_DIRECT_MAIL_SYNC_DATE}T14:00:00.000Z`,
      },
      {
        piece_code: "10",
        ab_variant: "B",
        n_sent: 44,
        n_outcome: 7,
        outcome_rate: 7 / 44,
        computed_at: `${RIVERSIDE_PREVIEW_DIRECT_MAIL_SYNC_DATE}T14:00:00.000Z`,
      },
    ],
    repairOrderAmountRows: [
      { repair_amount_cents: 428_000 },
      { repair_amount_cents: 386_000 },
      { repair_amount_cents: 512_000 },
    ],
    companyProgramAmountRows: [
      { quantity: 1, unit_price_cents: 3_200_000 },
    ],
  });
}

export function summarizeDirectMailMetrics({
  shopIds = [],
  from,
  to = null,
  sendHistoryRows,
  productionRows = [],
  priorRows = [],
  repairOrderAmountRows = [],
  companyProgramAmountRows = [],
  legacyNameFallbackUsed = false,
  today = new Date().toISOString().slice(0, 10),
}: {
  shopIds?: string[];
  from: string;
  to?: string | null;
  sendHistoryRows: SendHistoryRow[];
  productionRows?: ProductionRow[];
  priorRows?: PriorRow[];
  repairOrderAmountRows?: RepairOrderAmountRow[];
  companyProgramAmountRows?: CompanyProgramAmountRow[];
  legacyNameFallbackUsed?: boolean;
  today?: string;
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
  const rangeEvents = sentEvents.filter((row) => isWithinRange(row.sentDate, from, to));

  const pieces = new Map<string, DirectMailPieceSummary>();
  const recentByDate = new Map<string, Map<string, DirectMailPieceSummary>>();
  const households = new Set<string>();

  for (const row of rangeEvents) {
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
  const monthStart = today.slice(0, 7) + "-01";
  const yearStart = today.slice(0, 4) + "-01-01";
  const lettersMailedMonthToDate = countSentEvents(sentEvents, monthStart, today);
  const lettersMailedYearToDate = countSentEvents(sentEvents, yearStart, today);
  const lettersMailedLifetime = sentEvents.length;
  const salesShare = summarizePostRepairSalesShare({
    repairOrderAmountRows,
    companyProgramAmountRows,
  });
  const monthlyTrend = summarizeMonthlyResultTrend({
    sentEvents,
    resultStatus,
    priorRows,
  });

  const metrics: DirectMailMetrics = {
    shopIds: [...new Set(shopIds)],
    range: { from, to },
    activity: {
      lettersMailed: rangeEvents.length,
      lettersMailedMonthToDate,
      lettersMailedYearToDate,
      lettersMailedLifetime,
      estimatedReferralReach: {
        monthToDate: lettersMailedMonthToDate * 3,
        yearToDate: lettersMailedYearToDate * 3,
        lifetime: lettersMailedLifetime * 3,
        multiplier: 3,
        label: "Estimated reach: letters mailed x 3 people told",
      },
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
      monthlyTrend,
      lastUpdatedAt: resultStatus === "ready" ? latestPriorUpdate : null,
      message: resultMessage(resultStatus, totalPriorSent),
    },
    postRepairSalesShare: salesShare,
    sources: {
      sendHistoryRows: sendHistoryRows.length,
      productionRows: productionRows.length,
      resultRows: priorRows.length,
      legacyNameFallbackUsed,
    },
    privacy: { rawRecipientFieldsIncluded: false },
    totalSent: rangeEvents.length,
    recentSent: rangeEvents.length,
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
    getSendHistoryRows(db, { companyIds, shopNames: scopedNames, from: null, to }),
    getProductionRows(db, { companyIds, from: null, to }),
    getPriorRows(db, { companyIds, shopNames: scopedNames }),
  ]);
  const [repairOrderAmountRows, companyProgramAmountRows] = await Promise.all([
    getRepairOrderAmountRows(db, companyIds),
    getCompanyProgramAmountRows(db, companyIds),
  ]);

  return summarizeDirectMailMetrics({
    shopIds,
    from,
    to,
    sendHistoryRows,
    productionRows,
    priorRows,
    repairOrderAmountRows,
    companyProgramAmountRows,
    legacyNameFallbackUsed: scopedNames.length > 0,
    today: to ?? undefined,
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
    from: string | null;
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
  from: string | null,
  to: string | null
): Promise<SendHistoryRow[]> {
  let query = db
    .from("mail_send_history")
    .select("id,company_id,shop_name,piece_code,piece_variant,sent_date,household_key,updated_at")
    .in(scopeColumn, scopeValues);
  if (from) query = query.gte("sent_date", from);
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
    from: string | null;
    to: string | null;
  }
): Promise<ProductionRow[]> {
  if (companyIds.length === 0) return [];
  let query = db
    .from("production_documents")
    .select("id,company_id,piece_type,status,created_at,updated_at")
    .in("company_id", companyIds)
    .in("status", [...SENT_PRODUCTION_STATUSES]);
  if (from) query = query.gte("created_at", from);
  if (to) query = query.lte("created_at", to);

  const { data, error } = await query
    .order("created_at", { ascending: false })
    .limit(10000);
  if (error) throw new Error(`getProductionRows failed: ${error.message}`);
  return (data ?? []) as ProductionRow[];
}

async function getRepairOrderAmountRows(
  db: SupabaseClient,
  companyIds: string[]
): Promise<RepairOrderAmountRow[]> {
  if (companyIds.length === 0) return [];
  const { data, error } = await db
    .from("repair_orders")
    .select("company_id,repair_amount_cents")
    .in("company_id", companyIds)
    .not("repair_amount_cents", "is", null)
    .limit(10000);

  if (error) throw new Error(`getRepairOrderAmountRows failed: ${error.message}`);
  return (data ?? []) as RepairOrderAmountRow[];
}

async function getCompanyProgramAmountRows(
  db: SupabaseClient,
  companyIds: string[]
): Promise<CompanyProgramAmountRow[]> {
  if (companyIds.length === 0) return [];
  const { data, error } = await db
    .from("company_programs")
    .select("company_id,quantity,unit_price_cents")
    .in("company_id", companyIds)
    .gt("unit_price_cents", 0)
    .limit(10000);

  if (error) throw new Error(`getCompanyProgramAmountRows failed: ${error.message}`);
  return (data ?? []) as CompanyProgramAmountRow[];
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
    label: PIECE_LABELS[pieceCode] ?? FALLBACK_PIECE_LABELS[pieceCode] ?? `Piece ${pieceCode}`,
    variant,
    sent: 0,
    outcomes: 0,
    outcomeRate: null,
  };
}

function summarizeMonthlyResultTrend({
  sentEvents,
  resultStatus,
  priorRows,
}: {
  sentEvents: SentEvent[];
  resultStatus: DirectMailResultStatus;
  priorRows: PriorRow[];
}): DirectMailMonthlyResultTrendPoint[] {
  const byMonth = new Map<string, number>();
  for (const event of sentEvents) {
    const month = event.sentDate.slice(0, 7);
    byMonth.set(month, (byMonth.get(month) ?? 0) + 1);
  }

  const message =
    priorRows.length === 0
      ? "Monthly results are waiting on mined outcome history."
      : resultStatus === "ready"
        ? "Mined outcomes are available as an overall shop result; month-by-month outcomes need month-scoped mining."
        : "Monthly results are waiting on a larger mined outcome sample.";

  return [...byMonth.entries()]
    .sort(([a], [b]) => b.localeCompare(a))
    .slice(0, 12)
    .map(([month, mailed]) => ({
      month,
      mailed,
      outcomes: null,
      outcomeRate: null,
      message,
    }));
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

function summarizePostRepairSalesShare({
  repairOrderAmountRows,
  companyProgramAmountRows,
}: {
  repairOrderAmountRows: RepairOrderAmountRow[];
  companyProgramAmountRows: CompanyProgramAmountRow[];
}): DirectMailPostRepairSalesShare {
  const repairSalesCents = repairOrderAmountRows.reduce(
    (sum, row) => sum + Math.max(0, toFiniteNumber(row.repair_amount_cents)),
    0
  );
  const overallShopSalesCents = companyProgramAmountRows.reduce((sum, row) => {
    const unitPrice = Math.max(0, toFiniteNumber(row.unit_price_cents));
    const quantity = Math.max(0, toFiniteNumber(row.quantity));
    return sum + unitPrice * quantity;
  }, 0);

  const hasRepairSales = repairOrderAmountRows.length > 0 && repairSalesCents > 0;
  const hasOverallSales =
    companyProgramAmountRows.length > 0 && overallShopSalesCents > 0;

  if (!hasRepairSales || !hasOverallSales) {
    return {
      status: "unavailable",
      repairSalesCents: hasRepairSales ? repairSalesCents : null,
      overallShopSalesCents: hasOverallSales ? overallShopSalesCents : null,
      share: null,
      message:
        !hasRepairSales && !hasOverallSales
          ? "Post-repair sales share is waiting on repair sales and package pricing."
          : !hasRepairSales
            ? "Post-repair sales share is waiting on repair sales amounts."
            : "Post-repair sales share is waiting on package pricing.",
    };
  }

  return {
    status: "ready",
    repairSalesCents,
    overallShopSalesCents,
    share: repairSalesCents / overallShopSalesCents,
    message: null,
  };
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

function countSentEvents(events: SentEvent[], from: string, to: string | null): number {
  return events.filter((row) => isWithinRange(row.sentDate, from, to)).length;
}

function isWithinRange(value: string, from: string, to: string | null): boolean {
  return value >= from && (!to || value <= to);
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
