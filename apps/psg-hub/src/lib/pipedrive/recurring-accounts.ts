// PSG-607 Move 1 follow-on — recurring-service TRIGGER plumbing.
//
// The builder (`provisionRecurringServiceBoard()` in recurring.ts, PSG-582) is done; this
// module is everything the monthly cron + manual/QA ops path need AROUND it:
//   • `activeRecurringAccounts()` — read the durable Pipedrive deals mirror and reduce it
//     to the set of live client accounts a monthly cycle should be spawned for.
//   • `resolveRecurringBoardConfig()` — the env pair that picks which Pipedrive board/phase
//     the monthly project lands in, defaulting to the onboarding board (Ada's PSG-606 call).
//   • `firstOfCurrentMonthUTC()` — the deterministic cycle anchor (Day 0) for a monthly run.
//   • `runRecurringCycle()` — enumerate accounts and provision one board each, capturing
//     per-account failures so one bad account never aborts the whole monthly batch.
//
// Read seam: reuses `readMirrorDeals` (mirror.ts) so there is ONE Pipedrive-deals read path
// for both reporting and this trigger. RLS is the caller's choice of Supabase handle
// (service-role for cron; a policy-gated user client otherwise) — see mirror.ts header.

import { readMirrorDeals, type MirrorSupabase } from "./mirror";
import { provisionRecurringServiceBoard, type RecurringClient } from "./recurring";
import type { PipedriveProjectsClient } from "./projects";
import type { RecurringRole } from "./recurring-service-template";
import type { PipedriveDeal } from "./types";

/**
 * The set of active client accounts a monthly recurring cycle should run for, derived from
 * the durable deals mirror. An account is "active" when it has a WON deal. We dedupe to one
 * account per organization (a client with several won deals must get ONE monthly board, not
 * one per deal), keying on `orgId` when present and falling back to the (normalized) org
 * name so orgless rows still collapse per client. Rows with no org name are skipped — we
 * cannot title (and therefore cannot idempotently de-duplicate) a board without a client
 * name. First won deal per org wins the dedupe.
 *
 * PSG-817 (opt-in): when a pinned maintenance roster is configured, the derived set is
 * further narrowed to only the orgs on that roster (Ada's PSG-813 Option A — monthly boards
 * go to the ~88 real maintenance shops, not every won-deal org). When the roster is unset /
 * empty the derived set is returned unchanged, so this is a fail-safe no-op until a roster
 * is populated. Callers that need the audit counts (how many were dropped by the roster gate)
 * should use `selectRecurringAccounts()` instead.
 *
 * PSG-825 (additive): any accounts on the maintenance SUPPLEMENT list (pre-CRM shops with an
 * org record but no won deal) are appended after the roster gate — see
 * `resolveMaintenanceSupplement()` / `selectRecurringAccounts()`.
 */
export async function activeRecurringAccounts(
  db: MirrorSupabase,
  roster: MaintenanceRoster | null = resolveMaintenanceRoster(),
  supplement: RecurringClient[] = resolveMaintenanceSupplement(),
): Promise<RecurringClient[]> {
  return (await selectRecurringAccounts(db, roster, supplement)).accounts;
}

/** All won-deal accounts, deduped per org, BEFORE any roster gate is applied. */
function deriveAccountsFromDeals(deals: PipedriveDeal[]): RecurringClient[] {
  const byKey = new Map<string, RecurringClient>();
  for (const d of deals) {
    if (d.status !== "won") continue;
    const orgName = (d.orgName ?? "").trim();
    if (orgName === "") continue; // can't name/idempotently-dedupe a board without a client
    const key = d.orgId != null ? `org:${d.orgId}` : `name:${orgName.toLowerCase()}`;
    if (byKey.has(key)) continue;
    byKey.set(key, { orgName, orgId: d.orgId, personId: d.personId });
  }
  return [...byKey.values()];
}

/**
 * Pinned allowlist of maintenance-shop accounts (PSG-813 Option A). Matching an account is
 * intentionally the SAME key logic the dedupe uses: prefer `orgId`, fall back to the
 * normalized org name so orgless rows still match. Both sets can be populated at once.
 */
