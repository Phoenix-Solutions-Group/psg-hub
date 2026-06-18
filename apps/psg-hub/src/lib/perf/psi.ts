import "server-only";
import { CircuitBreaker, withRetry, type RetryOptions } from "@/lib/resilience";
import type { PsiFieldMetrics, PsiResult } from "@/lib/analytics/types";

/**
 * PageSpeed Insights v5 fetch (Phase 12 / 12-05b). ONE `runPagespeed` call (strategy=mobile,
 * the locked default) returns BOTH the Lighthouse LAB block (always present) and the CrUX FIELD
 * block (loadingExperience / originLoadingExperience — best-effort, absent for low-traffic
 * collision-shop origins; RESEARCH). No separate CrUX queryRecord: the field IS in this response.
 *
 * Resilience (PROJECT mandate): CircuitBreaker + withRetry on the call, >=30s timeout for the
 * Lighthouse latency. A CrUX-absent response is a SUCCESSFUL-EMPTY result (field=null) — it does
 * NOT throw and does NOT trip the breaker. A Google Cloud API key is a HARD prerequisite (the
 * keyless path is quota=0); psiConfigured() gates the whole perf section.
 */

const PSI_ENDPOINT = "https://www.googleapis.com/pagespeedonline/v5/runPagespeed";
const PSI_TIMEOUT_MS = 45_000;

/** Minimal shapes of the PSI response (only the fields the parser reads). */
type PsiAudit = { numericValue?: number | null } | undefined;
type PsiCruxMetric = { percentile?: number | null } | undefined;
type PsiCruxBlock = {
  metrics?: Record<string, PsiCruxMetric> | null;
  overall_category?: string | null;
} | null;
export type PsiApiResponse = {
  lighthouseResult?: {
    categories?: { performance?: { score?: number | null } | null } | null;
    audits?: Record<string, PsiAudit> | null;
  } | null;
  loadingExperience?: PsiCruxBlock;
  originLoadingExperience?: PsiCruxBlock;
};

/** Typed HTTP error so the retry/breaker predicate can branch on status. */
export class PerfHttpError extends Error {
  constructor(
    public readonly status: number,
    message: string
  ) {
    super(message);
    this.name = "PerfHttpError";
  }
}

/** Retry transient failures only: 408/429/5xx + network errors; never a 4xx auth/bad-request. */
export function isRetryablePerfError(err: unknown): boolean {
  if (err instanceof PerfHttpError) {
    return err.status === 408 || err.status === 429 || err.status >= 500;
  }
  return true; // network/timeout/parse — worth a retry
}

export type PsiHttpGet = (requestUrl: string) => Promise<PsiApiResponse>;

export type FetchPsiDeps = {
  /** Test seam — bypasses fetch entirely. */
  httpGet?: PsiHttpGet;
  breaker?: CircuitBreaker;
  retry?: RetryOptions;
  /** Override the env key (tests). */
  apiKey?: string;
};

const defaultPsiBreaker = new CircuitBreaker({
  failureThreshold: 5,
  resetTimeoutMs: 30_000,
  isFailure: isRetryablePerfError,
});

export function psiConfigured(): boolean {
  return Boolean(process.env.PAGESPEED_API_KEY);
}

