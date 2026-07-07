import { describe, it, expect } from "vitest";
import {
  checkPhaseStamping,
  type PhasedTemplateEntry,
} from "../qa-smoke";

// PSG-723 — the "net that proves it catches": `checkPhaseStamping` is the load-bearing
// verifier every write-path smoke uses to prove provisioned tasks land in the RIGHT
// template phase (the PSG-715 "Phase unassigned" defect). Ravi's PSG-722 added the
// happy-path assertions; these lock the FAILURE modes so the gate can never silently
// pass a regression: an unphased task, a mis-phased task, a task in a non-template
// phase, or a board missing a template column must all flip a flag to fail.

const TEMPLATE: readonly PhasedTemplateEntry[] = [
  { name: "Discovery", tasks: [{ title: "Kick-off" }, { title: "Audit" }] },
  { name: "Design", tasks: [{ title: "Wireframes" }] },
  { name: "Build", tasks: [{ title: "Develop" }, { title: "QA GATE" }] },
];

// Board columns: the 3 template phases + one FOREIGN column ("Onboarding") the shared
// fallback board also carries. Phase ids are deliberately not sequential with task ids.
const BOARD = [
  { id: 10, name: "Discovery" },
  { id: 20, name: "Design" },
  { id: 30, name: "Build" },
  { id: 99, name: "Onboarding" }, // foreign — not in the template
];

const TASKS = [
  { id: 1, title: "Kick-off" },
  { id: 2, title: "Audit" },
  { id: 3, title: "Wireframes" },
  { id: 4, title: "Develop" },
  { id: 5, title: "QA GATE" },
];

/** Every task stamped into its correct template phase. */
const HAPPY_PLAN = [
  { taskId: 1, phaseId: 10 },
  { taskId: 2, phaseId: 10 },
  { taskId: 3, phaseId: 20 },
  { taskId: 4, phaseId: 30 },
  { taskId: 5, phaseId: 30 },
];

describe("checkPhaseStamping — PSG-723 gate proves it catches mis-phasing", () => {
  it("PASSES when every task sits in its correct template phase", () => {
    const r = checkPhaseStamping({
      tasks: TASKS,
      plan: HAPPY_PLAN,
      boardPhases: BOARD,
      template: TEMPLATE,
    });
    expect(r.allTemplatePhasesPresent).toBe(true);
    expect(r.tasksInUnassigned).toBe(0);
    expect(r.everyTaskStamped).toBe(true);
    expect(r.perPhase.map((p) => p.name)).toEqual([
      "Discovery",
      "Design",
      "Build",
    ]);
    expect(r.perPhase.map((p) => p.taskCount)).toEqual([2, 1, 2]);
    // Foreign board column is not a template phase, so it is never counted.
    expect(r.templatePhaseNames).toEqual(["Discovery", "Design", "Build"]);
  });

  it("FAILS when a task is unphased (missing plan row → 'Phase unassigned')", () => {
    // Drop task 5's plan row entirely: it never got stamped.
    const plan = HAPPY_PLAN.filter((row) => row.taskId !== 5);
    const r = checkPhaseStamping({
      tasks: TASKS,
      plan,
      boardPhases: BOARD,
      template: TEMPLATE,
    });
    expect(r.tasksInUnassigned).toBe(1);
    expect(r.everyTaskStamped).toBe(false);
    // The Build phase now only holds the one task that WAS stamped.
    expect(r.perPhase.find((p) => p.name === "Build")?.taskCount).toBe(1);
  });

  it("FAILS when a plan row exists but its phase_id is null (stamped to nothing)", () => {
    const plan = HAPPY_PLAN.map((row) =>
      row.taskId === 3 ? { taskId: 3, phaseId: null } : row,
    );
    const r = checkPhaseStamping({
      tasks: TASKS,
      plan,
      boardPhases: BOARD,
      template: TEMPLATE,
    });
    expect(r.tasksInUnassigned).toBe(1);
    expect(r.everyTaskStamped).toBe(false);
  });

  it("FAILS when a task lands in the WRONG template phase (nothing unassigned)", () => {
    // Task 3 ("Wireframes") belongs in Design(20) but is stamped into Discovery(10).
    const plan = HAPPY_PLAN.map((row) =>
      row.taskId === 3 ? { taskId: 3, phaseId: 10 } : row,
    );
    const r = checkPhaseStamping({
      tasks: TASKS,
      plan,
      boardPhases: BOARD,
      template: TEMPLATE,
    });
    // No task is unassigned, so a count-only check would miss this — but the
    // per-task name resolution catches the mis-placement.
    expect(r.tasksInUnassigned).toBe(0);
    expect(r.everyTaskStamped).toBe(false);
  });

  it("FAILS when a task lands in a FOREIGN (non-template) board phase", () => {
    // Task 4 stamped into "Onboarding"(99) — a real board column, but not a template phase.
    const plan = HAPPY_PLAN.map((row) =>
      row.taskId === 4 ? { taskId: 4, phaseId: 99 } : row,
    );
    const r = checkPhaseStamping({
      tasks: TASKS,
      plan,
      boardPhases: BOARD,
      template: TEMPLATE,
    });
    expect(r.tasksInUnassigned).toBe(0);
    expect(r.everyTaskStamped).toBe(false);
    // The foreign column is never surfaced as a template phase.
    expect(r.perPhase.some((p) => p.name === "Onboarding")).toBe(false);
  });

  it("FAILS allTemplatePhasesPresent when the board is missing a template column", () => {
    // The shared board never got the "Build" column created (the exact PSG-715 root cause:
    // ensureBoardPhases didn't run / name mismatch → stamp is a no-op).
    const board = BOARD.filter((p) => p.name !== "Build");
    const r = checkPhaseStamping({
      tasks: TASKS,
      plan: HAPPY_PLAN.filter((row) => row.taskId !== 4 && row.taskId !== 5),
      boardPhases: board,
      template: TEMPLATE,
    });
    expect(r.allTemplatePhasesPresent).toBe(false);
    // Build tasks have no column to land in → they read as unassigned.
    expect(r.tasksInUnassigned).toBe(2);
    expect(r.everyTaskStamped).toBe(false);
  });

  it("does not false-pass when the plan comes back EMPTY (PSG-737 shape-drift class)", () => {
    // If getProjectPlan drops every row (as the PSG-737 field-map bug did), the verifier
    // must FAIL loudly — never report 0 unassigned by omission.
    const r = checkPhaseStamping({
      tasks: TASKS,
      plan: [],
      boardPhases: BOARD,
      template: TEMPLATE,
    });
    expect(r.tasksInUnassigned).toBe(TASKS.length);
    expect(r.everyTaskStamped).toBe(false);
  });
});
