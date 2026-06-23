// v1.4 / PSG-46 — Operational Reports: live (B1-backed) data functions for the
// Volume & Invoicing batch. All five reports are wired here.
//
//   • reprint-recap — production re-prints, grouped by shop × batch × reason.
//     Source: public.production_reprint_log → production_documents →
//     production_batches / companies (PSG-27 production module,
//     20260618180001_production_module_v1_3).
//
//   • audit — line-level reconciliation listing of repair_orders in the period:
//     RO #, shop, pay type, amount, status, closed date.
//
//   • processing-recap — per-shop RO volume + processed dollars (ROs opened, ROs
//     closed, summed invoiced $).
//
//   • invoicing-recap — per-shop × pay-type invoiced totals: invoice count,
//     invoiced $, average ticket.
//
//   • recap-trailing — per-shop invoiced $ over a 3-month trailing window
//     (2-months-ago, last-month, current) anchored on the period end, with MoM %.
//
// The four repair_orders-backed reports read the CANONICAL invoiced-$ + pay-type
// columns landed by PSG-352 (20260624160000_repair_orders_amount_paytype):
//   repair_orders.repair_amount_cents  — integer cents, NULL = unknown (never 0)
//   repair_orders.pay_type             — 'insurance'|'customer'|'internal'|'warranty', NULL = unknown
// populated for every import source by the importer (src/lib/ops/import) +
// backfilled from the old payloads. HONEST SOURCING is preserved end-to-end: a
// NULL amount is excluded from a sum (never counted as $0), and a group with no
// known amounts reports null rather than a fabricated $0; an unknown pay type
// buckets under "—" rather than a wrong bucket.
//
// Shape mirrors live/survey.ts: build the PostgREST query (date/shop scoped),
// fetch every row via fetchAllRows (past the 1000-row cap, PSG-354/PSG-360),
// then aggregate in JS so the path is unit-testable against a plain stub db.
// Shop filtering matches the surveys-API convention: the `shopId` filter value is
// matched case-insensitively against the resolved company name. ctx.shopIds
// (staff shop scope) is honored when non-null by scoping on
// repair_orders.company_id (the RO → companies FK); it is null on every call
// today (the route passes null), so this is forward-compatible.

import type { ReportContext, ReportParams, ReportRow } from "../types";
import { fetchAllRows } from "./paginate";

const YMD = /^\d{4}-\d{2}-\d{2}$/;
const YM = /^\d{4}-\d{2}$/;

/** Round to 2 decimal places (currency). */
function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

/** Round to 1 decimal place (percent). */
function round1(n: number): number {
  return Math.round(n * 10) / 10;
}

/** Canonical integer cents → dollars (2dp), or null for a NULL/non-finite amount.
 *  Never coerces a missing amount to 0 — honest sourcing (PSG-352). */
function centsToDollars(v: number | string | null | undefined): number | null {
  if (v == null) return null;
  const n = typeof v === "string" ? Number(v) : v;
  return Number.isFinite(n) ? round2((n as number) / 100) : null;
}

/** Case-insensitive substring match, mirroring the surveys API `ilike` filter. */
function shopMatches(shopName: string | null, needle: string): boolean {
  return (shopName ?? "").toLowerCase().includes(needle.toLowerCase());
}

/** PostgREST embeds a to-one relation as an object and a to-many as an array. */
function first<T>(v: T | T[] | null | undefined): T | null {
  if (v == null) return null;
  return Array.isArray(v) ? (v.length ? v[0] : null) : v;
}

/** First 10 chars (YYYY-MM-DD) of an ISO/date string, or null. */
function dateOnly(ts: string | null | undefined): string | null {
  if (typeof ts !== "string" || ts.length < 10) return null;
  const ymd = ts.slice(0, 10);
  return YMD.test(ymd) ? ymd : null;
}

type NamedRef = { name: string | null };

// ───────────────────────────── reprint-recap ─────────────────────────────

