// PSG-644 — Asana DOMAIN/ORG EXPORT → migration source (offline, tokenless path).
//
// Why this exists: the live read side (`asana-client.ts`) needs an Asana Personal Access
// Token to hit the API. When the operator instead hands us an Asana **domain export** — the
// `domain_export_<org>_..._<ts>.json.gz` an admin downloads from Asana — we can run the WHOLE
// migration off that file with NO Asana token and NO network. This adapter turns a parsed
// export object into the SAME `AsanaReadClient` the orchestrator (`asana-migrate.ts`) already
// consumes, so nothing downstream changes: the pure planner, dry-run, idempotency marker,
// history CSV — all reused verbatim. The only new surface is "how do we read the tasks".
//
// The domain export is an ORG-WIDE dump: many projects (= many clients) in one file. So this
// adapter also enumerates the projects (`listExportProjects`) so a caller can pick the pilot
// client, and offers a one-call per-project dry-run (`dryRunExportProject`).
//
// Schema tolerance: Asana's export JSON has drifted in shape over the years, so every field
// is read through defensive helpers that accept the known aliases (`due_on`/`due_at`,
// `completed_at`/`completed_ts`, comment stories keyed `type:"comment"` OR
// `resource_subtype:"comment_added"`, story→task links via `target`/`task`/`parent`). The
// canonical assumption is the flat org shape: `root.data.{projects,tasks,stories,users}[]`
// with tasks carrying `parent` (gid ref) + `memberships[].{project,section}`. A single
// project export (`root.data.tasks[]` with nested `subtasks`/`stories`, no top-level
// projects array) is also accepted. If a real file surfaces a field name we do not yet read,
// the fix is localized to the small extractor helpers below.

import type { AsanaReadClient } from "./asana-client";
import {
  planClientMigration,
  buildHistoryCsv,
  historyArchiveCount,
  type AsanaTask,
  type AsanaComment,
  type AssigneeMap,
} from "./asana-migration";
import { migrateClientOpenTasks, type MigrateClientResult } from "./asana-migrate";

// ── defensive field readers ────────────────────────────────────────────────────────────

type Json = Record<string, unknown>;

function asObj(v: unknown): Json | null {
  return v && typeof v === "object" && !Array.isArray(v) ? (v as Json) : null;
}
function asArr(v: unknown): unknown[] {
  return Array.isArray(v) ? v : [];
}
function str(v: unknown): string | null {
  if (typeof v === "string") return v;
  if (typeof v === "number") return String(v);
  return null;
}
/** First non-null string among a raw object's candidate keys. */
function pick(obj: Json, ...keys: string[]): string | null {
  for (const k of keys) {
    const s = str(obj[k]);
    if (s != null && s !== "") return s;
  }
  return null;
}

// ── normalized export model ──────────────────────────────────────────────────────────

/** A client/project discovered in the export — the unit a migration run targets. */
export interface ExportProject {
  gid: string;
  name: string;
  /** Count of open (not-completed) tasks that would migrate — for pilot selection. */
  openTaskCount: number;
  /** Count of closed tasks that would archive to CSV. */
  closedTaskCount: number;
}

interface ParsedExport {
  /** projectGid → ordered task list (flattened, parent-linked), comments pre-attached. */
  tasksByProject: Map<string, AsanaTask[]>;
  /** projectGid → display name. */
  projectNames: Map<string, string>;
}

/**
 * True when this is the flat ORG dump rather than a single nested project export. Both carry
 * a top-level `tasks` array, so we discriminate on what only the org dump has: a top-level
 * `projects` list, or tasks that reference their project(s) via `memberships`. A single
 * project export's `data` IS the project (gid+name, tasks with nested `subtasks`, no
 * memberships) → nested.
 */
function looksFlat(data: Json): boolean {
  if (Array.isArray(data.projects)) return true;
  return asArr(data.tasks).some((t) => {
    const to = asObj(t);
    return to != null && Array.isArray(to.memberships) && to.memberships.length > 0;
  });
}

/** Reduce an export story object to our comment shape, or null if it is not a user comment. */
function storyToComment(raw: Json): AsanaComment | null {
  const type = pick(raw, "type") ?? "";
  const subtype = pick(raw, "resource_subtype") ?? "";
  const isComment = type === "comment" || subtype === "comment_added";
  if (!isComment) return null;
  const text = pick(raw, "text", "html_text") ?? "";
  if (!text.trim()) return null;
  const author = asObj(raw.created_by);
  return {
    authorName: author ? pick(author, "name") : pick(raw, "created_by_name"),
    text,
    createdAt: pick(raw, "created_at", "created_ts"),
  };
}

/** Extract the project gids a flat-export task belongs to (via memberships or `projects`). */
function taskProjectGids(raw: Json): string[] {
  const out = new Set<string>();
  for (const m of asArr(raw.memberships)) {
    const mo = asObj(m);
    const proj = mo && asObj(mo.project);
    const gid = proj && pick(proj, "gid");
    if (gid) out.add(gid);
  }
  for (const p of asArr(raw.projects)) {
    const po = asObj(p);
    const gid = po && pick(po, "gid");
    if (gid) out.add(gid);
  }
  return [...out];
}

