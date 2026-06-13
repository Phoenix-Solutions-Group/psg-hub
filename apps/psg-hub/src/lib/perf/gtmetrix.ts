import "server-only";
import { CircuitBreaker, withRetry, type RetryOptions } from "@/lib/resilience";
import type { GtmetrixResult } from "@/lib/analytics/types";
import { PerfHttpError, isRetryablePerfError } from "./psi";

/**
 * GTMetrix API v2.0 fetch (Phase 12 / 12-05b). ASYNC two-phase (no synchronous option):
 *   POST /tests        -> { id, state }            (enqueue)
 *   GET  /tests/{id}    -> { state }               (poll queued->started->completed)
 *   GET  /reports/{id}  -> data.attributes         (the report fields live HERE, NOT on /tests)
 * On completion GET /tests/{id} 303-redirects to /reports/{id} (same id); we read the report
 * resource explicitly. HTTP Basic auth = the API key as username + a BLANK password.
 *
 * Guards (RESEARCH): a hard max-poll ceiling -> throw rather than hang the 300s Fluid invocation;
 * state='error' throws (contained by perf-sync); 429 (E42901) backs off via withRetry. Optional:
 * gtmetrixConfigured() gates the whole fetch (PSI is the required floor, GTMetrix is enrichment).
 */

const GTMETRIX_BASE = "https://api.gtmetrix.com/api/2.0";
const DEFAULT_POLL_INTERVAL_MS = 3_000;
const DEFAULT_MAX_POLLS = 20; // ~60s ceiling at 3s — survives one Fluid invocation

/** GTMetrix JSON:API envelope (only the fields we read). */
type GtmetrixEnvelope = {
  data?: {
    id?: string;
    attributes?: Record<string, unknown> | null;
  } | null;
};

export type GtmetrixSubmit = (url: string) => Promise<{ id: string; state: string }>;
export type GtmetrixPoll = (id: string) => Promise<{ state: string }>;
export type GtmetrixGetReport = (id: string) => Promise<Record<string, unknown>>;

export type FetchGtmetrixDeps = {
  /** Test seams — bypass HTTP entirely. */
  submitTest?: GtmetrixSubmit;
  pollTest?: GtmetrixPoll;
  getReport?: GtmetrixGetReport;
  breaker?: CircuitBreaker;
  retry?: RetryOptions;
  /** Injectable sleep (tests pass a no-op). */
  sleep?: (ms: number) => Promise<void>;
  pollIntervalMs?: number;
  maxPolls?: number;
  apiKey?: string;
};

const defaultGtmetrixBreaker = new CircuitBreaker({
  failureThreshold: 5,
  resetTimeoutMs: 30_000,
  isFailure: isRetryablePerfError,
});

const defaultSleep = (ms: number): Promise<void> =>
  new Promise((resolve) => setTimeout(resolve, ms));

export function gtmetrixConfigured(): boolean {
  return Boolean(process.env.GTMETRIX_API_KEY);
}

function num(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}
function str(value: unknown): string | null {
  return typeof value === "string" && value.length > 0 ? value : null;
}

/** Map a /reports/{id} data.attributes object to the typed result. */
function parseAttributes(attrs: Record<string, unknown>): GtmetrixResult {
  return {
    fully_loaded_time: num(attrs.fully_loaded_time),
    onload_time: num(attrs.onload_time),
    time_to_first_byte: num(attrs.time_to_first_byte),
    backend_duration: num(attrs.backend_duration),
    page_bytes: num(attrs.page_bytes),
    html_bytes: num(attrs.html_bytes),
    page_requests: num(attrs.page_requests),
    redirect_duration: num(attrs.redirect_duration),
    connect_duration: num(attrs.connect_duration),
    largest_contentful_paint: num(attrs.largest_contentful_paint),
    total_blocking_time: num(attrs.total_blocking_time),
    cumulative_layout_shift: num(attrs.cumulative_layout_shift),
    speed_index: num(attrs.speed_index),
    time_to_interactive: num(attrs.time_to_interactive),
    gtmetrix_grade: str(attrs.gtmetrix_grade),
    gtmetrix_score: num(attrs.gtmetrix_score),
    performance_score: num(attrs.performance_score),
    structure_score: num(attrs.structure_score),
  };
}