type ReprintDocRef = {
  company_id?: string | null;
  companies: NamedRef | NamedRef[] | null;
  production_batches: NamedRef | NamedRef[] | null;
};
type ReprintLogRow = {
  reason: string | null;
  reprinted_at: string | null;
  production_documents: ReprintDocRef | ReprintDocRef[] | null;
};

const REPRINT_SELECT =
  "reason, reprinted_at, " +
  "production_documents(company_id, companies(name), production_batches(name))";

/**
 * Re-Print Recap — production re-prints in the period, grouped by shop ×
 * original batch × reprint reason, with a count and the most-recent reprint
 * date for each group. Scoped by reprinted_at over [start, end]; shop filter
 * matched in JS against the resolved company name. Sorted by shop, then batch,
 * then reason (deterministic).
 */
export async function reprintRecapRun(
  params: ReportParams,
  ctx: ReportContext,
): Promise<ReportRow[]> {
  if (!ctx.db) throw new Error("reprintRecapRun requires a db context");

  const data = await fetchAllRows<ReprintLogRow>(() => {
    let query = ctx.db!.from("production_reprint_log").select(REPRINT_SELECT);
    if (params.start && YMD.test(params.start)) {
      query = query.gte("reprinted_at", params.start);
    }
    if (params.end && YMD.test(params.end)) {
      query = query.lte("reprinted_at", `${params.end}T23:59:59.999Z`);
    }
    return query;
  });

  const shopFilter = params.filters.shopId?.trim();
  const scope = ctx.shopIds; // company_id allow-list, or null for all shops

  type Group = {
    shop: string;
    batch: string;
    reason: string;
    count: number;
    latest: string | null;
  };
  const groups = new Map<string, Group>();

  for (const r of data) {
    const doc = first(r.production_documents);
    if (scope && !scope.includes(doc?.company_id ?? "")) continue;
    const shop = (first(doc?.companies)?.name ?? "—").trim() || "—";
    if (shopFilter && !shopMatches(shop, shopFilter)) continue;
    const batch = (first(doc?.production_batches)?.name ?? "—").trim() || "—";
    const reason = (r.reason ?? "").trim() || "—";
    const date = dateOnly(r.reprinted_at);

    const key = `${shop.toLowerCase()}|${batch.toLowerCase()}|${reason.toLowerCase()}`;
    let g = groups.get(key);
    if (!g) {
      g = { shop, batch, reason, count: 0, latest: null };
      groups.set(key, g);
    }
    g.count += 1;
    if (date && (g.latest === null || date > g.latest)) g.latest = date;
  }

  return Array.from(groups.values())
    .sort(
      (a, b) =>
        a.shop.localeCompare(b.shop) ||
        a.batch.localeCompare(b.batch) ||
        a.reason.localeCompare(b.reason),
    )
    .map((g) => ({
      shop: g.shop,
      batch: g.batch,
      reason: g.reason,
      count: g.count,
      date: g.latest,
    }));
}

// ──────────────────── repair_orders canonical row shape ───────────────────

type RepairOrderRow = {
  ro_number: string | null;
  status: string | null;
  dates_json: Record<string, unknown> | null;
  repair_amount_cents: number | string | null;
  pay_type: string | null;
  created_at: string | null;
  companies: NamedRef | NamedRef[] | null;
};

/** Build a repair_orders query scoped by created_at over [start,end] + the
 *  staff shop scope (company_id IN ctx.shopIds when non-null). The selected
 *  columns vary per report, so the caller passes the select string. */
function repairOrdersQuery(
  select: string,
  params: ReportParams,
  ctx: ReportContext,
  range?: { gte?: string; lteEndOfDay?: string },
) {
  let query = ctx.db!.from("repair_orders").select(select);
  const gte = range?.gte ?? (params.start && YMD.test(params.start) ? params.start : null);
  const lte = range?.lteEndOfDay ?? (params.end && YMD.test(params.end) ? params.end : null);
  if (gte) query = query.gte("created_at", gte);
  if (lte) query = query.lte("created_at", `${lte}T23:59:59.999Z`);
  if (ctx.shopIds) query = query.in("company_id", ctx.shopIds);
  return query;
}