/** Section name for a flat-export task (first membership that names one). */
function taskSectionName(raw: Json): string | null {
  for (const m of asArr(raw.memberships)) {
    const mo = asObj(m);
    const sec = mo && asObj(mo.section);
    const name = sec && pick(sec, "name");
    if (name) return name;
  }
  return null;
}

/** Map one raw export task to our internal AsanaTask (comments attached separately). */
function toTask(raw: Json): AsanaTask {
  const assignee = asObj(raw.assignee);
  const parent = asObj(raw.parent);
  return {
    gid: pick(raw, "gid", "id") ?? "",
    name: pick(raw, "name", "title") ?? "",
    completed: raw.completed === true,
    completedAt: pick(raw, "completed_at", "completed_ts"),
    assigneeGid: assignee ? pick(assignee, "gid", "id") : pick(raw, "assignee_gid"),
    assigneeName: assignee ? pick(assignee, "name") : pick(raw, "assignee_name"),
    dueOn: pick(raw, "due_on", "due_at", "due_date"),
    notes: pick(raw, "notes", "html_notes", "description"),
    parentGid: parent ? pick(parent, "gid", "id") : pick(raw, "parent_gid"),
    sectionName: taskSectionName(raw),
    permalinkUrl: pick(raw, "permalink_url", "url"),
    comments: [],
  };
}

/** Parse the flat org shape: top-level tasks/stories/projects arrays. */
function parseFlat(data: Json): ParsedExport {
  const projectNames = new Map<string, string>();
  for (const p of asArr(data.projects)) {
    const po = asObj(p);
    const gid = po && pick(po, "gid", "id");
    if (gid) projectNames.set(gid, (po && pick(po, "name")) ?? gid);
  }

  // Index comments by their target task gid (a story references a task).
  const commentsByTask = new Map<string, AsanaComment[]>();
  for (const s of asArr(data.stories)) {
    const so = asObj(s);
    if (!so) continue;
    const comment = storyToComment(so);
    if (!comment) continue;
    const target =
      asObj(so.target) ?? asObj(so.task) ?? asObj(so.parent) ?? null;
    const taskGid = target ? pick(target, "gid", "id") : pick(so, "target_gid", "task_gid");
    if (!taskGid) continue;
    const list = commentsByTask.get(taskGid) ?? [];
    list.push(comment);
    commentsByTask.set(taskGid, list);
  }

  // Build tasks, attaching comments, and bucket by project.
  const tasksByProject = new Map<string, AsanaTask[]>();
  for (const t of asArr(data.tasks)) {
    const to = asObj(t);
    if (!to) continue;
    const task = toTask(to);
    if (!task.gid) continue;
    task.comments = commentsByTask.get(task.gid) ?? [];
    const projectGids = taskProjectGids(to);
    // A subtask may carry no membership; fall back to a nested `project` hint or skip
    // gracefully — the parent's project is resolved in a second pass below.
    for (const pg of projectGids) {
      if (!projectNames.has(pg)) projectNames.set(pg, pg);
      const list = tasksByProject.get(pg) ?? [];
      list.push(task);
      tasksByProject.set(pg, list);
    }
    if (projectGids.length === 0) {
      // Park orphan (membership-less) tasks so the parent-project backfill can place them.
      const list = tasksByProject.get("") ?? [];
      list.push(task);
      tasksByProject.set("", list);
    }
  }

  // Backfill: a subtask with no membership inherits its parent task's project(s).
  const orphans = tasksByProject.get("") ?? [];
  if (orphans.length) {
    const projectOfTask = new Map<string, string[]>();
    for (const [pg, list] of tasksByProject) {
      if (pg === "") continue;
      for (const task of list) {
        const arr = projectOfTask.get(task.gid) ?? [];
        arr.push(pg);
        projectOfTask.set(task.gid, arr);
      }
    }
    for (const orphan of orphans) {
      const parentProjects = orphan.parentGid ? projectOfTask.get(orphan.parentGid) : undefined;
      for (const pg of parentProjects ?? []) {
        tasksByProject.get(pg)!.push(orphan);
      }
    }
    tasksByProject.delete("");
  }

  return { tasksByProject, projectNames };
}

/** Parse a single nested project export: `data` IS a project with nested `tasks`/`subtasks`. */
function parseNested(data: Json): ParsedExport {
  const projectGid = pick(data, "gid", "id") ?? "project";
  const projectName = pick(data, "name") ?? projectGid;
  const tasks: AsanaTask[] = [];

  function walk(raw: Json, parentGid: string | null) {
    const task = toTask(raw);
    if (parentGid && !task.parentGid) task.parentGid = parentGid;
    if (!task.gid) return;
    // Comments from a nested `stories` array on the task.
    const comments: AsanaComment[] = [];
    for (const s of asArr(raw.stories)) {
      const so = asObj(s);
      const c = so && storyToComment(so);
      if (c) comments.push(c);
    }
    task.comments = comments;
    tasks.push(task);
    for (const sub of asArr(raw.subtasks)) {
      const so = asObj(sub);
      if (so) walk(so, task.gid);
    }
  }
  for (const t of asArr(data.tasks)) {
    const to = asObj(t);
    if (to) walk(to, null);
  }

  return {
    tasksByProject: new Map([[projectGid, tasks]]),
    projectNames: new Map([[projectGid, projectName]]),
  };
}

