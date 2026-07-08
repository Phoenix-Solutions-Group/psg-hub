// Phase 12 / 12-03 — Render client: drives the controlled-host Chromium worker.
// RESEARCH refuted Chromium on Vercel Fluid (libnss3.so launch break), so the PDF
// is rendered on a host PSG controls (Hetzner puppeteer worker, deployed at 12-04).
// This client POSTs the internal print-route URL to that worker and gets PDF bytes.
//
// The HTTP call is wrapped in withRetry + CircuitBreaker (resilience constraint), and
// the transport (deps.httpPost) is injected so unit tests mock it — no real network.

import { withRetry, CircuitBreaker, type RetryOptions } from "../resilience";

/** Minimal response surface the client needs from the transport. */
export type RenderHttpResponse = {
  ok: boolean;
  status: number;
  arrayBuffer(): Promise<ArrayBuffer>;
  text?(): Promise<string>;
};

export type RenderHttpPost = (
  url: string,
  init: { headers: Record<string, string>; body: string }
) => Promise<RenderHttpResponse>;

export type RenderDeps = {
  /** Injected transport; defaults to fetch. Tests pass a mock. */
  httpPost?: RenderHttpPost;
  /** Shared breaker (so callers can reuse one across renders). */
  breaker?: CircuitBreaker;
  /** Retry options (tests pass a no-op sleep). */
  retry?: RetryOptions;
};

/** Default transport: POST via fetch. */
const fetchPost: RenderHttpPost = (url, init) =>
  fetch(url, { method: "POST", headers: init.headers, body: init.body });

function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(`renderReportPdf: missing required env ${name}`);
  }
  return value;
}

/**
 * Render the report PDF for `slug` ("{shopId}__{period}") via the controlled-host
 * worker. POSTs `{ url: <print-route URL> }` to REPORT_RENDER_URL with a RENDER_TOKEN
 * bearer; the worker page.goto(url) (sending the same bearer) and page.pdf() back.
 * Returns the PDF bytes. Fails loud on missing env; retries transient failures and
 * trips the circuit breaker after repeated failure.
 */
export async function renderReportPdf(
  slug: string,
  deps: RenderDeps = {}
): Promise<Uint8Array> {
  const renderUrl = requireEnv("REPORT_RENDER_URL");
  const token = requireEnv("RENDER_TOKEN");
  const appUrl = requireEnv("NEXT_PUBLIC_APP_URL");

  const printUrl = `${appUrl.replace(/\/$/, "")}/reports/${slug}/print`;
  const post = deps.httpPost ?? fetchPost;
  const breaker = deps.breaker ?? new CircuitBreaker();

  return breaker.execute(() =>
    withRetry(async () => {
      const res = await post(renderUrl, {
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ url: printUrl }),
      });
      if (!res.ok) {
        const detail = res.text ? (await res.text()).trim().slice(0, 500) : "";
        throw new Error(
          `render worker responded ${res.status}${detail ? `: ${detail}` : ""}`
        );
      }
      return new Uint8Array(await res.arrayBuffer());
    }, deps.retry)
  );
}
