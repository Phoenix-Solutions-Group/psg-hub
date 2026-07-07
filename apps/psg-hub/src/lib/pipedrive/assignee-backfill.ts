import "server-only";

// PSG-686 — guarded back-fill of task owners on delivery boards our provisioner built
// during the pre-`80a14d5` unassigned window (the fix that made new boards assign owners).
//
// Context: the PSG-687 scan flagged 50 boards / 452 ownerless leaf tasks, but almost all
// are LEGACY / hand-built / migrated boards that were ALWAYS ownerless and were never in
// scope — auto-assigning owners to those would corrupt real client data. Only boards our
// deal-won provisioner built are in scope, and only the ones that missed owner assignment
// because they predate the fix. This module writes owners to EXACTLY those tasks and
// nothing else, behind layered scope guards:
//
//   Guard 1 (board): title must match the provisioner's deterministic naming — it ends in
//     `(deal <number>)` (see `deliveryProjectTitle`). Legacy DPM projects (no deal id) and
//     old hand-built website boards (`SNB Bank`, …) never match, so they are never touched.
//   Guard 2 (task): only OPEN LEAF tasks with EMPTY `assignee_ids` are candidates (parents
//     are ownerless by design; done tasks need no routing; already-owned tasks are skipped
//     → the write is idempotent).
//   Guard 3 (role): the owner ROLE is recovered from the task description the provisioner
//     wrote (`Owner: <label> (<ROLE>)`). A task with no recognizable role token is skipped
//     — this is what excludes any migrated task that happens to sit on a deal-titled board.
//   Guard 4 (mapping): the recovered role must map to a real Pipedrive user id via
//     `loadRoleUserMap` (the SAME map the provisioner uses). Unmapped role → skipped.
//   Guard 5 (allowlist, optional): when `projectIds` is passed, only those project ids are
//     considered — an extra operator constraint on top of the automatic guards.
//   Guard 6 (dry-run default): `apply` defaults to false. The default run PLANS the writes
//     and returns them for review; nothing is written until `apply: true`.
//
// Why no explicit "created before the fix" date check: an in-scope task is one that our
// provisioner built (deal-titled board + role-tokened description) yet has NO owner. Post-
// fix, every mapped role is assigned at creation, so an EMPTY assignee on such a task is
// itself the pre-fix fingerprint. The empty-assignee state is the window test.
//
// Secret hygiene: reads via the read-only audit client, writes via the Projects client's
// `updateTask` (v2 `PATCH /tasks/{id}` → `assignee_ids:[id]` through `toV2TaskBody`). Both
// carry the token only in the query string and never log it.

import {
  createProjectsClient,
  type PipedriveProjectsClient,
} from "./projects";
import {
  createAssigneeAuditClient,
  type AssigneeAuditClient,
  type AuditTask,
} from "./assignee-audit";
import { QA_TEST_MARKER } from "./qa-smoke";
import { loadRoleUserMap } from "./role-user-map";
import type { OnboardingRole } from "./onboarding-template";

/** The provisioner's deterministic delivery-board title ends in `(deal <number>)`. */
const DEAL_TITLE_RE = /\(deal \d+\)\s*$/;

/** All roles the provisioner may stamp into a task description as `(<ROLE>)`. */
const ROLE_TOKENS: readonly OnboardingRole[] = [
  "AS",
  "Ads",
  "Analytics",
  "Web",
  "CRO",
  "UX",
  "QA",
];
// Longest-first isn't needed (tokens are distinct, each wrapped in parens), but anchoring
// on the literal `(ROLE)` shape keeps the match unambiguous vs. incidental text.
const ROLE_DESC_RE = new RegExp(`\\((${ROLE_TOKENS.join("|")})\\)`);

/** Recover the accountable role from a provisioner-written task description, or null. */
export function roleFromDescription(description: string): OnboardingRole | null {
  const m = ROLE_DESC_RE.exec(description);
  return m ? (m[1] as OnboardingRole) : null;
}

/** True for a board whose title carries the deal-won provisioner naming (Guard 1). */
export function isProvisionerBoardTitle(title: string): boolean {
  return DEAL_TITLE_RE.test(title.trim()) && !title.includes(QA_TEST_MARKER);
}

/** One task the back-fill would set (or set) an owner on. */
export interface PlannedAssignment {
  projectId: number;
  projectTitle: string;
  taskId: number;
  taskTitle: string;
  role: OnboardingRole;
  assigneeId: number;
  /** true once the PATCH succeeded (apply mode); false in dry-run or on a failed write. */
  applied: boolean;
  /** Error reason if the write failed (apply mode only). */
  error?: string;
}

