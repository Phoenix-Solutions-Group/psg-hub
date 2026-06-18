// v1.6 / 16-03 — Competitor report render-to-PDF client (the Chromium-worker seam).
// Mirrors lib/production/render-pdf.ts exactly: Chromium does not run on Vercel Fluid
// (the report module's research refuted it — libnss3.so launch break), so PDF synthesis runs
// on a host PSG controls (the same Hetzner Chromium worker family). The competitor report is
// internal (no app print route to page.goto), so the self-contained HTML from render.ts is
// shipped INLINE and the worker does page.setContent(html) then page.pdf() — same shape as the
// mail render client. We POST `{ html }`, not `{ url }`.
//
// No real Chromium and no spend run here build-local: the HTTP transport (deps.httpPost) is
// injected so unit tests mock it, and the route is wrapped in withRetry + CircuitBreaker per the
// resilience constraint. This adds NO metered-vendor spend — it is print synthesis, not an LLM
// call (the LLM narrative is the only G5-gated piece, gated upstream in report/server.ts).

import { withRetry, CircuitBreaker, type RetryOptions } from "@/lib/resilience";

/** Minimal response surface the client needs from the transport. */
export type RenderHttpResponse = {
  ok: boolean;
  status: number;
  arrayBuffer(): Promise<ArrayBuffer>;
};

export type RenderHttpPost = (
  url: string,
  init: { headers: Record<string, string>; body: string },
) => Promise<RenderHttpResponse>;

export type ReportPdfDeps = {
  /** Injected transport; defaults to fetch. Tests pass a mock. */
  httpPost?: RenderHttpPost;
  /** Shared breaker (so callers can reuse one across renders). */
  breaker?: CircuitBreaker;
  /** Retry options (tests pass a no-op sleep). */
  retry?: RetryOptions;
  /**
   * Overrides for the worker endpoint + bearer (defaults read from env). Injectable so a unit
   * test never needs process.env wired and the function fails loud only in real use.
   */
  renderUrl?: string;
  token?: string;
};

/** Default transport: POST via fetch. */
const fetchPost: RenderHttpPost = (url, init) =>
  fetch(url, { method: "POST", headers: init.headers, body: init.body });

function requireValue(value: string | undefined, name: string): string {
  if (!value) throw new Error(`renderCompetitorReportPdf: missing required ${name}`);
  return value;
}

/**
 * Render a self-contained competitor-report HTML string to print-ready PDF bytes via the
 * controlled-host Chromium worker. POSTs `{ html }` to INTEL_REPORT_RENDER_URL (falling back to
 * the shared MAIL_RENDER_URL worker) with a RENDER_TOKEN bearer; the worker
 * page.setContent(html) + page.pdf() back. Fails loud on missing config; retries transient
 * failures and trips the circuit breaker after repeated failure.
 */
export async function renderCompetitorReportPdf(
  html: string,
  deps: ReportPdfDeps = {},
): Promise<Uint8Array> {
  const renderUrl = requireValue(
    deps.renderUrl ?? process.env.INTEL_REPORT_RENDER_URL ?? process.env.MAIL_RENDER_URL,
    "INTEL_REPORT_RENDER_URL (or MAIL_RENDER_URL)",
  );
  const token = requireValue(deps.token ?? process.env.RENDER_TOKEN, "RENDER_TOKEN");

  const post = deps.httpPost ?? fetchPost;
  const breaker = deps.breaker ?? new CircuitBreaker();

  return breaker.execute(() =>
    withRetry(async () => {
      const res = await post(renderUrl, {
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ html }),
      });
      if (!res.ok) {
        throw new Error(`competitor report render worker responded ${res.status}`);
      }
      return new Uint8Array(await res.arrayBuffer());
    }, deps.retry),
  );
}