export interface MaintenanceRoster {
  orgIds: Set<number>;
  orgNames: Set<string>;
}

/** Normalize an org name for roster matching: trim, lowercase, collapse inner whitespace. */
function normalizeRosterName(name: string): string {
  return name.trim().toLowerCase().replace(/\s+/g, " ");
}

/**
 * Parse the pinned maintenance roster from env (fail-safe). The value of
 * `RECURRING_MAINTENANCE_ROSTER` is a comma- and/or newline-separated list of tokens; each
 * token is either:
 *   • an org id — a bare all-digits token (`4021`) or an `id:`-prefixed token (`id:4021`), or
 *   • an org name — anything else (matched case-insensitively, whitespace-collapsed).
 * The frozen ~88-shop list from PSG-816 (Step 0) populates this. Returns `null` when the var
 * is unset or contains no usable tokens, which is the fail-safe "no roster → behave as today"
 * state — the monthly generator will NOT be silently narrowed by a misconfigured value.
 */
export function resolveMaintenanceRoster(
  env: Record<string, string | undefined> = process.env,
): MaintenanceRoster | null {
  const raw = env.RECURRING_MAINTENANCE_ROSTER;
  if (raw == null || raw.trim() === "") return null;
  const orgIds = new Set<number>();
  const orgNames = new Set<string>();
  for (const tokenRaw of raw.split(/[,\n]/)) {
    const token = tokenRaw.trim();
    if (token === "") continue;
    const idMatch = /^id:\s*(\d+)$/i.exec(token) ?? /^(\d+)$/.exec(token);
    if (idMatch) {
      orgIds.add(Number(idMatch[1]));
      continue;
    }
    orgNames.add(normalizeRosterName(token));
  }
  if (orgIds.size === 0 && orgNames.size === 0) return null;
  return { orgIds, orgNames };
}

/** True when this account is on the pinned roster (by org id, or by normalized name). */
function isOnRoster(account: RecurringClient, roster: MaintenanceRoster): boolean {
  if (account.orgId != null && roster.orgIds.has(account.orgId)) return true;
  return roster.orgNames.has(normalizeRosterName(account.orgName));
}

/**
 * The dedupe key an account collapses to. IDENTICAL to `deriveAccountsFromDeals` so a
 * supplement account is never double-provisioned against a won-deal account for the same org.
 */
function accountKey(account: RecurringClient): string {
  return account.orgId != null
    ? `org:${account.orgId}`
    : `name:${account.orgName.trim().toLowerCase()}`;
}

/**
 * PSG-825 — parse the maintenance SUPPLEMENT list from env (fail-safe, additive).
 *
 * `RECURRING_MAINTENANCE_SUPPLEMENT` folds long-standing maintenance shops that predate our
 * CRM into the monthly cycle WITHOUT fabricating won deals (Nick's PSG-819 ruling — no
 * invented amounts/dates that would distort revenue reporting). These orgs have an org record
 * only and therefore never appear in the won-deal mirror, so — unlike the roster, which
 * FILTERS the derived set — the supplement ADDS accounts to it.
 *
 * Because these accounts are not in the mirror, the engine cannot look up their name there,
 * so each supplement entry must carry both the org id and the org name (the name is needed to
 * title and idempotently de-duplicate the monthly board). Format: one entry per LINE (never
 * comma-separated — org names may contain commas), each `<orgId>|<Org Name>`, e.g.
 *   `5001|Certified Auto Body`
 *   `id:5002|Robert Noaker Racing`
 * A leading `id:` on the id part is tolerated for symmetry with the roster syntax. Lines that
 * are blank, start with `#`, lack a `|`, carry a non-numeric id, or have an empty name are
 * skipped (fail-safe — a malformed value must not silently distort the fleet). Duplicate org
 * ids collapse to the first. Returns `[]` when unset/empty, so no supplement is a clean no-op.
 */
