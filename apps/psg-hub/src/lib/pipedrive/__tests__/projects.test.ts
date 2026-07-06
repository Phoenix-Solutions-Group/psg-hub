import { describe, it, expect, vi } from "vitest";
import {
  provisionOnboardingBoard,
  onboardingProjectTitle,
  isDealWonTransition,
  type PipedriveProjectsClient,
  type CreateProjectInput,
  type CreateTaskInput,
  type WonDeal,
} from "../projects";
import { WHM_ONBOARDING_TEMPLATE, templateTaskCount } from "../onboarding-template";

const DEAL: WonDeal = {
  id: 4242,
  title: "Sunrise Collision",
  orgName: "Sunrise Collision LLC",
  orgId: 77,
  personId: 12,
  wonDate: "2026-07-06",
};

function fakeClient(overrides: Partial<PipedriveProjectsClient> = {}) {
  let nextId = 1000;
  const createProject = vi.fn(async (_input: CreateProjectInput) => ({ id: 900 }));
  const createTask = vi.fn(async (_input: CreateTaskInput) => ({ id: nextId++ }));
  const findProjectByTitle = vi.fn(async (_title: string) => null as { id: number } | null);
  const client: PipedriveProjectsClient = {
    listBoards: vi.fn(async () => []),
    listPhases: vi.fn(async () => []),
    createProject,
    createTask,
    findProjectByTitle,
    ...overrides,
  };
  return { client, createProject, createTask, findProjectByTitle };
}

describe("provisionOnboardingBoard", () => {
  it("creates one project + one parent task per phase + every leaf task", async () => {
    const { client, createProject, createTask } = fakeClient();
    const res = await provisionOnboardingBoard({
      client,
      deal: DEAL,
      boardId: 3,
      phaseId: 9,
    });

    expect(res.created).toBe(true);
    expect(res.skippedExisting).toBe(false);
    expect(res.phaseCount).toBe(WHM_ONBOARDING_TEMPLATE.length);
    expect(res.taskCount).toBe(templateTaskCount());

    expect(createProject).toHaveBeenCalledTimes(1);
    // parent tasks (5 phases) + 25 leaf tasks = 30 createTask calls.
    expect(createTask).toHaveBeenCalledTimes(
      WHM_ONBOARDING_TEMPLATE.length + templateTaskCount(),
    );

    // Project links the deal, sets Day-0 start, and drops into the given board/phase.
    expect(createProject).toHaveBeenCalledWith(
      expect.objectContaining({
        board_id: 3,
        phase_id: 9,
        start_date: "2026-07-06",
        deal_ids: [4242],
        org_id: 77,
        person_id: 12,
      }),
    );
  });

  it("dates the first D1 task at Day 0 + offset and the final task at Day 55", async () => {
    const { client, createTask } = fakeClient();
    await provisionOnboardingBoard({ client, deal: DEAL, boardId: 3, phaseId: 9 });

    const leafCalls = createTask.mock.calls.map((c) => c[0]);
    const welcome = leafCalls.find((t) =>
      t.title.startsWith("Send welcome email"),
    );
    const signoff = leafCalls.find((t) =>
      t.title.startsWith("Client sign-off"),
    );
    expect(welcome?.due_date).toBe("2026-07-07"); // Day 1
    expect(signoff?.due_date).toBe("2026-08-30"); // Day 55
    // Leaf tasks are nested under a phase parent.
    expect(welcome?.parent_task_id).toBeDefined();
  });

  it("assigns tasks to users when a role→user map is supplied", async () => {
    const { client, createTask } = fakeClient();
    await provisionOnboardingBoard({
      client,
      deal: DEAL,
      boardId: 3,
      phaseId: 9,
      roleUserMap: { AS: 501, Analytics: 502 },
    });
    const asTask = createTask.mock.calls
      .map((c) => c[0])
      .find((t) => t.title.startsWith("Send welcome email"));
    expect(asTask?.assignee_id).toBe(501);
  });

  it("is idempotent: an existing project short-circuits (no double create)", async () => {
    const { client, createProject, createTask } = fakeClient({
      findProjectByTitle: vi.fn(async () => ({ id: 900 })),
    });
    const res = await provisionOnboardingBoard({
      client,
      deal: DEAL,
      boardId: 3,
      phaseId: 9,
    });
    expect(res.skippedExisting).toBe(true);
    expect(res.created).toBe(false);
    expect(createProject).not.toHaveBeenCalled();
    expect(createTask).not.toHaveBeenCalled();
  });
});

describe("onboardingProjectTitle", () => {
  it("is deterministic and prefers the org name", () => {
    expect(onboardingProjectTitle(DEAL)).toBe(
      "Onboarding — Sunrise Collision LLC (deal 4242)",
    );
  });
  it("falls back to the deal title when org name is absent", () => {
    expect(
      onboardingProjectTitle({ ...DEAL, orgName: null }),
    ).toBe("Onboarding — Sunrise Collision (deal 4242)");
  });
});

describe("isDealWonTransition", () => {
  it("fires only on the transition INTO won", () => {
    expect(
      isDealWonTransition({ current: { status: "won" }, previous: { status: "open" } }),
    ).toBe(true);
  });
  it("ignores an already-won deal re-sent (idempotent webhook)", () => {
    expect(
      isDealWonTransition({ current: { status: "won" }, previous: { status: "won" } }),
    ).toBe(false);
  });
  it("ignores non-won updates", () => {
    expect(
      isDealWonTransition({ current: { status: "open" }, previous: { status: "open" } }),
    ).toBe(false);
    expect(isDealWonTransition({ current: { status: "lost" }, previous: null })).toBe(
      false,
    );
  });
});
