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

describe("migrateClientOpenTasks — PSG-802 scope filter", () => {
  it("defaults OFF: every incomplete task migrates (unchanged PSG-644 behaviour)", async () => {
    const asana = fakeAsana([
      t("1", { name: "Monthly Updates" }),
      t("2", { name: "Check Site Health & Plugins" }),
    ]);
    const pd = fakePipedrive();
    const res = await migrateClientOpenTasks({
      asana,
      pipedrive: pd.client,
      asanaProjectGid: "PROJ",
      pipedriveProjectId: 42,
    });
    expect(res.excludedByFilterCount).toBe(0);
    expect(res.excludedByFilter).toEqual([]);
    expect(res.openTaskCount).toBe(2);
  });

  it("excludeStaleRemnants drops the stale monthly remnants and reports them for review", async () => {
    const asana = fakeAsana([
      t("act1", { name: "Monthly Updates" }),
      t("act2", { name: "Rework — Main Navigation" }),
      t("rem1", { name: "Check Site Health & Plugins" }),
      t("rem2", { name: "Google Studio Custom Analytics Report" }),
      t("rem3", { name: "Send Email w/Monthly Custom Analytics Report" }),
    ]);
    const pd = fakePipedrive();
    const res = await migrateClientOpenTasks({
      asana,
      pipedrive: pd.client,
      asanaProjectGid: "PROJ",
      pipedriveProjectId: 42,
      dryRun: true,
      excludeStaleRemnants: true,
    });
    expect(res.openTaskCount).toBe(2); // only the two genuinely-active tasks planned
    expect(res.excludedByFilterCount).toBe(3);
    expect(res.excludedByFilter.map((e) => e.asanaGid).sort()).toEqual(["rem1", "rem2", "rem3"]);
    expect(res.excludedByFilter.every((e) => e.reason === "stale-recurring-remnant")).toBe(true);
    // Non-destructive: nothing about the exclusion routes tasks into the closed archive.
    expect(res.archivedCount).toBe(0);
  });

  it("explicit excludeGids skip-list is applied and labelled 'explicit'", async () => {
    const asana = fakeAsana([t("1", { name: "Keep me" }), t("2", { name: "Skip me" })]);
    const pd = fakePipedrive();
    const res = await migrateClientOpenTasks({
      asana,
      pipedrive: pd.client,
      asanaProjectGid: "PROJ",
      pipedriveProjectId: 42,
      excludeGids: ["2"],
    });
    expect(res.createdCount).toBe(1);
    expect(pd.createTask.mock.calls[0][0].title).toBe("Keep me");
    expect(res.excludedByFilter).toEqual([
      { asanaGid: "2", title: "Skip me", reason: "explicit" },
    ]);
  });

  it("keeps the already-migrated skip count correct alongside the filter", async () => {
    const asana = fakeAsana([
      t("done", { name: "Monthly Updates" }),
      t("rem", { name: "Check Site Health & Plugins" }),
      t("new", { name: "Client Call/Email" }),
    ]);
    const pd = fakePipedrive([
      { id: 9, title: "Monthly Updates", description: asanaMarker("done") },
    ]);
    const res = await migrateClientOpenTasks({
      asana,
      pipedrive: pd.client,
      asanaProjectGid: "PROJ",
      pipedriveProjectId: 42,
      excludeStaleRemnants: true,
    });
    // 3 open: "done" already migrated (skip), "rem" filtered, "new" created.
    expect(res.excludedByFilterCount).toBe(1);
    expect(res.skippedAlreadyMigratedCount).toBe(1);
    expect(res.createdCount).toBe(1);
    expect(pd.createTask.mock.calls[0][0].title).toBe("Client Call/Email");
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