/** A candidate task that was NOT actioned, with the reason (audit trail). */
export interface SkippedTask {
  projectId: number;
  taskId: number;
  reason: "no_role_token" | "role_unmapped";
  role?: OnboardingRole;
}

export interface BackfillEvidence {
  /** false ⇒ dry-run (planned only); true ⇒ writes were attempted. */
  applied: boolean;
  totalProjects: number;
  /** Boards that passed Guard 1 (+ optional allowlist) and were inspected. */
  inScopeProjects: number;
  inScopeProjectIds: number[];
  /** Open ownerless leaf tasks found on in-scope boards (the raw candidate set). */
  candidateTasks: number;
  /** Tasks with a mapped role — planned (dry-run) or written (apply). */
  planned: PlannedAssignment[];
  /** Candidates deliberately not actioned, with reasons. */
  skipped: SkippedTask[];
  /** In apply mode: how many PATCHes succeeded / failed. */
  appliedCount: number;
  failedCount: number;
}

export interface RunBackfillOptions {
  companyDomain?: string | null;
  apiKey?: string;
  fetchImpl?: typeof fetch;
  /** Default false ⇒ dry-run. Set true to actually PATCH `assignee_ids`. */
  apply?: boolean;
  /** Optional extra scope guard: only these project ids are considered (Guard 5). */
  projectIds?: number[];
  /** Role→user map; defaults to `loadRoleUserMap()` (the provisioner's own map). */
  roleUserMap?: Partial<Record<OnboardingRole, number>>;
  /** Test seams. */
  readClient?: AssigneeAuditClient;
  writeClient?: Pick<PipedriveProjectsClient, "updateTask">;
}

/** True for an open leaf task with no owner (the candidate predicate). */
function isOwnerlessOpenLeaf(t: AuditTask): boolean {
  return t.parentTaskId != null && !t.done && t.assigneeIds.length === 0;
}

/**
 * Plan (or, with `apply: true`, perform) the owner back-fill on in-scope provisioner
 * boards. Pure read in dry-run; in apply mode issues one idempotent PATCH per planned
 * task. Returns a full audit trail (planned, skipped-with-reasons, apply/fail counts).
 */
export async function runAssigneeBackfill(
  opts: RunBackfillOptions = {},
): Promise<BackfillEvidence> {
  const apply = opts.apply === true;
  const roleUserMap = opts.roleUserMap ?? loadRoleUserMap();
  const allowlist = opts.projectIds != null ? new Set(opts.projectIds) : null;
  const readClient =
    opts.readClient ??
    createAssigneeAuditClient({
      apiKey: opts.apiKey,
      companyDomain: opts.companyDomain ?? null,
      fetchImpl: opts.fetchImpl,
    });
  const writeClient =
    opts.writeClient ??
    createProjectsClient({
      apiKey: opts.apiKey,
      companyDomain: opts.companyDomain ?? null,
      fetchImpl: opts.fetchImpl,
    });

  const projects = await readClient.listAllProjects();
  const inScope = projects.filter(
    (p) =>
      isProvisionerBoardTitle(p.title) && (allowlist == null || allowlist.has(p.id)),
  );

  const planned: PlannedAssignment[] = [];
  const skipped: SkippedTask[] = [];
  let candidateTasks = 0;
  let appliedCount = 0;
  let failedCount = 0;

  for (const p of inScope) {
    const tasks = await readClient.listProjectTasks(p.id);
    for (const t of tasks) {
      if (!isOwnerlessOpenLeaf(t)) continue;
      candidateTasks += 1;
      const role = roleFromDescription(t.description);
      if (!role) {
        skipped.push({ projectId: p.id, taskId: t.id, reason: "no_role_token" });
        continue;
      }
      const assigneeId = roleUserMap[role];
      if (assigneeId == null) {
        skipped.push({ projectId: p.id, taskId: t.id, reason: "role_unmapped", role });
        continue;
      }
      const entry: PlannedAssignment = {
        projectId: p.id,
        projectTitle: p.title,
        taskId: t.id,
        taskTitle: t.title,
        role,
        assigneeId,
        applied: false,
      };
      if (apply) {
        try {
          // updateTask maps `assignee_id` → `assignee_ids:[id]` (PSG-680, toV2TaskBody).
          await writeClient.updateTask!(t.id, { assignee_id: assigneeId });
          entry.applied = true;
          appliedCount += 1;
        } catch (err) {
          entry.error = err instanceof Error ? err.message : "unknown";
          failedCount += 1;
        }
      }
      planned.push(entry);
    }
  }

  return {
    applied: apply,
    totalProjects: projects.length,
    inScopeProjects: inScope.length,
    inScopeProjectIds: inScope.map((p) => p.id),
    candidateTasks,
    planned,
    skipped,
    appliedCount,
    failedCount,
  };
}
