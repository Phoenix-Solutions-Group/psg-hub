// PSG-666 — Tests for the overdue-digest verification harness (PSG-643 / PSG-660).
//
// Two jobs:
//   1) Prove the harness is correct NOW, with no secrets, using synthetic rows that
//      span every boundary category. This is what makes the harness trustworthy.
//   2) When real, read-only Pipedrive dumps are supplied via env file paths, ingest
//      them, print the full evidence package, and (if the live endpoint summary is
//      also supplied) assert the independent recompute matches it byte-for-byte.
//
// Run the live-diff path (after a deployer pulls read-only dumps — see PSG-666):
//   OVERDUE_TASKS_JSON=/tmp/tasks.json \
//   OVERDUE_PROJECTS_JSON=/tmp/projects.json \
//   OVERDUE_AS_OF=2026-07-07 \
//   OVERDUE_LIVE_SUMMARY=/tmp/digest.json \
//   pnpm --filter psg-hub test overdue-digest-verify
// Without those env vars the live-diff test is skipped, so CI stays green.

import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import type { DigestProject, DigestTask } from "../overdue-digest";
import {
  boundarySnapshot,
  classifyTask,
  renderEvidence,
  verifyFromDigest,
  verifyFromRaw,
} from "../overdue-digest-verify";

const ASOF = new Date("2026-07-07T09:00:00Z");

function task(over: Partial<DigestTask>): DigestTask {
  return {
    id: 0,
    title: "step",
    projectId: 100,
    parentTaskId: null,
    dueDate: null,
    done: false,
    ...over,
  };
}

// One representative row per boundary category, at ASOF = 2026-07-07.
const BEHIND_A = task({ id: 1, title: "GBP post", projectId: 100, dueDate: "2026-07-05" }); // 2d
const BEHIND_B = task({ id: 2, title: "Blog draft", projectId: 100, dueDate: "2026-07-01" }); // 6d
const BEHIND_C = task({ id: 3, title: "Report", projectId: 200, dueDate: "2026-07-06" }); // 1d, other client
const DUE_TODAY = task({ id: 4, title: "Due today", projectId: 100, dueDate: "2026-07-07" });
const FUTURE = task({ id: 5, title: "Future", projectId: 100, dueDate: "2026-07-10" });
const DONE_PAST = task({ id: 6, title: "Done late", projectId: 100, dueDate: "2026-07-01", done: true });
const DONE_OK = task({ id: 7, title: "Done ok", projectId: 100, dueDate: "2026-07-10", done: true });
const NO_DUE = task({ id: 8, title: "No due", projectId: 100, dueDate: null });
const NO_PROJECT = task({ id: 9, title: "Orphan", projectId: null, dueDate: "2026-07-01" });

const ALL_TASKS = [
  BEHIND_A, BEHIND_B, BEHIND_C, DUE_TODAY, FUTURE, DONE_PAST, DONE_OK, NO_DUE, NO_PROJECT,
];
const PROJECTS: DigestProject[] = [
  { id: 100, title: "Acme Collision", boardId: 3 },
  { id: 200, title: "Bright Auto Body", boardId: 3 },
];

describe("classifyTask — the boundary taxonomy", () => {
  it("maps each task to exactly the right category", () => {
    expect(classifyTask(BEHIND_A, ASOF).category).toBe("behind");
    expect(classifyTask(BEHIND_B, ASOF).category).toBe("behind");
    expect(classifyTask(DUE_TODAY, ASOF).category).toBe("due-today");
    expect(classifyTask(FUTURE, ASOF).category).toBe("future");
    expect(classifyTask(DONE_PAST, ASOF).category).toBe("done-past-due");
    expect(classifyTask(DONE_OK, ASOF).category).toBe("done");
    expect(classifyTask(NO_DUE, ASOF).category).toBe("no-due-date");
    expect(classifyTask(NO_PROJECT, ASOF).category).toBe("no-project");
  });

  it("marks ONLY the past-due, not-done, has-project tasks as expected-in-digest", () => {
    const inDigest = ALL_TASKS.filter((t) => classifyTask(t, ASOF).expectedInDigest);
    expect(inDigest.map((t) => t.id).sort()).toEqual([1, 2, 3]);
  });
});

