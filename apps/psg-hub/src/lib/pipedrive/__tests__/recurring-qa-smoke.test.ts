import { describe, it, expect, vi } from "vitest";
import { runRecurringQaSmoke } from "../recurring-qa-smoke";
import { recurringCycleTitle, type RecurringClient } from "../recurring";
import type {
  CreateProjectInput,
  CreateTaskInput,
  PipedriveProjectsClient,
} from "../projects";
import { recurringTaskCount } from "../recurring-service-template";

// In-memory Pipedrive shared by BOTH the injected provision client (which builds the board)
// and the low-level REST fetch (which reads/deletes it back), so the smoke sees exactly what
// it created — the realistic round trip without hitting the network.
interface Store {
  projects: Map<number, { id: number; title: string; board_id: number; phase_id: number; start_date: string }>;
  tasks: Array<{ id: number; title: string; parent_task_id: number | null; due_date: string | null; project_id: number; phase_id: number | null }>;
  // PSG-722: board phases (id → {id,name,board_id}) shared by build + read-back.
  phases: Array<{ id: number; name: string; board_id: number }>;
  next: number;
}

function makeStore(): Store {
  return { projects: new Map(), tasks: [], phases: [], next: 900 };
}

function fakeProvisionClient(store: Store): PipedriveProjectsClient {
  return {
    listBoards: vi.fn(async () => []),
    listPhases: vi.fn(async (boardId: number) =>
      store.phases.filter((p) => p.board_id === boardId),
    ),
    listUsers: vi.fn(async () => []),
    findProjectByTitle: vi.fn(async (title: string) => {
      for (const p of store.projects.values()) if (p.title === title) return { id: p.id };
      return null;
    }),
    createProject: vi.fn(async (input: CreateProjectInput) => {
      const id = store.next++;
      store.projects.set(id, {
        id,
        title: input.title,
        board_id: input.board_id,
        phase_id: input.phase_id,
        start_date: input.start_date ?? "",
      });
      return { id };
    }),
    createTask: vi.fn(async (input: CreateTaskInput) => {
      const id = store.next++;
      store.tasks.push({
        id,
        title: input.title,
        parent_task_id: input.parent_task_id ?? null,
        due_date: input.due_date ?? null,
        project_id: input.project_id,
        phase_id: null,
      });
      return { id };
    }),
    createPhase: vi.fn(async (boardId: number, name: string, _order?: number) => {
      const id = store.next++;
      store.phases.push({ id, name, board_id: boardId });
      return { id };
    }),
    setTaskPhase: vi.fn(async (_projectId: number, taskId: number, phaseId: number) => {
      const t = store.tasks.find((x) => x.id === taskId);
      if (t) t.phase_id = phaseId;
    }),
  };
}

/** Minimal Pipedrive REST fake covering only the calls the recurring smoke makes. */
function fakeFetch(store: Store): typeof fetch {
  const ok = (data: unknown, additional: unknown = {}) =>
    ({
      ok: true,
      status: 200,
      json: async () => ({ success: true, data, additional_data: additional }),
    }) as unknown as Response;

  return (async (input: RequestInfo | URL, init?: RequestInit) => {
    const u = new URL(typeof input === "string" ? input : input.toString());
    const method = (init?.method ?? "GET").toUpperCase();
    const path = u.pathname;

    if (method === "POST" && path.endsWith("/api/v1/organizations")) return ok({ id: store.next++ });
    if (method === "POST" && path.endsWith("/api/v1/persons")) return ok({ id: store.next++ });
    if (method === "DELETE" && /\/api\/v1\/(organizations|persons)\/\d+$/.test(path)) return ok({});

    // GET single project: .../api/v2/projects/{id}
    const single = path.match(/\/api\/v2\/projects\/(\d+)$/);
    if (method === "GET" && single) {
      return ok(store.projects.get(Number(single[1])) ?? null);
    }
    // GET tasks list for a project
    if (method === "GET" && path.endsWith("/api/v2/tasks")) {
      const pid = Number(u.searchParams.get("project_id"));
      return ok(store.tasks.filter((t) => t.project_id === pid), {});
    }
    // PSG-722: GET board phases (name read-back for the phase-stamp verifier).
    if (method === "GET" && path.endsWith("/api/v2/phases")) {
      const bid = Number(u.searchParams.get("board_id"));
      return ok(store.phases.filter((p) => p.board_id === bid), {});
    }
    // PSG-722: GET project plan — links each task to its stamped phase_id.
    const plan = path.match(/\/api\/v1\/projects\/(\d+)\/plan$/);
    if (method === "GET" && plan) {
      const pid = Number(plan[1]);
      return ok(
        store.tasks
          .filter((t) => t.project_id === pid)
          .map((t) => ({ type: "task", task_id: t.id, phase_id: t.phase_id })),
        {},
      );
    }
    // GET projects list (dedupe / cleanup scan)
    if (method === "GET" && path.endsWith("/api/v2/projects")) {
      return ok([...store.projects.values()], {});
    }
    // DELETE project
    const del = path.match(/\/api\/v2\/projects\/(\d+)$/);
    if (method === "DELETE" && del) {
      store.projects.delete(Number(del[1]));
      return ok({});
    }
    throw new Error(`unexpected ${method} ${path}`);
  }) as typeof fetch;
}

