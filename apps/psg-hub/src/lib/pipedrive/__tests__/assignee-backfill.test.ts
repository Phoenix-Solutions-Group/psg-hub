import { describe, it, expect } from "vitest";
import {
  runAssigneeBackfill,
  roleFromDescription,
  isProvisionerBoardTitle,
} from "../assignee-backfill";
import type { AssigneeAuditClient, AuditTask } from "../assignee-audit";
import { QA_TEST_MARKER } from "../qa-smoke";

// ── task builders ───────────────────────────────────────────────────────────────────
const parent = (id: number): AuditTask => ({
  id,
  title: `Phase ${id}`,
  parentTaskId: null,
  assigneeIds: [],
  done: false,
  description: `Phase D1 — 3 task(s).`,
});
const leaf = (id: number, over: Partial<AuditTask> = {}): AuditTask => ({
  id,
  title: `Task ${id}`,
  parentTaskId: 1,
  assigneeIds: [],
  done: false,
  description: "Owner: Web Engineer (Web)",
  ...over,
});

function fakeRead(
  projects: Array<{ id: number; title: string }>,
  tasksByProject: Record<number, AuditTask[]>,
): AssigneeAuditClient {
  return {
    async listAllProjects() {
      return projects.map((p) => ({
        id: p.id,
        title: p.title,
        board_id: null,
        phase_id: null,
      }));
    },
    async listProjectTasks(projectId) {
      return tasksByProject[projectId] ?? [];
    },
  };
}

/** Records PATCH calls; can be told to throw for a given task id. */
function fakeWrite(failIds: number[] = []) {
  const patched: Array<{ taskId: number; assigneeId: number }> = [];
  return {
    patched,
    client: {
      async updateTask(taskId: number, patch: { assignee_id?: number }) {
        if (failIds.includes(taskId)) throw new Error("boom");
        patched.push({ taskId, assigneeId: patch.assignee_id! });
        return { id: taskId };
      },
    },
  };
}

const MAP = { Web: 111, AS: 222, UX: 333 } as const;

describe("roleFromDescription", () => {
  it("parses each role token", () => {
    expect(roleFromDescription("Owner: Web Engineer (Web)")).toBe("Web");
    expect(roleFromDescription("Owner: Account Strategist (AS) · GATE")).toBe("AS");
    expect(roleFromDescription("Owner: UX Designer (UX)")).toBe("UX");
    expect(roleFromDescription("Owner: QA Analyst (QA)")).toBe("QA");
  });
  it("returns null when no known role token is present", () => {
    expect(roleFromDescription("some migrated task note")).toBeNull();
    expect(roleFromDescription("")).toBeNull();
    expect(roleFromDescription("(Marketing)")).toBeNull();
  });
});

describe("isProvisionerBoardTitle (Guard 1)", () => {
  it("matches deal-titled provisioner boards", () => {
    expect(isProvisionerBoardTitle("Onboarding — Quality Body Shop (deal 3887)")).toBe(true);
    expect(isProvisionerBoardTitle("New Website Build — Acme (deal 42)")).toBe(true);
  });
  it("rejects legacy / hand-built / migrated / QA boards", () => {
    expect(isProvisionerBoardTitle("SNB Bank")).toBe(false);
    expect(isProvisionerBoardTitle("Database Enhancement Gateway")).toBe(false);
    expect(isProvisionerBoardTitle("Marina e-Survey Onboarding")).toBe(false);
    expect(isProvisionerBoardTitle(`${QA_TEST_MARKER} — Move1 (deal 9)`)).toBe(false);
  });
});

describe("runAssigneeBackfill — scoping & dry-run", () => {
  it("dry-run plans writes for the in-scope board only and writes nothing", async () => {
    const read = fakeRead(
      [
        { id: 94, title: "Onboarding — Quality Body Shop (deal 3887)" },
        { id: 40, title: "DPM Project" }, // legacy: no deal id → excluded
        { id: 7, title: "SNB Bank" }, // legacy website → excluded
      ],
      {
        94: [parent(1), leaf(2), leaf(3, { description: "Owner: Account Strategist (AS)" })],
        40: [parent(1), leaf(2, { description: "migrated" })],
        7: [parent(1), leaf(2, { description: "old" })],
      },
    );
    const w = fakeWrite();
    const ev = await runAssigneeBackfill({
      readClient: read,
      writeClient: w.client,
      roleUserMap: MAP,
    });
    expect(ev.applied).toBe(false);
    expect(ev.inScopeProjectIds).toEqual([94]);
    expect(ev.candidateTasks).toBe(2);
    expect(ev.planned).toHaveLength(2);
    expect(ev.planned.map((p) => [p.taskId, p.role, p.assigneeId])).toEqual([
      [2, "Web", 111],
      [3, "AS", 222],
    ]);
    expect(ev.planned.every((p) => p.applied === false)).toBe(true);
    expect(w.patched).toHaveLength(0); // dry-run wrote nothing
  });

  it("never touches legacy boards even if they carry ownerless tasks", async () => {
    const read = fakeRead(
      [{ id: 40, title: "DPM Project" }, { id: 7, title: "SNB Bank" }],
      { 40: [parent(1), leaf(2), leaf(3)], 7: [parent(1), leaf(2)] },
    );
    const w = fakeWrite();
    const ev = await runAssigneeBackfill({ readClient: read, writeClient: w.client, roleUserMap: MAP });
    expect(ev.inScopeProjects).toBe(0);
    expect(ev.candidateTasks).toBe(0);
    expect(ev.planned).toHaveLength(0);
  });
});

