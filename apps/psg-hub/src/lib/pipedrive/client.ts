// PSG-446 — Typed Pipedrive REST client (durable sync read path, PSG-434).
// Paginates `GET /api/v2/deals` (cursor pagination) over all open deals, plus a
// recently-updated won/lost pull for churn / YoY context, and maps the raw payload
// onto `PipedriveDeal`. Pure-ish: the token, company domain and `fetch` impl are all
// injectable so this is unit-tested against a mocked fetch with no live token.
//
// Auth: a read-only `PIPEDRIVE_API_TOKEN` (provisioned by the operator — see PSG-445).
// The token is read server-side only (the cron entrypoint passes it in); it is never
// logged and never returned. Base URL prefers the company domain
// (`https://<company>.pipedrive.com`) and falls back to `https://api.pipedrive.com`.

import type { DealStatus, PipedriveDeal } from "./types";

/** Raw Pipedrive deal payload — intentionally loose; we map defensively (v1/v2). */
export type RawPipedriveDeal = Record<string, unknown>;

export interface PipedriveClientConfig {
  /** Read-only Pipedrive API token. Defaults to `process.env.PIPEDRIVE_API_TOKEN`. */
  apiToken?: string;
  /** Company subdomain (the `<company>` in `<company>.pipedrive.com`). Optional. */
  companyDomain?: string | null;
  /** Injectable fetch (defaults to global `fetch`) — the seam unit tests mock. */
  fetchImpl?: typeof fetch;
  /** Page size for cursor pagination (Pipedrive v2 max is 500). */
  pageLimit?: number;
  /** Hard cap on pages, so a runaway `next_cursor` can never loop forever. */
  maxPages?: number;
}

export class PipedriveError extends Error {
  readonly status?: number;
  constructor(message: string, status?: number) {
    super(message);
    this.name = "PipedriveError";
    this.status = status;
  }
}