/** Resolve the display shop name from an embedded companies relation. */
function shopName(row: { companies: NamedRef | NamedRef[] | null }): string {
  return (first(row.companies)?.name ?? "—").trim() || "—";
}

// ───────────────────────────────── audit ─────────────────────────────────

const AUDIT_SELECT =
  "ro_number, status, dates_json, repair_amount_cents, pay_type, created_at, companies(name)";

/** Title-case a known RO status; pass through anything unexpected verbatim. */
function statusLabel(status: string | null): string {
  const s = (status ?? "").trim();
  if (!s) return "—";
  return s.charAt(0).toUpperCase() + s.slice(1);
}

/** The RO's reconciliation date: closed/delivered date_out if present, else the
 *  created_at day (the documented proxy — repair_orders has no flat close date). */
function auditDate(row: RepairOrderRow): string | null {
  const dates = row.dates_json;
  const dout =
    dates && typeof dates.date_out === "string" ? (dates.date_out as string) : null;
  if (dout && YMD.test(dout)) return dout;
  return dateOnly(row.created_at);
}

/**
 * Audit — a line-level reconciliation listing of repair_orders in the period:
 * RO #, shop, pay type, amount, status and closed date. RO #/shop/status/date
 * are off the spine; pay type + amount are the canonical repair_orders columns
 * (PSG-352), left blank ("—" / null) when unknown — honest "not recorded", never
 * a fabricated figure, and identical to what the aggregation reports sum. Scoped
 * by created_at over [start, end] (the available timestamp; the same proxy
 * live/survey.ts uses). Honors the shop filter (company name) and the pay-type
 * filter (exact bucket — rows with no recorded pay type drop when it is set).
 * Sorted newest date first, then RO #.
 */
export async function auditRun(
  params: ReportParams,
  ctx: ReportContext,
): Promise<ReportRow[]> {
  if (!ctx.db) throw new Error("auditRun requires a db context");

  const data = await fetchAllRows<RepairOrderRow>(() =>
    repairOrdersQuery(AUDIT_SELECT, params, ctx),
  );

  const shopFilter = params.filters.shopId?.trim();
  const payFilter = params.filters.payType?.trim().toLowerCase();

  const rows: (ReportRow & { _date: string; _ro: string })[] = [];
  for (const r of data) {
    const shop = shopName(r);
    if (shopFilter && !shopMatches(shop, shopFilter)) continue;

    const payType = (r.pay_type ?? "").trim() || null;
    if (payFilter && (payType ?? "").toLowerCase() !== payFilter) continue;

    const date = auditDate(r);
    const ro = (r.ro_number ?? "—").trim() || "—";
    rows.push({
      ro,
      shop,
      payType: payType ?? "—",
      amount: centsToDollars(r.repair_amount_cents),
      status: statusLabel(r.status),
      date,
      _date: date ?? "",
      _ro: ro,
    });
  }

  rows.sort((a, b) => b._date.localeCompare(a._date) || a._ro.localeCompare(b._ro));
  return rows.map(({ _date, _ro, ...row }) => row);
}

// ──────────────────────────── processing-recap ────────────────────────────

const PROCESSING_SELECT =
  "status, repair_amount_cents, created_at, companies(name)";

/**
 * Processing Recap — per-shop RO processing volume over the period: ROs opened
 * (every RO created in the window), ROs closed (those now in status 'closed'),
 * and processed dollars (the sum of recorded invoiced amounts). `processed` is
 * the sum of the canonical repair_amount_cents over ROs that have one; a shop
 * with ROs but no recorded amounts reports null (honest), not $0. Scoped by
 * created_at over [start, end]; shop filter matched in JS. Sorted by shop asc.
 */
