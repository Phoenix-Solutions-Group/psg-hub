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

import type { DealStatus, PipedriveDeal, RevenueType } from "./types";

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

/**
 * Derive a won deal's revenue character (PSG-435 / John's §2.1 tie-out) from the raw
 * Pipedrive payload. HONEST-NULL rule (Tess asserts it on PSG-447): only classify on
 * a real signal — never silently bucket. Precedence:
 *   1. native recurring signals — a `recurring` flag, an attached `subscription_id`,
 *      or a positive `mrr`/`recurring_revenue` → `recurring`;
 *   2. a documented deal-type / product-category marker (`revenue_type` custom field)
 *      → `recurring` | `one_time`;
 *   3. no signal → `null`, which the export surfaces LOUDLY as `unknown`
 *      (never netted against MRR until resolved).
 */
export function deriveRevenueType(raw: RawPipedriveDeal): RevenueType | null {
  if (raw.recurring === true) return "recurring";
  if (relId(raw.subscription_id) != null) return "recurring";
  const mrr = asNumber(raw.mrr ?? raw.recurring_revenue);
  if (mrr != null && mrr > 0) return "recurring";

  const marker =
    typeof raw.revenue_type === "string" ? raw.revenue_type.toLowerCase().trim() : null;
  if (marker === "recurring" || marker === "mrr" || marker === "subscription") {
    return "recurring";
  }
  if (
    marker === "one_time" ||
    marker === "one-time" ||
    marker === "onetime" ||
    marker === "project"
  ) {
    return "one_time";
  }
  return null; // honest-null: unmapped → reported as `unknown` at the export
}

function round2(n: number): number {
  return Math.round((n + Number.EPSILON) * 100) / 100;
}

// ── recurring monthly-MRR basis (PSG-468 / John's §2.1 tightening B) ──────────────
// `value` is face `$` with no period; Invoiced MRR is monthly. To net a recurring deal
// against MRR we need its normalized MONTHLY contribution — derived from the same raw
// recurring metadata as `deriveRevenueType`, honest-null when no basis is derivable.

/** Months in one unit of a recurring interval (canonical units). */
const UNIT_MONTHS: Record<string, number> = {
  day: 12 / 365,
  week: 12 / 52,
  month: 1,
  quarter: 3,
  year: 12,
};

/** Keyword cadences carry a full period themselves (an `interval_count` is ignored). */
const CADENCE: Record<string, { unit: keyof typeof UNIT_MONTHS; count: number }> = {
  daily: { unit: "day", count: 1 },
  weekly: { unit: "week", count: 1 },
  biweekly: { unit: "week", count: 2 },
  fortnightly: { unit: "week", count: 2 },
  monthly: { unit: "month", count: 1 },
  quarterly: { unit: "quarter", count: 1 },
  semiannual: { unit: "month", count: 6 },
  "semi-annual": { unit: "month", count: 6 },
  semiannually: { unit: "month", count: 6 },
  biannual: { unit: "month", count: 6 },
  "half-yearly": { unit: "month", count: 6 },
  annual: { unit: "year", count: 1 },
  annually: { unit: "year", count: 1 },
  yearly: { unit: "year", count: 1 },
};

/** Bare interval units (Stripe-style) — pair with an optional `interval_count`. */
const BARE_UNIT: Record<string, keyof typeof UNIT_MONTHS> = {
  day: "day",
  week: "week",
  month: "month",
  quarter: "quarter",
  year: "year",
};

/**
 * Resolve a recurring deal's billing period to a number of MONTHS, or `null` when the
 * interval can't be derived. Accepts a keyword cadence (`cadence_type: "monthly"`/
 * `"yearly"`) or a bare unit + count (`interval: "month"`, `interval_count: 3`).
 */
function monthsPerPeriod(raw: RawPipedriveDeal): number | null {
  const rawUnit =
    raw.cadence_type ??
    raw.recurring_interval ??
    raw.billing_frequency ??
    raw.recurring_period ??
    raw.interval;
  if (typeof rawUnit !== "string") return null;
  const u = rawUnit.trim().toLowerCase();
  if (u === "") return null;

  const cadence = CADENCE[u];
  if (cadence) return UNIT_MONTHS[cadence.unit] * cadence.count;

  const unit = BARE_UNIT[u];
  if (!unit) return null;
  const count =
    asNumber(raw.recurring_interval_count ?? raw.interval_count ?? raw.cadence_count) ??
    1;
  const months = UNIT_MONTHS[unit] * (count > 0 ? count : 1);
  return months > 0 ? months : null;
}

/**
 * Derive a WON `recurring` deal's normalized **monthly** MRR contribution (PSG-468).
 * Precedence:
 *   1. a native monthly figure (`mrr` / `recurring_revenue`) — already normalized;
 *   2. a recurring amount (`recurring_amount` / `cycle_amount`) ÷ its interval-in-months.
 * HONEST-NULL: a non-recurring deal, or a recurring deal with no derivable amount/interval,
 * returns `null` — never silently annualized or assumed monthly (it is flagged for manual
 * reconcile downstream, counted but never mechanically netted against Invoiced MRR).
 */