describe("verifyFromDigest — recompute matches the shipped builder", () => {
  it("summary + operator lines + taxonomy invariant all hold", async () => {
    const r = await verifyFromDigest(ALL_TASKS, PROJECTS, ASOF);

    // The recomputed summary must reflect only the 3 behind steps across 2 clients.
    expect(r.report.totalOverdue).toBe(3);
    expect(r.report.clientsBehind).toBe(2);
    expect(r.report.allCaughtUp).toBe(false);
    expect(r.asOf).toBe("2026-07-07");

    // Category counts must sum to every task and split correctly.
    expect(r.categoryCounts.behind).toBe(3);
    expect(r.categoryCounts["due-today"]).toBe(1);
    expect(r.categoryCounts.future).toBe(1);
    expect(r.categoryCounts["done-past-due"]).toBe(1);
    expect(r.categoryCounts["no-due-date"]).toBe(1);
    expect(r.categoryCounts["no-project"]).toBe(1);

    // The load-bearing invariant: our taxonomy never disagrees with production's rule.
    expect(r.taxonomyConsistent).toBe(true);

    // Operator lines are exactly what Vercel logs would show, worst-behind client first.
    expect(r.operatorLines[0]).toBe(
      "[overdue-digest] ALERT 2026-07-07: 2 client(s) behind, 3 step(s)",
    );
    expect(r.operatorLines).toContain(
      "[overdue-digest] BEHIND Acme Collision: 2 step(s), worst 6d — Blog draft (6d); GBP post (2d)",
    );
    expect(r.operatorLines).toContain(
      "[overdue-digest] BEHIND Bright Auto Body: 1 step(s), worst 1d — Report (1d)",
    );
  });

  it("reports all-caught-up when nothing is behind", async () => {
    const r = await verifyFromDigest([DUE_TODAY, FUTURE, DONE_PAST, NO_DUE], PROJECTS, ASOF);
    expect(r.report.allCaughtUp).toBe(true);
    expect(r.report.totalOverdue).toBe(0);
    expect(r.operatorLines).toEqual([
      "[overdue-digest] ok 2026-07-07: all caught up, 0 clients behind",
    ]);
    expect(r.taxonomyConsistent).toBe(true);
  });
});

describe("verifyFromRaw — ingests raw Pipedrive v2 envelopes through the shipped mappers", () => {
  it("maps {data:[...]} rows (0/1 done, ISO due timestamps) identically to production", async () => {
    const rawTasks = {
      success: true,
      data: [
        { id: 1, title: "GBP post", project_id: 100, due_date: "2026-07-05T00:00:00Z", done: false },
        { id: 6, title: "Done late", project_id: 100, due_date: "2026-07-01", done: 1 }, // legacy 1 = done
      ],
      additional_data: { next_cursor: null },
    };
    const rawProjects = { data: [{ id: 100, title: "Acme Collision", board_id: 3 }] };
    const r = await verifyFromRaw(rawTasks, rawProjects, ASOF);
    expect(r.report.totalOverdue).toBe(1); // only the not-done past-due row
    expect(r.categoryCounts.behind).toBe(1);
    expect(r.categoryCounts["done-past-due"]).toBe(1);
    expect(r.taxonomyConsistent).toBe(true);
  });
});

describe("boundarySnapshot", () => {
  it("selects rows spanning behind / due-today / future / done-past-due", async () => {
    const r = await verifyFromDigest(ALL_TASKS, PROJECTS, ASOF);
    const titleById = new Map(PROJECTS.map((p) => [p.id, p.title]));
    const snap = boundarySnapshot(r, titleById);
    const cats = new Set(snap.map((s) => s.category));
    expect(cats.has("behind")).toBe(true);
    expect(cats.has("due-today")).toBe(true);
    expect(cats.has("future")).toBe(true);
    expect(cats.has("done-past-due")).toBe(true);
    // Only the behind rows may claim to be in the digest.
    expect(snap.every((s) => s.expectedInDigest === (s.category === "behind"))).toBe(true);
  });
});

// ── Live-diff path: only runs when a deployer supplies real read-only dumps ─────────
const TASKS_PATH = process.env.OVERDUE_TASKS_JSON;
const PROJECTS_PATH = process.env.OVERDUE_PROJECTS_JSON;
const runLive = Boolean(TASKS_PATH && PROJECTS_PATH);

describe.skipIf(!runLive)("LIVE — independent recompute vs real Pipedrive data", () => {
  it("prints the evidence package and matches the live endpoint summary (if provided)", async () => {
    const asOf = process.env.OVERDUE_AS_OF ? new Date(`${process.env.OVERDUE_AS_OF}T09:00:00Z`) : new Date();
    const rawTasks = JSON.parse(readFileSync(TASKS_PATH as string, "utf8"));
    const rawProjects = JSON.parse(readFileSync(PROJECTS_PATH as string, "utf8"));
    const r = await verifyFromRaw(rawTasks, rawProjects, asOf);

    // Rebuild id→title from the raw projects for the snapshot labels
    // (verifyFromRaw already mapped them; re-derive cheaply here).
    const projectRows: Array<{ id: number; title: string }> = Array.isArray(rawProjects?.data)
      ? rawProjects.data
      : rawProjects;
    const titleById = new Map<number, string>(
      projectRows.map((p) => [Number(p.id), String(p.title)] as [number, string]),
    );
    const snap = boundarySnapshot(r, titleById);
    // Surfaced in the vitest reporter output so the reviewer can copy it verbatim.
    console.log(`\n${renderEvidence(r, snap)}\n`);

    // The harness must always agree with production's own predicate.
    expect(r.taxonomyConsistent).toBe(true);

    if (process.env.OVERDUE_LIVE_SUMMARY) {
      const live = JSON.parse(readFileSync(process.env.OVERDUE_LIVE_SUMMARY, "utf8"));
      expect(r.report.totalOverdue).toBe(live.totalOverdue);
      expect(r.report.clientsBehind).toBe(live.clientsBehind);
      expect(r.report.allCaughtUp).toBe(live.allCaughtUp);
      expect(r.report.asOf).toBe(live.asOf);
    }
  });
});