export async function processingRecapRun(
  params: ReportParams,
  ctx: ReportContext,
): Promise<ReportRow[]> {
  if (!ctx.db) throw new Error("processingRecapRun requires a db context");

  const data = await fetchAllRows<RepairOrderRow>(() =>
    repairOrdersQuery(PROCESSING_SELECT, params, ctx),
  );

  const shopFilter = params.filters.shopId?.trim();

  type Group = {
    shop: string;
    opened: number;
    closed: number;
    cents: number;
    known: number;
  };
  const groups = new Map<string, Group>();

  for (const r of data) {
    const shop = shopName(r);
    if (shopFilter && !shopMatches(shop, shopFilter)) continue;

    const key = shop.toLowerCase();
    let g = groups.get(key);
    if (!g) {
      g = { shop, opened: 0, closed: 0, cents: 0, known: 0 };
      groups.set(key, g);
    }
    g.opened += 1;
    if ((r.status ?? "").trim().toLowerCase() === "closed") g.closed += 1;
    const c = centsToDollars(r.repair_amount_cents);
    if (c !== null) {
      g.cents += c;
      g.known += 1;
    }
  }

  return Array.from(groups.values())
    .sort((a, b) => a.shop.localeCompare(b.shop))
    .map((g) => ({
      shop: g.shop,
      opened: g.opened,
      closed: g.closed,
      processed: g.known > 0 ? round2(g.cents) : null,
    }));
}

// ──────────────────────────── invoicing-recap ─────────────────────────────

const INVOICING_SELECT =
  "repair_amount_cents, pay_type, created_at, companies(name)";

/**
 * Monthly Processing Invoicing Recap — per-shop × pay-type invoiced totals over
 * the period: invoice count (ROs in the bucket), invoiced $ (sum of recorded
 * amounts), and average ticket (mean of the recorded amounts — averaged over the
 * invoices that actually carry an amount, so amount-less ROs never deflate it).
 * Pay type is the canonical bucket; ROs with no recorded pay type bucket under
 * "—" so the column totals reconcile with processing-recap. Honors the pay-type
 * filter (exact bucket) and shop filter. Sorted by shop, then pay type.
 */
export async function invoicingRecapRun(
  params: ReportParams,
  ctx: ReportContext,
): Promise<ReportRow[]> {
  if (!ctx.db) throw new Error("invoicingRecapRun requires a db context");

  const data = await fetchAllRows<RepairOrderRow>(() =>
    repairOrdersQuery(INVOICING_SELECT, params, ctx),
  );

  const shopFilter = params.filters.shopId?.trim();
  const payFilter = params.filters.payType?.trim().toLowerCase();

  type Group = {
    shop: string;
    payType: string; // display label ("insurance" … or "—")
    invoices: number;
    cents: number;
    known: number;
  };
  const groups = new Map<string, Group>();

  for (const r of data) {
    const shop = shopName(r);
    if (shopFilter && !shopMatches(shop, shopFilter)) continue;

    const payType = (r.pay_type ?? "").trim() || null;
    if (payFilter && (payType ?? "").toLowerCase() !== payFilter) continue;
    const payLabel = payType ?? "—";

    const key = `${shop.toLowerCase()}|${payLabel.toLowerCase()}`;
    let g = groups.get(key);
    if (!g) {
      g = { shop, payType: payLabel, invoices: 0, cents: 0, known: 0 };
      groups.set(key, g);
    }
    g.invoices += 1;
    const c = centsToDollars(r.repair_amount_cents);
    if (c !== null) {
      g.cents += c;
      g.known += 1;
    }
  }

  return Array.from(groups.values())
    .sort(
      (a, b) =>
        a.shop.localeCompare(b.shop) || a.payType.localeCompare(b.payType),
    )
    .map((g) => ({
      shop: g.shop,
      payType: g.payType,
      invoices: g.invoices,
      amount: g.known > 0 ? round2(g.cents) : null,
      avgTicket: g.known > 0 ? round2(g.cents / g.known) : null,
    }));
}

// ──────────────────────────── recap-trailing ──────────────────────────────

