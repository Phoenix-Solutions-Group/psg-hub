import { describe, it, expect, vi } from "vitest";
import {
  provisionRecurringServiceBoard,
  recurringCycleTitle,
  type RecurringClient,
} from "../recurring";
import type {
  PipedriveProjectsClient,
  CreateProjectInput,
  CreateTaskInput,
} from "../projects";
import {
  WHM_RECURRING_SERVICE_TEMPLATE,
  recurringTaskCount,
  cycleLabelFor,
  dueDateFor,
} from "../recurring-service-template";

const ACCOUNT: RecurringClient = {
  orgName: "Sunrise Collision LLC",
  orgId: 77,
  personId: 12,
};
const CYCLE_START = "2026-09-01";

function fakeClient(overrides: Partial<PipedriveProjectsClient> = {}) {
  let nextId = 1000;
  const createProject = vi.fn(async (_input: CreateProjectInput) => ({ id: 900 }));
  const createTask = vi.fn(async (_input: CreateTaskInput) => ({ id: nextId++ }));
  const findProjectByTitle = vi.fn(async (_title: string) => null as { id: number } | null);
  const client: PipedriveProjectsClient = {
    listBoards: vi.fn(async () => []),
    listPhases: vi.fn(async () => []),
    listUsers: vi.fn(async () => []),
    createProject,
    createTask,
    findProjectByTitle,
    ...overrides,
  };
  return { client, createProject, createTask, findProjectByTitle };
}

describe("WHM_RECURRING_SERVICE_TEMPLATE", () => {
  it("has 3 groups and 9 leaf tasks with exactly one monthly gate", () => {
    expect(WHM_RECURRING_SERVICE_TEMPLATE.length).toBe(3);
    expect(recurringTaskCount()).toBe(9);
    const gates = WHM_RECURRING_SERVICE_TEMPLATE.flatMap((g) => g.tasks).filter((t) => t.gate);
    expect(gates).toHaveLength(1);
    expect(gates[0]?.owner).toBe("AS");
  });

  it("keeps day-offsets monotonic and within a single month (buffer before next cycle)", () => {
    const offsets = WHM_RECURRING_SERVICE_TEMPLATE.flatMap((g) => g.tasks).map((t) => t.dayOffset);
    expect(offsets).toEqual([...offsets].sort((a, b) => a - b));
    expect(Math.max(...offsets)).toBeLessThanOrEqual(28); // leaves buffer before a ~30-day cycle
  });

  it("only uses roles that exist in the shared onboarding role→user map (AS/Analytics/Web)", () => {
    const roles = new Set(WHM_RECURRING_SERVICE_TEMPLATE.flatMap((g) => g.tasks).map((t) => t.owner));
    expect([...roles].sort()).toEqual(["AS", "Analytics", "Web"]);
  });
});

describe("cycleLabelFor / recurringCycleTitle", () => {
  it("labels the cycle by YYYY-MM and builds a deterministic per-month title", () => {
    expect(cycleLabelFor(CYCLE_START)).toBe("2026-09");
    expect(recurringCycleTitle(ACCOUNT, CYCLE_START)).toBe(
      "Monthly Service — Sunrise Collision LLC — 2026-09",
    );
  });

  it("falls back to a generic client label when orgName is blank", () => {
    expect(recurringCycleTitle({ orgName: "  " }, CYCLE_START)).toBe(
      "Monthly Service — Client — 2026-09",
    );
  });
});

describe("provisionRecurringServiceBoard", () => {
  it("creates one project + one parent task per group + every leaf task", async () => {
    const { client, createProject, createTask } = fakeClient();
    const res = await provisionRecurringServiceBoard({
      client,
      account: ACCOUNT,
      cycleStart: CYCLE_START,
      boardId: 1,
      phaseId: 1,
    });

    expect(res.created).toBe(true);
    expect(res.skippedExisting).toBe(false);
    expect(res.phaseCount).toBe(WHM_RECURRING_SERVICE_TEMPLATE.length);
    expect(res.taskCount).toBe(recurringTaskCount());

    expect(createProject).toHaveBeenCalledTimes(1);
    // parent tasks (3 groups) + 9 leaf tasks = 12 createTask calls.
    expect(createTask).toHaveBeenCalledTimes(3 + recurringTaskCount());
  });

  it("relates org/person as v2 ARRAYS and sets the cycle start date", async () => {
    const { client, createProject } = fakeClient();
    await provisionRecurringServiceBoard({
      client,
      account: ACCOUNT,
      cycleStart: CYCLE_START,
      boardId: 1,
      phaseId: 1,
    });
    const input = createProject.mock.calls[0]![0] as CreateProjectInput;
    expect(input.org_ids).toEqual([77]);
    expect(input.person_ids).toEqual([12]);
    expect(input.start_date).toBe(CYCLE_START);
    expect(input.title).toBe(recurringCycleTitle(ACCOUNT, CYCLE_START));
  });

  it("omits org_ids/person_ids entirely when absent (v2 rejects empty arrays)", async () => {
    const { client, createProject } = fakeClient();
    await provisionRecurringServiceBoard({
      client,
      account: { orgName: "No IDs Co" },
      cycleStart: CYCLE_START,
      boardId: 1,
      phaseId: 1,
    });
    const input = createProject.mock.calls[0]![0] as CreateProjectInput;
    expect("org_ids" in input).toBe(false);
    expect("person_ids" in input).toBe(false);
  });

  it("sets leaf due dates = cycleStart + offset and assigns via roleUserMap", async () => {
    const { client, createTask } = fakeClient();
    await provisionRecurringServiceBoard({
      client,
      account: ACCOUNT,
      cycleStart: CYCLE_START,
      boardId: 1,
      phaseId: 1,
      roleUserMap: { Analytics: 555 },
    });
    const calls = createTask.mock.calls.map((c) => c[0] as CreateTaskInput);
    const analyticsTask = calls.find((c) =>
      c.title.startsWith("Compile Google Analytics"),
    )!;
    expect(analyticsTask.assignee_id).toBe(555);
    expect(analyticsTask.due_date).toBe(dueDateFor(CYCLE_START, 7)); // 2026-09-08
    expect(analyticsTask.due_date).toBe("2026-09-08");

    // An unmapped role stays unassigned.
    const webTask = calls.find((c) => c.title.startsWith("Check site health"))!;
    expect("assignee_id" in webTask).toBe(false);
  });

  it("is idempotent: an existing same-month board is a no-op", async () => {
    const { client, createProject, createTask } = fakeClient({
      findProjectByTitle: vi.fn(async () => ({ id: 424242 })),
    });
    const res = await provisionRecurringServiceBoard({
      client,
      account: ACCOUNT,
      cycleStart: CYCLE_START,
      boardId: 1,
      phaseId: 1,
    });
    expect(res.created).toBe(false);
    expect(res.skippedExisting).toBe(true);
    expect(res.projectId).toBe(424242);
    expect(createProject).not.toHaveBeenCalled();
    expect(createTask).not.toHaveBeenCalled();
  });
});
