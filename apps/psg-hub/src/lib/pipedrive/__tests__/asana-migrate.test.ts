import { describe, it, expect, vi } from "vitest";
import { migrateClientOpenTasks } from "../asana-migrate";
import type { AsanaReadClient } from "../asana-client";
import { asanaMarker, type AsanaTask, type AsanaComment } from "../asana-migration";
import type { PipedriveProjectsClient, CreateTaskInput } from "../projects";

function fakeAsana(tasks: AsanaTask[], comments: Record<string, AsanaComment[]> = {}): AsanaReadClient {
  return {
    listProjectTaskTree: vi.fn(async () => tasks.map((t) => ({ ...t }))),
    listTaskComments: vi.fn(async (gid: string) => comments[gid] ?? []),
  };
}

function fakePipedrive(existing: Array<{ id: number; title: string; description: string }> = []) {
  let nextId = 500;
  const createTask = vi.fn(async (_input: CreateTaskInput) => ({ id: nextId++ }));
  const listProjectTasks = vi.fn(async (_projectId: number) => existing);
  const client: PipedriveProjectsClient = {
    listBoards: vi.fn(async () => []),
    listPhases: vi.fn(async () => []),
    listUsers: vi.fn(async () => []),
    createProject: vi.fn(async () => ({ id: 1 })),
    createTask,
    findProjectByTitle: vi.fn(async () => null),
    listProjectTasks,
  };
  return { client, createTask, listProjectTasks };
}

function t(gid: string, over: Partial<AsanaTask> = {}): AsanaTask {
  return { gid, name: `Task ${gid}`, completed: false, ...over };
}

describe("migrateClientOpenTasks — dry-run", () => {
  it("makes ZERO Pipedrive writes and reports what would be created", async () => {
    const asana = fakeAsana([t("1"), t("2", { completed: true }), t("3", { parentGid: "1" })]);
    const pd = fakePipedrive();
    const res = await migrateClientOpenTasks({
      asana,
      pipedrive: pd.client,
      asanaProjectGid: "PROJ",
      pipedriveProjectId: 42,
      dryRun: true,
      clientLabel: "Sunrise Collision",
    });

    expect(pd.createTask).not.toHaveBeenCalled();
    expect(res.dryRun).toBe(true);
    expect(res.openTaskCount).toBe(2); // task 1 + subtask 3 (task 2 is closed)
    expect(res.createdCount).toBe(0);
    expect(res.archivedCount).toBe(1);
    // Task 3 nests under task 1.
    const three = res.tasks.find((x) => x.asanaGid === "3");
    expect(three?.parentAsanaGid).toBe("1");
    expect(res.tasks.every((x) => x.pipedriveTaskId === null)).toBe(true);
  });
});

describe("migrateClientOpenTasks — real run", () => {
  it("creates parents then children with parent_task_id, marker, assignee, due", async () => {
    const asana = fakeAsana(
      [
        t("1", { assigneeGid: "u1", dueOn: "2026-08-01T10:00:00Z", notes: "do it" }),
        t("2", { parentGid: "1" }),
      ],
      { "1": [{ authorName: "Bob", text: "hi" }] },
    );
    const pd = fakePipedrive();
    const res = await migrateClientOpenTasks({
      asana,
      pipedrive: pd.client,
      asanaProjectGid: "PROJ",
      pipedriveProjectId: 42,
      assigneeMap: { u1: 100 },
    });

    expect(res.createdCount).toBe(2);
    // Parent created first (id 500), child second with parent_task_id 500.
    const parentCall = pd.createTask.mock.calls[0][0];
    const childCall = pd.createTask.mock.calls[1][0];
    expect(parentCall.title).toBe("Task 1");
    expect(parentCall.assignee_id).toBe(100);
    expect(parentCall.due_date).toBe("2026-08-01");
    expect(parentCall.description).toContain(asanaMarker("1"));
    expect(parentCall.description).toContain("do it");
    expect(parentCall.description).toContain("hi"); // migrated comment
    expect(childCall.parent_task_id).toBe(500);
    expect(childCall.description).toContain(asanaMarker("2"));
    // Evidence carries the created ids.
    expect(res.tasks.find((x) => x.asanaGid === "1")?.pipedriveTaskId).toBe(500);
  });

  it("fetches comments for open tasks only (never for closed)", async () => {
    const asana = fakeAsana([t("1"), t("2", { completed: true })]);
    const pd = fakePipedrive();
    await migrateClientOpenTasks({
      asana,
      pipedrive: pd.client,
      asanaProjectGid: "PROJ",
      pipedriveProjectId: 42,
    });
    expect(asana.listTaskComments).toHaveBeenCalledTimes(1);
    expect(asana.listTaskComments).toHaveBeenCalledWith("1");
  });
});

describe("migrateClientOpenTasks — idempotency", () => {
  it("skips tasks already marked in the target project and reports the skip count", async () => {
    const asana = fakeAsana([t("1"), t("2")]);
    const pd = fakePipedrive([
      { id: 9, title: "Task 1", description: `already ${asanaMarker("1")}` },
    ]);
    const res = await migrateClientOpenTasks({
      asana,
      pipedrive: pd.client,
      asanaProjectGid: "PROJ",
      pipedriveProjectId: 42,
    });
    expect(res.skippedAlreadyMigratedCount).toBe(1);
    expect(res.createdCount).toBe(1);
    expect(pd.createTask).toHaveBeenCalledTimes(1);
    expect(pd.createTask.mock.calls[0][0].title).toBe("Task 2");
  });

  it("a second identical run creates nothing (fully idempotent)", async () => {
    const tasks = [t("1"), t("2", { parentGid: "1" })];
    // Simulate that run 1 already wrote both markers into the project.
    const pd = fakePipedrive([
      { id: 9, title: "Task 1", description: asanaMarker("1") },
      { id: 10, title: "Task 2", description: asanaMarker("2") },
    ]);
    const res = await migrateClientOpenTasks({
      asana: fakeAsana(tasks),
      pipedrive: pd.client,
      asanaProjectGid: "PROJ",
      pipedriveProjectId: 42,
    });
    expect(res.createdCount).toBe(0);
    expect(pd.createTask).not.toHaveBeenCalled();
  });
});

describe("migrateClientOpenTasks — guards", () => {
  it("refuses to run when the Pipedrive client cannot list project tasks", async () => {
    const pd = fakePipedrive();
    // Strip the marker-guard capability.
    delete (pd.client as { listProjectTasks?: unknown }).listProjectTasks;
    await expect(
      migrateClientOpenTasks({
        asana: fakeAsana([t("1")]),
        pipedrive: pd.client,
        asanaProjectGid: "PROJ",
        pipedriveProjectId: 42,
      }),
    ).rejects.toThrow(/idempotency/i);
  });
});
