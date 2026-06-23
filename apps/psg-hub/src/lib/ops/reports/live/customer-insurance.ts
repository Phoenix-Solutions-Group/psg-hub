// v1.4 / PSG-28 — Operational Reports: live (B1-backed) data functions for the
// Customer & Insurance batch (PSG-48). Fast-follow to the Survey & CSI batch
// (PSG-80, ./survey.ts) — same "fetch rows → group in JS" shape, db-injected and
// unit-testable against a plain stub.
//
// All 8 reports read the v1.1 Ops Foundation spine (20260618170000_ops_foundation_v1_1):
//   repair_orders → companies (shop), vehicles (make/model),
//                   insurance_companies (insurer), insurance_agents (agent),
//                   repair_customers (customer name)
// fetched via PostgREST embedded selects (each is a single FK off repair_orders,
// so the embeds are unambiguous), then aggregated in JS.
//
// Honest-source notes (the discipline the framework documents — a column is wired
// only when it has a REAL source; otherwise it is null, never fabricated):
//
//   • Repair dollars (severity / amount / sales / claim $) come from
//     repair_orders.payload_jsonb["bms.totals.grandTotal"], the headline figure
//     the CCC Secure Share importer writes (src/lib/ccc-secure-share/bms). A
//     plain RO/estimate import writes only { source: "import" } with no total, so
//     grandTotal is present for CCC-sourced ROs and ABSENT otherwise. We sum/avg
//     over present values and yield null when a group has none (mirrors survey.ts
//     mean()=null) — a missing total never reads as $0.
//   • Pay type (pay-type-analysis) is derived from the spine: an RO with an
//     insurance_company_id is "Insurance", otherwise "Customer Pay". The legacy
//     "internal" / "warranty" pay types are not distinguishable on the spine yet,
//     so they are not invented. (public.payments is the Stripe PaymentIntent
//     mirror — a billing-side table keyed on shops, NOT repair pay types — so it
//     is intentionally NOT used here.)
//   • Referral category/source (referral-directory) is derived from the insurer/
//     agent edges the spine carries (Insurance Agent → agent, Insurance Company →
//     insurer, else Direct). A free-form per-customer referral field does not
//     exist on the spine.
//   • Supplement counts (claims-review) have no per-insurer source on the spine
//     (supplements live inside estimates.payload_jsonb["bms.supplements"], not
//     joinable to an insurer), so that column is null pending that edge.
//
// Period scoping uses repair_orders.created_at (the available indexed timestamp;
// the legacy RO has no flat business-date column — same proxy survey.ts uses for
// repair_order_employees). Staff scope: when ctx.shopIds is non-null it filters
// company_id IN (…) — repair_orders keys on companies.id, per the PSG-48 brief.
// The shop *filter* (params.filters.shopId) is matched case-insensitively against
// the resolved company name in JS (surveys-API convention), like rentalCarAnalysisRun.

import type { ReportContext, ReportParams, ReportRow } from "../types";
import { fetchAllRows } from "./paginate";

const YMD = /^\d{4}-\d{2}-\d{2}$/;

/** Coerce a numeric|string|null cell to a finite number, or null. */
function num(v: unknown): number | null {
  if (v == null) return null;
  const n = typeof v === "string" ? Number(v) : typeof v === "number" ? v : NaN;
  return Number.isFinite(n) ? n : null;
}

/** Average of the values, or null when the array is empty. */
function mean(values: number[]): number | null {
  if (values.length === 0) return null;
  return values.reduce((a, b) => a + b, 0) / values.length;
}

/** Sum of the values, or null when the array is empty (no real source). */
function sumOrNull(values: number[]): number | null {
  if (values.length === 0) return null;
  return values.reduce((a, b) => a + b, 0);
}

/** Round to whole dollars (currency columns). null passes through. */
function dollars(n: number | null): number | null {
  return n === null ? null : Math.round(n);
}

/** Round to 1 decimal place. */
function round1(n: number): number {
  return Math.round(n * 10) / 10;
}

/** Case-insensitive substring match, mirroring the surveys API `ilike` filter. */
function shopMatches(name: string | null, needle: string): boolean {
  return (name ?? "").toLowerCase().includes(needle.toLowerCase());
}

/** PostgREST embeds a to-one relation as an object (or array on some shapes). */
function first<T>(v: T | T[] | null | undefined): T | null {
  if (v == null) return null;
  return Array.isArray(v) ? (v.length ? v[0] : null) : v;
}

/** Trim a label to a non-empty string, or the placeholder "—". */
function label(v: string | null | undefined): string {
  return (v ?? "").trim() || "—";
}

type NamedRef = { name: string | null };
type VehicleRef = { make: string | null; model: string | null };
type CustomerRef = { first_name: string | null; last_name: string | null };

