import "server-only";

// PSG-686 — read-only audit for unassigned task owners on live delivery boards.
//
// Why this exists: until `80a14d5` (PSG-680, live 2026-07-07) every task our provisioner
// auto-created on a Pipedrive delivery board was written with NO owner — the v2 Tasks API
// assigns via `assignee_ids: number[]`, and the old code sent the ignored singular
// `assignee_id`, so tasks landed with `assignee_ids: []`. The fix is live and new boards
// assign owners correctly. This module answers the follow-up question: did any REAL client
// delivery board get built during the unassigned window, and if so which tasks need an
// owner set? It is a pure READ — it lists projects and their tasks and reports the ones
// whose leaf tasks have empty `assignee_ids`. It never writes anything.
//
// Scope of the "unassigned" signal (deliberately narrow, to avoid false positives):
//   • Only LEAF tasks (`parent_task_id != null`) are considered. The D-phase PARENT tasks
//     are created without an owner ON PURPOSE (they are containers), so a parent with an
//     empty assignee is correct, not a finding.
//   • DONE leaf tasks are ignored — a completed task needs no routing.
//   • QA test projects (title carries the `ZZ QA TEST` marker) are skipped — they are
//     throwaway smoke artifacts, never a real client's board.
//
// Secret hygiene: same discipline as projects.ts / qa-smoke.ts — token rides ONLY in the
// query string and is NEVER logged; thrown errors carry the PATH + status, never the URL
// (which holds `?api_token=`). Read-only: this client issues GET requests exclusively.

import {
  pipedriveBaseUrl,
  resolvePipedriveToken,
  PipedriveProjectsError,
} from "./projects";
import { QA_TEST_MARKER } from "./qa-smoke";

export type AuditFetch = typeof fetch;

interface AuditClientConfig {
  /** Admin token. Defaults to `resolvePipedriveToken()`. */
  apiKey?: string;
  companyDomain?: string | null;
  /** Injectable fetch (defaults to global `fetch`) — the seam unit tests mock. */
  fetchImpl?: AuditFetch;
}

/** A Pipedrive Projects-v2 project row, trimmed to what the audit needs. */
export interface AuditProject {
  id: number;
  title: string;
  board_id: number | null;
  phase_id: number | null;
}

/** A Pipedrive Projects-v2 task row, trimmed to what the audit needs. */
export interface AuditTask {
  id: number;
  title: string;
  /** null ⇒ a D-phase PARENT container (correctly ownerless); non-null ⇒ a leaf. */
  parentTaskId: number | null;
  /** v2 assigns via this array; empty ⇒ no owner. */
  assigneeIds: number[];
  /** A finished task needs no routing, so it is excluded from findings. */
  done: boolean;
  /** The provisioner writes `Owner: <label> (<ROLE>)` here — the role-recovery key the
   *  PSG-686 back-fill parses. Empty for tasks not built by our provisioner. */
  description: string;
}

/** One live delivery board that has leaf tasks with no owner (a back-fill candidate). */
export interface AffectedProject {
  id: number;
  title: string;
  board_id: number | null;
  phase_id: number | null;
  totalTasks: number;
  leafTasks: number;
  /** Every open, ownerless leaf task id on this project (the exact back-fill target set). */
  unassignedLeafTaskIds: number[];
  /** A capped sample of the ownerless leaf task titles, for human-readable evidence. */
  sampleUnassignedTitles: string[];
}

export interface AssigneeAuditEvidence {
  /** Every project seen on the account (before QA-marker filtering). */
  totalProjects: number;
  /** QA test projects skipped by the marker guard. */
  qaTestProjectsSkipped: number;
  /** Real projects that were read for task ownership. */
  projectsScanned: number;
  /** Real projects found to have ≥1 open ownerless leaf task. */
  projectsWithUnassignedLeaves: number;
  /** Total open ownerless leaf tasks across all affected projects (the back-fill volume). */
  totalUnassignedLeafTasks: number;
  affected: AffectedProject[];
  /** true ⇒ nothing to back-fill (the "verified-clean" outcome). */
  clean: boolean;
}

// ── tiny local coercers (kept private; mirror qa-smoke.ts semantics) ──────────────────
function asRecord(v: unknown): Record<string, unknown> {
  return v && typeof v === "object" ? (v as Record<string, unknown>) : {};
}
function num(v: unknown): number | null {
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}
function str(v: unknown): string {
  return typeof v === "string" ? v : "";
}
/** Coerce a v2 relation field to number[] (handles bare ids or {id}/{value} objects). */
function numArray(v: unknown): number[] {
  if (!Array.isArray(v)) return [];
  const out: number[] = [];
  for (const item of v) {
    const n =
      item !== null && typeof item === "object"
        ? num(asRecord(item).id) ?? num(asRecord(item).value)
        : num(item);
    if (n != null) out.push(n);
  }
  return out;
}
/** Pipedrive marks completion as a boolean, 0/1, or a status string — accept all. */
function isDone(r: Record<string, unknown>): boolean {
  const d = r.done;
  if (typeof d === "boolean") return d;
  if (typeof d === "number") return d === 1;
  const status = str(r.status).toLowerCase();
  return status === "done" || status === "completed" || status === "closed";
}

export interface AssigneeAuditClient {
  /** Every project on the account (cursor-paginated defensively). */
  listAllProjects(): Promise<AuditProject[]>;
  /** All tasks in one project (cursor-paginated defensively). */
  listProjectTasks(projectId: number): Promise<AuditTask[]>;
}

