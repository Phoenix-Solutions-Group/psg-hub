import { describe, it, expect } from "vitest";
import {
  runAssigneeAudit,
  createAssigneeAuditClient,
  type AssigneeAuditClient,
  type AuditTask,
} from "../assignee-audit";
import { QA_TEST_MARKER } from "../qa-smoke";
import { PipedriveProjectsError } from "../projects";

// ── helpers ───────────────────────────────────────────────────────────────────────
const parent = (id: number, title = `Phase ${id}`): AuditTask => ({
  id,
  title,
  parentTaskId: null,
  assigneeIds: [],
  done: false,
  description: "",
});
const leaf = (
  id: number,
  over: Partial<AuditTask> = {},
): AuditTask => ({
  id,
  title: `Task ${id}`,
  parentTaskId: 1,
  assigneeIds: [],
  done: false,
  description: "",
  ...over,
});

/** In-memory client seam: projects + a per-project task list. */
function fakeClient(
  projects: Array<{ id: number; title: string; board_id?: number | null; phase_id?: number | null }>,
  tasksByProject: Record<number, AuditTask[]>,
): AssigneeAuditClient {
  return {
    async listAllProjects() {
      return projects.map((p) => ({
        id: p.id,
        title: p.title,
        board_id: p.board_id ?? null,
        phase_id: p.phase_id ?? null,
      }));
    },
    async listProjectTasks(projectId) {
      return tasksByProject[projectId] ?? [];
    },
  };
}

describe("runAssigneeAudit — orchestrator logic", () => {
  it("reports clean when every open leaf has an owner", async () => {
    const client = fakeClient(
      [{ id: 10, title: "Onboarding — Acme (deal 1)" }],
      { 10: [parent(1), leaf(2, { assigneeIds: [777] }), leaf(3, { assigneeIds: [888] })] },
    );
    const ev = await runAssigneeAudit({ client });
    expect(ev.clean).toBe(true);
    expect(ev.projectsScanned).toBe(1);
    expect(ev.projectsWithUnassignedLeaves).toBe(0);
    expect(ev.totalUnassignedLeafTasks).toBe(0);
    expect(ev.affected).toEqual([]);
  });

  it("flags a board whose open leaf tasks have no owner (the back-fill case)", async () => {
    const client = fakeClient(
      [{ id: 10, title: "Onboarding — Acme (deal 1)", board_id: 5, phase_id: 6 }],
      { 10: [parent(1), leaf(2), leaf(3), leaf(4, { assigneeIds: [999] })] },
    );
    const ev = await runAssigneeAudit({ client });
    expect(ev.clean).toBe(false);
    expect(ev.projectsWithUnassignedLeaves).toBe(1);
    expect(ev.totalUnassignedLeafTasks).toBe(2);
    const a = ev.affected[0];
    expect(a).toMatchObject({ id: 10, board_id: 5, phase_id: 6, totalTasks: 4, leafTasks: 3 });
    expect(a.unassignedLeafTaskIds).toEqual([2, 3]);
    expect(a.sampleUnassignedTitles).toEqual(["Task 2", "Task 3"]);
  });

  it("never flags PARENT (container) tasks — they are ownerless by design", async () => {
    const client = fakeClient(
      [{ id: 10, title: "Onboarding — Acme (deal 1)" }],
      // Two parents (no owner) + every leaf assigned.
      { 10: [parent(1), parent(2), leaf(3, { parentTaskId: 1, assigneeIds: [1] })] },
    );
    const ev = await runAssigneeAudit({ client });
    expect(ev.clean).toBe(true);
  });

  it("ignores DONE leaf tasks (a finished task needs no routing)", async () => {
    const client = fakeClient(
      [{ id: 10, title: "Onboarding — Acme (deal 1)" }],
      { 10: [parent(1), leaf(2, { done: true }), leaf(3, { assigneeIds: [5] })] },
    );
    const ev = await runAssigneeAudit({ client });
    expect(ev.clean).toBe(true);
  });

  it("skips QA test projects by the marker guard", async () => {
    const client = fakeClient(
      [
        { id: 10, title: `${QA_TEST_MARKER} — Move1 E2E run-x` },
        { id: 11, title: "Onboarding — Real Client (deal 2)" },
      ],
      {
        10: [parent(1), leaf(2)], // ownerless but QA → must be skipped
        11: [parent(1), leaf(2, { assigneeIds: [5] })],
      },
    );
    const ev = await runAssigneeAudit({ client });
    expect(ev.totalProjects).toBe(2);
    expect(ev.qaTestProjectsSkipped).toBe(1);
    expect(ev.projectsScanned).toBe(1);
    expect(ev.clean).toBe(true);
  });

  it("caps the sampled titles but keeps the full id list", async () => {
    const leaves = Array.from({ length: 15 }, (_, i) => leaf(i + 2));
    const client = fakeClient(
      [{ id: 10, title: "Onboarding — Big Board (deal 3)" }],
      { 10: [parent(1), ...leaves] },
    );
    const ev = await runAssigneeAudit({ client, sampleCap: 10 });
    const a = ev.affected[0];
    expect(a.unassignedLeafTaskIds).toHaveLength(15);
    expect(a.sampleUnassignedTitles).toHaveLength(10);
  });

  it("aggregates across multiple affected boards", async () => {
    const client = fakeClient(
      [
        { id: 10, title: "Onboarding — A (deal 1)" },
        { id: 11, title: "New Website Build — B (deal 2)" },
        { id: 12, title: "Onboarding — C (deal 3)" },
      ],
      {
        10: [parent(1), leaf(2)],
        11: [parent(1), leaf(2, { assigneeIds: [1] })], // clean
        12: [parent(1), leaf(2), leaf(3)],
      },
    );
    const ev = await runAssigneeAudit({ client });
    expect(ev.projectsScanned).toBe(3);
    expect(ev.projectsWithUnassignedLeaves).toBe(2);
    expect(ev.totalUnassignedLeafTasks).toBe(3);
    expect(ev.affected.map((a) => a.id)).toEqual([10, 12]);
  });
});

