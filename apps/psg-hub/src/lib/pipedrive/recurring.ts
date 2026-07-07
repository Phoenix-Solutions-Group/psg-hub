// PSG-582 Move 1 follow-on — WHM monthly recurring-service board builder.
//
// Mirrors `provisionOnboardingBoard()` (projects.ts / PSG-584) but for the perpetual
// monthly service loop that runs AFTER onboarding sign-off. One project per monthly
// CYCLE per client, so each cycle is small and can reach "Done" — the whole point of
// keeping this separate from the finite onboarding board (Noelle's D6/D7 decision,
// PSG-580).
//
// Reuses the exact same Pipedrive Projects client + role→user map + UTC date math as
// onboarding, so there is one code path to the Pipedrive API and one place to fix.

import type {
  PipedriveProjectsClient,
  ProvisionResult,
} from "./projects";
import { normalizePhaseName } from "./projects";
import {
  WHM_RECURRING_SERVICE_TEMPLATE,
  cycleLabelFor,
  dueDateFor,
  ROLE_LABELS,
  type RecurringGroup,
  type RecurringRole,
} from "./recurring-service-template";

/** The client an active monthly cycle is spawned for. */
export interface RecurringClient {
  /** Client / organization name — used in the board title. */
  orgName: string;
  /** Pipedrive organization id, related to the project as a v2 array when present. */
  orgId?: number | null;
  /** Pipedrive person id, related as a v2 array when present. */
  personId?: number | null;
}

export interface RecurringProvisionOptions {
  client: PipedriveProjectsClient;
  account: RecurringClient;
  /** Cycle anchor date (Day 0), `YYYY-MM-DD`. First cycle = onboarding D5 sign-off date. */
  cycleStart: string;
  /** Board + kanban phase the new monthly project is dropped into. */
  boardId: number;
  phaseId: number;
  template?: readonly RecurringGroup[];
  /**
   * Optional role→Pipedrive-user-id map (same shape/source as onboarding, PSG-587).
   * When a role is present its tasks are assigned to that user; otherwise the task is
   * left UNASSIGNED with the role kept in the description.
   */
  roleUserMap?: Partial<Record<RecurringRole, number>>;
}

/**
 * Deterministic monthly-board title so a re-run for the same client+month is a no-op.
 * The `YYYY-MM` suffix is what makes each month its own idempotent board.
 */
export function recurringCycleTitle(account: RecurringClient, cycleStart: string): string {
  const client = (account.orgName ?? "").trim() || "Client";
  return `Monthly Service — ${client} — ${cycleLabelFor(cycleStart)}`;
}

/**
 * Create one monthly recurring-service board for a client: one project, one parent
 * task per workstream group, each group's tasks as subtasks with due dates =
 * cycleStart + offset. Idempotent: if a project with the deterministic
 * (client + month) title already exists, it is a no-op (`skippedExisting: true`) so a
 * retried monthly trigger never double-creates.
 */
export async function provisionRecurringServiceBoard(
  opts: RecurringProvisionOptions,
): Promise<ProvisionResult> {
  const { client, account, cycleStart, boardId, phaseId } = opts;
  const template = opts.template ?? WHM_RECURRING_SERVICE_TEMPLATE;
  const roleUserMap = opts.roleUserMap ?? {};
  const title = recurringCycleTitle(account, cycleStart);

  const existing = await client.findProjectByTitle(title);
  if (existing) {
    return {
      created: false,
      projectId: existing.id,
      phaseCount: 0,
      taskCount: 0,
      skippedExisting: true,
      phasedTaskCount: 0,
    };
  }

  const project = await client.createProject({
    title,
    board_id: boardId,
    phase_id: phaseId,
    description:
      `WHM monthly recurring service — cycle ${cycleLabelFor(cycleStart)} ` +
      `(Day 0 = ${cycleStart}). Auto-created for the ongoing monthly loop.`,
    start_date: cycleStart,
    // v2 relates orgs/persons as ARRAYS; omit entirely when absent (v2 rejects empty []).
    ...(account.orgId != null ? { org_ids: [account.orgId] } : {}),
    ...(account.personId != null ? { person_ids: [account.personId] } : {}),
  });

  // PSG-715 — resolve the board's phases ONCE so each task can be stamped into the phase
  // matching its workstream group (by normalized name). Degrades gracefully to "no
  // stamping" when the client lacks the methods or the board has no matching phases, so
  // the recurring loop never regresses. Mirrors the onboarding builder exactly.
  const phaseIdByName = new Map<string, number>();
  try {
    const boardPhases = await client.listPhases(boardId);
    for (const bp of boardPhases ?? []) {
      const key = normalizePhaseName(bp.name);
      if (key !== "" && !phaseIdByName.has(key)) phaseIdByName.set(key, bp.id);
    }
  } catch {
    // leave the map empty → no stamping
  }
  const canStamp = typeof client.setTaskPhaseOrGroup === "function";
  const stampInto = async (taskId: number, groupName: string): Promise<number> => {
    if (!canStamp) return 0;
    const targetPhaseId = phaseIdByName.get(normalizePhaseName(groupName));
    if (targetPhaseId == null) return 0;
    try {
      await client.setTaskPhaseOrGroup!(project.id, taskId, { phaseId: targetPhaseId });
      return 1;
    } catch {
      return 0;
    }
  };

  let taskCount = 0;
  let phasedTaskCount = 0;
  for (const group of template) {
    // Parent task = the workstream group; due date is the group's last task offset.
    const groupEndOffset = group.tasks.reduce((m, t) => Math.max(m, t.dayOffset), 0);
    const parent = await client.createTask({
      title: group.name,
      project_id: project.id,
      due_date: dueDateFor(cycleStart, groupEndOffset),
      description: `${group.key} — ${group.tasks.length} task(s).`,
    });
    phasedTaskCount += await stampInto(parent.id, group.name);

    for (const t of group.tasks) {
      const assignee = roleUserMap[t.owner];
      const leaf = await client.createTask({
        title: t.title,
        project_id: project.id,
        parent_task_id: parent.id,
        due_date: dueDateFor(cycleStart, t.dayOffset),
        description: `Owner: ${ROLE_LABELS[t.owner]} (${t.owner})${t.gate ? " · GATE" : ""}`,
        ...(assignee != null ? { assignee_id: assignee } : {}),
      });
      phasedTaskCount += await stampInto(leaf.id, group.name);
      taskCount += 1;
    }
  }

  return {
    created: true,
    projectId: project.id,
    phaseCount: template.length,
    taskCount,
    skippedExisting: false,
    phasedTaskCount,
  };
}
