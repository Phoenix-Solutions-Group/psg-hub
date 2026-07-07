import { describe, it, expect } from "vitest";
import {
  planClientMigration,
  buildHistoryCsv,
  historyArchiveCount,
  buildTaskDescription,
  asanaMarker,
  extractMigratedGids,
  normalizeDueDate,
  HISTORY_CSV_HEADER,
  type AsanaTask,
} from "../asana-migration";

function task(gid: string, over: Partial<AsanaTask> = {}): AsanaTask {
  return {
    gid,
    name: `Task ${gid}`,
    completed: false,
    ...over,
  };
}

describe("normalizeDueDate", () => {
  it("passes a plain date through", () => {
    expect(normalizeDueDate("2026-08-15")).toBe("2026-08-15");
  });
  it("takes the date part of a due_at datetime", () => {
    expect(normalizeDueDate("2026-08-15T17:00:00.000Z")).toBe("2026-08-15");
  });
  it("returns null for empty/absent/garbage", () => {
    expect(normalizeDueDate(null)).toBeNull();
    expect(normalizeDueDate(undefined)).toBeNull();
    expect(normalizeDueDate("   ")).toBeNull();
    expect(normalizeDueDate("not-a-date")).toBeNull();
  });
});

describe("asanaMarker + extractMigratedGids", () => {
  it("round-trips a gid through the marker", () => {
    expect(asanaMarker("12345")).toBe("[asana:12345]");
    const set = extractMigratedGids([{ description: `hello ${asanaMarker("12345")} world` }]);
    expect(set.has("12345")).toBe(true);
  });
  it("extracts multiple gids and ignores marker-less descriptions", () => {
    const set = extractMigratedGids([
      { description: asanaMarker("a") },
      { description: "no marker here" },
      { description: null },
      { description: `${asanaMarker("b")} and ${asanaMarker("c")}` },
    ]);
    expect([...set].sort()).toEqual(["a", "b", "c"]);
  });
});

describe("buildTaskDescription", () => {
  it("combines notes, comments, and marker in stable order", () => {
    const t = task("77", {
      notes: "Original notes",
      assigneeName: "Jane",
      sectionName: "In Progress",
      comments: [
        { authorName: "Bob", text: "first", createdAt: "2026-07-01" },
        { authorName: "Al", text: "second" },
      ],
    });
    const desc = buildTaskDescription(t, null);
    expect(desc).toContain("Original notes");
    expect(desc).toContain("Asana assignee: Jane (unmapped");
    expect(desc).toContain("Asana section: In Progress");
    expect(desc).toContain("--- Comments (migrated from Asana) ---");
    expect(desc).toContain("Bob · 2026-07-01");
    expect(desc).toContain("first");
    expect(desc).toContain("second");
    // Marker is always last.
    expect(desc.trimEnd().endsWith(asanaMarker("77"))).toBe(true);
  });
  it("omits the unmapped-assignee line when the assignee IS mapped", () => {
    const t = task("9", { assigneeName: "Jane", assigneeGid: "u1" });
    const desc = buildTaskDescription(t, 555);
    expect(desc).not.toContain("unmapped");
  });
  it("is deterministic (byte-identical) across calls — stable marker scan", () => {
    const t = task("42", { notes: "n", comments: [{ text: "c" }] });
    expect(buildTaskDescription(t, null)).toBe(buildTaskDescription(t, null));
  });
});

describe("planClientMigration — open/closed split", () => {
  it("plans open tasks only and counts closed for the archive", () => {
    const plan = planClientMigration([
      task("1"),
      task("2", { completed: true }),
      task("3"),
      task("4", { completed: true }),
    ]);
    expect(plan.openTaskCount).toBe(2);
    expect(plan.closedTaskCount).toBe(2);
    expect(plan.parents.map((p) => p.asanaGid)).toEqual(["1", "3"]);
  });
});

describe("planClientMigration — assignee mapping", () => {
  it("maps a known assignee gid and leaves an unknown one unassigned", () => {
    const plan = planClientMigration(
      [
        task("1", { assigneeGid: "u1" }),
        task("2", { assigneeGid: "u2" }),
        task("3"),
      ],
      { assigneeMap: { u1: 100 } },
    );
    const byGid = Object.fromEntries(plan.parents.map((p) => [p.asanaGid, p.assigneeId]));
    expect(byGid["1"]).toBe(100);
    expect(byGid["2"]).toBeNull();
    expect(byGid["3"]).toBeNull();
  });
});