export function resolveMaintenanceSupplement(
  env: Record<string, string | undefined> = process.env,
): RecurringClient[] {
  const raw = env.RECURRING_MAINTENANCE_SUPPLEMENT;
  if (raw == null || raw.trim() === "") return [];
  const out: RecurringClient[] = [];
  const seen = new Set<number>();
  for (const lineRaw of raw.split("\n")) {
    const line = lineRaw.trim();
    if (line === "" || line.startsWith("#")) continue;
    const sep = line.indexOf("|");
    if (sep < 0) continue; // must carry a name — an id alone cannot title a board
    const idPart = line.slice(0, sep).trim();
    const orgName = line.slice(sep + 1).trim();
    const idMatch = /^(?:id:\s*)?(\d+)$/i.exec(idPart);
    if (!idMatch || orgName === "") continue;
    const orgId = Number(idMatch[1]);
    if (seen.has(orgId)) continue;
    seen.add(orgId);
    // No won deal → no associated person; the recurring builder tolerates a null personId.
    out.push({ orgName, orgId, personId: null });
  }
  return out;
}

/** Full result of resolving the monthly fleet: the selected accounts plus audit counts. */
export interface RecurringSelection {
  /**
   * Accounts a monthly cycle should provision: the roster-gated won-deal set PLUS any
   * supplement accounts (post-roster-gate when a roster is set).
   */
  accounts: RecurringClient[];
  /** Won-deal accounts derived from the mirror BEFORE the roster gate. */
  derivedTotal: number;
  /** Whether a pinned maintenance roster was applied this run. */
  rosterApplied: boolean;
  /** Accounts dropped by the roster gate (derived-but-not-on-roster). Empty when no roster. */
  excluded: RecurringClient[];
  /** Whether a maintenance supplement was configured this run. */
  supplementApplied: boolean;
  /** Supplement accounts actually appended (i.e. not already in the won-deal/roster set). */
  supplementAdded: RecurringClient[];
}

/**
 * Resolve the monthly fleet with audit detail. Derives the won-deal accounts, then — when a
 * pinned maintenance roster is configured — keeps only the accounts on that roster and
 * captures the excluded ones as reviewable evidence (no silent truncation). When no roster
 * is set, `rosterApplied` is false and every derived account is returned unchanged.
 *
 * PSG-825: after the roster gate, any configured SUPPLEMENT accounts (pre-CRM maintenance
 * shops with an org record but no won deal) are appended. This is additive and INDEPENDENT of
 * the roster gate — a supplement account is included even when it is not on the roster,
 * because it has no won deal for the roster to keep. Supplement entries already present in the
 * selected set (same org id / normalized name) are skipped so no org is provisioned twice.
 */
export async function selectRecurringAccounts(
  db: MirrorSupabase,
  roster: MaintenanceRoster | null = resolveMaintenanceRoster(),
  supplement: RecurringClient[] = resolveMaintenanceSupplement(),
): Promise<RecurringSelection> {
  const deals = await readMirrorDeals(db);
  const derived = deriveAccountsFromDeals(deals);

  let accounts: RecurringClient[];
  let excluded: RecurringClient[];
  let rosterApplied: boolean;
  if (!roster) {
    accounts = [...derived];
    excluded = [];
    rosterApplied = false;
  } else {
    accounts = [];
    excluded = [];
    rosterApplied = true;
    for (const account of derived) {
      if (isOnRoster(account, roster)) accounts.push(account);
      else excluded.push(account);
    }
  }

  // Additive supplement (PSG-825): append pre-CRM maintenance accounts, deduped against the
  // already-selected set so a supplemented org that later wins a deal is never double-run.
  const supplementAdded: RecurringClient[] = [];
  const present = new Set(accounts.map(accountKey));
  for (const account of supplement) {
    const key = accountKey(account);
    if (present.has(key)) continue;
    present.add(key);
    accounts.push(account);
    supplementAdded.push(account);
  }

  return {
    accounts,
    derivedTotal: derived.length,
    rosterApplied,
    excluded,
    supplementApplied: supplement.length > 0,
    supplementAdded,
  };
}

/** Board + kanban phase the monthly recurring project is dropped into. */
export interface RecurringBoardConfig {
  boardId: number;
  phaseId: number;
}