/** Read-only Projects-v2 client for the audit (GET only). Same hygiene as projects.ts. */
export function createAssigneeAuditClient(
  config: AuditClientConfig = {},
): AssigneeAuditClient {
  const apiKey = config.apiKey ?? resolvePipedriveToken();
  if (!apiKey) {
    throw new PipedriveProjectsError("Missing Pipedrive token for assignee audit");
  }
  const base = pipedriveBaseUrl(config.companyDomain);
  const doFetch = config.fetchImpl ?? fetch;

  function url(path: string, params: Record<string, string> = {}): string {
    const u = new URL(`${base}/api/v2/${path}`);
    for (const [k, v] of Object.entries(params)) u.searchParams.set(k, v);
    u.searchParams.set("api_token", apiKey);
    return u.toString();
  }

  async function get(
    path: string,
    params: Record<string, string> = {},
  ): Promise<{ data: unknown[]; additional: Record<string, unknown> }> {
    const res = await doFetch(url(path, params), { headers: { Accept: "application/json" } });
    if (!res.ok) {
      // NEVER include the URL (it carries the token) in the error.
      throw new PipedriveProjectsError(
        `Pipedrive GET /api/v2/${path} returned HTTP ${res.status}`,
        res.status,
      );
    }
    const payload = (await res.json()) as {
      success?: boolean;
      data?: unknown;
      additional_data?: unknown;
    };
    if (payload.success === false) {
      throw new PipedriveProjectsError(`Pipedrive GET /api/v2/${path} returned success=false`);
    }
    return {
      data: Array.isArray(payload.data) ? payload.data : [],
      additional: asRecord(payload.additional_data),
    };
  }

  /** Follow the v2 cursor until it runs out (bounded so a bug can't loop forever). */
  async function pageAll(
    path: string,
    baseParams: Record<string, string>,
  ): Promise<unknown[]> {
    const out: unknown[] = [];
    let cursor: string | null = null;
    for (let i = 0; i < 100; i++) {
      const params: Record<string, string> = { ...baseParams, limit: "500" };
      if (cursor) params.cursor = cursor;
      const { data, additional } = await get(path, params);
      out.push(...data);
      const next = additional.next_cursor;
      cursor = typeof next === "string" && next !== "" ? next : null;
      if (!cursor) break;
    }
    return out;
  }

  return {
    async listAllProjects() {
      const rows = await pageAll("projects", {});
      return rows.map((p) => {
        const r = asRecord(p);
        return {
          id: num(r.id) ?? 0,
          title: str(r.title),
          board_id: num(r.board_id),
          phase_id: num(r.phase_id),
        };
      });
    },
    async listProjectTasks(projectId) {
      const rows = await pageAll("tasks", { project_id: String(projectId) });
      return rows.map((t) => {
        const r = asRecord(t);
        return {
          id: num(r.id) ?? 0,
          title: str(r.title),
          // NB: `num(null)` is 0 (finite) which would falsely mark a parent as a leaf —
          // preserve null explicitly so the parent/leaf split is correct.
          parentTaskId: r.parent_task_id == null ? null : num(r.parent_task_id),
          assigneeIds: numArray(r.assignee_ids),
          done: isDone(r),
          description: str(r.description),
        };
      });
    },
  };
}

export interface RunAssigneeAuditOptions {
  companyDomain?: string | null;
  apiKey?: string;
  fetchImpl?: AuditFetch;
  /** Test seam: inject a client instead of the live one. */
  client?: AssigneeAuditClient;
  /** How many ownerless titles to sample per project in the evidence (default 10). */
  sampleCap?: number;
}

/** True for a leaf task (has a parent) that is open and has no owner. */
function isUnassignedOpenLeaf(t: AuditTask): boolean {
  return t.parentTaskId != null && !t.done && t.assigneeIds.length === 0;
}

/**
 * Scan every live project's tasks and report the ones whose open leaf tasks have no owner.
 * Pure read; returns structured evidence. `clean: true` ⇒ nothing to back-fill.
 */
export async function runAssigneeAudit(
  opts: RunAssigneeAuditOptions = {},
): Promise<AssigneeAuditEvidence> {
  const client =
    opts.client ??
    createAssigneeAuditClient({
      apiKey: opts.apiKey,
      companyDomain: opts.companyDomain ?? null,
      fetchImpl: opts.fetchImpl,
    });
  const sampleCap = opts.sampleCap ?? 10;

  const projects = await client.listAllProjects();
  let qaTestProjectsSkipped = 0;
  let projectsScanned = 0;
  let totalUnassignedLeafTasks = 0;
  const affected: AffectedProject[] = [];

  for (const p of projects) {
    // Never treat a throwaway QA smoke board as a real client finding.
    if (p.title.includes(QA_TEST_MARKER)) {
      qaTestProjectsSkipped += 1;
      continue;
    }
    projectsScanned += 1;
    const tasks = await client.listProjectTasks(p.id);
    const leaves = tasks.filter((t) => t.parentTaskId != null);
    const unassigned = tasks.filter(isUnassignedOpenLeaf);
    if (unassigned.length > 0) {
      totalUnassignedLeafTasks += unassigned.length;
      affected.push({
        id: p.id,
        title: p.title,
        board_id: p.board_id,
        phase_id: p.phase_id,
        totalTasks: tasks.length,
        leafTasks: leaves.length,
        unassignedLeafTaskIds: unassigned.map((t) => t.id),
        sampleUnassignedTitles: unassigned.slice(0, sampleCap).map((t) => t.title),
      });
    }
  }

  return {
    totalProjects: projects.length,
    qaTestProjectsSkipped,
    projectsScanned,
    projectsWithUnassignedLeaves: affected.length,
    totalUnassignedLeafTasks,
    affected,
    clean: affected.length === 0,
  };
}
