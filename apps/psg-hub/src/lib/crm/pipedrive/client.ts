import "server-only";

// PSG-423 — Minimal, READ-ONLY Pipedrive client. No feature build: just enough to
// prove we can reach the account. The HTTP transport (deps.httpGet) is injected so
// unit tests mock it — the live API is NEVER hit in CI (mirrors render-client.ts).
//
// Secret hygiene: the `api_token` is a query param required by Pipedrive's
// personal-token auth, but it is NEVER placed in any thrown Error message or log.
// Errors carry only the request PATH + HTTP status, so the token cannot leak into
// stack traces, audit rows, or the JSON returned to the client.

import { loadPipedriveConfig, type PipedriveConfig } from "./config";

/** Minimal response surface the client needs from the transport. */
export type PipedriveHttpResponse = {
  ok: boolean;
  status: number;
  json(): Promise<unknown>;
};

export type PipedriveHttpGet = (url: string) => Promise<PipedriveHttpResponse>;

/** Default transport: a plain GET via fetch (no caching — this is a live probe). */
const fetchGet: PipedriveHttpGet = (url) =>
  fetch(url, { method: "GET", cache: "no-store" });

export type PipedriveDeps = {
  /** Injected config (tests pass a fixture; default loads from env). */
  config?: PipedriveConfig;
  /** Injected transport; defaults to fetch. Tests pass a mock. */
  httpGet?: PipedriveHttpGet;
};

/** Non-2xx from the Pipedrive API. Message is secret-free (path + status only). */
export class PipedriveApiError extends Error {
  readonly status: number;
  constructor(path: string, status: number) {
    super(`Pipedrive GET ${path} responded ${status}`);
    this.name = "PipedriveApiError";
    this.status = status;
  }
}

export type PipedriveUser = {
  id: number | null;
  name: string | null;
  email: string | null;
  companyId: number | null;
  companyName: string | null;
  companyDomain: string | null;
};

export type PipedrivePing = {
  reachable: true;
  user: PipedriveUser;
  /** Best-effort total deal count from the list-collection pagination metadata. */
  dealCount: number | null;
};

/** Build the request URL. `path` already begins with "/". Token is the auth query. */
function buildUrl(config: PipedriveConfig, path: string): string {
  const sep = path.includes("?") ? "&" : "?";
  return `${config.baseUrl}${path}${sep}api_token=${encodeURIComponent(
    config.apiToken,
  )}`;
}

/** GET + parse JSON. Throws PipedriveApiError (secret-free) on a non-2xx response. */
async function getJson(
  get: PipedriveHttpGet,
  config: PipedriveConfig,
  path: string,
): Promise<unknown> {
  const res = await get(buildUrl(config, path));
  if (!res.ok) {
    // NB: pass `path`, never the built URL — the URL carries the api_token.
    throw new PipedriveApiError(path, res.status);
  }
  return res.json();
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" ? (value as Record<string, unknown>) : {};
}

function numOrNull(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function strOrNull(value: unknown): string | null {
  return typeof value === "string" && value !== "" ? value : null;
}

/** Map `GET /users/me` `data` into our typed user/company shape. */
function parseMe(payload: unknown): PipedriveUser {
  const data = asRecord(asRecord(payload).data);
  return {
    id: numOrNull(data.id),
    name: strOrNull(data.name),
    email: strOrNull(data.email),
    companyId: numOrNull(data.company_id),
    companyName: strOrNull(data.company_name),
    companyDomain: strOrNull(data.company_domain),
  };
}

/**
 * READ-ONLY connection test. Calls `GET /users/me` to prove the token + domain
 * reach the account and surfaces the authenticated user + company. Best-effort,
 * also counts deals via `GET /deals?limit=1` pagination metadata (failure there is
 * swallowed — it must not fail the reachability check).
 *
 * Throws PipedriveConfigError (missing env) or PipedriveApiError (non-2xx). The
 * caller (ping route) translates those into a red result; a returned value always
 * means reachable=true.
 */
export async function pingPipedrive(
  deps: PipedriveDeps = {},
): Promise<PipedrivePing> {
  const config = deps.config ?? loadPipedriveConfig();
  const get = deps.httpGet ?? fetchGet;

  const user = parseMe(await getJson(get, config, "/users/me"));

  let dealCount: number | null = null;
  try {
    const deals = asRecord(await getJson(get, config, "/deals?limit=1"));
    const pagination = asRecord(
      asRecord(deals.additional_data).pagination,
    );
    dealCount = numOrNull(pagination.total_count);
  } catch {
    // Reachability already proven by /users/me; deal count is a nice-to-have.
  }

  return { reachable: true, user, dealCount };
}