/** Parse "YYYY-MM" → {year, month1to12}, or null. */
function parseYM(ym: string): { y: number; m: number } | null {
  if (!YM.test(ym)) return null;
  const y = Number(ym.slice(0, 4));
  const m = Number(ym.slice(5, 7));
  if (m < 1 || m > 12) return null;
  return { y, m };
}

/** Shift a "YYYY-MM" by `delta` months (delta may be negative). */
function addMonths(ym: string, delta: number): string {
  const p = parseYM(ym)!;
  const zero = p.y * 12 + (p.m - 1) + delta; // months since year 0
  const y = Math.floor(zero / 12);
  const m = (zero % 12) + 1;
  return `${String(y).padStart(4, "0")}-${String(m).padStart(2, "0")}`;
}

/** Last calendar day of a "YYYY-MM" as "YYYY-MM-DD" (UTC). */
function monthLastDay(ym: string): string {
  const p = parseYM(ym)!;
  const day = new Date(Date.UTC(p.y, p.m, 0)).getUTCDate(); // day 0 of next month
  return `${ym}-${String(day).padStart(2, "0")}`;
}

const TRAILING_SELECT = "repair_amount_cents, created_at, companies(name)";

/**
 * Recap (Trailing 2 mo + Current) — per-shop invoiced $ for three consecutive
 * months: 2-months-ago, last-month and the current month, with the MoM % change
 * (current vs last). The 3-month window is the report's own definition, anchored
 * on the period END month (falling back to the start month); params.start is not
 * used as a lower bound. Each cell is the sum of recorded invoiced amounts that
 * month (null when that shop-month has no recorded amount — honest, not $0). MoM
 * trend is null when last-month is null or zero. Sorted by shop asc. Returns no
 * rows when neither end nor start is a usable date (no anchor).
 */
export async function recapTrailingRun(
  params: ReportParams,
  ctx: ReportContext,
): Promise<ReportRow[]> {
  if (!ctx.db) throw new Error("recapTrailingRun requires a db context");

  const anchorDate = (params.end ?? params.start ?? "").trim();
  if (!YMD.test(anchorDate)) return [];
  const current = anchorDate.slice(0, 7); // YYYY-MM
  const m1 = addMonths(current, -1);
  const m2 = addMonths(current, -2);

  const data = await fetchAllRows<RepairOrderRow>(() =>
    repairOrdersQuery(TRAILING_SELECT, params, ctx, {
      gte: `${m2}-01`,
      lteEndOfDay: monthLastDay(current),
    }),
  );

  const shopFilter = params.filters.shopId?.trim();

  type Group = {
    shop: string;
    sums: Record<string, number>; // month -> dollars
    known: Record<string, number>; // month -> count of known amounts
  };
  const groups = new Map<string, Group>();
  const months = [m2, m1, current];

  for (const r of data) {
    const shop = shopName(r);
    if (shopFilter && !shopMatches(shop, shopFilter)) continue;
    const day = dateOnly(r.created_at);
    if (!day) continue;
    const month = day.slice(0, 7);
    if (!months.includes(month)) continue;

    const key = shop.toLowerCase();
    let g = groups.get(key);
    if (!g) {
      g = { shop, sums: {}, known: {} };
      groups.set(key, g);
    }
    const c = centsToDollars(r.repair_amount_cents);
    if (c !== null) {
      g.sums[month] = (g.sums[month] ?? 0) + c;
      g.known[month] = (g.known[month] ?? 0) + 1;
    }
  }

  const cell = (g: Group, month: string): number | null =>
    (g.known[month] ?? 0) > 0 ? round2(g.sums[month]) : null;

  return Array.from(groups.values())
    .sort((a, b) => a.shop.localeCompare(b.shop))
    .map((g) => {
      const v2 = cell(g, m2);
      const v1 = cell(g, m1);
      const vc = cell(g, current);
      const trend =
        v1 === null || v1 === 0 || vc === null
          ? null
          : round1(((vc - v1) / v1) * 100);
      return { shop: g.shop, m2: v2, m1: v1, current: vc, trend };
    });
}