type RoRow = {
  created_at: string | null;
  total_loss_flag: boolean | null;
  insurance_company_id: string | null;
  insurance_agent_id: string | null;
  payload_jsonb: Record<string, unknown> | null;
  companies: NamedRef | NamedRef[] | null;
  vehicles: VehicleRef | VehicleRef[] | null;
  insurance_companies: NamedRef | NamedRef[] | null;
  insurance_agents: NamedRef | NamedRef[] | null;
  repair_customers: CustomerRef | CustomerRef[] | null;
};

const RO_SELECT =
  "created_at, total_loss_flag, insurance_company_id, insurance_agent_id, payload_jsonb, " +
  "companies(name), vehicles(make, model), insurance_companies(name), " +
  "insurance_agents(name), repair_customers(first_name, last_name)";

/**
 * Fetch repair_orders for the period with the spine embeds every Customer &
 * Insurance report needs. Date-scoped by created_at; company-scoped by
 * ctx.shopIds when present. The shop-name filter is applied by each report in JS.
 */
async function fetchRepairOrders(
  params: ReportParams,
  ctx: ReportContext,
): Promise<RoRow[]> {
  return fetchAllRows<RoRow>(() => {
    let query = ctx.db!.from("repair_orders").select(RO_SELECT);
    if (params.start && YMD.test(params.start)) {
      query = query.gte("created_at", params.start);
    }
    if (params.end && YMD.test(params.end)) {
      query = query.lte("created_at", `${params.end}T23:59:59.999Z`);
    }
    if (ctx.shopIds) {
      query = query.in("company_id", ctx.shopIds);
    }
    return query;
  });
}

// ── Per-RO resolved fields, computed once so each report reads the same view. ──

/** Headline repair dollars for an RO (CCC grandTotal), or null when absent. */
function grandTotal(ro: RoRow): number | null {
  return num(ro.payload_jsonb?.["bms.totals.grandTotal"]);
}
function shopName(ro: RoRow): string {
  return label(first(ro.companies)?.name);
}
function insurerName(ro: RoRow): string {
  return label(first(ro.insurance_companies)?.name);
}
function agentName(ro: RoRow): string {
  return label(first(ro.insurance_agents)?.name);
}
function customerName(ro: RoRow): string {
  const c = first(ro.repair_customers);
  const full = `${(c?.first_name ?? "").trim()} ${(c?.last_name ?? "").trim()}`.trim();
  return full || "—";
}
/** Created date as YYYY-MM-DD, or "" when unparseable. */
function createdYmd(ro: RoRow): string {
  const ca = typeof ro.created_at === "string" ? ro.created_at.slice(0, 10) : "";
  return YMD.test(ca) ? ca : "";
}

/** Apply the optional shop-name filter (case-insensitive) in JS. */
function withShopFilter(rows: RoRow[], params: ReportParams): RoRow[] {
  const shop = params.filters.shopId?.trim();
  if (!shop) return rows;
  return rows.filter((ro) => shopMatches(shopName(ro), shop));
}

function guard(ctx: ReportContext, name: string): void {
  if (!ctx.db) throw new Error(`${name} requires a db context`);
}

/**
 * Pay Type Analysis — RO count and dollars by pay type, with each pay type's
 * share of total dollars. Pay type is spine-derived: an RO carrying an insurer is
 * "Insurance", otherwise "Customer Pay". Amount = Σ grandTotal (null when a
 * bucket has no CCC total); share = amount ÷ total dollars. Sorted by pay type.
 */
export async function payTypeAnalysisRun(
  params: ReportParams,
  ctx: ReportContext,
): Promise<ReportRow[]> {
  guard(ctx, "payTypeAnalysisRun");
  const rows = withShopFilter(await fetchRepairOrders(params, ctx), params);

  const groups = new Map<string, { payType: string; ros: number; amounts: number[] }>();
  for (const ro of rows) {
    const payType = ro.insurance_company_id ? "Insurance" : "Customer Pay";
    let g = groups.get(payType);
    if (!g) {
      g = { payType, ros: 0, amounts: [] };
      groups.set(payType, g);
    }
    g.ros += 1;
    const t = grandTotal(ro);
    if (t !== null) g.amounts.push(t);
  }

  const built = Array.from(groups.values())
    .sort((a, b) => a.payType.localeCompare(b.payType))
    .map((g) => ({ payType: g.payType, ros: g.ros, amount: dollars(sumOrNull(g.amounts)) }));

  const total = built.reduce((s, r) => s + (r.amount ?? 0), 0);
  return built.map((r) => ({
    ...r,
    share: total > 0 && r.amount !== null ? round1((r.amount / total) * 100) : null,
  }));
}