describe("planClientMigration — flatten to one level", () => {
  it("nests an open subtask under its open parent", () => {
    const plan = planClientMigration([
      task("p"),
      task("c", { parentGid: "p" }),
    ]);
    expect(plan.parents).toHaveLength(1);
    expect(plan.parents[0].asanaGid).toBe("p");
    expect(plan.parents[0].children.map((c) => c.asanaGid)).toEqual(["c"]);
    expect(plan.openTaskCount).toBe(2);
  });

  it("flattens depth>1 to the TOP-most open ancestor (one level only)", () => {
    // p -> c -> g  (three deep). g must attach to p, not c.
    const plan = planClientMigration([
      task("p"),
      task("c", { parentGid: "p" }),
      task("g", { parentGid: "c" }),
    ]);
    expect(plan.parents).toHaveLength(1);
    const kids = plan.parents[0].children.map((c) => c.asanaGid).sort();
    expect(kids).toEqual(["c", "g"]);
    // No child has children of its own — depth is exactly one.
    expect(plan.parents[0].children.every((c) => !("children" in c && (c as { children?: unknown[] }).children?.length))).toBe(true);
  });

  it("promotes an open subtask of a CLOSED parent to top-level (never dropped)", () => {
    const plan = planClientMigration([
      task("p", { completed: true }),
      task("c", { parentGid: "p" }),
    ]);
    expect(plan.parents.map((p) => p.asanaGid)).toEqual(["c"]);
    expect(plan.parents[0].children).toHaveLength(0);
    expect(plan.closedTaskCount).toBe(1);
    expect(plan.openTaskCount).toBe(1);
  });

  it("does not infinite-loop on a self/cyclic parent reference", () => {
    const plan = planClientMigration([
      task("x", { parentGid: "x" }),
      task("y", { parentGid: "z" }),
      task("z", { parentGid: "y" }),
    ]);
    // Everything survives as tasks; no hang.
    expect(plan.openTaskCount).toBe(3);
  });
});

describe("planClientMigration — idempotency (marker-guard)", () => {
  it("skips tasks whose gid is already migrated", () => {
    const already = new Set(["1"]);
    const plan = planClientMigration([task("1"), task("2")], { alreadyMigrated: already });
    expect(plan.parents.map((p) => p.asanaGid)).toEqual(["2"]);
    expect(plan.openTaskCount).toBe(1);
  });

  it("re-homes a child to top-level when its parent was already migrated", () => {
    const already = new Set(["p"]);
    const plan = planClientMigration(
      [task("p"), task("c", { parentGid: "p" })],
      { alreadyMigrated: already },
    );
    // Parent skipped; child survives as a top-level task, not dropped.
    expect(plan.parents.map((p) => p.asanaGid)).toEqual(["c"]);
    expect(plan.parents[0].children).toHaveLength(0);
  });

  it("a full re-run with all gids migrated plans nothing", () => {
    const already = new Set(["p", "c"]);
    const plan = planClientMigration(
      [task("p"), task("c", { parentGid: "p" })],
      { alreadyMigrated: already },
    );
    expect(plan.parents).toHaveLength(0);
    expect(plan.openTaskCount).toBe(0);
  });
});

describe("buildHistoryCsv", () => {
  it("archives ONLY closed tasks with the documented header + RFC-4180 CRLF", () => {
    const csv = buildHistoryCsv([
      task("1"),
      task("2", {
        completed: true,
        name: "Done thing",
        assigneeName: "Jane",
        sectionName: "Complete",
        dueOn: "2026-01-02T09:00:00Z",
        completedAt: "2026-01-03",
        permalinkUrl: "https://app.asana.com/0/1/2",
        comments: [{ text: "a" }, { text: "b" }],
      }),
    ]);
    const lines = csv.split("\r\n");
    expect(lines[0]).toBe(HISTORY_CSV_HEADER.join(","));
    // Only the one closed task is a row.
    expect(lines).toHaveLength(2);
    expect(lines[1]).toContain("Done thing");
    expect(lines[1]).toContain("2026-01-02"); // due normalized to date
    expect(lines[1]).toContain("2026-01-03"); // completed_at
    expect(lines[1]).toContain("https://app.asana.com/0/1/2");
    expect(lines[1]).toMatch(/,2,/); // num_comments = 2
  });

  it("escapes commas, quotes, and newlines; collapses note newlines to one row", () => {
    const csv = buildHistoryCsv([
      task("2", {
        completed: true,
        name: 'Has "quotes", commas',
        notes: "line1\nline2",
      }),
    ]);
    const lines = csv.split("\r\n");
    expect(lines).toHaveLength(2); // header + 1 row, note newline did NOT add a line
    expect(lines[1]).toContain('"Has ""quotes"", commas"');
    expect(lines[1]).toContain("line1 line2");
  });

  it("emits only the header when there are no closed tasks", () => {
    const csv = buildHistoryCsv([task("1"), task("2")]);
    expect(csv).toBe(HISTORY_CSV_HEADER.join(","));
  });
});

describe("historyArchiveCount", () => {
  it("counts closed tasks only", () => {
    expect(
      historyArchiveCount([task("1"), task("2", { completed: true }), task("3", { completed: true })]),
    ).toBe(2);
  });
});