/**
 * Resolve the recurring board/phase from env. Uses the dedicated
 * `PIPEDRIVE_RECURRING_BOARD_ID` / `PIPEDRIVE_RECURRING_PHASE_ID` pair when set, otherwise
 * falls back to the onboarding board pair (Ada's PSG-606 decision — reuse the Delivery
 * board for now; monthly titles are uniquely prefixed, and a dedicated board is later just
 * these two vars, no code change). Returns null when neither pair is configured so the
 * caller can fail closed with a not-configured 503. Note: `Number("")` is a finite `0`, so
 * we reject blank/unset values explicitly BEFORE the numeric check.
 */
export function resolveRecurringBoardConfig(
  env: Record<string, string | undefined> = process.env,
): RecurringBoardConfig | null {
  const boardRaw = env.PIPEDRIVE_RECURRING_BOARD_ID ?? env.PIPEDRIVE_ONBOARDING_BOARD_ID;
  const phaseRaw = env.PIPEDRIVE_RECURRING_PHASE_ID ?? env.PIPEDRIVE_ONBOARDING_PHASE_ID;
  if (boardRaw == null || boardRaw.trim() === "") return null;
  if (phaseRaw == null || phaseRaw.trim() === "") return null;
  const boardId = Number(boardRaw.trim());
  const phaseId = Number(phaseRaw.trim());
  if (!Number.isFinite(boardId) || !Number.isFinite(phaseId)) return null;
  return { boardId, phaseId };
}

/**
 * Cycle anchor (Day 0) for a monthly run: the first day of the CURRENT UTC month,
 * `YYYY-MM-01`. Pure UTC math (injectable `now` for tests) so it is deterministic
 * regardless of server timezone — the whole monthly board's due dates key off this.
 */
export function firstOfCurrentMonthUTC(now: Date = new Date()): string {
  const y = now.getUTCFullYear();
  const m = String(now.getUTCMonth() + 1).padStart(2, "0");
  return `${y}-${m}-01`;
}

export interface RunRecurringCycleOptions {
  client: PipedriveProjectsClient;
  accounts: RecurringClient[];
  /** Cycle anchor date (Day 0), `YYYY-MM-01`. */
  cycleStart: string;
  boardId: number;
  phaseId: number;
  /** Same role→user map onboarding uses (role-user-map.ts). */
  roleUserMap?: Partial<Record<RecurringRole, number>>;
}

export interface RecurringCycleResult {
  cycleStart: string;
  total: number;
  /** Accounts that got a freshly-created monthly board this run. */
  created: number;
  /** Accounts whose board for this month already existed (idempotent no-op). */
  skipped: number;
  /** Accounts whose provision threw (captured, not fatal to the batch). */
  errored: number;
  /** Per-account failure detail. Provision errors carry PATH + status only, never a token. */
  errors: Array<{ orgName: string; orgId: number | null; reason: string }>;
  projects: Array<{
    orgName: string;
    orgId: number | null;
    projectId: number;
    created: boolean;
  }>;
}

/**
 * Provision one monthly board per active account. A single account's failure is CAPTURED
 * (counted in `errored` with its reason) and never aborts the batch — a monthly cron must
 * still process every other client even if one Pipedrive call fails. The caller maps a
 * non-zero `errored` to a 502 so the run alerts while still recording partial success.
 */
export async function runRecurringCycle(
  opts: RunRecurringCycleOptions,
): Promise<RecurringCycleResult> {
  const result: RecurringCycleResult = {
    cycleStart: opts.cycleStart,
    total: opts.accounts.length,
    created: 0,
    skipped: 0,
    errored: 0,
    errors: [],
    projects: [],
  };
  for (const account of opts.accounts) {
    try {
      const prov = await provisionRecurringServiceBoard({
        client: opts.client,
        account,
        cycleStart: opts.cycleStart,
        boardId: opts.boardId,
        phaseId: opts.phaseId,
        roleUserMap: opts.roleUserMap,
      });
      if (prov.skippedExisting) result.skipped += 1;
      else result.created += 1;
      result.projects.push({
        orgName: account.orgName,
        orgId: account.orgId ?? null,
        projectId: prov.projectId,
        created: prov.created,
      });
    } catch (err) {
      result.errored += 1;
      result.errors.push({
        orgName: account.orgName,
        orgId: account.orgId ?? null,
        reason: err instanceof Error ? err.message : "unknown",
      });
    }
  }
  return result;
}
