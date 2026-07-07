// PSG-824 (Group A of PSG-819, Nick-approved) — one-time records fix: flip 5 mis-marked
// WHM monthly-maintenance deals to "won" in Pipedrive.
//
// Why: five live monthly-maintenance clients have their Pipedrive deal mis-marked (four
// `lost`, one `open`). Because `activeRecurringAccounts()` (recurring-accounts.ts) only
// treats an org as an active recurring account when it has a WON deal, these shops are
// invisible to the monthly engine. Correcting the deal to `won` makes the mirror sync pick
// them up; the roster env (`RECURRING_MAINTENANCE_ROSTER`) then gates which of the won orgs
// actually get a monthly board (38 → 43).
//
// SAFETY (this is a live-CRM write with the admin token):
//   • The five target deal ids are a HARD-CODED allowlist (`FLIP_DEALS_WON_TARGETS`). The
//     endpoint NEVER accepts deal ids from the request body, so this path can only ever
//     touch these exact five deals — it cannot be repurposed to flip an arbitrary deal.
//   • Org guard: before writing, we re-read the live deal and require its `org_id` to match
//     the expected org id for that target. A mismatch is recorded as an error and SKIPPED
//     (never flipped), so a stale/re-pointed deal id can never win the wrong record.
//   • Idempotent: a deal already `won` is left untouched (no write) and reported as
//     `skipped_already_won`, so re-running converges and never double-writes.
//   • Value integrity: we PUT ONLY `{ status: "won" }`. The existing deal value/currency are
//     never touched — we do not invent or inflate amounts (per the ticket).
//   • Per-deal isolation: one deal's failure is captured, not fatal — the other four still
//     process (mirrors the recurring cron's captured-error discipline).
//   • Secret hygiene: the token is carried ONLY in the query string and is never logged or
//     surfaced; errors never include the URL (which carries `?api_token=`).

import {
  PipedriveProjectsError,
  PIPEDRIVE_TOKEN_ENV_CANDIDATES,
  pipedriveBaseUrl,
  resolvePipedriveToken,
  type ProjectsClientConfig,
} from "./projects";

/** One mis-marked deal to correct, pinned to the org it must belong to. */
export interface FlipTarget {
  /** Pipedrive deal id to flip. */
  dealId: number;
  /** Org this deal MUST belong to (defense-in-depth guard before any write). */
  orgId: number;
  /** Human label for evidence/audit only. */
  orgName: string;
}

/**
 * The five deals from PSG-824 (one per org). Deal→org mapping verified against the durable
 * `pipedrive_deals` mirror (synced 2026-07-07). Island Fender (1106) has two lost deals
 * (3600, 3601); we flip only the most recent (3600) — one won deal per org is all the
 * per-org-deduped engine needs.
 */
export const FLIP_DEALS_WON_TARGETS: readonly FlipTarget[] = [
  { dealId: 3573, orgId: 8500, orgName: "Tracy's Collision Center [Main]" },
  { dealId: 3844, orgId: 1028, orgName: "Bay Cities Auto Body" },
  { dealId: 3600, orgId: 1106, orgName: "Island Fender" },
  { dealId: 3558, orgId: 1328, orgName: "Gentile's Collision" },
  { dealId: 3898, orgId: 5945, orgName: "Dan's Paint & Body" },
] as const;

/** Outcome for a single target. */
export type FlipAction = "flipped" | "skipped_already_won" | "error";

export interface FlipResult {
  dealId: number;
  orgId: number;
  orgName: string;
  action: FlipAction;
  /** Deal status read live BEFORE any write ("won" | "lost" | "open" | null when unread). */
  statusBefore: string | null;
  /** Deal status after the write (equals "won" on a successful flip). */
  statusAfter: string | null;
  /** Populated only when action === "error"; scrubbed of any token/URL. */
  reason?: string;
}

export interface FlipDealsWonResult {
  total: number;
  flipped: number;
  skippedAlreadyWon: number;
  errored: number;
  results: FlipResult[];
}

/** Minimal live-deal shape we read back from Pipedrive v1 `/deals/{id}`. */
interface LiveDeal {
  id: number;
  status: string | null;
  orgId: number | null;
  value: number | null;
  currency: string | null;
}

/** Narrow v1 deals client: read one deal, and set a deal's status to "won". */
export interface DealsWriteClient {
  get(dealId: number): Promise<LiveDeal>;
  setStatusWon(dealId: number): Promise<LiveDeal>;
}

/**
 * Self-contained Pipedrive v1 deals client (read + status write). Token resolved via
 * `resolvePipedriveToken()` and carried ONLY in the query string; errors never include the
 * URL. Mirrors the hygiene of `createWebhooksClient` in projects.ts.
 */
