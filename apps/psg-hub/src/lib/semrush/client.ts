import "server-only";
import {
  CircuitBreaker,
  withRetry,
  type RetryOptions,
} from "@/lib/resilience";
import type { SemrushMetrics } from "@/lib/analytics/types";

/**
 * SEMrush HTTP API client — built to the LIVE-VERIFIED contract in
 * .paul/phases/09-analytics-foundation-semrush/research/semrush-api.md
 * (NOT the MCP shape). Two load-bearing bug-traps from that research:
 *
 *  1. Authority Score column is `score`, NOT `ascore` (several doc pages lie).
 *  2. A typo'd export_columns code is SILENTLY ignored (the API returns its
 *     default column set, no error) — so responses are ALWAYS parsed by the
 *     RETURNED header line, never by requested column order.
 *
 * Errors arrive as a plain-text `ERROR nn :: MESSAGE` line — often with
 * HTTP 200 — so the body is sniffed before any CSV parse.
 */

// SECURITY NOTE: SEMrush auth is `?key=` in the query string by contract — the
// API has no header-auth option (research/semrush-api.md, verified live). The
// assembled URLs live in memory only: nothing in this module or sync.ts logs a
// request URL, all thrown errors carry status/code/header-names only, and any
// error text that COULD embed a URL is scrubbed through redactApiKey() before
// logging. Rotate the key periodically (operator).
const OVERVIEW_BASE = "https://api.semrush.com/";
const BACKLINKS_BASE = "https://api.semrush.com/analytics/v1/";
const DATABASE = "us";
/** Cost lever (plan grounding #3): domain_organic bills 10 units/row. */
const POSITION_SAMPLE_LIMIT = 100;

export class SemrushApiError extends Error {
  constructor(
    public readonly code: number,
    message: string
  ) {
    super(`SEMrush API error ${code}: ${message}`);
    this.name = "SemrushApiError";
  }
}

export class SemrushHttpError extends Error {
  constructor(public readonly status: number) {
    super(`SEMrush HTTP ${status}`);
    this.name = "SemrushHttpError";
  }
}

/**
 * The response parsed but doesn't look like the contract we coded against
 * (empty data, or a header that matches none of our expected keys). Fail LOUD:
 * without this, a renamed header would silently read every metric as 0 and
 * write a zero row — indistinguishable from a low-data shop in prod.
 */
export class SemrushContractError extends Error {
  constructor(message: string) {
    super(`SEMrush contract mismatch: ${message}`);
    this.name = "SemrushContractError";
  }
}

/** First record, verified to carry at least one expected header key. */
function requireRecord(
  records: SemrushRecord[],
  expectedKeys: string[],
  report: string
): SemrushRecord {
  const record = records[0];
  if (!record) {
    throw new SemrushContractError(`${report}: empty response (no data row)`);
  }
  const present = expectedKeys.some((k) => k.toLowerCase() in record);
  if (!present) {
    throw new SemrushContractError(
      `${report}: returned header [${Object.keys(record).join(", ")}] matches none of the expected [${expectedKeys.join(", ")}]`
    );
  }
  return record;
}

/** Transient = network/unknown, 429, or 5xx. API ERROR lines + contract mismatches are permanent. */
export function isRetryableSemrushError(error: unknown): boolean {
  if (error instanceof SemrushApiError) return false;
  if (error instanceof SemrushContractError) return false;
  if (error instanceof SemrushHttpError) {
    return error.status === 429 || error.status >= 500;
  }
  return true;
}

/**
 * Shop URL -> bare root domain for the API (`https://www.x.com/contact` -> `x.com`).
 * Returns null for empty/garbage input (caller renders the no-data state).
 */