/** Finite number or null (PSI numericValues are numbers; guard undefined/NaN). */
function num(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

/** Read a CrUX percentile off a metrics block; null when the key is absent. */
function fieldPercentile(
  metrics: Record<string, PsiCruxMetric> | null | undefined,
  key: string
): number | null {
  return num(metrics?.[key]?.percentile);
}

/** Parse a CrUX block -> field metrics, or null when it carries no usable metrics. */
function parseField(block: PsiCruxBlock | undefined): PsiFieldMetrics | null {
  const metrics = block?.metrics;
  if (!metrics || Object.keys(metrics).length === 0) return null;

  const clsRaw = fieldPercentile(metrics, "CUMULATIVE_LAYOUT_SHIFT_SCORE");
  const field: PsiFieldMetrics = {
    lcp_ms: fieldPercentile(metrics, "LARGEST_CONTENTFUL_PAINT_MS"),
    inp_ms: fieldPercentile(metrics, "INTERACTION_TO_NEXT_PAINT"),
    cls: clsRaw === null ? null : clsRaw / 100, // integer ×100 -> real value
    fcp_ms: fieldPercentile(metrics, "FIRST_CONTENTFUL_PAINT_MS"),
    ttfb_ms: fieldPercentile(metrics, "EXPERIMENTAL_TIME_TO_FIRST_BYTE"),
    overall_category:
      typeof block?.overall_category === "string" ? block.overall_category : null,
  };
  // All-null + no category => treat as no field data.
  const hasAny =
    field.lcp_ms !== null ||
    field.inp_ms !== null ||
    field.cls !== null ||
    field.fcp_ms !== null ||
    field.ttfb_ms !== null;
  return hasAny || field.overall_category ? field : null;
}

export async function fetchPsi(
  url: string,
  deps: FetchPsiDeps = {}
): Promise<PsiResult> {
  const breaker = deps.breaker ?? defaultPsiBreaker;
  const retry: RetryOptions = {
    retries: 3,
    baseDelayMs: 200,
    maxDelayMs: 5000,
    isRetryable: isRetryablePerfError,
    ...deps.retry,
  };
  const apiKey = deps.apiKey ?? process.env.PAGESPEED_API_KEY ?? "";
  const httpGet = deps.httpGet ?? defaultHttpGet;

  const requestUrl =
    `${PSI_ENDPOINT}?url=${encodeURIComponent(url)}` +
    `&strategy=mobile&category=performance&key=${apiKey}`;

  const resp = await breaker.execute(() =>
    withRetry(() => httpGet(requestUrl), retry)
  );

  const lh = resp.lighthouseResult;
  const audits = lh?.audits ?? {};
  const score = num(lh?.categories?.performance?.score);

  // FIELD: URL-level first, then origin fallback (record which supplied it).
  const urlField = parseField(resp.loadingExperience);
  const originField = urlField ? null : parseField(resp.originLoadingExperience);
  const field = urlField ?? originField;

  return {
    perf_score: score === null ? null : Math.round(score * 100),
    lab_lcp_ms: num(audits["largest-contentful-paint"]?.numericValue),
    lab_cls: num(audits["cumulative-layout-shift"]?.numericValue),
    lab_tbt_ms: num(audits["total-blocking-time"]?.numericValue),
    lab_fcp_ms: num(audits["first-contentful-paint"]?.numericValue),
    lab_speed_index_ms: num(audits["speed-index"]?.numericValue),
    lab_ttfb_ms: num(audits["server-response-time"]?.numericValue),
    field,
    origin_field: field !== null && originField !== null,
  };
}

const defaultHttpGet: PsiHttpGet = async (requestUrl) => {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), PSI_TIMEOUT_MS);
  try {
    const res = await fetch(requestUrl, { signal: controller.signal });
    if (!res.ok) {
      // Capture the PSI error body so the reason (e.g. a 400's lighthouseError /
      // ERRORED_DOCUMENT_REQUEST when Google's crawler can't load the page) reaches the
      // logs — the status alone is undiagnosable. The body is Google's error JSON, which
      // does NOT echo the api key; collapse whitespace + truncate to keep logs bounded.
      let detail = "";
      try {
        detail = (await res.text()).replace(/\s+/g, " ").trim().slice(0, 500);
      } catch {
        // body unreadable (already consumed / network) — fall back to status-only
      }
      throw new PerfHttpError(
        res.status,
        detail ? `PSI HTTP ${res.status}: ${detail}` : `PSI HTTP ${res.status}`
      );
    }
    return (await res.json()) as PsiApiResponse;
  } finally {
    clearTimeout(timer);
  }
};
