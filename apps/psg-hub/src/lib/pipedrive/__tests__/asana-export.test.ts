import { describe, it, expect } from "vitest";
import {
  parseAsanaExport,
  createExportSource,
  dryRunExportProject,
  summarizeExport,
} from "../asana-export";

// PSG-644 — the offline domain-export ingest path. These fixtures reproduce the two shapes
// an Asana JSON export can take: the flat ORG dump (many projects, top-level tasks/stories)
// and a single nested PROJECT export (tasks with nested subtasks/stories). The assertions
// prove the export flows through the SAME planner/orchestrator the live path uses:
// open-only, closed→archive, subtasks flatten one level, comments carried, per-project split.

// A flat org export: two client projects, open + closed tasks, a subtask, and a comment.
const FLAT_EXPORT = {
  data: {
    projects: [
      { gid: "P1", name: "Acme Body Shop" },
      { gid: "P2", name: "Bella Collision" },
    ],
    users: [{ gid: "U1", name: "Dana Tech" }],
    tasks: [
      {
        gid: "T1",
        name: "Publish August blog",
        completed: false,
        assignee: { gid: "U1", name: "Dana Tech" },
        due_on: "2026-08-15",
        notes: "Draft in Docs",
        memberships: [{ project: { gid: "P1" }, section: { name: "In Progress" } }],
      },
      {
        gid: "T1s",
        name: "Add meta description",
        completed: false,
        parent: { gid: "T1" },
        memberships: [{ project: { gid: "P1" } }],
      },
      {
        gid: "T2",
        name: "Old finished audit",
        completed: true,
        completed_at: "2026-05-01T10:00:00.000Z",
        permalink_url: "https://app.asana.com/0/P1/T2",
        memberships: [{ project: { gid: "P1" } }],
      },
      {
        gid: "T3",
        name: "Bella — refresh homepage",
        completed: false,
        due_at: "2026-09-01T12:00:00.000Z",
        memberships: [{ project: { gid: "P2" }, section: { name: "Backlog" } }],
      },
    ],
    stories: [
      {
        gid: "S1",
        type: "comment",
        text: "Client approved the draft",
        created_at: "2026-07-01T09:00:00.000Z",
        created_by: { name: "Dana Tech" },
        target: { gid: "T1" },
      },
      // A system story that must NOT become a comment.
      {
        gid: "S2",
        type: "system",
        resource_subtype: "assigned",
        text: "assigned to Dana",
        target: { gid: "T1" },
      },
    ],
  },
};

describe("parseAsanaExport — flat org shape", () => {
  it("buckets tasks by project and enumerates clients open-first", () => {
    const source = createExportSource(FLAT_EXPORT);
    const projects = source.listExportProjects();
    expect(projects.map((p) => p.gid)).toEqual(["P1", "P2"]); // P1 has more open work
    const p1 = projects.find((p) => p.gid === "P1")!;
    expect(p1.name).toBe("Acme Body Shop");
    expect(p1.openTaskCount).toBe(2); // T1 + subtask T1s (T2 is closed)
    expect(p1.closedTaskCount).toBe(1); // T2
    const p2 = projects.find((p) => p.gid === "P2")!;
    expect(p2.openTaskCount).toBe(1);
  });

  it("attaches only user comments to the right task", async () => {
    const source = createExportSource(FLAT_EXPORT);
    expect(await source.listTaskComments("T1")).toEqual([
      {
        authorName: "Dana Tech",
        text: "Client approved the draft",
        createdAt: "2026-07-01T09:00:00.000Z",
      },
    ]);
    expect(await source.listTaskComments("T3")).toEqual([]);
  });
});

describe("dryRunExportProject — plans off the file with zero writes", () => {
  it("migrates open only, flattens the subtask, archives the closed task, carries the comment", async () => {
    const source = createExportSource(FLAT_EXPORT);
    const result = await dryRunExportProject(source, "P1", {
      assigneeMap: { U1: 555 },
      clientLabel: "Acme Body Shop",
    });

    expect(result.dryRun).toBe(true);
    expect(result.createdCount).toBe(0); // dry-run writes nothing
    expect(result.openTaskCount).toBe(2); // T1 parent + T1s child
    expect(result.archivedCount).toBe(1); // T2 closed

    // Parent T1 with its flattened child T1s.
    expect(result.tasks).toHaveLength(2);
    const parent = result.tasks[0];
    expect(parent.asanaGid).toBe("T1");
    expect(parent.parentAsanaGid).toBeNull();
    expect(parent.assigneeId).toBe(555); // mapped
    expect(parent.dueDate).toBe("2026-08-15");
    const child = result.tasks[1];
    expect(child.asanaGid).toBe("T1s");
    expect(child.parentAsanaGid).toBe("T1"); // nested one level

    // History CSV contains the closed task, not the open ones.
    expect(result.historyCsv).toContain("Old finished audit");
    expect(result.historyCsv).not.toContain("Publish August blog");
  });

  it("normalizes a due_at datetime to a date for the second client", async () => {
    const source = createExportSource(FLAT_EXPORT);
    const result = await dryRunExportProject(source, "P2");
    expect(result.openTaskCount).toBe(1);
    expect(result.tasks[0].dueDate).toBe("2026-09-01");
  });
});

describe("summarizeExport — fleet totals", () => {
  it("totals open and closed across all clients", () => {
    const summary = summarizeExport(FLAT_EXPORT);
    expect(summary.totalOpen).toBe(3); // T1 + T1s + T3
    expect(summary.totalClosed).toBe(1); // T2
    expect(summary.projects).toHaveLength(2);
  });
});

// A single nested project export (the other shape Asana can produce).
const NESTED_EXPORT = {
  data: {
    gid: "PN",
    name: "Nested Client",
    tasks: [
      {
        gid: "N1",
        name: "Parent task",
        completed: false,
        subtasks: [
          {
            gid: "N1a",
            name: "Nested child",
            completed: false,
            stories: [
              { gid: "NS1", type: "comment", text: "note on child", created_by: { name: "Ravi" } },
            ],
          },
        ],
      },
      { gid: "N2", name: "Done long ago", completed: true },
    ],
  },
};

describe("parseAsanaExport — nested single-project shape", () => {
  it("walks nested subtasks into a flat parent-linked list with comments", async () => {
    const parsed = parseAsanaExport(NESTED_EXPORT);
    expect([...parsed.tasksByProject.keys()]).toEqual(["PN"]);
    const source = createExportSource(NESTED_EXPORT);
    expect(await source.listTaskComments("N1a")).toEqual([
      { authorName: "Ravi", text: "note on child", createdAt: null },
    ]);

    const result = await dryRunExportProject(source, "PN");
    expect(result.openTaskCount).toBe(2); // N1 + N1a
    expect(result.archivedCount).toBe(1); // N2
    expect(result.tasks[1].parentAsanaGid).toBe("N1"); // child nested under parent
  });
});