// ── client parsing / transport (fake fetch) ─────────────────────────────────────────
type Page = { data: unknown[]; next_cursor?: string | null };

function fetchFrom(
  projectPages: Page[],
  taskPagesByProject: Record<number, Page[]>,
): typeof fetch {
  const ok = (page: Page) =>
    new Response(
      JSON.stringify({
        success: true,
        data: page.data,
        additional_data: { next_cursor: page.next_cursor ?? null },
      }),
      { status: 200, headers: { "content-type": "application/json" } },
    );
  // cursor is the index into the relevant page array
  return (async (input: string | URL | Request) => {
    const u = new URL(typeof input === "string" ? input : input.toString());
    const parts = u.pathname.split("/").filter(Boolean); // ['api','v2','projects'|'tasks']
    const resource = parts[2];
    const cursor = u.searchParams.get("cursor");
    const idx = cursor ? Number(cursor) : 0;
    if (resource === "projects") {
      const page = projectPages[idx];
      return ok(page);
    }
    if (resource === "tasks") {
      const projectId = Number(u.searchParams.get("project_id"));
      const pages = taskPagesByProject[projectId] ?? [{ data: [] }];
      return ok(pages[idx]);
    }
    return new Response(JSON.stringify({ success: false }), { status: 404 });
  }) as unknown as typeof fetch;
}

describe("createAssigneeAuditClient — parsing & pagination", () => {
  it("parses assignee_ids from bare ids and {id}/{value} objects, and coerces done", async () => {
    const client = createAssigneeAuditClient({
      apiKey: "t",
      fetchImpl: fetchFrom([{ data: [{ id: 1, title: "P", board_id: 5, phase_id: 6 }] }], {
        1: [
          {
            data: [
              { id: 2, title: "parent", parent_task_id: null, assignee_ids: [] },
              { id: 3, title: "bare", parent_task_id: 2, assignee_ids: [77] },
              { id: 4, title: "obj", parent_task_id: 2, assignee_ids: [{ id: 88 }] },
              { id: 5, title: "done-num", parent_task_id: 2, assignee_ids: [], done: 1 },
              { id: 6, title: "done-str", parent_task_id: 2, assignee_ids: [], status: "done" },
            ],
          },
        ],
      }),
    });
    const projects = await client.listAllProjects();
    expect(projects).toEqual([{ id: 1, title: "P", board_id: 5, phase_id: 6 }]);
    const tasks = await client.listProjectTasks(1);
    expect(tasks.find((t) => t.id === 2)?.parentTaskId).toBeNull();
    expect(tasks.find((t) => t.id === 3)?.assigneeIds).toEqual([77]);
    expect(tasks.find((t) => t.id === 4)?.assigneeIds).toEqual([88]);
    expect(tasks.find((t) => t.id === 5)?.done).toBe(true);
    expect(tasks.find((t) => t.id === 6)?.done).toBe(true);
  });

  it("follows the cursor across multiple pages", async () => {
    const client = createAssigneeAuditClient({
      apiKey: "t",
      fetchImpl: fetchFrom(
        [
          { data: [{ id: 1, title: "A" }], next_cursor: "1" },
          { data: [{ id: 2, title: "B" }], next_cursor: null },
        ],
        {
          1: [{ data: [{ id: 9, title: "t", parent_task_id: 1, assignee_ids: [] }] }],
          2: [{ data: [] }],
        },
      ),
    });
    const projects = await client.listAllProjects();
    expect(projects.map((p) => p.id)).toEqual([1, 2]);
  });

  it("throws a token-free error on a non-ok response", async () => {
    const client = createAssigneeAuditClient({
      apiKey: "secret-token",
      fetchImpl: (async () =>
        new Response("nope", { status: 500 })) as unknown as typeof fetch,
    });
    await expect(client.listAllProjects()).rejects.toMatchObject({
      status: 500,
    });
    await client.listAllProjects().catch((e: unknown) => {
      const msg = e instanceof Error ? e.message : String(e);
      expect(msg).not.toContain("secret-token");
      expect(msg).not.toContain("api_token");
    });
  });

  it("throws when no token is configured", () => {
    expect(() => createAssigneeAuditClient({ apiKey: "" })).toThrow(PipedriveProjectsError);
  });

  it("end-to-end: live-shaped fetch flows through runAssigneeAudit", async () => {
    const ev = await runAssigneeAudit({
      apiKey: "t",
      fetchImpl: fetchFrom([{ data: [{ id: 1, title: "Onboarding — Acme (deal 1)" }] }], {
        1: [
          {
            data: [
              { id: 2, title: "phase", parent_task_id: null, assignee_ids: [] },
              { id: 3, title: "needs owner", parent_task_id: 2, assignee_ids: [] },
              { id: 4, title: "has owner", parent_task_id: 2, assignee_ids: [42] },
            ],
          },
        ],
      }),
    });
    expect(ev.clean).toBe(false);
    expect(ev.affected[0].unassignedLeafTaskIds).toEqual([3]);
  });
});