export function deriveMonthlyValue(raw: RawPipedriveDeal): number | null {
  if (deriveRevenueType(raw) !== "recurring") return null;

  const mrr = asNumber(raw.mrr ?? raw.recurring_revenue);
  if (mrr != null && mrr > 0) return round2(mrr);

  const amount = asNumber(
    raw.recurring_amount ?? raw.cycle_amount ?? raw.subscription_amount,
  );
  if (amount == null || amount <= 0) return null;

  const months = monthsPerPeriod(raw);
  if (months == null) return null; // interval/basis not derivable → honest-null
  return round2(amount / months);
}

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
    // Revenue character for the won/booked §2.1 tie-out; honest-null when unmapped.
    revenueType: deriveRevenueType(raw),
    // Normalized monthly MRR basis for recurring deals; honest-null when underivable.
    monthlyValue: deriveMonthlyValue(raw),
  };
}

interface DealsPage {
  data: RawPipedriveDeal[];
  nextCursor: string | null;
}

/** Raw Pipedrive stage payload — loose, mapped defensively (v1/v2). */
export type RawPipedriveStage = Record<string, unknown>;

/**
 * A Pipedrive pipeline stage. PSG-622: Pipedrive v2 `/deals` returns `stage_id` but not
 * the stage label, so we fetch `/api/v2/stages` and join the name in. `orderNr` is the
 * stage's position within its pipeline (useful when confirming the stage → Sn mapping).
 */
export interface PipedriveStage {
  id: number;
  name: string | null;
  pipelineId: number | null;
  orderNr: number | null;
}

/** Map a raw Pipedrive stage onto `PipedriveStage`. */
export function mapRawStage(raw: RawPipedriveStage): PipedriveStage {
  return {
    id: asNumber(raw.id) ?? 0,
    name: typeof raw.name === "string" ? raw.name : null,
    pipelineId: relId(raw.pipeline_id),
    orderNr: asNumber(raw.order_nr),
  };
}

/** A typed Pipedrive client. Only what the sync needs: paginated deal + stage reads. */
export interface PipedriveClient {
  /** All open deals (cursor-paginated, mapped, stage names joined in). */
  fetchOpenDeals(): Promise<PipedriveDeal[]>;
  /** Deals of a given status updated on/after `updatedSince` (ISO). For churn/YoY. */
  fetchDealsByStatus(
    status: Extract<DealStatus, "won" | "lost">,
    updatedSince?: string,
  ): Promise<PipedriveDeal[]>;
  /** All pipeline stages (cursor-paginated, mapped). PSG-622 — source of stage names. */
  fetchStages(): Promise<PipedriveStage[]>;
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

  // PSG-622 — one page of `/api/v2/stages` (same cursor-pagination shape as /deals).
  async function getStagesPage(
    cursor: string | null,
  ): Promise<{ data: RawPipedriveStage[]; nextCursor: string | null }> {
    const url = new URL(`${base}/api/v2/stages`);
    url.searchParams.set("limit", String(limit));
    if (cursor) url.searchParams.set("cursor", cursor);
    url.searchParams.set("api_token", apiToken);

    const res = await doFetch(url.toString(), {
      method: "GET",
      headers: { Accept: "application/json" },
    });
    if (!res.ok) {
      // Never include the URL (it carries the token) in the error.
      throw new PipedriveError(
        `Pipedrive /stages returned HTTP ${res.status}`,
        res.status,
      );
    }
    const body = (await res.json()) as {
      success?: boolean;
      data?: RawPipedriveStage[] | null;
      additional_data?: { next_cursor?: string | null } | null;
    };
    if (body.success === false) {
      throw new PipedriveError("Pipedrive /stages returned success=false");
    }
    return {
      data: Array.isArray(body.data) ? body.data : [],
      nextCursor: body.additional_data?.next_cursor ?? null,
    };
  }

  async function fetchStages(): Promise<PipedriveStage[]> {
    const out: PipedriveStage[] = [];
    let cursor: string | null = null;
    for (let page = 0; page < maxPages; page += 1) {
      const { data, nextCursor } = await getStagesPage(cursor);
      for (const raw of data) out.push(mapRawStage(raw));
      if (!nextCursor) return out;
      cursor = nextCursor;
    }
    throw new PipedriveError(`Pipedrive stage pagination exceeded ${maxPages} pages`);
  }

