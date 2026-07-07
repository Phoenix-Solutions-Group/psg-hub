// PSG-644 — Asana → Pipedrive migration core (pure transform, no I/O).
//
// Business outcome (PSG-610 §3 · Move 2): when a client's maintenance work moves off
// Asana onto their new Pipedrive delivery project (created from the WHM template,
// PSG-642), this module decides EXACTLY what to copy and how, with no network calls so
// every rule is unit-tested deterministically. The thin read/write wiring lives in
// `asana-migrate.ts` (orchestrator) + the ops route; this file is where the rules live.
//
// The rules (straight from the ticket):
//   • Open / in-flight tasks ONLY get re-created in Pipedrive. A task is "open" when it
//     is not completed.
//   • Closed / historical tasks are NEVER re-created — they are emitted as CSV rows for a
//     read-only Drive archive (`buildHistoryCsv`).
//   • Subtask depth FLATTENS to a single level: WHM only needs one. Any open task whose
//     open ancestor is also being migrated is nested one level under its TOP-MOST open
//     ancestor; deeper Asana nesting collapses to that one level.
//   • Comments migrate as TEXT appended to the task description/notes (Pipedrive tasks
//     have no comment stream), under a clearly-labelled section.
//   • Every created task carries a deterministic `[asana:<gid>]` marker in its
//     description. A re-run reads the markers already present in the target project and
//     skips those gids — this is what makes the whole import idempotent + marker-guarded.
//
// Assignee mapping mirrors the role→user pattern (role-user-map.ts): the operator supplies
// an `asanaUserGid → pipedriveUserId` map. Unmapped assignees are LEFT UNASSIGNED with the
// original assignee name kept in the description — a bad/absent mapping must never drop a
// task or break the run (same "partial rollout, never throw" discipline as PSG-587).

// ── Asana input shapes (the subset of the Asana Task we consume) ─────────────────────

/** One comment ("story") on an Asana task, already reduced to author + text. */
export interface AsanaComment {
  /** Display name of the comment author (best-effort; may be empty). */
  authorName?: string | null;
  /** The comment text. */
  text: string;
  /** ISO timestamp the comment was created, if known (used only for ordering/label). */
  createdAt?: string | null;
}

/** The subset of an Asana task this migration reads. Flat — parent is a gid reference. */
export interface AsanaTask {
  /** Asana global id — stable, unique, and the idempotency key. */
  gid: string;
  /** Task name → Pipedrive task title. */
  name: string;
  /** Asana completion flag. `true` = closed/historical (archive), `false` = open (migrate). */
  completed: boolean;
  /** Assignee's Asana user gid, if assigned. */
  assigneeGid?: string | null;
  /** Assignee display name (kept in the description when we can't map to a Pipedrive id). */
  assigneeName?: string | null;
  /** Due date `YYYY-MM-DD` (Asana `due_on`) or a full datetime (`due_at`) — date part used. */
  dueOn?: string | null;
  /** Task notes/body → carried into the Pipedrive description. */
  notes?: string | null;
  /** Parent task gid when this is a subtask; absent/null for a top-level task. */
  parentGid?: string | null;
  /** Section/column name for context (kept in the description; Pipedrive has no sections). */
  sectionName?: string | null;
  /** Asana web URL, archived in the history CSV so a closed task can still be found. */
  permalinkUrl?: string | null;
  /** ISO timestamp the task was completed (archived in the history CSV). */
  completedAt?: string | null;
  /** Comments in chronological order → appended to the description as text. */
  comments?: AsanaComment[];
}

/** `asanaUserGid → Pipedrive user id`. Same shape/philosophy as the role→user map. */
export type AssigneeMap = Record<string, number>;

// ── planned Pipedrive output (what the orchestrator will create) ─────────────────────

/** A single Pipedrive task the migration will create (parent OR flattened child). */
export interface PlannedTask {
  /** Source Asana gid — the marker key + idempotency guard. */
  asanaGid: string;
  /** Pipedrive task title. */
  title: string;
  /** Mapped Pipedrive assignee id, or null when the Asana assignee is unmapped/absent. */
  assigneeId: number | null;
  /** Pipedrive `due_date` `YYYY-MM-DD`, or null. */
  dueDate: string | null;
  /** Full description: original notes + assignee/section context + migrated comments + marker. */
  description: string;
}

/** A top-level migrated task plus its flattened (one-level) children. */
export interface PlannedParent extends PlannedTask {
  children: PlannedTask[];
}