/**
 * Vehicle Analysis (Make) — RO volume and average severity (avg grandTotal)
 * grouped by vehicle make. ROs without a decoded vehicle group under "—".
 * Sorted by make ascending.
 */
export async function vehicleAnalysisMakeRun(
  params: ReportParams,
  ctx: ReportContext,
): Promise<ReportRow[]> {
  guard(ctx, "vehicleAnalysisMakeRun");
  const rows = withShopFilter(await fetchRepairOrders(params, ctx), params);

  const groups = new Map<string, { make: string; ros: number; sev: number[] }>();
  for (const ro of rows) {
    const make = label(first(ro.vehicles)?.make);
    let g = groups.get(make);
    if (!g) {
      g = { make, ros: 0, sev: [] };
      groups.set(make, g);
    }
    g.ros += 1;
    const t = grandTotal(ro);
    if (t !== null) g.sev.push(t);
  }

  return Array.from(groups.values())
    .sort((a, b) => a.make.localeCompare(b.make))
    .map((g) => ({ make: g.make, ros: g.ros, avgSeverity: dollars(mean(g.sev)) }));
}

/**
 * Vehicle Analysis (Model) — RO volume and average severity grouped by
 * make + model. Sorted by make then model ascending.
 */
export async function vehicleAnalysisModelRun(
  params: ReportParams,
  ctx: ReportContext,
): Promise<ReportRow[]> {
  guard(ctx, "vehicleAnalysisModelRun");
  const rows = withShopFilter(await fetchRepairOrders(params, ctx), params);

  const groups = new Map<
    string,
    { make: string; model: string; ros: number; sev: number[] }
  >();
  for (const ro of rows) {
    const v = first(ro.vehicles);
    const make = label(v?.make);
    const model = label(v?.model);
    const key = `${make}|${model}`;
    let g = groups.get(key);
    if (!g) {
      g = { make, model, ros: 0, sev: [] };
      groups.set(key, g);
    }
    g.ros += 1;
    const t = grandTotal(ro);
    if (t !== null) g.sev.push(t);
  }

  return Array.from(groups.values())
    .sort((a, b) => a.make.localeCompare(b.make) || a.model.localeCompare(b.model))
    .map((g) => ({
      make: g.make,
      model: g.model,
      ros: g.ros,
      avgSeverity: dollars(mean(g.sev)),
    }));
}

/** Spine-derived referral attribution for an RO. */
function referralOf(ro: RoRow): { category: string; source: string } {
  if (ro.insurance_agent_id) {
    return { category: "Insurance Agent", source: agentName(ro) };
  }
  if (ro.insurance_company_id) {
    return { category: "Insurance Company", source: insurerName(ro) };
  }
  return { category: "Direct", source: "Direct" };
}

/**
 * Referral Directory by Category — referral sources grouped by category with RO
 * count and captured dollars (Σ grandTotal). Category/source are spine-derived
 * (see referralOf). Sorted by category then source ascending.
 */
export async function referralDirectoryRun(
  params: ReportParams,
  ctx: ReportContext,
): Promise<ReportRow[]> {
  guard(ctx, "referralDirectoryRun");
  const rows = withShopFilter(await fetchRepairOrders(params, ctx), params);

  const groups = new Map<
    string,
    { category: string; source: string; ros: number; amounts: number[] }
  >();
  for (const ro of rows) {
    const { category, source } = referralOf(ro);
    const key = `${category}|${source}`;
    let g = groups.get(key);
    if (!g) {
      g = { category, source, ros: 0, amounts: [] };
      groups.set(key, g);
    }
    g.ros += 1;
    const t = grandTotal(ro);
    if (t !== null) g.amounts.push(t);
  }

  return Array.from(groups.values())
    .sort(
      (a, b) =>
        a.category.localeCompare(b.category) || a.source.localeCompare(b.source),
    )
    .map((g) => ({
      category: g.category,
      source: g.source,
      ros: g.ros,
      amount: dollars(sumOrNull(g.amounts)),
    }));
}

/** Aggregate ROs that carry an insurance agent, grouped by agent name. */
type AgentGroup = {
  agent: string;
  insurer: string;
  earliest: string;
  ros: number;
  amounts: number[];
};
function groupByAgent(rows: RoRow[]): AgentGroup[] {
  const groups = new Map<string, AgentGroup>();
  for (const ro of rows) {
    if (!ro.insurance_agent_id) continue; // only agent-referred work
    const agent = agentName(ro);
    const date = createdYmd(ro);
    let g = groups.get(agent);
    if (!g) {
      g = { agent, insurer: insurerName(ro), earliest: date || "9999-12-31", ros: 0, amounts: [] };
      groups.set(agent, g);
    }
    g.ros += 1;
    // Carry the insurer + firstSeen from the earliest RO for this agent.
    if (date && date < g.earliest) {
      g.earliest = date;
      g.insurer = insurerName(ro);
    }
    const t = grandTotal(ro);
    if (t !== null) g.amounts.push(t);
  }
  return Array.from(groups.values());
}

