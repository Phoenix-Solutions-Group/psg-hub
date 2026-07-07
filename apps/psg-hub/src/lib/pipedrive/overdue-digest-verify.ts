// PSG-666 — Independent verification harness for the weekly overdue digest (PSG-643).
//
// Purpose (QA accuracy gate, PSG-660): given a raw, read-only dump of Pipedrive's
// `/api/v2/tasks` + `/api/v2/projects`, this module INDEPENDENTLY recomputes the
// digest and classifies EVERY task against the single overdue rule, so a reviewer
// can confirm the live digest picked exactly the right rows — no more, no fewer.
//
// It deliberately reuses the SHIPPED pure functions (`isTaskOverdue`,
// `buildOverdueDigestReport`, `buildDigestDeliverer`, `toDigestTask/Project`) rather
// than reimplementing the rule, so there is zero drift between what production does
// and what this check asserts. No I/O, no clock (the caller supplies `asOf`), no
// secrets — it operates only on already-fetched JSON.
//
// The overdue rule under test (from overdue-digest.ts): a task is BEHIND iff it is
// NOT done AND has a due date strictly before `asOf`. Everything else is excluded:
//   • due today            → excluded
//   • due in the future    → excluded
//   • done (even if past due) → excluded
//   • no due date          → excluded
//   • no project id        → excluded (not client delivery work)

import {
  buildDigestDeliverer,
  buildOverdueDigestReport,
  isTaskOverdue,
  toDigestProject,
  toDigestTask,
  toIsoDate,
  type DigestProject,
  type DigestTask,
  type OverdueDigestReport,
} from "./overdue-digest";

/** The mutually-exclusive boundary category a task falls into for a given `asOf`. */
export type TaskCategory =
  | "behind" // NOT done, due < asOf, has project → the ONLY category in the digest
  | "due-today" // NOT done, due == asOf → excluded
  | "future" // NOT done, due > asOf → excluded
  | "done-past-due" // done, due < asOf → excluded (the classic false-positive trap)
  | "done" // done, due >= asOf or no due → excluded
  | "no-due-date" // NOT done, no due date → excluded
  | "no-project"; // no project id → excluded (not client delivery work)

export interface ClassifiedTask {
  task: DigestTask;
  category: TaskCategory;
  /** True iff this task should appear in the digest (category === "behind"). */
  expectedInDigest: boolean;
}

/**
 * Classify a single task into exactly one boundary category. The `expectedInDigest`
 * flag is cross-checked against the shipped `isTaskOverdue` predicate so the taxonomy
 * can never silently disagree with production (see `classifyTasks`' invariant).
 */
export function classifyTask(task: DigestTask, asOf: Date): ClassifiedTask {
  let category: TaskCategory;
  if (task.projectId == null) {
    category = "no-project";
  } else if (task.done) {
    // A done task is never overdue; split past-due vs not only for reviewer insight.
    const due = task.dueDate;
    category = due != null && due.slice(0, 10) < toIsoDate(asOf) ? "done-past-due" : "done";
  } else if (task.dueDate == null) {
    category = "no-due-date";
  } else {
    const due = task.dueDate.slice(0, 10);
    const today = toIsoDate(asOf);
    category = due < today ? "behind" : due === today ? "due-today" : "future";
  }
  return { task, category, expectedInDigest: category === "behind" };
}

export function classifyTasks(tasks: DigestTask[], asOf: Date): ClassifiedTask[] {
  return tasks.map((t) => classifyTask(t, asOf));
}

/** The 4-field ground-truth row a reviewer eyeballs: title | due | done | verdict. */
export interface SnapshotRow {
  project: string;
  task: string;
  dueDate: string | null;
  done: boolean;
  category: TaskCategory;
  expectedInDigest: boolean;
}

export interface VerificationResult {
  asOf: string;
  /** The independently recomputed digest report (same builder production uses). */
  report: OverdueDigestReport;
  /** The exact `[overdue-digest]` operator lines this report would emit. */
  operatorLines: string[];
  /** Every task, classified — the full accuracy surface. */
  classified: ClassifiedTask[];
  /** Task counts per category (quick sanity totals). */
  categoryCounts: Record<TaskCategory, number>;
  /**
   * Invariant that must ALWAYS hold: a task's `expectedInDigest` equals the shipped
   * predicate (`isTaskOverdue` && has project). If false, the taxonomy drifted from
   * production and the harness itself is untrustworthy — fail loudly.
   */
  taxonomyConsistent: boolean;
}

const CATEGORIES: TaskCategory[] = [
  "behind",
  "due-today",
  "future",
  "done-past-due",
  "done",
  "no-due-date",
  "no-project",
];

/**
 * Capture the `[overdue-digest]` operator lines the deployed deliverer would log for
 * this report, by invoking the SHIPPED `buildDigestDeliverer` with a log sink (and no
 * email). This is byte-identical to what Vercel's function logs show on a live run.
 */
