// PSG-644 — Asana READ client (source side of the Asana → Pipedrive migration).
//
// The ONLY Asana surface this codebase touches, and it is read-only: the migration copies
// work OUT of Asana, never writes back. Two jobs:
//   1. `listProjectTaskTree(projectGid)` — the flat list of every task in an Asana project
//      (top-level tasks AND their subtasks, at any depth), each carrying its `parentGid`
//      so the pure planner (`asana-migration.ts`) can flatten nesting to one level and
//      split open vs closed.
//   2. `listTaskComments(taskGid)` — a task's comment "stories" reduced to author + text,
//      which the planner appends to the Pipedrive task description (Pipedrive tasks have no
//      comment stream).
//
// Auth: an Asana Personal Access Token in the `Authorization: Bearer` HEADER (NOT a query
// param), resolved from `ASANA_ACCESS_TOKEN` (canonical; `ASANA_PAT` / `ASANA_TOKEN`
// accepted as aliases). The token is never logged and never placed in a URL; errors carry
// only the method + path + HTTP status, mirroring the Pipedrive client's hygiene.
//
// `fetchImpl` is injectable so every path is unit-tested with a recording fake and no
// network. Pagination follows Asana's `next_page.offset` cursor to completion.

import type { AsanaTask, AsanaComment } from "./asana-migration";

export class AsanaClientError extends Error {
  readonly status?: number;
  constructor(message: string, status?: number) {
    super(message);
    this.name = "AsanaClientError";
    this.status = status;
  }
}

/** Env var names that may hold the Asana PAT, tried in order. Never logged. */
export const ASANA_TOKEN_ENV_CANDIDATES = [
  "ASANA_ACCESS_TOKEN",
  "ASANA_PAT",
  "ASANA_TOKEN",
] as const;

/** First non-empty (trimmed) Asana token among the accepted env names, or `""` when none. */
export function resolveAsanaToken(
  env: Record<string, string | undefined> = process.env,
): string {
  for (const name of ASANA_TOKEN_ENV_CANDIDATES) {
    const raw = env[name];
    if (typeof raw === "string" && raw.trim() !== "") return raw.trim();
  }
  return "";
}

export interface AsanaClientConfig {
  /** Asana PAT. Defaults to `resolveAsanaToken()`. */
  token?: string;
  /** Injectable fetch (defaults to global `fetch`) — the seam unit tests mock. */
  fetchImpl?: typeof fetch;
  /** Base URL override (defaults to the Asana public API). */
  baseUrl?: string;
}

export interface AsanaReadClient {
  /** Flat list of every task (top-level + subtasks, any depth) in a project. Open + closed. */
  listProjectTaskTree(projectGid: string): Promise<AsanaTask[]>;
  /** A task's comments (author + text), chronological. */
  listTaskComments(taskGid: string): Promise<AsanaComment[]>;
}

const DEFAULT_BASE = "https://app.asana.com/api/1.0";

// The task fields we pull. `.` traverses relations (Asana `opt_fields` dot syntax).
const TASK_FIELDS = [
  "name",
  "completed",
  "completed_at",
  "assignee.gid",
  "assignee.name",
  "due_on",
  "due_at",
  "notes",
  "parent.gid",
  "permalink_url",
  "num_subtasks",
  "memberships.section.name",
].join(",");

/** Raw Asana task JSON (only the fields we request). */
interface RawAsanaTask {
  gid: string;
  name?: string;
  completed?: boolean;
  completed_at?: string | null;
  assignee?: { gid?: string; name?: string } | null;
  due_on?: string | null;
  due_at?: string | null;
  notes?: string | null;
  parent?: { gid?: string } | null;
  permalink_url?: string | null;
  num_subtasks?: number;
  memberships?: Array<{ section?: { name?: string } | null }>;
}