/** The complete, ordered plan for one client — what a dry-run prints and a real run writes. */
export interface MigrationPlan {
  /** Ordered top-level tasks (each with its flattened children). */
  parents: PlannedParent[];
  /** Count of open tasks that will be created (parents + children). */
  openTaskCount: number;
  /** Count of closed/historical tasks routed to the CSV archive (never created). */
  closedTaskCount: number;
}

// ── marker (idempotency) ─────────────────────────────────────────────────────────────

/**
 * The deterministic marker embedded in every migrated task's description. Reading it back
 * off the target project's tasks is what lets a re-run skip already-migrated Asana tasks.
 * Format is intentionally simple + greppable: `[asana:<gid>]`.
 */
export function asanaMarker(gid: string): string {
  return `[asana:${gid}]`;
}

const MARKER_RE = /\[asana:([^\]]+)\]/g;

/**
 * Extract the set of already-migrated Asana gids from the descriptions of tasks that
 * already exist in the target Pipedrive project. Pure — the orchestrator passes in the
 * descriptions it read back. A task with no marker contributes nothing.
 */
export function extractMigratedGids(
  existing: ReadonlyArray<{ description?: string | null }>,
): Set<string> {
  const gids = new Set<string>();
  for (const t of existing) {
    const desc = t.description ?? "";
    for (const m of desc.matchAll(MARKER_RE)) gids.add(m[1]);
  }
  return gids;
}

// ── stale recurring-remnant filter (PSG-802) ─────────────────────────────────────────
//
// Long-lived WHM clients accumulate, in Asana, one uncompleted copy of the standard monthly
// checklist for EVERY past month it was never closed (LaMettry's had ~13 such cycles). Those
// are past-month duplicates of the three "Monthly Updates" tasks that the recurring engine
// (recurring-service-template.ts) now regenerates automatically on the fresh Pipedrive board.
// Migrating them would double the recurring engine's own output onto the new board, so the
// pilot migration excludes them by title. This is OPT-IN (default = migrate every incomplete
// task, PSG-644) and NON-DESTRUCTIVE (the Asana tasks are untouched; they still archive/stay
// visible in Asana) — it only decides what NOT to re-create on the fresh board.

