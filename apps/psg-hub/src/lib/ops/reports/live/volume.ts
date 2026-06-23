// v1.4 / PSG-46 — Operational Reports: live (B1-backed) data functions for the
// Volume & Invoicing batch.
//
// Two of the five Volume/Invoicing reports have a complete, honest real source
// on the tables that have landed and are wired here:
//
//   • reprint-recap — production re-prints, grouped by shop × batch × reason.
//     Source: public.production_reprint_log → production_documents →
//     production_batches / companies (PSG-27 production module,
//     20260618180001_production_module_v1_3). Fully sourced.
//
//   • audit — a line-level reconciliation listing of repair_orders in the
//     period: RO #, shop, pay type, amount, status, closed date. RO #, shop,
//     status and date come straight off the spine (PSG-25); pay type and amount
//     are read from repair_orders.payload_jsonb where the import source recorded
//     them (CCC/BMS writes "bms.totals.grandTotal"; Advantage2.0 writes
//     advantage2.payType) and are left blank otherwise — the truthful "not
//     recorded for this RO" an auditor needs, never a fabricated figure.
//
// The other three Volume/Invoicing reports (processing-recap, invoicing-recap,
// recap-trailing) are dollar-AGGREGATION reports: their headline columns are
// summed/averaged invoiced dollars (and, for invoicing-recap, a shop × pay-type
// cross-tab). repair_orders carries no canonical invoiced-$ column today and the
// per-source payload figures are sparse and disjoint (amount only on CCC rows,
// pay type only on Advantage2.0 rows — they never co-occur), so summing them
// would render a misleading $0 for the majority of real ROs. They stay
// pending-data until the invoicing data model lands; see PSG-46 / its follow-up.
//
// Shape mirrors live/survey.ts exactly: build the PostgREST query (date/shop
// scoped), then aggregate over real rows in JS so the path is unit-testable
// against a plain stub db. Shop filtering matches the surveys-API convention:
// the `shopId` filter value is matched case-insensitively against the resolved
// company name. ctx.shopIds (staff shop scope) is honored when non-null by
// scoping on repair_orders.company_id (the RO → companies FK); it is null on
// every call today (the route passes null), so this is forward-compatible.

import type { ReportContext, ReportParams, ReportRow } from "../types";

const YMD = /^\d{4}-\d{2}-\d{2}$/;

/** Coerce a numeric|string|null cell to a finite number, or null. */
function num(v: number | string | null | undefined): number | null {
  if (v == null) return null;
  const n = typeof v === "string" ? Number(v) : v;
  return typeof n === "number" && Number.isFinite(n) ? n : null;
}

