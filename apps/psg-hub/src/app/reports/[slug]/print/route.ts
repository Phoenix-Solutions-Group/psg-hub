import { timingSafeEqual } from "node:crypto";
import { createServiceClient } from "@/lib/supabase/service";
import { getSnapshots, getMonthlySnapshot } from "@/lib/analytics/snapshots";
import {
  assembleReportData,
  type SnapshotReader,
  type MonthlyDimensionsReader,
  type MonthlyPerformanceReader,
} from "@/lib/report/report-data";
import { loadReportNarrative } from "@/lib/report/storage";
import { renderReportHtml } from "@/lib/report/render";
import type { ReportData } from "@/lib/report/types";
import type { ReportNarrative } from "@/lib/report/schema";

// 12-03: INTERNAL branded print surface. The Hetzner Chromium worker (12-04 deploy)
// does page.goto(this URL) then page.pdf(). It is NOT a customer surface — it is
// gated by a RENDER_TOKEN bearer (the SAME timingSafeEqual idiom as the cron routes),
// not a user session. Customer access is the membership-gated download route.
//
// runtime=nodejs is REQUIRED (node:crypto + the server-only snapshots/service deps).
export const runtime = "nodejs";

/** slug = "{shopId}__{period}" where period is 'YYYY-MM'. */
const SLUG_RE = /^([0-9a-fA-F-]{36})__(\d{4}-\d{2})$/;

function authorized(request: Request): boolean {
  const token = process.env.RENDER_TOKEN;
  if (!token) return false; // unconfigured = locked
  const header = request.headers.get("authorization") ?? "";
  const expected = `Bearer ${token}`;
  const a = Buffer.from(header);
  const b = Buffer.from(expected);
  return a.length === b.length && timingSafeEqual(a, b);
}

/** Parse a print slug into its shopId + period parts (null if malformed). */
export function parsePrintSlug(slug: string): { shopId: string; period: string } | null {
  const m = SLUG_RE.exec(slug);
  if (!m) return null;
  return { shopId: m[1], period: m[2] };
}

/** Injectable payload loader so the render pipeline is testable without a DB/storage. */
export type PrintPayloadLoader = (
  shopId: string,
  period: string
) => Promise<{ reportData: ReportData; narrative: ReportNarrative } | null>;

/** Default loader: assemble ReportData from snapshots + load the persisted narrative. */
export const defaultLoader: PrintPayloadLoader = async (shopId, period) => {
  const narrative = await loadReportNarrative(shopId, period);
  if (!narrative) return null; // no eval-passed narrative persisted yet
  const service = createServiceClient();
  const readSnapshots: SnapshotReader = (query) => getSnapshots(service, query);
  // 12-05c: bind the optional monthly readers so the GA4 dimensional sections (12-05a)
  // + the Website-performance block (12-05b) reach the PDF. Service client is correct
  // here (this route is RENDER_TOKEN-gated/internal, not a user session). The
  // monthly-report cron's narrative binding deliberately does NOT wire these — the
  // writer only sees linkedSources, so leaving the dims/perf out of the narrative keeps
  // the eval gate from holding on an ungrounded number (the 12-04 lesson).
  const readMonthlyDimensions: MonthlyDimensionsReader = ({ shopId: s, month }) =>
    getMonthlySnapshot(service, { shopId: s, source: "ga4_dimensions", month });
  const readMonthlyPerformance: MonthlyPerformanceReader = ({ shopId: s, month }) =>
    getMonthlySnapshot(service, { shopId: s, source: "performance", month });
  const reportData = await assembleReportData(shopId, period, {
    readSnapshots,
    generatedAt: new Date().toISOString(),
    readMonthlyDimensions,
    readMonthlyPerformance,
  });
  return { reportData, narrative };
};

async function handle(
  request: Request,
  slug: string,
  loader: PrintPayloadLoader
): Promise<Response> {
  if (!authorized(request)) {
    return new Response("unauthorized", { status: 401 });
  }
  const parsed = parsePrintSlug(slug);
  if (!parsed) {
    return new Response("bad slug", { status: 400 });
  }
  const payload = await loader(parsed.shopId, parsed.period);
  if (!payload) {
    return new Response("not found", { status: 404 });
  }
  const html = renderReportHtml(payload.reportData, payload.narrative);
  return new Response(html, {
    status: 200,
    headers: { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "private, no-store" },
  });
}

export async function GET(
  request: Request,
  { params }: { params: Promise<{ slug: string }> }
): Promise<Response> {
  const { slug } = await params;
  return handle(request, slug, defaultLoader);
}