/** Base REST URL for a company domain (or the shared API host when unknown). */
export function pipedriveBaseUrl(companyDomain?: string | null): string {
  const domain = (companyDomain ?? "").trim();
  if (!domain) return "https://api.pipedrive.com";
  // Accept either the bare subdomain or a full host; normalise to the subdomain.
  const sub = domain.replace(/^https?:\/\//, "").replace(/\.pipedrive\.com.*$/, "");
  return `https://${sub}.pipedrive.com`;
}

// ── mapping helpers ─────────────────────────────────────────────────────────────
// Pipedrive returns related objects sometimes as a bare id (v2) and sometimes as a
// nested `{ value, name }` / `{ id, name }` object (v1). Map both shapes defensively.

function asNumber(v: unknown): number | null {
  if (v == null) return null;
  const n = typeof v === "number" ? v : Number(v);
  return Number.isFinite(n) ? n : null;
}

function relId(v: unknown): number | null {
  if (v == null) return null;
  if (typeof v === "object") {
    const o = v as Record<string, unknown>;
    return asNumber(o.value ?? o.id);
  }
  return asNumber(v);
}

function relName(v: unknown): string | null {
  if (v && typeof v === "object") {
    const o = v as Record<string, unknown>;
    return typeof o.name === "string" ? o.name : null;
  }
  return null;
}

/** ISO date (YYYY-MM-DD) from a Pipedrive date or timestamp; null when absent. */
function isoDate(v: unknown): string | null {
  if (typeof v !== "string" || v.trim() === "") return null;
  // Pipedrive dates are "YYYY-MM-DD"; timestamps are "YYYY-MM-DD HH:MM:SS".
  return v.slice(0, 10);
}

const VALID_STATUS: ReadonlySet<string> = new Set([
  "open",
  "won",
  "lost",
  "deleted",
]);

/** Map a raw Pipedrive deal onto the mirror's `PipedriveDeal`. */
export function mapRawDeal(raw: RawPipedriveDeal): PipedriveDeal {
  const status = String(raw.status ?? "open");
  return {
    dealId: asNumber(raw.id) ?? 0,
    title: typeof raw.title === "string" ? raw.title : null,
    value: asNumber(raw.value) ?? 0,
    currency: typeof raw.currency === "string" ? raw.currency : "USD",
    status: (VALID_STATUS.has(status) ? status : "open") as DealStatus,
    pipelineId: relId(raw.pipeline_id),
    stageId: relId(raw.stage_id),
    stageName: typeof raw.stage_name === "string" ? raw.stage_name : null,
    winProbability: asNumber(raw.probability),
    orgId: relId(raw.org_id),
    orgName: typeof raw.org_name === "string" ? raw.org_name : relName(raw.org_id),
    personId: relId(raw.person_id),
    // v2 flattens to `owner_id`; v1 nested under `user_id` / `owner_id`.
    ownerId: relId(raw.owner_id ?? raw.user_id),
    ownerName:
      typeof raw.owner_name === "string"
        ? raw.owner_name
        : relName(raw.owner_id ?? raw.user_id),
    expectedCloseDate: isoDate(raw.expected_close_date),
    // ACTUAL close: `close_time` (won/lost) — distinct from the forecasted date.
    closeDate: isoDate(raw.close_time ?? raw.close_date),
    lastActivityDate: isoDate(raw.last_activity_date),
  };
}

interface DealsPage {
  data: RawPipedriveDeal[];
  nextCursor: string | null;
}

/** A typed Pipedrive client. Only what the sync needs: paginated deal reads. */
export interface PipedriveClient {
  /** All open deals (cursor-paginated, mapped). */
  fetchOpenDeals(): Promise<PipedriveDeal[]>;
  /** Deals of a given status updated on/after `updatedSince` (ISO). For churn/YoY. */
  fetchDealsByStatus(
    status: Extract<DealStatus, "won" | "lost">,
    updatedSince?: string,
  ): Promise<PipedriveDeal[]>;
}

export function createPipedriveClient(
  config: PipedriveClientConfig = {},
): PipedriveClient {
  const apiToken = config.apiToken ?? process.env.PIPEDRIVE_API_TOKEN ?? "";
  if (!apiToken) {
    throw new PipedriveError("Missing PIPEDRIVE_API_TOKEN");
  }
  const base = pipedriveBaseUrl(config.companyDomain);
  const doFetch = config.fetchImpl ?? fetch;
  const limit = Math.min(config.pageLimit ?? 500, 500);
  const maxPages = config.maxPages ?? 1000;

  async function getPage(
    status: DealStatus,
    cursor: string | null,
    updatedSince?: string,
  ): Promise<DealsPage> {
    const url = new URL(`${base}/api/v2/deals`);
    url.searchParams.set("status", status);
    url.searchParams.set("limit", String(limit));
    url.searchParams.set("sort_by", "update_time");
    url.searchParams.set("sort_direction", "desc");
    if (cursor) url.searchParams.set("cursor", cursor);
    if (updatedSince) url.searchParams.set("updated_since", updatedSince);
    // Token goes in the query param (classic personal-token auth); never logged.
    url.searchParams.set("api_token", apiToken);

    const res = await doFetch(url.toString(), {
      method: "GET",
      headers: { Accept: "application/json" },
    });
    if (!res.ok) {
      // Never include the URL (it carries the token) in the error.
      throw new PipedriveError(
        `Pipedrive /deals returned HTTP ${res.status}`,
        res.status,
      );
    }
    const body = (await res.json()) as {
      success?: boolean;
      data?: RawPipedriveDeal[] | null;
      additional_data?: { next_cursor?: string | null } | null;
    };
    if (body.success === false) {
      throw new PipedriveError("Pipedrive /deals returned success=false");
    }
    return {
      data: Array.isArray(body.data) ? body.data : [],
      nextCursor: body.additional_data?.next_cursor ?? null,
    };
  }

  async function paginate(
    status: DealStatus,
    updatedSince?: string,
  ): Promise<PipedriveDeal[]> {
    const out: PipedriveDeal[] = [];
    let cursor: string | null = null;
    for (let page = 0; page < maxPages; page += 1) {
      const { data, nextCursor }: DealsPage = await getPage(
        status,
        cursor,
        updatedSince,
      );
      for (const raw of data) out.push(mapRawDeal(raw));
      if (!nextCursor) return out;
      cursor = nextCursor;
    }
    throw new PipedriveError(`Pipedrive pagination exceeded ${maxPages} pages`);
  }

  return {
    fetchOpenDeals: () => paginate("open"),
    fetchDealsByStatus: (status, updatedSince) =>
      paginate(status, updatedSince),
  };
}
