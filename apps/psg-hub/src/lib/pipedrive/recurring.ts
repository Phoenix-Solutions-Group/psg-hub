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

import {
  ensureBoardPhases,
  type PipedriveProjectsClient,
  type ProvisionResult,
} from "./projects";
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
 * Create one monthly recurring-service board for a client: one project, and each template
 * task created FLAT and stamped into its workstream phase (due dates = cycleStart + offset).
 * The board's phase columns are ensured to match the template first (PSG-722). Idempotent:
 * if a project with the deterministic (client + month) title already exists it is a no-op
 * (`skippedExisting: true`) so a retried monthly trigger never double-creates; phase
 * creation is idempotent by name.
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
      phaseStampAttempts: 0,
      phaseStampConfirmed: 0,
      phaseStampDiagnostic: null,
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

  // Give the board this template's workstream phase columns (idempotent by name), then
  // stamp each task into its group — same PSG-722 fix as the onboarding/web-build boards,
  // so the monthly WHM board is phased too (no task lands in "Phase unassigned").
  const phaseMap = await ensureBoardPhases(
    client,
    boardId,
    template.map((g) => g.name),
  );

  let taskCount = 0;
  let phaseStampAttempts = 0;
  let phaseStampConfirmed = 0;
  let phaseStampDiagnostic: string | null = null;
  for (const group of template) {
    const targetPhaseId = phaseMap.get(group.name.trim());
    for (const t of group.tasks) {
      const assignee = roleUserMap[t.owner];
      const task = await client.createTask({
        title: t.title,
        project_id: project.id,
        due_date: dueDateFor(cycleStart, t.dayOffset),
        description: `Owner: ${ROLE_LABELS[t.owner]} (${t.owner})${t.gate ? " · GATE" : ""}`,
        ...(assignee != null ? { assignee_id: assignee } : {}),
      });
      if (targetPhaseId != null && typeof client.setTaskPhase === "function") {
        // PSG-770: a non-persisting phase-stamp is non-fatal (never abort a monthly board
        // mid-build); record the first token-free reason + confirmed/attempted counts so the
        // silent no-op surfaces instead of shipping a board stuck in "Phase unassigned".
        phaseStampAttempts += 1;
        try {
          await client.setTaskPhase(project.id, task.id, targetPhaseId);
          phaseStampConfirmed += 1;
        } catch (err) {
          if (phaseStampDiagnostic == null) {
            phaseStampDiagnostic = err instanceof Error ? err.message : String(err);
          }
        }
      }
      taskCount += 1;
    }
  }

  return {
    created: true,
    projectId: project.id,
    phaseCount: template.length,
    taskCount,
    skippedExisting: false,
    phaseStampAttempts,
    phaseStampConfirmed,
    phaseStampDiagnostic,
  };
}