export async function fetchGtmetrix(
  url: string,
  deps: FetchGtmetrixDeps = {}
): Promise<GtmetrixResult> {
  const breaker = deps.breaker ?? defaultGtmetrixBreaker;
  const retry: RetryOptions = {
    retries: 3,
    baseDelayMs: 200,
    maxDelayMs: 5000,
    isRetryable: isRetryablePerfError,
    ...deps.retry,
  };
  const sleep = deps.sleep ?? defaultSleep;
  const pollIntervalMs = deps.pollIntervalMs ?? DEFAULT_POLL_INTERVAL_MS;
  const maxPolls = deps.maxPolls ?? DEFAULT_MAX_POLLS;
  const apiKey = deps.apiKey ?? process.env.GTMETRIX_API_KEY ?? "";

  const submitTest = deps.submitTest ?? defaultSubmit(apiKey);
  const pollTest = deps.pollTest ?? defaultPoll(apiKey);
  const getReport = deps.getReport ?? defaultGetReport(apiKey);

  const submitted = await breaker.execute(() =>
    withRetry(() => submitTest(url), retry)
  );
  let state = submitted.state;

  let polls = 0;
  while (state !== "completed") {
    if (state === "error") {
      throw new Error("gtmetrix test failed (state=error)");
    }
    if (polls >= maxPolls) {
      throw new Error(`gtmetrix poll timeout after ${maxPolls} polls`);
    }
    await sleep(pollIntervalMs);
    polls += 1;
    const polled = await breaker.execute(() =>
      withRetry(() => pollTest(submitted.id), retry)
    );
    state = polled.state;
  }

  const attrs = await breaker.execute(() =>
    withRetry(() => getReport(submitted.id), retry)
  );
  return parseAttributes(attrs);
}

/** HTTP Basic header with the API key as username + a BLANK password. */
function authHeader(apiKey: string): string {
  return `Basic ${Buffer.from(`${apiKey}:`).toString("base64")}`;
}

async function gtmetrixJson(
  res: Response
): Promise<GtmetrixEnvelope> {
  if (!res.ok) {
    throw new PerfHttpError(res.status, `GTMetrix HTTP ${res.status}`);
  }
  return (await res.json()) as GtmetrixEnvelope;
}

function defaultSubmit(apiKey: string): GtmetrixSubmit {
  return async (url) => {
    const res = await fetch(`${GTMETRIX_BASE}/tests`, {
      method: "POST",
      headers: {
        Authorization: authHeader(apiKey),
        "Content-Type": "application/vnd.api+json",
      },
      body: JSON.stringify({ data: { type: "test", attributes: { url } } }),
    });
    const env = await gtmetrixJson(res);
    return {
      id: env.data?.id ?? "",
      state: str(env.data?.attributes?.state) ?? "queued",
    };
  };
}

function defaultPoll(apiKey: string): GtmetrixPoll {
  return async (id) => {
    // redirect:'manual' so a 303-on-completion is observed as completion, not auto-followed.
    const res = await fetch(`${GTMETRIX_BASE}/tests/${id}`, {
      headers: { Authorization: authHeader(apiKey) },
      redirect: "manual",
    });
    if (res.status === 303 || res.status === 0) {
      return { state: "completed" };
    }
    const env = await gtmetrixJson(res);
    return { state: str(env.data?.attributes?.state) ?? "started" };
  };
}

function defaultGetReport(apiKey: string): GtmetrixGetReport {
  return async (id) => {
    const res = await fetch(`${GTMETRIX_BASE}/reports/${id}`, {
      headers: { Authorization: authHeader(apiKey) },
    });
    const env = await gtmetrixJson(res);
    return env.data?.attributes ?? {};
  };
}