export function createDealsWriteClient(
  config: ProjectsClientConfig = {},
): DealsWriteClient {
  const apiKey = config.apiKey ?? resolvePipedriveToken();
  if (!apiKey) {
    throw new PipedriveProjectsError(
      `Missing Pipedrive token (set one of: ${PIPEDRIVE_TOKEN_ENV_CANDIDATES.join(", ")})`,
    );
  }
  const base = pipedriveBaseUrl(config.companyDomain);
  const doFetch = config.fetchImpl ?? fetch;

  function url(dealId: number): string {
    const u = new URL(`${base}/api/v1/deals/${dealId}`);
    u.searchParams.set("api_token", apiKey);
    return u.toString();
  }

  async function call(
    method: "GET" | "PUT",
    dealId: number,
    jsonBody?: Record<string, unknown>,
  ): Promise<LiveDeal> {
    const res = await doFetch(url(dealId), {
      method,
      headers: jsonBody
        ? { Accept: "application/json", "Content-Type": "application/json" }
        : { Accept: "application/json" },
      body: jsonBody ? JSON.stringify(jsonBody) : undefined,
    });
    if (!res.ok) {
      // NEVER include the URL (it carries the token) in the error.
      throw new PipedriveProjectsError(
        `Pipedrive ${method} /api/v1/deals/${dealId} returned HTTP ${res.status}`,
        res.status,
      );
    }
    const payload = (await res.json()) as {
      success?: boolean;
      data?: {
        id?: number;
        status?: string | null;
        org_id?: number | { value?: number | null } | null;
        value?: number | null;
        currency?: string | null;
      } | null;
    };
    if (payload.success === false || !payload.data) {
      throw new PipedriveProjectsError(
        `Pipedrive ${method} /api/v1/deals/${dealId} returned success=false`,
      );
    }
    const d = payload.data;
    // v1 org_id can be a bare number or an object `{ value: <id> }`.
    const rawOrg = d.org_id;
    const orgId =
      typeof rawOrg === "number"
        ? rawOrg
        : rawOrg && typeof rawOrg === "object"
          ? (rawOrg.value ?? null)
          : null;
    return {
      id: Number(d.id ?? dealId),
      status: d.status ?? null,
      orgId: orgId != null ? Number(orgId) : null,
      value: d.value ?? null,
      currency: d.currency ?? null,
    };
  }

  return {
    get: (dealId) => call("GET", dealId),
    // PUT only `status` — value/currency are intentionally left as-is (no inflation).
    setStatusWon: (dealId) => call("PUT", dealId, { status: "won" }),
  };
}

export interface RunFlipDealsWonOptions {
  companyDomain?: string | null;
  /** Injected for tests; production omits it and uses the real Pipedrive client. */
  client?: DealsWriteClient;
}

/**
 * Flip each PSG-824 target to "won", idempotently and safely. Reads live status first,
 * skips deals already won, guards the org id, and captures per-deal failures without
 * aborting the batch. Returns structured evidence for QA/audit.
 */
export async function runFlipDealsWon(
  opts: RunFlipDealsWonOptions = {},
): Promise<FlipDealsWonResult> {
  const client = opts.client ?? createDealsWriteClient({ companyDomain: opts.companyDomain });
  const result: FlipDealsWonResult = {
    total: FLIP_DEALS_WON_TARGETS.length,
    flipped: 0,
    skippedAlreadyWon: 0,
    errored: 0,
    results: [],
  };

  for (const target of FLIP_DEALS_WON_TARGETS) {
    const row: FlipResult = {
      dealId: target.dealId,
      orgId: target.orgId,
      orgName: target.orgName,
      action: "error",
      statusBefore: null,
      statusAfter: null,
    };
    try {
      const before = await client.get(target.dealId);
      row.statusBefore = before.status;

      // Org guard — never write to a deal that isn't the expected org's.
      if (before.orgId !== target.orgId) {
        row.action = "error";
        row.reason = `org_mismatch: deal ${target.dealId} belongs to org ${before.orgId ?? "null"}, expected ${target.orgId}`;
        result.errored += 1;
        result.results.push(row);
        continue;
      }

      // Idempotent — already won means nothing to do.
      if (before.status === "won") {
        row.action = "skipped_already_won";
        row.statusAfter = "won";
        result.skippedAlreadyWon += 1;
        result.results.push(row);
        continue;
      }

      const after = await client.setStatusWon(target.dealId);
      row.statusAfter = after.status;
      if (after.status === "won") {
        row.action = "flipped";
        result.flipped += 1;
      } else {
        row.action = "error";
        row.reason = `write_did_not_win: status is ${after.status ?? "null"} after PUT`;
        result.errored += 1;
      }
      result.results.push(row);
    } catch (err) {
      row.action = "error";
      row.reason = err instanceof Error ? err.message : "unknown";
      result.errored += 1;
      result.results.push(row);
    }
  }

  return result;
}
