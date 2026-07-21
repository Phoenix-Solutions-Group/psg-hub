import "server-only";
import {
  CircuitBreaker,
  withRetry,
  type RetryOptions,
} from "@/lib/resilience";

const TSDR_BASE_URL = "https://tsdrapi.uspto.gov/ts/cd";
const TSDR_TIMEOUT_MS = 30_000;

const API_KEY_ENV_CANDIDATES = ["USPTO_TSDR_API_KEY", "USPTO_API_KEY"];

export type TsdrCasePrefix = "sn" | "rn";

export type TsdrCaseInput = {
  type?: TsdrCasePrefix;
  value: string;
};

export type TsdrConfig = {
  apiKey: string;
  keySource: string;
};

export type TsdrStatusResponse = {
  caseId: string;
  format: "xml";
  sourceUrl: string;
  xml: string;
};

export class TsdrConfigError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "TsdrConfigError";
  }
}

export class TsdrHttpError extends Error {
  constructor(
    public readonly status: number,
    message: string
  ) {
    super(message);
    this.name = "TsdrHttpError";
  }
}

export type TsdrFetch = (
  requestUrl: string,
  init: RequestInit
) => Promise<Pick<Response, "ok" | "status" | "text">>;

export type FetchTsdrStatusDeps = {
  apiKey?: string;
  fetchImpl?: TsdrFetch;
  breaker?: CircuitBreaker;
  retry?: RetryOptions;
};

const defaultBreaker = new CircuitBreaker({
  failureThreshold: 5,
  resetTimeoutMs: 30_000,
  isFailure: isRetryableTsdrError,
});

export function tsdrConfigured(env: NodeJS.ProcessEnv = process.env): boolean {
  return Boolean(resolveTsdrConfig(env));
}

export function resolveTsdrConfig(
  env: NodeJS.ProcessEnv = process.env
): TsdrConfig | null {
  for (const keySource of API_KEY_ENV_CANDIDATES) {
    const apiKey = env[keySource]?.trim();
    if (apiKey) return { apiKey, keySource };
  }
  return null;
}

export function normalizeTsdrCaseId(input: TsdrCaseInput | string): string {
  const raw =
    typeof input === "string" ? input : `${input.type ?? ""}${input.value}`;
  const compact = raw.trim().toLowerCase().replace(/[\s-]+/g, "");
  const explicit = compact.match(/^(sn|rn)(\d+)$/);
  if (explicit) return `${explicit[1]}${explicit[2]}`;

  const digits = compact.match(/^\d+$/);
  if (digits) return `sn${compact}`;

  throw new TsdrConfigError(
    "Enter a USPTO serial number as sn12345678 or a registration number as rn1234567."
  );
}

export function buildTsdrStatusUrl(caseInput: TsdrCaseInput | string): string {
  const caseId = normalizeTsdrCaseId(caseInput);
  return `${TSDR_BASE_URL}/casestatus/${caseId}/info.xml`;
}

export function isRetryableTsdrError(error: unknown): boolean {
  if (error instanceof TsdrHttpError) {
    return error.status === 408 || error.status === 429 || error.status >= 500;
  }
  return true;
}

export async function fetchTsdrStatus(
  caseInput: TsdrCaseInput | string,
  deps: FetchTsdrStatusDeps = {}
): Promise<TsdrStatusResponse> {
  const config = deps.apiKey
    ? { apiKey: deps.apiKey, keySource: "override" }
    : resolveTsdrConfig();
  if (!config) {
    throw new TsdrConfigError(
      "USPTO_TSDR_API_KEY is required for USPTO trademark status lookup."
    );
  }

  const caseId = normalizeTsdrCaseId(caseInput);
  const requestUrl = buildTsdrStatusUrl(caseId);
  const fetchImpl = deps.fetchImpl ?? defaultFetch;
  const breaker = deps.breaker ?? defaultBreaker;
  const retry: RetryOptions = {
    retries: 3,
    baseDelayMs: 250,
    maxDelayMs: 5000,
    isRetryable: isRetryableTsdrError,
    ...deps.retry,
  };

  return breaker.execute(() =>
    withRetry(async () => {
      const res = await fetchImpl(requestUrl, {
        headers: {
          Accept: "application/xml",
          "USPTO-API-KEY": config.apiKey,
        },
        cache: "no-store",
      });

      if (!res.ok) {
        let body = "";
        try {
          body = (await res.text()).replace(/\s+/g, " ").trim().slice(0, 500);
        } catch {
          // Ignore unreadable error bodies. The HTTP status is still actionable.
        }
        throw new TsdrHttpError(
          res.status,
          body ? `USPTO TSDR HTTP ${res.status}: ${body}` : `USPTO TSDR HTTP ${res.status}`
        );
      }

      return {
        caseId,
        format: "xml",
        sourceUrl: requestUrl,
        xml: await res.text(),
      };
    }, retry)
  );
}

const defaultFetch: TsdrFetch = async (requestUrl, init) => {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TSDR_TIMEOUT_MS);
  try {
    return await fetch(requestUrl, { ...init, signal: controller.signal });
  } finally {
    clearTimeout(timer);
  }
};