/** Normalize a title for tolerant matching: lower-case, punctuation→space, collapse spaces. */
export function normalizeTitleForMatch(title: string | null | undefined): string {
  return (title ?? "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim()
    .replace(/\s+/g, " ");
}

/**
 * Titles of the stale monthly-checklist remnants a recurring WHM Asana board accumulates —
 * past-month copies of the three "Monthly Updates" recurring tasks. Matched on NORMALIZED
 * EQUALITY (see `normalizeTitleForMatch`) so punctuation/casing variance doesn't matter, but
 * a genuinely-active task with a different name is never caught. Extend per-client via the
 * migrate route's `excludeStaleTitles` when a board uses a naming variant.
 */
export const RECURRING_REMNANT_TITLES: readonly string[] = [
  "Check Site Health & Plugins",
  "Google Studio Custom Analytics Report",
  "Send Email w/Monthly Custom Analytics Report",
];

/**
 * Pure: the gids of OPEN tasks whose title matches one of `titles` (normalized equality).
 * Completed tasks are ignored — they archive to CSV regardless of this filter. Deterministic.
 */
export function selectStaleRemnantGids(
  tasks: ReadonlyArray<AsanaTask>,
  titles: ReadonlyArray<string> = RECURRING_REMNANT_TITLES,
): Set<string> {
  const wanted = new Set(titles.map(normalizeTitleForMatch).filter((t) => t.length > 0));
  const gids = new Set<string>();
  if (wanted.size === 0) return gids;
  for (const t of tasks) {
    if (t.completed) continue;
    if (wanted.has(normalizeTitleForMatch(t.name))) gids.add(t.gid);
  }
  return gids;
}

// ── helpers ──────────────────────────────────────────────────────────────────────────

/** Normalize an Asana due value to a `YYYY-MM-DD` date, or null. Handles `due_at` datetimes. */
export function normalizeDueDate(due?: string | null): string | null {
  if (!due) return null;
  const trimmed = due.trim();
  if (!trimmed) return null;
  // `due_at` is an ISO datetime; `due_on` is already a date. Take the leading date part.
  const m = trimmed.match(/^(\d{4}-\d{2}-\d{2})/);
  return m ? m[1] : null;
}

/**
 * Build the full Pipedrive task description from an Asana task: original notes, then a
 * context block (assignee we could not map + Asana section), then migrated comments as
 * text, and finally the idempotency marker on its own line. Deterministic ordering so a
 * re-run produces byte-identical descriptions (and the marker scan stays stable).
 */
export function buildTaskDescription(task: AsanaTask, mappedAssignee: number | null): string {
  const parts: string[] = [];

  const notes = (task.notes ?? "").trim();
  if (notes) parts.push(notes);

  // Context lines that don't fit a structured field.
  const context: string[] = [];
  if (mappedAssignee == null && (task.assigneeName ?? "").trim()) {
    context.push(`Asana assignee: ${task.assigneeName!.trim()} (unmapped — assign in Pipedrive)`);
  }
  if ((task.sectionName ?? "").trim()) {
    context.push(`Asana section: ${task.sectionName!.trim()}`);
  }
  if (context.length) parts.push(context.join("\n"));

  const comments = task.comments ?? [];
  if (comments.length) {
    const rendered = comments
      .map((c) => {
        const who = (c.authorName ?? "").trim() || "Unknown";
        const when = (c.createdAt ?? "").trim();
        const head = when ? `${who} · ${when}` : who;
        return `— ${head}:\n${c.text.trim()}`;
      })
      .join("\n\n");
    parts.push(`--- Comments (migrated from Asana) ---\n${rendered}`);
  }

  // Marker ALWAYS last, on its own line, so it is trivially greppable + stable.
  parts.push(asanaMarker(task.gid));
  return parts.join("\n\n");
}

/** Turn one Asana task into a PlannedTask (title/assignee/due/description), applying the map. */
function planTask(task: AsanaTask, assigneeMap: AssigneeMap): PlannedTask {
  const mapped =
    task.assigneeGid != null && Number.isInteger(assigneeMap[task.assigneeGid])
      ? assigneeMap[task.assigneeGid]
      : null;
  return {
    asanaGid: task.gid,
    title: (task.name ?? "").trim() || "(untitled Asana task)",
    assigneeId: mapped,
    dueDate: normalizeDueDate(task.dueOn),
    description: buildTaskDescription(task, mapped),
  };
}

// ── the plan builder ──────────────────────────────────────────────────────────────────

export interface PlanOptions {
  /** `asanaUserGid → pipedriveUserId`. Unmapped assignees stay unassigned. */
  assigneeMap?: AssigneeMap;
  /**
   * Gids already migrated into the target project (from `extractMigratedGids`). Any open
   * task in this set is skipped — the marker-guard that makes the import idempotent.
   */
  alreadyMigrated?: ReadonlySet<string>;
  /**
   * PSG-802 — opt-in scope filter. Open tasks whose gid is in this set are NOT planned
   * (treated as if absent): the orchestrator uses this to drop stale recurring-checklist
   * remnants that the recurring engine already regenerates on the fresh board, so they are
   * not duplicated. Absent/empty → every open task is planned (PSG-644 default, unchanged).
   * An excluded task's open children (rare — remnants are leaves) re-home to top-level via
   * the same "no open ancestor → top-level" rule, so no genuinely-open work is ever dropped.
   */
  excludeGids?: ReadonlySet<string>;
}

/**
 * The core transform: given one client's full Asana task list, produce the ordered
 * Pipedrive creation plan.
 *
 *   • Open tasks only are planned; closed tasks are counted for the archive and dropped.
 *   • Nesting flattens to ONE level: a task whose top-most OPEN ancestor is also being
 *     migrated becomes a child of that ancestor; everything else is a top-level parent.
 *     (An open subtask of a CLOSED parent has no migrated ancestor → it becomes top-level,
 *     so no open work is ever lost.)
 *   • `alreadyMigrated` gids are skipped (idempotent re-run). A skipped PARENT still
 *     anchors its children: they nest under the existing project task via the same marker,
 *     handled by the orchestrator; here a skipped parent's surviving children are re-homed
 *     to top-level so they are never dropped.
 *
 * Input order is preserved (Asana list order) so a dry-run reads predictably.
 */
export function planClientMigration(
  tasks: ReadonlyArray<AsanaTask>,
  options: PlanOptions = {},
): MigrationPlan {
  const assigneeMap = options.assigneeMap ?? {};
  const already = options.alreadyMigrated ?? new Set<string>();
  const excluded = options.excludeGids ?? new Set<string>();

  const byGid = new Map<string, AsanaTask>();
  for (const t of tasks) byGid.set(t.gid, t);

  // Filter-excluded open tasks (PSG-802) are dropped from planning here. Closed tasks are
  // counted independently so the archive total stays correct regardless of the filter.
  const openTasks = tasks.filter((t) => !t.completed && !excluded.has(t.gid));
  const openGids = new Set(openTasks.map((t) => t.gid));
  const closedTaskCount = tasks.reduce((n, t) => (t.completed ? n + 1 : n), 0);

  /**
   * Walk up the parent chain and return the TOP-MOST open ancestor gid that is strictly
   * above `task` (i.e. the task's own root among migrated tasks). Returns null when the
   * task has no open ancestor (it is itself a top-level migrated task). Guards against
   * cycles/self-parent with a visited set.
   */
  function topOpenAncestor(task: AsanaTask): string | null {
    let root: string | null = null;
    const seen = new Set<string>([task.gid]);
    let cur = task.parentGid ?? null;
    while (cur && openGids.has(cur) && !seen.has(cur)) {
      seen.add(cur);
      root = cur;
      cur = byGid.get(cur)?.parentGid ?? null;
    }
    return root;
  }

  // Assemble parents in input order; children slot under their top-most open ancestor.
  const parents = new Map<string, PlannedParent>();
  const orderedParentGids: string[] = [];
  const childrenByRoot = new Map<string, PlannedTask[]>();

  for (const task of openTasks) {
    if (already.has(task.gid)) continue; // marker-guard: already migrated → skip.
    const root = topOpenAncestor(task);
    if (root == null || already.has(root)) {
      // Top-level task (no open ancestor), OR its ancestor was already migrated and no
      // longer anchors new work in this run → re-home to top-level so it is never dropped.
      if (!parents.has(task.gid)) {
        parents.set(task.gid, { ...planTask(task, assigneeMap), children: [] });
        orderedParentGids.push(task.gid);
      }
    } else {
      const list = childrenByRoot.get(root) ?? [];
      list.push(planTask(task, assigneeMap));
      childrenByRoot.set(root, list);
    }
  }

  // Attach children to their parents (order preserved within each parent).
  for (const [root, kids] of childrenByRoot) {
    const parent = parents.get(root);
    if (parent) parent.children.push(...kids);
    else {
      // Root itself was skipped (already migrated) but survived as a re-homed top-level
      // above; if not, promote the children to top-level so nothing is lost.
      for (const kid of kids) {
        if (!parents.has(kid.asanaGid)) {
          parents.set(kid.asanaGid, { ...kid, children: [] });
          orderedParentGids.push(kid.asanaGid);
        }
      }
    }
  }

  const orderedParents = orderedParentGids
    .map((gid) => parents.get(gid))
    .filter((p): p is PlannedParent => p != null);

  const openTaskCount = orderedParents.reduce((n, p) => n + 1 + p.children.length, 0);

  return { parents: orderedParents, openTaskCount, closedTaskCount };
}

// ── history archive (closed tasks → CSV) ──────────────────────────────────────────────

/** RFC-4180 field escape (mirrors export.ts / ops reports export). */
function csvEscape(field: string): string {
  if (/[",\r\n]/.test(field)) return `"${field.replace(/"/g, '""')}"`;
  return field;
}

/** Columns in the history archive CSV, in order. */
export const HISTORY_CSV_HEADER = [
  "asana_gid",
  "name",
  "assignee",
  "section",
  "due_on",
  "completed_at",
  "permalink_url",
  "num_comments",
  "notes",
] as const;

/**
 * Build the read-only history archive (closed/historical Asana tasks) as an RFC-4180 CSV
 * (CRLF line endings). Only COMPLETED tasks are included — these are the ~6,800 the ticket
 * says to archive, never re-create. Notes are single-lined so the CSV stays one row per
 * task; the permalink lets anyone open the original in Asana. Deterministic (input order).
 */
export function buildHistoryCsv(tasks: ReadonlyArray<AsanaTask>): string {
  const rows: string[] = [HISTORY_CSV_HEADER.join(",")];
  for (const t of tasks) {
    if (!t.completed) continue;
    const cells = [
      t.gid,
      t.name ?? "",
      t.assigneeName ?? "",
      t.sectionName ?? "",
      normalizeDueDate(t.dueOn) ?? "",
      (t.completedAt ?? "").trim(),
      t.permalinkUrl ?? "",
      String((t.comments ?? []).length),
      // Collapse newlines so notes stay in one CSV cell/row.
      (t.notes ?? "").replace(/\r?\n/g, " ").trim(),
    ];
    rows.push(cells.map((c) => csvEscape(String(c))).join(","));
  }
  return rows.join("\r\n");
}

/** Count of closed tasks that the archive will contain (for dry-run/summary reporting). */
export function historyArchiveCount(tasks: ReadonlyArray<AsanaTask>): number {
  return tasks.reduce((n, t) => (t.completed ? n + 1 : n), 0);
}
