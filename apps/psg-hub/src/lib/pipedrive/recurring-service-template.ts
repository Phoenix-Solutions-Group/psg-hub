// PSG-582 Move 1 follow-on — WHM monthly recurring-service template (typed data).
//
// Source of truth: Ada's build-ready template on PSG-582
// (`/PSG/issues/PSG-582#document-recurring-service-template`), grounded in Noelle's
// confirmed content from the live Asana boards (PSG-577) and the D6/D7 "separate
// board" decision on PSG-580.
//
// WHY A SEPARATE BOARD (not a 6th onboarding phase): onboarding is a FINITE project
// that must be able to reach "Done" at D5 sign-off (Day 55). This monthly loop is
// PERPETUAL — it runs every month for the life of the account. Embedding it in the
// onboarding board would keep every onboarding permanently open. So this is its own
// recurring board, one closeable instance PER MONTHLY CYCLE per client.
//
// Scheduling convention (mirrors the onboarding template):
//   • Day 0 = the cycle anchor date (recommended: the client's monthly billing /
//     anniversary date; the FIRST cycle anchors on the onboarding D5 sign-off date).
//   • Every `dayOffset` below is CALENDAR DAYS from Day 0; a task's due date is
//     cycleStart + offset. The last task (client call, Day 20) lands ~10 days before
//     the next cycle spawns, leaving buffer so a slipped month is visible before it
//     compounds.
//   • `owner` is the single accountable ROLE. Roles are a SUBSET of the onboarding
//     roles (AS/Analytics/Web) so the same `roleUserMap` from PSG-584/PSG-587 works
//     unchanged.

import type { OnboardingRole } from "./onboarding-template";
import { ROLE_LABELS, dueDateFor } from "./onboarding-template";

/** Roles that appear in the monthly loop (subset of OnboardingRole). Re-exported for callers. */
export type RecurringRole = Extract<OnboardingRole, "AS" | "Analytics" | "Web">;
export { ROLE_LABELS, dueDateFor };

export interface RecurringTask {
  /** Task title exactly as it should read on the board. */
  readonly title: string;
  /** Single accountable role. */
  readonly owner: RecurringRole;
  /** Calendar days from Day 0 (cycle anchor date). Due date = cycleStart + dayOffset. */
  readonly dayOffset: number;
  /**
   * Reserved gate flag (renders " · GATE" in the task description). The canonical
   * PSG-610 §2a monthly template carries NO gate task, so no task sets this today; the
   * optional field is kept so the builder/QA-smoke code stays gate-aware if a future
   * design amendment re-introduces a monthly Definition-of-Done gate.
   */
  readonly gate?: boolean;
}

export interface RecurringGroup {
  /** Stable group key. MU = Monthly Updates · CC = Customer Comments · CT = Client touchpoints. */
  readonly key: "MU" | "CC" | "CT";
  /** Group display name (rendered as the parent task on the board). */
  readonly name: string;
  readonly tasks: readonly RecurringTask[];
}

/**
 * The confirmed WHM monthly recurring-service template: 3 workstream groups, 8 tasks
 * (3 + 3 + 2), one accountable owner each, explicit day-offsets. This is the exact shape
 * from the board-approved parent design (PSG-610 §2a — Monthly Updates / Customer Comments
 * / Client touchpoints), grounded in Noelle's confirmed workstreams from the live Asana
 * boards (PSG-577). Do not reorder, renumber, or add a gate without updating PSG-610 §2a
 * and PSG-642 first. (PSG-642 realigned this to the canonical 8-task shape — the earlier
 * PSG-582 build carried a 9th monthly Definition-of-Done gate that the design does not.)
 */
export const WHM_RECURRING_SERVICE_TEMPLATE: readonly RecurringGroup[] = [
  {
    key: "MU",
    name: "Monthly Updates",
    tasks: [
      { title: "Check site health & plugin/security updates", owner: "Web", dayOffset: 3 },
      {
        title: "Compile Google Analytics / Looker Studio performance report",
        owner: "Analytics",
        dayOffset: 7,
      },
      { title: "Email the monthly performance report to client", owner: "AS", dayOffset: 8 },
    ],
  },
  {
    key: "CC",
    name: "Customer Comments",
    tasks: [
      { title: "Produce customer comments via database script", owner: "Web", dayOffset: 10 },
      { title: "Format & save the customer comments", owner: "AS", dayOffset: 12 },
      { title: "Add customer-comment graphics to the client site", owner: "Web", dayOffset: 14 },
    ],
  },
  {
    key: "CT",
    name: "Client touchpoints",
    tasks: [
      { title: "Client email — monthly relationship touch", owner: "AS", dayOffset: 15 },
      { title: "Client call — monthly check-in", owner: "AS", dayOffset: 20 },
    ],
  },
] as const;

/** Total task count across all groups (excludes the group parent rows). */
export function recurringTaskCount(
  template: readonly RecurringGroup[] = WHM_RECURRING_SERVICE_TEMPLATE,
): number {
  return template.reduce((n, g) => n + g.tasks.length, 0);
}

/**
 * Cycle label `YYYY-MM` derived from the anchor date — the human-facing "which month"
 * suffix that also makes each monthly board title unique (and therefore idempotent).
 * Pure UTC slice so it is deterministic regardless of server timezone.
 */
export function cycleLabelFor(cycleStartISO: string): string {
  return cycleStartISO.slice(0, 7);
}