/** Map a raw Asana task to our internal shape (comments filled in later, per-task). */
function toAsanaTask(raw: RawAsanaTask, parentGidOverride?: string | null): AsanaTask {
  const section = raw.memberships?.find((m) => m.section?.name)?.section?.name ?? null;
  return {
    gid: String(raw.gid),
    name: String(raw.name ?? ""),
    completed: raw.completed === true,
    completedAt: raw.completed_at ?? null,
    assigneeGid: raw.assignee?.gid ?? null,
    assigneeName: raw.assignee?.name ?? null,
    dueOn: raw.due_on ?? raw.due_at ?? null,
    notes: raw.notes ?? null,
    // A subtask fetched via /tasks/{gid}/subtasks may not echo `parent`; use the override.
    parentGid: raw.parent?.gid ?? parentGidOverride ?? null,
    sectionName: section,
    permalinkUrl: raw.permalink_url ?? null,
    comments: [],
  };
}

export function createAsanaClient(config: AsanaClientConfig = {}): AsanaReadClient {
  const token = config.token ?? resolveAsanaToken();
  if (!token) {
    throw new AsanaClientError(
      `Missing Asana token (set one of: ${ASANA_TOKEN_ENV_CANDIDATES.join(", ")})`,
    );
  }
  const base = (config.baseUrl ?? DEFAULT_BASE).replace(/\/+$/, "");
  const doFetch = config.fetchImpl ?? fetch;

  /** GET a paginated Asana collection, following `next_page.offset` to the end. */
  async function getAll<T>(path: string, params: Record<string, string>): Promise<T[]> {
    const out: T[] = [];
    let offset: string | null = null;
    // Bound the loop defensively; a fleet project has hundreds, not tens of thousands.
    for (let page = 0; page < 1000; page += 1) {
      const search = new URLSearchParams({ ...params, limit: "100" });
      if (offset) search.set("offset", offset);
      const res = await doFetch(`${base}${path}?${search.toString()}`, {
        method: "GET",
        headers: { Accept: "application/json", Authorization: `Bearer ${token}` },
      });
      if (!res.ok) {
        // Path + status only — never the URL (query) or the token.
        throw new AsanaClientError(
          `Asana GET ${path} returned HTTP ${res.status}`,
          res.status,
        );
      }
      const payload = (await res.json()) as {
        data?: T[];
        next_page?: { offset?: string } | null;
      };
      out.push(...(payload.data ?? []));
      offset = payload.next_page?.offset ?? null;
      if (!offset) break;
    }
    return out;
  }

  async function subtasksOf(taskGid: string): Promise<RawAsanaTask[]> {
    return getAll<RawAsanaTask>(`/tasks/${taskGid}/subtasks`, { opt_fields: TASK_FIELDS });
  }

  return {
    async listProjectTaskTree(projectGid) {
      const top = await getAll<RawAsanaTask>(`/projects/${projectGid}/tasks`, {
        opt_fields: TASK_FIELDS,
      });
      const collected: AsanaTask[] = [];
      // Breadth-first walk so any nesting depth is captured as a flat parent-linked list.
      const queue: Array<{ raw: RawAsanaTask; parentGid: string | null }> = top.map(
        (raw) => ({ raw, parentGid: raw.parent?.gid ?? null }),
      );
      const seen = new Set<string>();
      while (queue.length) {
        const { raw, parentGid } = queue.shift()!;
        if (seen.has(raw.gid)) continue;
        seen.add(raw.gid);
        collected.push(toAsanaTask(raw, parentGid));
        if ((raw.num_subtasks ?? 0) > 0) {
          const kids = await subtasksOf(raw.gid);
          for (const kid of kids) queue.push({ raw: kid, parentGid: raw.gid });
        }
      }
      return collected;
    },

    async listTaskComments(taskGid) {
      const stories = await getAll<{
        gid: string;
        type?: string;
        resource_subtype?: string;
        text?: string;
        created_at?: string;
        created_by?: { name?: string } | null;
      }>(`/tasks/${taskGid}/stories`, { opt_fields: "type,resource_subtype,text,created_at,created_by.name" });
      // Only user COMMENT stories carry migratable text; system stories are skipped.
      return stories
        .filter((s) => (s.type === "comment" || s.resource_subtype === "comment_added") && (s.text ?? "").trim())
        .map((s) => ({
          authorName: s.created_by?.name ?? null,
          text: String(s.text ?? ""),
          createdAt: s.created_at ?? null,
        }));
    },
  };
}