/** Normalize a parsed export JSON (either shape) into per-project task lists. */
export function parseAsanaExport(root: unknown): ParsedExport {
  const top = asObj(root);
  if (!top) throw new Error("Asana export root is not a JSON object");
  // Export wraps payload under `data`; some tools double-wrap or omit it.
  const data = asObj(top.data) ?? top;
  return looksFlat(data) ? parseFlat(data) : parseNested(data);
}

// ── AsanaReadClient over a parsed export ────────────────────────────────────────────────

export type ExportSource = AsanaReadClient & {
  /** Every project (client) in the export, with open/closed counts for pilot selection. */
  listExportProjects(): ExportProject[];
};

/**
 * Build a read client backed entirely by a parsed export — a drop-in for the live Asana
 * client. `listProjectTaskTree` returns that project's flattened task list; comments were
 * pre-attached at parse time, so `listTaskComments` just serves them (no network).
 */
export function createExportSource(root: unknown): ExportSource {
  const parsed = parseAsanaExport(root);
  const commentsByGid = new Map<string, AsanaComment[]>();
  for (const list of parsed.tasksByProject.values()) {
    for (const t of list) commentsByGid.set(t.gid, t.comments ?? []);
  }

  return {
    async listProjectTaskTree(projectGid: string): Promise<AsanaTask[]> {
      const list = parsed.tasksByProject.get(projectGid) ?? [];
      // Return copies with empty comments; the orchestrator fills via listTaskComments.
      return list.map((t) => ({ ...t, comments: [] }));
    },
    async listTaskComments(taskGid: string): Promise<AsanaComment[]> {
      return commentsByGid.get(taskGid) ?? [];
    },
    listExportProjects(): ExportProject[] {
      const out: ExportProject[] = [];
      for (const [gid, list] of parsed.tasksByProject) {
        let open = 0;
        let closed = 0;
        for (const t of list) (t.completed ? closed++ : open++);
        out.push({
          gid,
          name: parsed.projectNames.get(gid) ?? gid,
          openTaskCount: open,
          closedTaskCount: closed,
        });
      }
      // Largest open backlog first — natural pilot ordering.
      out.sort((a, b) => b.openTaskCount - a.openTaskCount);
      return out;
    },
  };
}

// ── dry-run convenience ──────────────────────────────────────────────────────────────────

/** In-memory Pipedrive stand-in for a dry-run: no existing tasks, writes never happen. */
function dryPipedrive() {
  return {
    async listProjectTasks(): Promise<Array<{ description?: string | null }>> {
      return [];
    },
    async createTask(): Promise<{ id: number }> {
      throw new Error("dry-run must not create Pipedrive tasks");
    },
  };
}

/**
 * Dry-run ONE project out of the export: read + plan + build archive, ZERO writes. Returns
 * the same evidence shape a real migrate would, so a caller can print "exactly what would be
 * created" per client straight off the file.
 */
export async function dryRunExportProject(
  source: ExportSource,
  projectGid: string,
  opts: { assigneeMap?: AssigneeMap; clientLabel?: string | null } = {},
): Promise<MigrateClientResult> {
  return migrateClientOpenTasks({
    asana: source,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any -- structural dry stand-in
    pipedrive: dryPipedrive() as any,
    asanaProjectGid: projectGid,
    pipedriveProjectId: 0,
    assigneeMap: opts.assigneeMap ?? {},
    dryRun: true,
    clientLabel: opts.clientLabel ?? null,
  });
}

/** Pure per-project counts without running the orchestrator — for a fast fleet summary. */
export function summarizeExport(root: unknown): {
  projects: ExportProject[];
  totalOpen: number;
  totalClosed: number;
} {
  const parsed = parseAsanaExport(root);
  const projects: ExportProject[] = [];
  let totalOpen = 0;
  let totalClosed = 0;
  for (const [gid, list] of parsed.tasksByProject) {
    const plan = planClientMigration(list);
    const closed = historyArchiveCount(list);
    // buildHistoryCsv is exercised here only to guarantee the archive is buildable.
    buildHistoryCsv(list);
    projects.push({
      gid,
      name: parsed.projectNames.get(gid) ?? gid,
      openTaskCount: plan.openTaskCount,
      closedTaskCount: closed,
    });
    totalOpen += plan.openTaskCount;
    totalClosed += closed;
  }
  projects.sort((a, b) => b.openTaskCount - a.openTaskCount);
  return { projects, totalOpen, totalClosed };
}