/**
 * Agent Capture — insurance agents referring work in the period, with RO counts
 * and the date first seen. Sorted by agent ascending.
 */
export async function agentCaptureRun(
  params: ReportParams,
  ctx: ReportContext,
): Promise<ReportRow[]> {
  guard(ctx, "agentCaptureRun");
  const rows = withShopFilter(await fetchRepairOrders(params, ctx), params);

  return groupByAgent(rows)
    .sort((a, b) => a.agent.localeCompare(b.agent))
    .map((g) => ({
      agent: g.agent,
      insurer: g.insurer,
      ros: g.ros,
      firstSeen: g.earliest === "9999-12-31" ? null : g.earliest,
    }));
}

/**
 * Agent Sales — captured sales dollars (Σ grandTotal) by insurance agent, ranked
 * by sales descending (nulls last), then agent ascending.
 */
export async function agentSalesRun(
  params: ReportParams,
  ctx: ReportContext,
): Promise<ReportRow[]> {
  guard(ctx, "agentSalesRun");
  const rows = withShopFilter(await fetchRepairOrders(params, ctx), params);

  return groupByAgent(rows)
    .map((g) => ({
      agent: g.agent,
      insurer: g.insurer,
      ros: g.ros,
      sales: dollars(sumOrNull(g.amounts)),
    }))
    .sort((a, b) => {
      const sa = a.sales ?? -1;
      const sb = b.sales ?? -1;
      return sb - sa || a.agent.localeCompare(b.agent);
    });
}

/**
 * Claims Review — claims by insurer with total-loss flags and claim dollars.
 * Each RO carrying an insurer is one claim. Supplements have no per-insurer
 * source on the spine yet (they live inside estimates.payload_jsonb), so that
 * column is null pending that edge. Sorted by insurer ascending.
 */
export async function claimsReviewRun(
  params: ReportParams,
  ctx: ReportContext,
): Promise<ReportRow[]> {
  guard(ctx, "claimsReviewRun");
  const rows = withShopFilter(await fetchRepairOrders(params, ctx), params);

  const groups = new Map<
    string,
    { insurer: string; claims: number; totalLoss: number; amounts: number[] }
  >();
  for (const ro of rows) {
    if (!ro.insurance_company_id) continue; // no insurer → not a claim
    const insurer = insurerName(ro);
    let g = groups.get(insurer);
    if (!g) {
      g = { insurer, claims: 0, totalLoss: 0, amounts: [] };
      groups.set(insurer, g);
    }
    g.claims += 1;
    if (ro.total_loss_flag) g.totalLoss += 1;
    const t = grandTotal(ro);
    if (t !== null) g.amounts.push(t);
  }

  return Array.from(groups.values())
    .sort((a, b) => a.insurer.localeCompare(b.insurer))
    .map((g) => ({
      insurer: g.insurer,
      claims: g.claims,
      totalLoss: g.totalLoss,
      supplements: null, // no per-insurer supplement source on the spine yet
      amount: dollars(sumOrNull(g.amounts)),
    }));
}

/**
 * Name Recap by Shop — repair customers and their RO counts/dollars, grouped by
 * shop then customer. The customer NAME is this report's defined business field
 * (its "Customer" column); no other customer PII (address/phone/email) is output.
 * Sorted by shop then customer ascending.
 */
export async function nameRecapByShopRun(
  params: ReportParams,
  ctx: ReportContext,
): Promise<ReportRow[]> {
  guard(ctx, "nameRecapByShopRun");
  const rows = withShopFilter(await fetchRepairOrders(params, ctx), params);

  const groups = new Map<
    string,
    { shop: string; customer: string; ros: number; amounts: number[] }
  >();
  for (const ro of rows) {
    const shop = shopName(ro);
    const customer = customerName(ro);
    const key = `${shop.toLowerCase()}|${customer.toLowerCase()}`;
    let g = groups.get(key);
    if (!g) {
      g = { shop, customer, ros: 0, amounts: [] };
      groups.set(key, g);
    }
    g.ros += 1;
    const t = grandTotal(ro);
    if (t !== null) g.amounts.push(t);
  }

  return Array.from(groups.values())
    .sort(
      (a, b) => a.shop.localeCompare(b.shop) || a.customer.localeCompare(b.customer),
    )
    .map((g) => ({
      shop: g.shop,
      customer: g.customer,
      ros: g.ros,
      amount: dollars(sumOrNull(g.amounts)),
    }));
}