export function normalizeDomain(url: string | null | undefined): string | null {
  if (!url) return null;
  const trimmed = url.trim();
  if (!trimmed) return null;
  try {
    const parsed = new URL(/^[a-z][a-z0-9+.-]*:\/\//i.test(trimmed) ? trimmed : `https://${trimmed}`);
    const host = parsed.hostname.replace(/^www\./i, "").toLowerCase();
    // A real domain needs at least one dot (rejects "localhost", bare words).
    return host.includes(".") ? host : null;
  } catch {
    return null;
  }
}

/** Scrub `key=...` values out of any text before it reaches a log line. */
export function redactApiKey(text: string): string {
  return text.replace(/([?&]key=)[^&\s"']+/gi, "$1[REDACTED]");
}

export type SemrushRecord = Record<string, string>;

/**
 * Parse a SEMrush CSV body. Sniffs the ERROR token FIRST (errors often come
 * with HTTP 200), then maps each `;`-separated row by the RETURNED header
 * (case-insensitive keys) — never by requested column order.
 */
export function parseSemrushCsv(text: string): SemrushRecord[] {
  const body = text.trim();
  const errorMatch = body.match(/^ERROR\s+(\d+)\s*::\s*(.*)$/im);
  if (body.toUpperCase().startsWith("ERROR") && errorMatch) {
    throw new SemrushApiError(Number(errorMatch[1]), errorMatch[2].trim());
  }
  if (!body) return [];

  const lines = body.split(/\r?\n/).filter((l) => l.trim() !== "");
  if (lines.length < 2) return []; // header only (or nothing) = no data rows

  const header = lines[0].split(";").map((h) => h.trim().toLowerCase());
  return lines.slice(1).map((line) => {
    const cells = line.split(";");
    const record: SemrushRecord = {};
    header.forEach((key, i) => {
      record[key] = (cells[i] ?? "").trim();
    });
    return record;
  });
}

/** Header-keyed numeric read; NaN-safe (jsonb must never carry NaN). */
function num(record: SemrushRecord, key: string): number {
  const value = Number(record[key.toLowerCase()]);
  return Number.isFinite(value) ? value : 0;
}

export interface SemrushClientOptions {
  apiKey: string;
  /** Injectable for tests — NEVER hit the live API from a test. */
  fetchImpl?: typeof fetch;
  breaker?: CircuitBreaker;
  retry?: RetryOptions;
}

/** One module-level breaker shared across all SEMrush calls (one upstream). */
const defaultBreaker = new CircuitBreaker({
  failureThreshold: 5,
  resetTimeoutMs: 30_000,
  isFailure: isRetryableSemrushError,
});

function buildFetchText(options: SemrushClientOptions) {
  const fetchImpl = options.fetchImpl ?? fetch;
  const breaker = options.breaker ?? defaultBreaker;
  const retry: RetryOptions = {
    retries: 3,
    baseDelayMs: 200,
    maxDelayMs: 5000,
    isRetryable: isRetryableSemrushError,
    ...options.retry,
  };

  return (url: string): Promise<string> =>
    breaker.execute(() =>
      withRetry(async () => {
        const res = await fetchImpl(url);
        if (!res.ok) {
          throw new SemrushHttpError(res.status);
        }
        return res.text();
      }, retry)
    );
}

/**
 * Fetch one shop's SemrushMetrics: 2 cheap calls (domain_rank ~10 units +
 * backlinks_overview ~40 units) + 1 cost-capped domain_organic sample
 * (POSITION_SAMPLE_LIMIT rows) bucketed client-side into the Po distribution.
 */
export async function fetchShopMetrics(
  domain: string,
  options: SemrushClientOptions
): Promise<SemrushMetrics> {
  const fetchText = buildFetchText(options);
  const key = encodeURIComponent(options.apiKey);
  const target = encodeURIComponent(domain);

  // 1. domain_rank -> Or / Ot / Oc. Returned headers are human text. Only
  //    "Organic Keywords" was verified live — requireRecord fails LOUD if the
  //    real header set matches none of these (gate-batch first-run check).
  const rank = requireRecord(
    parseSemrushCsv(
      await fetchText(
        `${OVERVIEW_BASE}?type=domain_rank&key=${key}&database=${DATABASE}&export_columns=Or,Ot,Oc&domain=${target}`
      )
    ),
    ["organic keywords", "organic traffic", "organic cost"],
    "domain_rank"
  );

  // 2. backlinks_overview -> total + score (Authority Score; NOT ascore).
  const backlinks = requireRecord(
    parseSemrushCsv(
      await fetchText(
        `${BACKLINKS_BASE}?type=backlinks_overview&key=${key}&target=${target}&target_type=root_domain&export_columns=total,score`
      )
    ),
    ["total", "score"],
    "backlinks_overview"
  );

  // 3. domain_organic Po sample -> client-side buckets. A domain that ranks but
  //    has no listable keywords yields ERROR 50 here — treat as no distribution
  //    rather than failing the whole shop.
  let positionDistribution: SemrushMetrics["position_distribution"];
  try {
    const positionRecords = parseSemrushCsv(
      await fetchText(
        `${OVERVIEW_BASE}?type=domain_organic&key=${key}&database=${DATABASE}&display_limit=${POSITION_SAMPLE_LIMIT}&display_sort=tr_desc&export_columns=Po&domain=${target}`
      )
    );
    if (positionRecords.length > 0) {
      const buckets = { top3: 0, top10: 0, top20: 0, top100: 0 };
      for (const record of positionRecords) {
        const po = num(record, "position");
        if (po >= 1 && po <= 3) buckets.top3 += 1;
        else if (po <= 10) buckets.top10 += 1;
        else if (po <= 20) buckets.top20 += 1;
        else if (po <= 100) buckets.top100 += 1;
      }
      positionDistribution = buckets;
    }
  } catch (error) {
    if (error instanceof SemrushApiError && error.code === 50) {
      positionDistribution = undefined; // NOTHING FOUND = no keyword sample
    } else {
      throw error;
    }
  }

  return {
    organic_keywords: num(rank, "organic keywords"),
    organic_traffic: num(rank, "organic traffic"),
    organic_traffic_cost: num(rank, "organic cost"),
    backlinks: num(backlinks, "total"),
    authority_score: num(backlinks, "score"),
    ...(positionDistribution ? { position_distribution: positionDistribution } : {}),
  };
}
