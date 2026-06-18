/**
 * Production mail render-to-PDF client (v1.3, PSG-42).
 *
 * Mirrors the report render client (src/lib/report/render-client.ts): Chromium
 * does not run on Vercel Fluid (the report module's research refuted it —
 * libnss3.so launch break), so PDF synthesis runs on a host PSG controls (the
 * same Hetzner Chromium worker family). This client POSTs the already-rendered,
 * self-contained mail HTML to that worker and gets print-ready PDF bytes back.
 *
 * DIVERGENCE from the report client: reports live at an app print route, so the
 * worker does `page.goto(url)`. Mail HTML is rendered for Lob (no app origin to
 * resolve against), so it is shipped inline and the worker does
 * `page.setContent(html)` then `page.pdf()`. Hence we POST `{ html }`, not
 * `{ url }`.
 *
 * WHY PDF AT ALL: the Lob adapter accepts HTML directly for postcard front/back
 * and letter `file`, so the Lob submit path never needs this. PDF is for the
 * in-house print queue and for operator/Nick proofs — a print-fixed artifact.
 *
 * The HTTP call is wrapped in withRetry + CircuitBreaker (resilience
 * constraint), and the transport (deps.httpPost) is injected so unit tests mock
 * it — no real network, no real Chromium.
 */

import { withRetry, CircuitBreaker, type RetryOptions } from "../resilience";

/** Minimal response surface the client needs from the transport. */
export type RenderHttpResponse = {
  ok: boolean;
  status: number;
  arrayBuffer(): Promise<ArrayBuffer>;
};

export type RenderHttpPost = (
  url: string,
  init: { headers: Record<string, string>; body: string }
) => Promise<RenderHttpResponse>;

export type MailPdfDeps = {
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
    throw new Error(`renderMailPdf: missing required env ${name}`);
  }
  return value;
}

/**
 * Render a self-contained mail HTML string to print-ready PDF bytes via the
 * controlled-host Chromium worker. POSTs `{ html }` to MAIL_RENDER_URL with a
 * RENDER_TOKEN bearer; the worker `page.setContent(html)` + `page.pdf()` back.
 * Fails loud on missing env; retries transient failures and trips the circuit
 * breaker after repeated failure.
 */
export async function renderMailPdf(
  html: string,
  deps: MailPdfDeps = {}
): Promise<Uint8Array> {
  const renderUrl = requireEnv("MAIL_RENDER_URL");
  const token = requireEnv("RENDER_TOKEN");

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
        throw new Error(`mail render worker responded ${res.status}`);
      }
      return new Uint8Array(await res.arrayBuffer());
    }, deps.retry)
  );
}