  // PSG-646 — one page of `/api/v2/organizations` (same cursor-pagination shape as /deals
  // and /stages). Pipedrive v2 `/deals` returns `org_id` as a bare number with NO org name,
  // so — exactly like stage labels (PSG-622) — we fetch organizations and join the name in.
  // Without this the deals mirror stores `orgName: null` for every deal, and the recurring
  // engine's `activeRecurringAccounts()` (which keys the monthly cycle off org name) skips
  // every account → the monthly cron provisions ZERO boards. Surfaced by the PSG-646 pilot.
  async function getOrgsPage(
    cursor: string | null,
  ): Promise<{ data: Array<Record<string, unknown>>; nextCursor: string | null }> {
    const url = new URL(`${base}/api/v2/organizations`);
    url.searchParams.set("limit", String(limit));
    if (cursor) url.searchParams.set("cursor", cursor);
    url.searchParams.set("api_token", apiToken);

    const res = await doFetch(url.toString(), {
      method: "GET",
      headers: { Accept: "application/json" },
    });
    if (!res.ok) {
      // Never include the URL (it carries the token) in the error.
      throw new PipedriveError(
        `Pipedrive /organizations returned HTTP ${res.status}`,
        res.status,
      );
    }
    const body = (await res.json()) as {
      success?: boolean;
      data?: Array<Record<string, unknown>> | null;
      additional_data?: { next_cursor?: string | null } | null;
    };
    if (body.success === false) {
      throw new PipedriveError("Pipedrive /organizations returned success=false");
    }
    return {
      data: Array.isArray(body.data) ? body.data : [],
      nextCursor: body.additional_data?.next_cursor ?? null,
    };
  }

  async function fetchOrgs(): Promise<Array<{ id: number; name: string | null }>> {
    const out: Array<{ id: number; name: string | null }> = [];
    let cursor: string | null = null;
    for (let page = 0; page < maxPages; page += 1) {
      const { data, nextCursor } = await getOrgsPage(cursor);
      for (const raw of data) {
        const id = asNumber(raw.id);
        if (id == null) continue;
        out.push({ id, name: typeof raw.name === "string" ? raw.name : null });
      }
      if (!nextCursor) return out;
      cursor = nextCursor;
    }
    throw new PipedriveError(`Pipedrive organization pagination exceeded ${maxPages} pages`);
  }

  // Fetch org names once per client and memoize. RESILIENT (same discipline as stage names,
  // PSG-622): an organizations-endpoint failure must NOT break the deal sync — on failure we
  // fall back to an empty map, so deals still sync with `orgName` null (prior behavior).
  let orgNamesPromise: Promise<Map<number, string>> | null = null;
  function loadOrgNames(): Promise<Map<number, string>> {
    if (!orgNamesPromise) {
      orgNamesPromise = fetchOrgs()
        .then((orgs) => {
          const m = new Map<number, string>();
          for (const o of orgs) {
            if (o.name != null && o.name !== "") m.set(o.id, o.name);
          }
          return m;
        })
        .catch(() => new Map<number, string>());
    }
    return orgNamesPromise;
  }

  // Fetch stage names once per client and memoize. RESILIENT (PSG-622): a stages-endpoint
  // failure must NOT break the deal sync — the raw open-pipeline-$ (proven in PSG-446) is
  // the load-bearing number, and it doesn't need names. On failure we fall back to an
  // empty map, so deals still sync with `stageName` null (exactly today's behavior).
  let stageNamesPromise: Promise<Map<number, string>> | null = null;
  function loadStageNames(): Promise<Map<number, string>> {
    if (!stageNamesPromise) {
      stageNamesPromise = fetchStages()
        .then((stages) => {
          const m = new Map<number, string>();
          for (const s of stages) {
            if (s.name != null && s.name !== "") m.set(s.id, s.name);
          }
          return m;
        })
        .catch(() => new Map<number, string>());
    }
    return stageNamesPromise;
  }

  async function paginate(
    status: DealStatus,
    updatedSince?: string,
  ): Promise<PipedriveDeal[]> {
    // Join stage names (PSG-622) + org names (PSG-646). Both fetched once per client;
    // failure → empty map (that field stays null, prior behavior).
    const stageNames = await loadStageNames();
    const orgNames = await loadOrgNames();
    const out: PipedriveDeal[] = [];
    let cursor: string | null = null;
    for (let page = 0; page < maxPages; page += 1) {
      const { data, nextCursor }: DealsPage = await getPage(
        status,
        cursor,
        updatedSince,
      );
      for (const raw of data) {
        const deal = mapRawDeal(raw);
        // Only fill from the stages lookup when the raw payload didn't carry a name (v2).
        if (deal.stageName == null && deal.stageId != null) {
          const name = stageNames.get(deal.stageId);
          if (name) deal.stageName = name;
        }
        // Same for org names — v2 `/deals` gives `org_id` (number) but no org name.
        if (deal.orgName == null && deal.orgId != null) {
          const name = orgNames.get(deal.orgId);
          if (name) deal.orgName = name;
        }
        out.push(deal);
      }
      if (!nextCursor) return out;
      cursor = nextCursor;
    }
    throw new PipedriveError(`Pipedrive pagination exceeded ${maxPages} pages`);
  }

  return {
    fetchOpenDeals: () => paginate("open"),
    fetchDealsByStatus: (status, updatedSince) =>
      paginate(status, updatedSince),
    fetchStages,
  };
}