/** Round to 2 decimal places (currency). */
function round2(n: number): number {
  return Math.round(n * 100) / 100;
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

// ───────────────────────────── reprint-recap ─────────────────────────────

type NamedRef = { name: string | null };
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

/** First 10 chars (YYYY-MM-DD) of an ISO/date string, or null. */
function dateOnly(ts: string | null | undefined): string | null {
  if (typeof ts !== "string" || ts.length < 10) return null;
  const ymd = ts.slice(0, 10);
  return YMD.test(ymd) ? ymd : null;
}

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

  let query = ctx.db.from("production_reprint_log").select(REPRINT_SELECT);
  if (params.start && YMD.test(params.start)) {
    query = query.gte("reprinted_at", params.start);
  }
  if (params.end && YMD.test(params.end)) {
    query = query.lte("reprinted_at", `${params.end}T23:59:59.999Z`);
  }

  const { data, error } = (await query) as {
    data: ReprintLogRow[] | null;
    error: { message: string } | null;
  };
  if (error) throw new Error(error.message);

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

  for (const r of data ?? []) {
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

// ───────────────────────────────── audit ─────────────────────────────────

type RoPayload = {
  // CCC/BMS importer writes the RO grand total under this literal dotted key
  // (see src/lib/ccc-secure-share/bms/index.ts bmsRepairOrderPayloadJsonb).
  "bms.totals.grandTotal"?: number | string | null;
  // Advantage2.0 importer writes pay type under advantage2.payType
  // (see src/lib/ops/import/data/advantage2-profile.ts).
  advantage2?: { payType?: string | null } | null;
} | null;

type AuditRoRow = {
  ro_number: string | null;
  status: string | null;
  dates_json: Record<string, unknown> | null;
  payload_jsonb: RoPayload;
  created_at: string | null;
  companies: NamedRef | NamedRef[] | null;
};

const AUDIT_SELECT =
  "ro_number, status, dates_json, payload_jsonb, created_at, companies(name)";

/** Title-case a known RO status; pass through anything unexpected verbatim. */
function statusLabel(status: string | null): string {
  const s = (status ?? "").trim();
  if (!s) return "—";
  return s.charAt(0).toUpperCase() + s.slice(1);
}

/** The RO's reconciliation date: closed/delivered date_out if present, else the
 *  created_at day (the documented proxy — repair_orders has no flat close date). */
function auditDate(row: AuditRoRow): string | null {
  const dates = row.dates_json;
  const dout =
    dates && typeof dates.date_out === "string" ? (dates.date_out as string) : null;
  if (dout && YMD.test(dout)) return dout;
  return dateOnly(row.created_at);
}

/** Pay type recorded on the RO (Advantage2.0 overflow), or null. */
function payTypeOf(payload: RoPayload): string | null {
  const pt = payload?.advantage2?.payType;
  const s = typeof pt === "string" ? pt.trim() : "";
  return s || null;
}

/** Repair amount recorded on the RO (CCC/BMS grand total), or null. */
function amountOf(payload: RoPayload): number | null {
  const v = num(payload?.["bms.totals.grandTotal"]);
  return v === null ? null : round2(v);
}

/**
 * Audit — a line-level reconciliation listing of repair_orders in the period:
 * RO #, shop, pay type, amount, status and closed date. RO #/shop/status/date
 * are off the spine; pay type and amount are read from payload_jsonb where the
 * import source recorded them, and left blank ("—" / null) otherwise — honest
 * "not recorded", never a fabricated figure. Scoped by created_at over
 * [start, end] (the available timestamp; the same proxy live/survey.ts uses).
 * Honors the shop filter (company name) and the pay-type filter (exact, case-
 * insensitive — rows with no recorded pay type drop when that filter is set).
 * Sorted newest date first, then RO #.
 */
export async function auditRun(
  params: ReportParams,
  ctx: ReportContext,
): Promise<ReportRow[]> {
  if (!ctx.db) throw new Error("auditRun requires a db context");

  let query = ctx.db.from("repair_orders").select(AUDIT_SELECT);
  if (params.start && YMD.test(params.start)) {
    query = query.gte("created_at", params.start);
  }
  if (params.end && YMD.test(params.end)) {
    query = query.lte("created_at", `${params.end}T23:59:59.999Z`);
  }
  if (ctx.shopIds) {
    query = query.in("company_id", ctx.shopIds);
  }

  const { data, error } = (await query) as {
    data: AuditRoRow[] | null;
    error: { message: string } | null;
  };
  if (error) throw new Error(error.message);

  const shopFilter = params.filters.shopId?.trim();
  const payFilter = params.filters.payType?.trim().toLowerCase();

  const rows: (ReportRow & { _date: string; _ro: string })[] = [];
  for (const r of data ?? []) {
    const shop = (first(r.companies)?.name ?? "—").trim() || "—";
    if (shopFilter && !shopMatches(shop, shopFilter)) continue;

    const payType = payTypeOf(r.payload_jsonb);
    if (payFilter && (payType ?? "").toLowerCase() !== payFilter) continue;

    const date = auditDate(r);
    const ro = (r.ro_number ?? "—").trim() || "—";
    rows.push({
      ro,
      shop,
      payType: payType ?? "—",
      amount: amountOf(r.payload_jsonb),
      status: statusLabel(r.status),
      date,
      _date: date ?? "",
      _ro: ro,
    });
  }

  rows.sort((a, b) => b._date.localeCompare(a._date) || a._ro.localeCompare(b._ro));
  return rows.map(({ _date, _ro, ...row }) => row);
}