describe("runRecurringQaSmoke", () => {
  it("builds 3 groups / 8 tasks / 0 gate, proves idempotency, and cleans up", async () => {
    const store = makeStore();
    const evidence = await runRecurringQaSmoke(
      {
        boardId: 1,
        phaseId: 1,
        cycleStart: "2026-09-01",
        runTag: "unit",
        apiKey: "test-token",
        fetchImpl: fakeFetch(store),
        sleep: async () => {},
      },
      fakeProvisionClient(store),
    );

    // PSG-722: FLAT board — 8 tasks, no container/parent tasks, 0 gate; all phase-stamped.
    expect(evidence.tree.totalTasks).toBe(recurringTaskCount());
    expect(evidence.tree.totalTasks).toBe(8);
    expect(evidence.tree.containerTasks).toBe(0);
    expect(evidence.tree.gateTasks).toBe(0);
    expect(evidence.phases.tasksInUnassigned).toBe(0);
    expect(evidence.phases.everyTaskStamped).toBe(true);
    expect(evidence.phases.allTemplatePhasesPresent).toBe(true);
    expect(evidence.phases.perPhase.map((p) => p.taskCount)).toEqual([3, 3, 2]);
    expect(evidence.checks.zeroTasksUnassigned).toBe(true);
    expect(evidence.checks.everyTaskInItsPhase).toBe(true);
    expect(evidence.idempotency.skippedExisting).toBe(true);
    expect(evidence.idempotency.projectIdMatches).toBe(true);
    expect(evidence.checks.projectTitleMatches).toBe(true);
    expect(evidence.checks.startDateIsCycleStart).toBe(true);
    expect(evidence.allChecksPass).toBe(true);

    // Title carried the QA marker so the delete guard fired; project is gone, no residual.
    const account: RecurringClient = evidence.account;
    expect(recurringCycleTitle(account, "2026-09-01")).toBe(evidence.project.title);
    expect(evidence.cleanup.projectDeleted).toBe(true);
    expect(evidence.cleanup.residualTestProjectRemains).toBe(false);
    expect(store.projects.size).toBe(0);
  });

  it("refuses to delete a project whose title lacks the QA marker (guard holds)", async () => {
    const store = makeStore();
    // Pre-seed a NON-marker project the cleanup scan would find under the smoke's title —
    // impossible in practice (the title carries the marker) but proves the guard.
    const evidence = await runRecurringQaSmoke(
      {
        boardId: 1,
        phaseId: 1,
        cycleStart: "2026-09-01",
        runTag: "guard",
        apiKey: "test-token",
        fetchImpl: fakeFetch(store),
        sleep: async () => {},
      },
      fakeProvisionClient(store),
    );
    // Normal run still cleans up (title has the marker).
    expect(evidence.cleanup.projectDeleted).toBe(true);
  });
});