describe("runAssigneeBackfill — task-level guards", () => {
  it("skips tasks with no role token and unmapped roles, with reasons", async () => {
    const read = fakeRead([{ id: 94, title: "Onboarding — X (deal 1)" }], {
      94: [
        parent(1),
        leaf(2, { description: "no role here" }), // → skipped no_role_token
        leaf(3, { description: "Owner: CRO Analyst (CRO)" }), // CRO not in MAP → role_unmapped
        leaf(4, { description: "Owner: Web Engineer (Web)" }), // → planned
      ],
    });
    const w = fakeWrite();
    const ev = await runAssigneeBackfill({ readClient: read, writeClient: w.client, roleUserMap: MAP });
    expect(ev.candidateTasks).toBe(3);
    expect(ev.planned.map((p) => p.taskId)).toEqual([4]);
    expect(ev.skipped).toEqual([
      { projectId: 94, taskId: 2, reason: "no_role_token" },
      { projectId: 94, taskId: 3, reason: "role_unmapped", role: "CRO" },
    ]);
  });

  it("ignores parents, done tasks, and already-owned tasks (idempotent)", async () => {
    const read = fakeRead([{ id: 94, title: "Onboarding — X (deal 1)" }], {
      94: [
        parent(1), // parent → ignored
        leaf(2, { done: true }), // done → ignored
        leaf(3, { assigneeIds: [999] }), // already owned → ignored
        leaf(4), // the only real candidate
      ],
    });
    const w = fakeWrite();
    const ev = await runAssigneeBackfill({ readClient: read, writeClient: w.client, roleUserMap: MAP });
    expect(ev.candidateTasks).toBe(1);
    expect(ev.planned.map((p) => p.taskId)).toEqual([4]);
  });

  it("honors the projectIds allowlist (Guard 5)", async () => {
    const read = fakeRead(
      [
        { id: 94, title: "Onboarding — A (deal 1)" },
        { id: 95, title: "Onboarding — B (deal 2)" },
      ],
      { 94: [parent(1), leaf(2)], 95: [parent(1), leaf(2)] },
    );
    const w = fakeWrite();
    const ev = await runAssigneeBackfill({
      readClient: read,
      writeClient: w.client,
      roleUserMap: MAP,
      projectIds: [94],
    });
    expect(ev.inScopeProjectIds).toEqual([94]);
    expect(ev.planned.map((p) => p.projectId)).toEqual([94]);
  });
});

describe("runAssigneeBackfill — apply mode", () => {
  it("PATCHes each planned task with the mapped assignee id", async () => {
    const read = fakeRead([{ id: 94, title: "Onboarding — X (deal 1)" }], {
      94: [parent(1), leaf(2), leaf(3, { description: "Owner: UX Designer (UX)" })],
    });
    const w = fakeWrite();
    const ev = await runAssigneeBackfill({
      readClient: read,
      writeClient: w.client,
      roleUserMap: MAP,
      apply: true,
    });
    expect(ev.applied).toBe(true);
    expect(ev.appliedCount).toBe(2);
    expect(ev.failedCount).toBe(0);
    expect(ev.planned.every((p) => p.applied)).toBe(true);
    expect(w.patched).toEqual([
      { taskId: 2, assigneeId: 111 },
      { taskId: 3, assigneeId: 333 },
    ]);
  });

  it("records a write failure without aborting the rest", async () => {
    const read = fakeRead([{ id: 94, title: "Onboarding — X (deal 1)" }], {
      94: [parent(1), leaf(2), leaf(3)],
    });
    const w = fakeWrite([2]); // task 2 throws
    const ev = await runAssigneeBackfill({
      readClient: read,
      writeClient: w.client,
      roleUserMap: MAP,
      apply: true,
    });
    expect(ev.appliedCount).toBe(1);
    expect(ev.failedCount).toBe(1);
    const failed = ev.planned.find((p) => p.taskId === 2)!;
    expect(failed.applied).toBe(false);
    expect(failed.error).toBeTruthy();
    expect(w.patched).toEqual([{ taskId: 3, assigneeId: 111 }]);
  });
});
