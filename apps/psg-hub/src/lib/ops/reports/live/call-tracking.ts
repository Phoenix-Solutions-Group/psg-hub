import type { ReportContext, ReportParams, ReportRow } from "../types";
import { fetchAllRows } from "./paginate";

const YMD = /^\d{4}-\d{2}-\d{2}$/;

type NamedRef = { name: string | null };

type CallTrackingRow = {
  shop_id: string;
  call_started_at: string;
  source: string | null;
  campaign: string | null;
  qualified: boolean | null;
  shops: NamedRef | NamedRef[] | null;
};

function first<T>(v: T | T[] | null | undefined): T | null {
  if (v == null) return null;
  return Array.isArray(v) ? (v.length ? v[0] : null) : v;
}

function dateOnly(ts: string | null | undefined): string | null {
  if (typeof ts !== "string" || ts.length < 10) return null;
  const ymd = ts.slice(0, 10);
  return YMD.test(ymd) ? ymd : null;
}

function shopMatches(shopName: string | null, needle: string): boolean {
  return (shopName ?? "").toLowerCase().includes(needle.toLowerCase());
}

/**
 * Paid-media call tracking summary — grouped by shop × date × source × campaign.
 * Reads the PII-minimized public.call_tracking_calls table; caller phone numbers
 * are intentionally not selected or surfaced.
 */
export async function callTrackingSummaryRun(
  params: ReportParams,
  ctx: ReportContext,
): Promise<ReportRow[]> {
  if (!ctx.db) throw new Error("callTrackingSummaryRun requires a db context");

  const data = await fetchAllRows<CallTrackingRow>(() => {
    let query = ctx
      .db!.from("call_tracking_calls")
      .select("shop_id, call_started_at, source, campaign, qualified, shops(name)");

    if (params.start && YMD.test(params.start)) {
      query = query.gte("call_started_at", params.start);
    }
    if (params.end && YMD.test(params.end)) {
      query = query.lte("call_started_at", `${params.end}T23:59:59.999Z`);
    }
    if (ctx.shopIds) query = query.in("shop_id", ctx.shopIds);
    return query;
  });

  const shopFilter = params.filters.shopId?.trim();
  type Group = {
    shop: string;
    date: string;
    source: string;
    campaign: string;
    totalCalls: number;
    qualifiedCalls: number;
  };
  const groups = new Map<string, Group>();

  for (const r of data) {
    const date = dateOnly(r.call_started_at);
    if (!date) continue;
    const shop = (first(r.shops)?.name ?? r.shop_id).trim() || r.shop_id;
    if (shopFilter && !shopMatches(shop, shopFilter)) continue;
    const source = (r.source ?? "Unknown").trim() || "Unknown";
    const campaign = (r.campaign ?? "Unknown").trim() || "Unknown";
    const key = `${shop.toLowerCase()}|${date}|${source.toLowerCase()}|${campaign.toLowerCase()}`;
    let group = groups.get(key);
    if (!group) {
      group = { shop, date, source, campaign, totalCalls: 0, qualifiedCalls: 0 };
      groups.set(key, group);
    }
    group.totalCalls += 1;
    if (r.qualified === true) group.qualifiedCalls += 1;
  }

  return Array.from(groups.values())
    .sort(
      (a, b) =>
        a.shop.localeCompare(b.shop) ||
        a.date.localeCompare(b.date) ||
        a.source.localeCompare(b.source) ||
        a.campaign.localeCompare(b.campaign),
    )
    .map((g) => ({
      shop: g.shop,
      date: g.date,
      source: g.source,
      campaign: g.campaign,
      totalCalls: g.totalCalls,
      qualifiedCalls: g.qualifiedCalls,
    }));
}
