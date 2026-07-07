// PSG-644 — Asana → Pipedrive migration ORCHESTRATOR (the read → plan → write wiring).
//
// Ties the read side (`asana-client.ts`) to the pure planner (`asana-migration.ts`) to the
// Pipedrive write side (`projects.ts`), for ONE client at a time (the ticket's unit of
// work). Everything is dependency-injected (both clients), so the whole flow — including a
// real write against a fake Pipedrive — is unit-tested with no network.
//
// The three guarantees the ticket demands, all enforced here:
//   • DRY-RUN: with `dryRun: true` we read + plan + build the archive and return exactly
//     what WOULD be created, making ZERO Pipedrive writes.
//   • IDEMPOTENT + MARKER-GUARDED: before writing we read the target project's existing
//     tasks, extract their `[asana:<gid>]` markers, and skip any Asana task already
//     migrated — so a re-run never double-writes.
//   • OPEN-ONLY + ARCHIVE: only open tasks are created; closed tasks are returned as a CSV
//     archive string (delivered to Drive by the caller), never re-created.

import type { AsanaReadClient } from "./asana-client";
import type { PipedriveProjectsClient } from "./projects";
import {
  planClientMigration,
  extractMigratedGids,
  buildHistoryCsv,
  historyArchiveCount,
  type AsanaTask,
  type AssigneeMap,
  type MigrationPlan,
} from "./asana-migration";

export interface MigrateClientOptions {
  asana: AsanaReadClient;
  pipedrive: PipedriveProjectsClient;
  /** Source Asana project gid to read open/closed tasks from. */
  asanaProjectGid: string;
  /** Target Pipedrive project id (created from the WHM template, PSG-642) to write into. */
  pipedriveProjectId: number;
  /** `asanaUserGid → pipedriveUserId`. Unmapped assignees stay unassigned. */
  assigneeMap?: AssigneeMap;
  /** When true, plan + archive only — make ZERO Pipedrive writes. */
  dryRun?: boolean;
  /** Human label for this client, echoed into evidence (e.g. org name). */
  clientLabel?: string | null;
}

/** One created (or would-be-created) task in the result — enough for QA to spot-check. */
export interface MigratedTaskEvidence {
  asanaGid: string;
  title: string;
  /** Pipedrive task id when actually created; null on dry-run or when skipped. */
  pipedriveTaskId: number | null;
  assigneeId: number | null;
  dueDate: string | null;
  parentAsanaGid: string | null;
}

export interface MigrateClientResult {
  clientLabel: string | null;
  dryRun: boolean;
  asanaProjectGid: string;
  pipedriveProjectId: number;
  /** Open tasks planned for creation (parents + flattened children). */
  openTaskCount: number;
  /** Tasks actually created this run (0 on dry-run). */
  createdCount: number;
  /** Open tasks skipped because their marker was already in the target project. */
  skippedAlreadyMigratedCount: number;
  /** Closed tasks routed to the CSV archive (never created). */
  archivedCount: number;
  /** The RFC-4180 history archive CSV (caller uploads to Drive). */
  historyCsv: string;
  /** Per-task evidence (parents then their children), for QA data-integrity checks. */
  tasks: MigratedTaskEvidence[];
}

/**
 * Migrate one client's OPEN Asana tasks into their Pipedrive project. Idempotent + dry-run
 * capable (see file header). Comments are fetched only for OPEN tasks (the ones we
 * re-create); closed tasks go to the archive by metadata alone.
 */
export async function migrateClientOpenTasks(
  opts: MigrateClientOptions,
): Promise<MigrateClientResult> {
  const {
    asana,
    pipedrive,
    asanaProjectGid,
    pipedriveProjectId,
    assigneeMap = {},
    dryRun = false,
    clientLabel = null,
  } = opts;

  // 1) Read the full Asana task tree (open + closed, flattened parent-linked list).
  const allTasks = await asana.listProjectTaskTree(asanaProjectGid);

  // 2) Fetch comments for OPEN tasks only (they are the ones we re-create).
  const withComments: AsanaTask[] = [];
  for (const t of allTasks) {
    if (t.completed) {
      withComments.push(t);
      continue;
    }
    const comments = await asana.listTaskComments(t.gid);
    withComments.push({ ...t, comments });
  }

  // 3) Marker-guard: read what is already in the target project so a re-run skips it.
  if (typeof pipedrive.listProjectTasks !== "function") {
    throw new Error(
      "Pipedrive client lacks listProjectTasks — cannot enforce idempotency; refusing to migrate.",
    );
  }
  const existing = await pipedrive.listProjectTasks(pipedriveProjectId);
  const alreadyMigrated = extractMigratedGids(existing);

  // 4) Build the plan (open only, one-level nesting) + the closed-task archive.
  const plan: MigrationPlan = planClientMigration(withComments, {
    assigneeMap,
    alreadyMigrated,
  });
  const historyCsv = buildHistoryCsv(withComments);
  const archivedCount = historyArchiveCount(withComments);

  // How many open tasks did the marker-guard skip? (planned-open excludes them, so
  // recompute the raw open count and subtract what remains to be created.)
  const rawOpenCount = withComments.filter((t) => !t.completed).length;
  const skippedAlreadyMigratedCount = Math.max(0, rawOpenCount - plan.openTaskCount);

  const tasks: MigratedTaskEvidence[] = [];
  let createdCount = 0;

  for (const parent of plan.parents) {
    let parentPipedriveId: number | null = null;
    if (!dryRun) {
      const created = await pipedrive.createTask({
        title: parent.title,
        project_id: pipedriveProjectId,
        ...(parent.assigneeId != null ? { assignee_id: parent.assigneeId } : {}),
        ...(parent.dueDate != null ? { due_date: parent.dueDate } : {}),
        description: parent.description,
      });
      parentPipedriveId = created.id;
      createdCount += 1;
    }
    tasks.push({
      asanaGid: parent.asanaGid,
      title: parent.title,
      pipedriveTaskId: parentPipedriveId,
      assigneeId: parent.assigneeId,
      dueDate: parent.dueDate,
      parentAsanaGid: null,
    });

    for (const child of parent.children) {
      let childPipedriveId: number | null = null;
      if (!dryRun) {
        const created = await pipedrive.createTask({
          title: child.title,
          project_id: pipedriveProjectId,
          // Nest one level under the just-created parent (flattened tree).
          ...(parentPipedriveId != null ? { parent_task_id: parentPipedriveId } : {}),
          ...(child.assigneeId != null ? { assignee_id: child.assigneeId } : {}),
          ...(child.dueDate != null ? { due_date: child.dueDate } : {}),
          description: child.description,
        });
        childPipedriveId = created.id;
        createdCount += 1;
      }
      tasks.push({
        asanaGid: child.asanaGid,
        title: child.title,
        pipedriveTaskId: childPipedriveId,
        assigneeId: child.assigneeId,
        dueDate: child.dueDate,
        parentAsanaGid: parent.asanaGid,
      });
    }
  }

  return {
    clientLabel,
    dryRun,
    asanaProjectGid,
    pipedriveProjectId,
    openTaskCount: plan.openTaskCount,
    createdCount,
    skippedAlreadyMigratedCount,
    archivedCount,
    historyCsv,
    tasks,
  };
}
