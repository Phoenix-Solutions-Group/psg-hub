import { createHash, timingSafeEqual } from "node:crypto";
import { NextResponse } from "next/server";
import { createServiceClient } from "@/lib/supabase/service";
import {
  getGoogleAdsClient,
  logAdsCall,
  mapGoogleAdsError,
  validateGaqlId,
  withAdsRateLimit,
} from "@/lib/google-ads/client";
import { sanitizeLastError } from "@/lib/google-ads/sanitize";
import { AdsApiError } from "@/lib/google-ads/types";

export const runtime = "nodejs";
export const maxDuration = 60;

const WINDOWS = [
  { key: "post_fix", start: "2026-06-11", end: "2026-07-11" },
  { key: "baseline", start: "2026-04-18", end: "2026-05-18" },
] as const;

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

type GoogleAdsAggregateRow = {
  metrics?: {
    cost_micros?: number;
    clicks?: number;
    impressions?: number;
    conversions?: number;
  };
};

type HistoricalWindowResult = {
  key: (typeof WINDOWS)[number]["key"];
  start: string;
  end: string;
  spend: number;
  clicks: number;
  impressions: number;
  conversions: number;
  cpl: number | null;
  cost_micros: number;
};

function productionOnly(): boolean {
  return process.env.VERCEL_ENV === "production";
}

function configured(): boolean {
  return Boolean(
    process.env.TEDESCO_ADS_PULL_TOKEN_SHA256 &&
      process.env.GOOGLE_ADS_DEVELOPER_TOKEN &&
      process.env.GOOGLE_ADS_CLIENT_ID &&
      process.env.GOOGLE_ADS_CLIENT_SECRET &&
      process.env.NEXT_PUBLIC_SUPABASE_URL &&
      process.env.SUPABASE_SERVICE_ROLE_KEY
  );
}

function bearerToken(request: Request): string {
  const header = request.headers.get("authorization") ?? "";
  const [scheme, token] = header.split(" ");
  return scheme === "Bearer" && token ? token : "";
}

function authorized(request: Request): boolean {
  const expectedHash = process.env.TEDESCO_ADS_PULL_TOKEN_SHA256;
  if (!expectedHash || !/^[a-f0-9]{64}$/i.test(expectedHash)) return false;
  const token = bearerToken(request);
  if (!token) return false;

  const actual = Buffer.from(
    createHash("sha256").update(token).digest("hex"),
    "utf8"
  );
  const expected = Buffer.from(expectedHash.toLowerCase(), "utf8");
  return actual.length === expected.length && timingSafeEqual(actual, expected);
}

function assertDate(date: string): void {
  if (!DATE_RE.test(date)) {
    throw new AdsApiError("bad_request", `invalid date: ${date}`);
  }
}

function publicError(err: unknown): { error: string; detail?: string } {
  const mapped = err instanceof AdsApiError ? err : mapGoogleAdsError(err);
  return {
    error: mapped.code,
    detail: sanitizeLastError(mapped.message),
  };
}

async function findTedescoShopId(): Promise<string> {
  const service = createServiceClient();
  const { data, error } = await service
    .from("shops")
    .select("id, name")
    .ilike("name", "%Tedesco%")
    .limit(2);

  if (error) {
    throw new AdsApiError("upstream", `Tedesco shop lookup failed: ${error.message}`);
  }
  if (!data || data.length === 0) {
    throw new AdsApiError("bad_request", "Tedesco shop was not found");
  }
  if (data.length > 1) {
    throw new AdsApiError("bad_request", "Tedesco shop lookup returned multiple matches");
  }
  return data[0].id as string;
}

async function fetchHistoricalWindow(
  shopId: string,
  window: (typeof WINDOWS)[number]
): Promise<HistoricalWindowResult> {
  assertDate(window.start);
  assertDate(window.end);

  const started = Date.now();
  const { customer, account } = await getGoogleAdsClient(shopId);
  validateGaqlId(account.customer_id);
  if (account.login_customer_id) validateGaqlId(account.login_customer_id);

  const gaql = `
    SELECT metrics.cost_micros, metrics.clicks, metrics.impressions, metrics.conversions
    FROM customer
    WHERE segments.date BETWEEN '${window.start}' AND '${window.end}'
  `;

  try {
    const rows = (await withAdsRateLimit(shopId, "SEARCH", () =>
      customer.query(gaql) as Promise<GoogleAdsAggregateRow[]>
    )) as GoogleAdsAggregateRow[];

    let cost_micros = 0;
    let clicks = 0;
    let impressions = 0;
    let conversions = 0;
    for (const row of rows) {
      cost_micros += Number(row.metrics?.cost_micros ?? 0);
      clicks += Number(row.metrics?.clicks ?? 0);
      impressions += Number(row.metrics?.impressions ?? 0);
      conversions += Number(row.metrics?.conversions ?? 0);
    }

    await logAdsCall({
      userId: null,
      shopId,
      accountId: account.id,
      endpoint: `ops.tedesco.google-ads-historical-pull.${window.key}`,
      method: "SEARCH",
      latencyMs: Date.now() - started,
      result: "success",
    });

    const spend = cost_micros / 1_000_000;
    return {
      ...window,
      spend,
      clicks,
      impressions,
      conversions,
      cpl: conversions > 0 ? spend / conversions : null,
      cost_micros,
    };
  } catch (err) {
    const mapped = err instanceof AdsApiError ? err : mapGoogleAdsError(err);
    await logAdsCall({
      userId: null,
      shopId,
      accountId: account.id,
      endpoint: `ops.tedesco.google-ads-historical-pull.${window.key}`,
      method: "SEARCH",
      latencyMs: Date.now() - started,
      result:
        mapped.code === "rate_limited"
          ? "rate_limited"
          : mapped.code === "auth_failed"
            ? "auth_failed"
            : "error",
      errorCode: mapped.code,
    });
    throw mapped;
  }
}

export async function POST(request: Request): Promise<NextResponse> {
  if (!productionOnly()) {
    return NextResponse.json({ error: "not_found" }, { status: 404 });
  }
  if (!authorized(request)) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  if (!configured()) {
    return NextResponse.json({ error: "not_configured" }, { status: 503 });
  }

  try {
    const shopId = await findTedescoShopId();
    const windows = [];
    for (const window of WINDOWS) {
      windows.push(await fetchHistoricalWindow(shopId, window));
    }
    return NextResponse.json({
      shop: "Tedesco",
      pulledAt: new Date().toISOString(),
      windows,
    });
  } catch (err) {
    const body = publicError(err);
    const status =
      body.error === "auth_failed"
        ? 401
        : body.error === "bad_request"
          ? 400
          : body.error === "rate_limited"
            ? 429
            : 502;
    return NextResponse.json(body, { status });
  }
}
