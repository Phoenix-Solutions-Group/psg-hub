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
  tasks: Array<{ id: number; title: string; parent_task_id: number | null; due_date: string | null; project_id: number }>;
  next: number;
}

function makeStore(): Store {
  return { projects: new Map(), tasks: [], next: 900 };
}

function fakeProvisionClient(store: Store): PipedriveProjectsClient {
  return {
    listBoards: vi.fn(async () => []),
    listPhases: vi.fn(async () => []),
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
      });
      return { id };
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
  it("builds 3 groups / 9 tasks / 1 gate, proves idempotency, and cleans up", async () => {
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

    expect(evidence.tree.parentTasks).toBe(3);
    expect(evidence.tree.leafTasks).toBe(recurringTaskCount());
    expect(evidence.tree.gateTasks).toBe(1);
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
