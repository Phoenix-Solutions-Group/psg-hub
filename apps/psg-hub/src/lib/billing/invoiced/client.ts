// Minimal read-only Invoiced.app client — PSG-422.
// Scope: a single `pingInvoiced()` reachability probe. NO writes, NO mirror, NO
// webhook. Mirrors the "one breaker per service" outbound posture of stripe.ts /
// the SendGrid+Twilio+Google adapters.
//
// Auth: Invoiced REST uses HTTP Basic with the API key as the username and an
// EMPTY password — `Authorization: Basic base64(`${apiKey}:`)`.
//
// The HTTP layer is injected (`fetchImpl`) so unit tests mock it and CI never
// touches the live API.

import { CircuitBreaker, withRetry } from "@/lib/resilience";
import {
  type InvoicedConfig,
  type InvoicedEnvironment,
  InvoicedConfigError,
  loadInvoicedConfig,
} from "./config";

// Default reachability probe: cheapest authenticated read that proves the key is
// accepted against the account. `per_page=1` keeps the payload tiny.
const PING_PATH = "/customers?per_page=1";

// One shared breaker for outbound Invoiced calls (service-level, not per-call).
const invoicedBreaker = new CircuitBreaker({
  failureThreshold: 5,
  resetTimeoutMs: 30_000,
});

export type FetchLike = (
  url: string,
  init: { method: string; headers: Record<string, string> },
) => Promise<{
  ok: boolean;
  status: number;
  headers: { get(name: string): string | null };
  json(): Promise<unknown>;
  text(): Promise<string>;
}>;

/** Best-effort account/company identity surfaced from a reachable response. */
export interface InvoicedAccount {
  /** Account/company id, when the API exposes one (header or body). */
  id: string | null;
  /** Account/company name, when derivable from the response. */
  name: string | null;
  /** Where the identity was read from (header name or body field) — for honesty. */
  source: string;
}

export interface InvoicedPingResult {
  reachable: boolean;
  environment: InvoicedEnvironment;
  /** Env var NAME the key resolved from (never the value). */
  keySource: string;
  /** HTTP status of the probe, when a response was received. */
  httpStatus: number | null;
  /** Best-effort account identity; null when nothing identifying was returned. */
  account: InvoicedAccount | null;
  /** Human-readable failure reason on red; omitted on green. */
  error?: string;
}

function basicAuthHeader(apiKey: string): string {
  // API key as username, empty password.
  return `Basic ${Buffer.from(`${apiKey}:`).toString("base64")}`;
}

/**
 * Pull a best-effort account/company identity out of a probe response WITHOUT
 * assuming a particular Invoiced payload shape. Invoiced surfaces the account via
 * the `X-Account-Context` header on most responses; the customer body is a weaker
 * fallback. Returns null when nothing identifying is present (still reachable).
 */
export function extractAccount(
  headers: { get(name: string): string | null },
  body: unknown,
): InvoicedAccount | null {
  const headerAccount =
    headers.get("X-Account-Context") ?? headers.get("x-account-context");
  if (headerAccount) {
    return { id: headerAccount, name: null, source: "header:X-Account-Context" };
  }

  // Body fallback: /customers returns an array; surface the first record as proof
  // the account holds real data. Top-level {name}/{company} covers other shapes.
  if (Array.isArray(body) && body.length > 0) {
    const first = body[0] as Record<string, unknown>;
    const id = typeof first.id === "number" || typeof first.id === "string"
      ? String(first.id)
      : null;
    const name = typeof first.name === "string" ? first.name : null;
    if (id || name) return { id, name, source: "body:customers[0]" };
  } else if (body && typeof body === "object") {
    const obj = body as Record<string, unknown>;
    const name =
      (typeof obj.name === "string" && obj.name) ||
      (typeof obj.company === "string" && obj.company) ||
      null;
    const id = typeof obj.id === "string" ? obj.id : null;
    if (id || name) return { id, name, source: "body:object" };
  }

  return null;
}

/**
 * Read-only reachability probe against the Invoiced account.
 * Resolves the key + base URL from env (sandbox unless INVOICED_ENV=live), issues
 * a single authenticated GET, and reports reachable + the resolved env var name +
 * a best-effort account identity. Never throws for HTTP/auth failures — returns a
 * red result so the caller can render it; only re-throws nothing (config errors
 * become a red result too).
 */
export async function pingInvoiced(
  fetchImpl: FetchLike = globalThis.fetch as unknown as FetchLike,
  configOverride?: InvoicedConfig,
): Promise<InvoicedPingResult> {
  let config: InvoicedConfig;
  try {
    config = configOverride ?? loadInvoicedConfig();
  } catch (error) {
    if (error instanceof InvoicedConfigError) {
      return {
        reachable: false,
        environment: "sandbox",
        keySource: "",
        httpStatus: null,
        account: null,
        error: error.message,
      };
    }
    throw error;
  }

  const base = {
    reachable: false,
    environment: config.environment,
    keySource: config.keySource,
  } as const;

  try {
    // A non-ok HTTP status is returned as a value (handled below), not thrown, so
    // withRetry only ever sees genuine network/transport throws — retry those.
    const response = await invoicedBreaker.execute(() =>
      withRetry(() =>
        fetchImpl(`${config.baseUrl}${PING_PATH}`, {
          method: "GET",
          headers: {
            Authorization: basicAuthHeader(config.apiKey),
            Accept: "application/json",
          },
        }),
      ),
    );

    if (!response.ok) {
      const detail = await response.text().catch(() => "");
      return {
        ...base,
        httpStatus: response.status,
        account: null,
        error:
          response.status === 401 || response.status === 403
            ? `Invoiced rejected the key (HTTP ${response.status}) — check the key and that it matches the ${config.environment} environment.`
            : `Invoiced returned HTTP ${response.status}${detail ? `: ${detail.slice(0, 200)}` : ""}.`,
      };
    }

    const body = await response.json().catch(() => null);
    return {
      ...base,
      reachable: true,
      httpStatus: response.status,
      account: extractAccount(response.headers, body),
    };
  } catch (error) {
    return {
      ...base,
      httpStatus: null,
      account: null,
      error: error instanceof Error ? error.message : "Unknown error reaching Invoiced.",
    };
  }
}