async function captureOperatorLines(report: OverdueDigestReport): Promise<string[]> {
  const lines: string[] = [];
  const deliver = buildDigestDeliverer({ recipients: [], log: (l) => lines.push(l) });
  await deliver(report);
  return lines;
}

/**
 * Recompute + classify from ALREADY-MAPPED digest tasks/projects. Pure and
 * secret-free. Callers that have raw Pipedrive JSON should use `verifyFromRaw`.
 */
export async function verifyFromDigest(
  tasks: DigestTask[],
  projects: DigestProject[],
  asOf: Date,
): Promise<VerificationResult> {
  const report = buildOverdueDigestReport(tasks, projects, asOf);
  const classified = classifyTasks(tasks, asOf);
  const operatorLines = await captureOperatorLines(report);

  const categoryCounts = Object.fromEntries(
    CATEGORIES.map((c) => [c, 0]),
  ) as Record<TaskCategory, number>;
  for (const c of classified) categoryCounts[c.category] += 1;

  // Invariant: our taxonomy's "should appear" must match the shipped predicate.
  const taxonomyConsistent = classified.every(
    (c) => c.expectedInDigest === (c.task.projectId != null && isTaskOverdue(c.task, asOf)),
  );

  return { asOf: toIsoDate(asOf), report, operatorLines, classified, categoryCounts, taxonomyConsistent };
}

/**
 * Recompute + classify straight from raw Pipedrive `/api/v2/{tasks,projects}` JSON.
 * Accepts either the full envelope (`{ data: [...] }`) or a bare row array, and maps
 * each row through the SHIPPED adapter mappers so field coercion matches production.
 */
export async function verifyFromRaw(
  rawTasks: unknown,
  rawProjects: unknown,
  asOf: Date,
): Promise<VerificationResult> {
  const taskRows = extractRows(rawTasks);
  const projectRows = extractRows(rawProjects);
  return verifyFromDigest(taskRows.map(toDigestTask), projectRows.map(toDigestProject), asOf);
}

/** Pull the row array out of a Pipedrive v2 envelope, a `{data}` object, or a bare array. */
export function extractRows(raw: unknown): unknown[] {
  if (Array.isArray(raw)) return raw;
  if (raw && typeof raw === "object" && Array.isArray((raw as { data?: unknown }).data)) {
    return (raw as { data: unknown[] }).data;
  }
  return [];
}

/**
 * Pick a small, human-readable boundary snapshot spanning the categories that prove
 * the filter is correct: up to `perCategory` real rows from each of behind / due-today
 * / future / done-past-due (the first should appear; the last three must not). Lets a
 * reviewer confirm the RIGHT rows were chosen without scanning the whole task list.
 */
export function boundarySnapshot(
  result: VerificationResult,
  projectTitleById: Map<number, string>,
  perCategory = 2,
): SnapshotRow[] {
  const want: TaskCategory[] = ["behind", "due-today", "future", "done-past-due"];
  const rows: SnapshotRow[] = [];
  for (const cat of want) {
    const picked = result.classified.filter((c) => c.category === cat).slice(0, perCategory);
    for (const c of picked) {
      rows.push({
        project:
          c.task.projectId != null
            ? projectTitleById.get(c.task.projectId) ?? `Project #${c.task.projectId}`
            : "(no project)",
        task: c.task.title || `Task #${c.task.id}`,
        dueDate: c.task.dueDate,
        done: c.task.done,
        category: c.category,
        expectedInDigest: c.expectedInDigest,
      });
    }
  }
  return rows;
}

/** Render the full evidence package as printable text (summary + lines + snapshot). */
export function renderEvidence(result: VerificationResult, snapshot: SnapshotRow[]): string {
  const { report } = result;
  const out: string[] = [];
  out.push(`# Overdue-digest independent verification — as of ${result.asOf}`);
  out.push("");
  out.push("## Recomputed summary (must match the live endpoint JSON)");
  out.push(
    JSON.stringify(
      {
        ok: true,
        asOf: report.asOf,
        totalOverdue: report.totalOverdue,
        clientsBehind: report.clientsBehind,
        allCaughtUp: report.allCaughtUp,
      },
      null,
      2,
    ),
  );
  out.push("");
  out.push("## Operator log lines (must match the [overdue-digest] lines in Vercel logs)");
  out.push(...result.operatorLines);
  out.push("");
  out.push("## Category counts (every task classified)");
  out.push(JSON.stringify(result.categoryCounts, null, 2));
  out.push(`taxonomyConsistent: ${result.taxonomyConsistent}`);
  out.push("");
  out.push("## Boundary snapshot — project | task | due_date | done | category | inDigest?");
  for (const r of snapshot) {
    out.push(
      `${r.project} | ${r.task} | ${r.dueDate ?? "(none)"} | ${r.done} | ${r.category} | ${r.expectedInDigest}`,
    );
  }
  return out.join("\n");
}
