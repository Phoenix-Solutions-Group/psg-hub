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

/**
 * The set of active client accounts a monthly recurring cycle should run for, derived from
 * the durable deals mirror. An account is "active" when it has a WON deal. We dedupe to one
 * account per organization (a client with several won deals must get ONE monthly board, not
 * one per deal), keying on `orgId` when present and falling back to the (normalized) org
 * name so orgless rows still collapse per client. Rows with no org name are skipped — we
 * cannot title (and therefore cannot idempotently de-duplicate) a board without a client
 * name. First won deal per org wins the dedupe.
 */
export async function activeRecurringAccounts(
  db: MirrorSupabase,
): Promise<RecurringClient[]> {
  const deals = await readMirrorDeals(db);
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
