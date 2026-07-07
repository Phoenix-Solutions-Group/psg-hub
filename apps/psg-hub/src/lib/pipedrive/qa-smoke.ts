import "server-only";

// PSG-597 Move 1 — live write-path QA smoke (create → win → provision → verify →
// idempotency → cleanup) run entirely server-side.
//
// Why this exists: the last unproven part of Move 1 (deal-won → onboarding board) is
// the WRITE path against LIVE Pipedrive — creating a deal, winning it, and building the
// board (`createProject`/`createTask`/`findProjectByTitle` on Projects API v2). QA (Tess)
// cannot drive it: the write token (`PIPEDRIVE_API_TOKEN`) is a SENSITIVE Vercel var no
// agent can read, and there is no Pipedrive MCP. Rather than hand a human a curl runbook
// (rule #1), this module runs the whole golden path in-process using the in-env token and
// returns structured JSON evidence for sign-off. Invoked via the secret-gated ops route
// (`/api/ops/pipedrive/onboarding-setup`, action `qa-smoke`).
//
// SAFETY (this module can create AND delete Pipedrive data — treat as load-bearing):
//   • Every artifact it creates is a clearly-labelled test record whose title carries
//     `QA_TEST_MARKER` ("ZZ QA TEST").
//   • It NEVER deletes a project or deal whose title does not contain that marker —
//     `assertDeletable` throws otherwise. So a bug in the id plumbing can only ever hit
//     test data, never a real client's delivery board or deal.
//   • Cleanup runs in `finally`, and a bounded re-scan absorbs a late deal-won webhook
//     that could re-create the board after the first delete.
//
// Secret hygiene: the token is carried ONLY in the query string; thrown errors carry the
// PATH + status only (never the URL, which holds `?api_token=`). Mirrors client.ts /
// projects.ts discipline.

import {
  createProjectsClient,
  provisionOnboardingBoard,
  onboardingProjectTitle,
  pipedriveBaseUrl,
  resolvePipedriveToken,
  PipedriveProjectsError,
  type PipedriveProjectsClient,
  type WonDeal,
} from "./projects";
import { dueDateFor, templateTaskCount, WHM_ONBOARDING_TEMPLATE } from "./onboarding-template";

/** Marker every QA test record's title must contain. The delete guard keys off this. */
export const QA_TEST_MARKER = "ZZ QA TEST";

// ── low-level test-only REST client (deals v1 + projects/tasks v2 read/delete) ────────
// The shared Projects client (projects.ts) intentionally exposes only what the webhook
// path needs. The extra calls the smoke needs — deal create/win/delete, project/task
// read, project delete — live here so the product client stays minimal and untouched.

export type QaFetch = typeof fetch;

interface QaClientConfig {
  apiKey?: string;
  companyDomain?: string | null;
  fetchImpl?: QaFetch;
}

function asRecord(v: unknown): Record<string, unknown> {
  return v && typeof v === "object" ? (v as Record<string, unknown>) : {};
}
function num(v: unknown): number | null {
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}
function str(v: unknown): string | null {
  return typeof v === "string" && v !== "" ? v : null;
}
/** Coerce a v2 relation field to a number[] (handles arrays of ids or {id}/{value} objects). */
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

export interface QaDeal {
  id: number;
  title: string;
  orgId: number | null;
  personId: number | null;
  pipelineId: number | null;
  wonDate: string | null;
}
export interface QaProject {
  id: number;
  title: string;
  board_id: number | null;
  phase_id: number | null;
  start_date: string | null;
  // v2 relates orgs/persons as ARRAYS. Read them back so the smoke can prove the
  // org_ids/person_ids link body actually landed on the created project (PSG-604).
  org_ids: number[];
  person_ids: number[];
}
export interface QaTask {
  id: number;
  title: string;
  parent_task_id: number | null;
  due_date: string | null;
  // PSG-673: read back the task's assignee + description so the web-build smoke can
  // spot-check that role→user assignment (esp. the PSG-668 UX/QA roles) actually landed
  // on the created board. Additive/optional — the onboarding smoke ignores them.
  assignee_id: number | null;
  // PSG-680: Pipedrive Projects v2 stores a task assignee under `assignee_ids` (array);
  // setting `assignee_id` on create overwrites `assignee_ids`. Read BOTH so the assignee
  // spot-check can't false-negative on which field the GET reflects.
  assignee_ids: number[];
  description: string | null;
}

export interface QaRestClient {
  createOrganization(name: string): Promise<{ id: number }>;
  createPerson(name: string, orgId?: number | null): Promise<{ id: number }>;
  deleteOrganization(orgId: number): Promise<void>;
  deletePerson(personId: number): Promise<void>;
  createDeal(
    title: string,
    pipelineId: number,
    links?: { orgId?: number | null; personId?: number | null },
  ): Promise<QaDeal>;
  winDeal(dealId: number): Promise<void>;
  getDeal(dealId: number): Promise<QaDeal>;
  deleteDeal(dealId: number): Promise<void>;
  getProject(projectId: number): Promise<QaProject>;
  listProjectTasks(projectId: number): Promise<QaTask[]>;
  deleteProject(projectId: number): Promise<void>;
  /** Raw v2 projects page + whether more pages exist (idempotency scale signal). */
  listProjectsPage(limit: number): Promise<{ items: QaProject[]; hasMore: boolean }>;
  /**
   * PSG-722 — the AUTHORITATIVE task→phase readback. v2 `GET /tasks` does NOT reliably
   * return `phase_id`; the v1 project plan (`GET /projects/{id}/plan`) links each task to
   * its phase + group. Returns one row per plan item that is a task.
   */
  getProjectPlan(
    projectId: number,
  ): Promise<Array<{ taskId: number; phaseId: number | null; groupId: number | null }>>;
  /** PSG-722 — board phases (id + name) so a task's stamped phase_id maps back to a name. */
  listBoardPhases(boardId: number): Promise<Array<{ id: number; name: string }>>;
}

export function createQaRestClient(config: QaClientConfig = {}): QaRestClient {
  const apiKey = config.apiKey ?? resolvePipedriveToken();
  if (!apiKey) {
    throw new PipedriveProjectsError("Missing Pipedrive token for QA smoke");
  }
  const base = pipedriveBaseUrl(config.companyDomain);
  const doFetch = config.fetchImpl ?? fetch;

  function url(version: "v1" | "v2", path: string, params: Record<string, string> = {}): string {
    const u = new URL(`${base}/api/${version}/${path}`);
    for (const [k, v] of Object.entries(params)) u.searchParams.set(k, v);
    u.searchParams.set("api_token", apiKey);
    return u.toString();
  }

  async function call<T>(
    method: "GET" | "POST" | "PUT" | "DELETE",
    version: "v1" | "v2",
    path: string,
    params: Record<string, string> = {},
    jsonBody?: Record<string, unknown>,
  ): Promise<{ data: T; additional: Record<string, unknown> }> {
    const res = await doFetch(url(version, path, params), {
      method,
      headers: jsonBody
        ? { Accept: "application/json", "Content-Type": "application/json" }
        : { Accept: "application/json" },
      body: jsonBody ? JSON.stringify(jsonBody) : undefined,
    });
    if (!res.ok) {
      // NEVER include the URL (carries the token) in the error.
      throw new PipedriveProjectsError(
        `Pipedrive ${method} /api/${version}/${path} returned HTTP ${res.status}`,
        res.status,
      );
    }
    const payload = (await res.json()) as {
      success?: boolean;
      data?: unknown;
      additional_data?: unknown;
    };
    if (payload.success === false) {
      throw new PipedriveProjectsError(
        `Pipedrive ${method} /api/${version}/${path} returned success=false`,
      );
    }
    return { data: payload.data as T, additional: asRecord(payload.additional_data) };
  }

  function toDeal(d: unknown): QaDeal {
    const r = asRecord(d);
    // v1 relates org/person as a nested object ({value,name}) or a bare id.
    const rel = (v: unknown): number | null =>
      typeof v === "object" && v !== null ? num(asRecord(v).value) : num(v);
    return {
      id: num(r.id) ?? 0,
      title: str(r.title) ?? "",
      orgId: rel(r.org_id),
      personId: rel(r.person_id),
      pipelineId: rel(r.pipeline_id),
      wonDate: (str(r.won_time) ?? str(r.update_time) ?? "")?.slice(0, 10) || null,
    };
  }
  function toProject(p: unknown): QaProject {
    const r = asRecord(p);
    return {
      id: num(r.id) ?? 0,
      title: str(r.title) ?? "",
      board_id: num(r.board_id),
      phase_id: num(r.phase_id),
      start_date: str(r.start_date),
      org_ids: numArray(r.org_ids),
      person_ids: numArray(r.person_ids),
    };
  }
  function toTask(t: unknown): QaTask {
    const r = asRecord(t);
    return {
      id: num(r.id) ?? 0,
      title: str(r.title) ?? "",
      // NB: `num(null)` is 0 (finite), which would falsely mark a phase PARENT (no
      // parent_task_id) as a child. Preserve null explicitly so parent/leaf split works.
      parent_task_id: r.parent_task_id == null ? null : num(r.parent_task_id),
      due_date: str(r.due_date),
      // PSG-673: assignee id (v2 tasks) + the "Owner: <label> (<ROLE>)" description the
      // provisioner writes — lets the web-build smoke map a leaf back to its ROLE + user.
      assignee_id: r.assignee_id == null ? null : num(r.assignee_id),
      assignee_ids: numArray(r.assignee_ids),
      description: str(r.description),
    };
  }

  return {
    async createOrganization(name) {
      const { data } = await call<{ id: number }>("POST", "v1", "organizations", {}, { name });
      return { id: num(asRecord(data).id) ?? 0 };
    },
    async createPerson(name, orgId) {
      const body: Record<string, unknown> = { name };
      if (orgId != null) body.org_id = orgId;
      const { data } = await call<{ id: number }>("POST", "v1", "persons", {}, body);
      return { id: num(asRecord(data).id) ?? 0 };
    },
    async deleteOrganization(orgId) {
      await call<unknown>("DELETE", "v1", `organizations/${orgId}`);
    },
    async deletePerson(personId) {
      await call<unknown>("DELETE", "v1", `persons/${personId}`);
    },
    async createDeal(title, pipelineId, links) {
      const body: Record<string, unknown> = { title, pipeline_id: pipelineId };
      // Link an org + person so the v2 `createProject` org_ids/person_ids ARRAY path is
      // exercised — the exact write-path body PSG-599 flagged as the likely failure point.
      if (links?.orgId != null) body.org_id = links.orgId;
      if (links?.personId != null) body.person_id = links.personId;
      const { data } = await call<unknown>("POST", "v1", "deals", {}, body);
      return toDeal(data);
    },
    async winDeal(dealId) {
      await call<unknown>("PUT", "v1", `deals/${dealId}`, {}, { status: "won" });
    },
    async getDeal(dealId) {
      const { data } = await call<unknown>("GET", "v1", `deals/${dealId}`);
      return toDeal(data);
    },
    async deleteDeal(dealId) {
      await call<unknown>("DELETE", "v1", `deals/${dealId}`);
    },
    async getProject(projectId) {
      const { data } = await call<unknown>("GET", "v2", `projects/${projectId}`);
      return toProject(data);
    },
    async listProjectTasks(projectId) {
      const out: QaTask[] = [];
      let cursor: string | null = null;
      // Defensive cursor loop (v2 lists are cursor-paginated); a single project's
      // ~30 tasks fit one page, but never assume.
      for (let i = 0; i < 20; i++) {
        const params: Record<string, string> = { project_id: String(projectId), limit: "500" };
        if (cursor) params.cursor = cursor;
        const { data, additional } = await call<unknown[]>("GET", "v2", "tasks", params);
        for (const t of data ?? []) out.push(toTask(t));
        cursor = str(additional.next_cursor);
        if (!cursor) break;
      }
      return out;
    },
    async deleteProject(projectId) {
      await call<unknown>("DELETE", "v2", `projects/${projectId}`);
    },
    async listProjectsPage(limit) {
      const { data, additional } = await call<unknown[]>("GET", "v2", "projects", {
        limit: String(limit),
      });
      return {
        items: (data ?? []).map(toProject),
        hasMore: str(additional.next_cursor) != null,
      };
    },
    async getProjectPlan(projectId) {
      // v1 `GET /projects/{id}/plan` — items are tasks + activities linked to a phase/group.
      // Field names are read defensively (task id under `task_id` or `id`; a `type` marker
      // distinguishes tasks from activities when present) so a minor shape drift can't crash
      // the readback. Non-task rows are dropped.
      const { data } = await call<unknown[]>("GET", "v1", `projects/${projectId}/plan`);
      const out: Array<{ taskId: number; phaseId: number | null; groupId: number | null }> = [];
      for (const item of data ?? []) {
        const r = asRecord(item);
        const type = typeof r.type === "string" ? r.type.toLowerCase() : null;
        if (type != null && type !== "task") continue; // keep tasks; drop activities
        const taskId = num(r.task_id) ?? num(r.id);
        if (taskId == null) continue;
        out.push({ taskId, phaseId: num(r.phase_id), groupId: num(r.group_id) });
      }
      return out;
    },
    async listBoardPhases(boardId) {
      const { data } = await call<unknown[]>("GET", "v2", "phases", {
        board_id: String(boardId),
      });
      return (data ?? []).map((p) => {
        const r = asRecord(p);
        return { id: num(r.id) ?? 0, name: str(r.name) ?? "" };
      });
    },
  };
}

// ── PSG-722 shared phase-stamp verifier (used by every write-path smoke) ──────────────

/** A template shape both onboarding phases and recurring groups satisfy structurally. */
export interface PhasedTemplateEntry {
  readonly name: string;
  readonly tasks: readonly { readonly title: string }[];
}

export interface PhaseStampCheck {
  /** Phase names present on the board (from v2 listPhases). */
  boardPhaseNames: string[];
  /** Phase names the template expects. */
  templatePhaseNames: string[];
  /** True when every template phase name exists on the board. */
  allTemplatePhasesPresent: boolean;
  /** Provisioned tasks whose plan row has no phase (the "Phase unassigned" bucket). MUST be 0. */
  tasksInUnassigned: number;
  /** True when 0 tasks are unassigned AND every task sits in its template phase. */
  everyTaskStamped: boolean;
  /** Per template phase: expected board phase id + how many provisioned tasks landed in it. */
  perPhase: Array<{ name: string; phaseId: number | null; taskCount: number }>;
}

/**
 * PSG-722 — verify that every provisioned task was stamped into the RIGHT template phase.
 * Cross-references three live reads: the project's tasks (id + title), the v1 plan
 * (task → phase_id), and the board's phases (id → name). A task is matched to its template
 * phase by title, then its plan phase_id is checked to resolve to that phase's name.
 */
export function checkPhaseStamping(args: {
  tasks: ReadonlyArray<{ id: number; title: string }>;
  plan: ReadonlyArray<{ taskId: number; phaseId: number | null }>;
  boardPhases: ReadonlyArray<{ id: number; name: string }>;
  template: readonly PhasedTemplateEntry[];
}): PhaseStampCheck {
  const { tasks, plan, boardPhases, template } = args;
  const phaseIdByName = new Map<string, number>();
  const phaseNameById = new Map<number, string>();
  for (const p of boardPhases) {
    const name = p.name.trim();
    if (name !== "" && !phaseIdByName.has(name)) phaseIdByName.set(name, p.id);
    phaseNameById.set(p.id, name);
  }
  const planPhaseByTask = new Map<number, number | null>();
  for (const row of plan) planPhaseByTask.set(row.taskId, row.phaseId ?? null);
  // title → expected template phase name.
  const expectedPhaseByTitle = new Map<string, string>();
  for (const phase of template) {
    for (const t of phase.tasks) expectedPhaseByTitle.set(t.title.trim(), phase.name.trim());
  }

  const templatePhaseNames = template.map((p) => p.name.trim());
  const boardPhaseNames = boardPhases.map((p) => p.name.trim());
  const allTemplatePhasesPresent = templatePhaseNames.every((n) =>
    phaseIdByName.has(n),
  );

  let tasksInUnassigned = 0;
  let everyTaskStamped = true;
  for (const task of tasks) {
    const stampedPhaseId = planPhaseByTask.get(task.id) ?? null;
    if (stampedPhaseId == null) {
      tasksInUnassigned += 1;
      everyTaskStamped = false;
      continue;
    }
    const expectedName = expectedPhaseByTitle.get(task.title.trim());
    // A task not in the template (shouldn't happen) is stamped-but-unverifiable → not a pass.
    if (expectedName == null || phaseNameById.get(stampedPhaseId) !== expectedName) {
      everyTaskStamped = false;
    }
  }

  const perPhase = template.map((phase) => {
    const name = phase.name.trim();
    const phaseId = phaseIdByName.get(name) ?? null;
    const taskCount =
      phaseId == null
        ? 0
        : tasks.filter((t) => (planPhaseByTask.get(t.id) ?? null) === phaseId).length;
    return { name, phaseId, taskCount };
  });

  return {
    boardPhaseNames,
    templatePhaseNames,
    allTemplatePhasesPresent,
    tasksInUnassigned,
    everyTaskStamped,
    perPhase,
  };
}

// ── orchestrator ──────────────────────────────────────────────────────────────────

export interface QaSmokeOptions {
  boardId: number;
  phaseId: number;
  salesPipelineId: number;
  companyDomain?: string | null;
  fetchImpl?: QaFetch;
  /** Test seam: override the token so tests need no env. Route omits it (uses env token). */
  apiKey?: string;
  /** Test seam: sleep implementation (default real setTimeout). */
  sleep?: (ms: number) => Promise<void>;
  /** Unique tag so concurrent/repeat runs never collide on a title. */
  runTag: string;
}

export interface QaSmokeEvidence {
  ok: boolean;
  dealId: number;
  wonDate: string | null;
  project: {
    id: number;
    title: string;
    board_id: number | null;
    phase_id: number | null;
    start_date: string | null;
    // The org/person links read back off the created project (PSG-604 completeness).
    org_ids: number[];
    person_ids: number[];
  };
  /** The deal's org/person ids we linked, so the array-body round-trip is auditable. */
  linkedOrgId: number | null;
  linkedPersonId: number | null;
  tree: {
    totalTasks: number;
    /** PSG-722: boards are now FLAT (no container parents). Kept for regression visibility. */
    containerTasks: number;
    gateTasks: number;
    gateTitles: string[];
  };
  /** PSG-722 — proof every task landed in its template phase (0 in "Phase unassigned"). */
  phases: PhaseStampCheck;
  dueDateSpotChecks: {
    d1Welcome: { title: string | null; due: string | null; expected: string; ok: boolean };
    d5SignOff: { title: string | null; due: string | null; expected: string; ok: boolean };
  };
  idempotency: {
    skippedExisting: boolean;
    projectIdMatches: boolean;
    /** v2 projects list scale signal: true ⇒ dedupe list is paginated (latent risk). */
    projectsListHasMore: boolean;
  };
  cleanup: {
    projectDeleted: boolean;
    dealDeleted: boolean;
    residualTestProjectRemains: boolean;
    lateReprovisionsDeleted: number;
  };
  checks: Record<string, boolean>;
  allChecksPass: boolean;
}

const realSleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

/** True only for titles carrying the QA marker — the load-bearing delete predicate. */
export function isQaTestTitle(title: string): boolean {
  return title.includes(QA_TEST_MARKER);
}

/** Throw unless `title` carries the QA marker — the load-bearing delete guard. */
function assertDeletable(kind: string, id: number, title: string): void {
  if (!isQaTestTitle(title)) {
    throw new PipedriveProjectsError(
      `Refusing to delete ${kind} ${id}: title does not carry the QA test marker`,
    );
  }
}

/**
 * Run the full Move 1 write-path smoke and return evidence. `provisionClient` defaults to
 * the REAL `createProjectsClient` (so the live v2 write path is genuinely exercised); tests
 * inject a fake. Cleanup always runs (in `finally`) and its results are folded into the
 * returned evidence via a shared-by-reference `cleanup` object.
 */
export async function runQaSmoke(
  opts: QaSmokeOptions,
  provisionClient?: PipedriveProjectsClient,
): Promise<QaSmokeEvidence> {
  const sleep = opts.sleep ?? realSleep;
  const rest = createQaRestClient({
    apiKey: opts.apiKey,
    companyDomain: opts.companyDomain ?? null,
    fetchImpl: opts.fetchImpl,
  });
  const client =
    provisionClient ??
    createProjectsClient({
      apiKey: opts.apiKey,
      companyDomain: opts.companyDomain ?? null,
      fetchImpl: opts.fetchImpl,
    });

  const dealTitle = `${QA_TEST_MARKER} — Move1 E2E ${opts.runTag}`;
  let dealId = 0;
  let orgId = 0;
  let personId = 0;
  let projectTitle = "";
  // Shared by reference: embedded in `evidence.cleanup` and mutated in `finally`.
  const cleanup: QaSmokeEvidence["cleanup"] = {
    projectDeleted: false,
    dealDeleted: false,
    residualTestProjectRemains: false,
    lateReprovisionsDeleted: 0,
  };
  let evidence: QaSmokeEvidence | null = null;

  try {
    // 0) Create a throwaway org + person so the won deal carries an organization and
    //    person — this makes provisionOnboardingBoard send the v2 `org_ids`/`person_ids`
    //    ARRAY body (the exact path PSG-599 flagged), exercising a real win faithfully.
    //    orgName is intentionally left null on the WonDeal below so the PROJECT title keeps
    //    the QA marker (the delete guard keys off it) rather than the org's name.
    const org = await rest.createOrganization(`${QA_TEST_MARKER} Org — ${opts.runTag}`);
    orgId = org.id;
    const person = await rest.createPerson(`${QA_TEST_MARKER} Person — ${opts.runTag}`, orgId);
    personId = person.id;

    // 1) Create + 2) win a real deal in the sales pipeline, linked to the org + person.
    const created = await rest.createDeal(dealTitle, opts.salesPipelineId, {
      orgId,
      personId,
    });
    dealId = created.id;
    await rest.winDeal(dealId);
    const won = await rest.getDeal(dealId);
    const wonDate = won.wonDate ?? new Date().toISOString().slice(0, 10);

    const deal: WonDeal = {
      id: dealId,
      title: won.title || dealTitle,
      orgName: null,
      orgId: won.orgId,
      personId: won.personId,
      pipelineId: won.pipelineId,
      wonDate,
    };
    projectTitle = onboardingProjectTitle(deal);

    // 3) Provision the board through the REAL write path (races the live webhook, but
    //    both are idempotent on the deterministic title, so only one project results).
    const prov = await provisionOnboardingBoard({
      client,
      deal,
      boardId: opts.boardId,
      phaseId: opts.phaseId,
    });

    // 4) Read back the project + task tree + phase stamping (PSG-722).
    const project = await rest.getProject(prov.projectId);
    const tasks = await rest.listProjectTasks(prov.projectId);
    // Container = referenced as another task's parent. On a phased board there are none.
    const parentIds = new Set(
      tasks.map((t) => t.parent_task_id).filter((id): id is number => id != null),
    );
    const containers = tasks.filter((t) => parentIds.has(t.id));
    const gates = tasks.filter((t) => t.title.toUpperCase().includes("GATE"));
    const plan = await rest.getProjectPlan(prov.projectId);
    const boardPhases = await rest.listBoardPhases(opts.boardId);
    const phases = checkPhaseStamping({
      tasks,
      plan,
      boardPhases,
      template: WHM_ONBOARDING_TEMPLATE,
    });

    const d1 = tasks.find((t) => t.title.toLowerCase().includes("welcome email"));
    // NB: "sign-off" also appears in the D5 pre-launch GATE (offset 39); match the
    // *client* sign-off (offset 55) specifically so the spot-check is unambiguous.
    const d5 = tasks.find((t) => t.title.toLowerCase().includes("client sign-off"));
    const d1Expected = dueDateFor(wonDate, 1);
    const d5Expected = dueDateFor(wonDate, 55);

    // 5) Idempotency: re-provision → must be a no-op on the same project id.
    const again = await provisionOnboardingBoard({
      client,
      deal,
      boardId: opts.boardId,
      phaseId: opts.phaseId,
    });
    const page = await rest.listProjectsPage(500);

    evidence = {
      ok: true,
      dealId,
      wonDate,
      project: {
        id: project.id,
        title: project.title,
        board_id: project.board_id,
        phase_id: project.phase_id,
        start_date: project.start_date,
        org_ids: project.org_ids,
        person_ids: project.person_ids,
      },
      linkedOrgId: won.orgId,
      linkedPersonId: won.personId,
      tree: {
        totalTasks: tasks.length,
        containerTasks: containers.length,
        gateTasks: gates.length,
        gateTitles: gates.map((t) => t.title),
      },
      phases,
      dueDateSpotChecks: {
        d1Welcome: {
          title: d1?.title ?? null,
          due: d1?.due_date ?? null,
          expected: d1Expected,
          ok: d1?.due_date === d1Expected,
        },
        d5SignOff: {
          title: d5?.title ?? null,
          due: d5?.due_date ?? null,
          expected: d5Expected,
          ok: d5?.due_date === d5Expected,
        },
      },
      idempotency: {
        skippedExisting: again.skippedExisting,
        projectIdMatches: again.projectId === prov.projectId,
        projectsListHasMore: page.hasMore,
      },
      cleanup,
      checks: {},
      allChecksPass: false,
    };

    // Assemble pass/fail checks (soft — reported, never throws).
    const c = evidence.checks;
    c.projectTitleMatches = project.title === projectTitle;
    c.boardIsDelivery = project.board_id === opts.boardId;
    c.phaseIsKickoff = project.phase_id === opts.phaseId;
    c.startDateIsWonDate = project.start_date === wonDate;
    // PSG-722: board is FLAT (no container/parent tasks); every template task is present.
    c.noContainerTasks = containers.length === 0;
    c.allTemplateTasksPresent = tasks.length === templateTaskCount();
    c.phaseCountFromTemplate = WHM_ONBOARDING_TEMPLATE.length === 5;
    // PSG-722 phase-stamp: real template columns + 0 tasks in "Phase unassigned".
    c.templatePhaseColumnsPresent = phases.allTemplatePhasesPresent;
    c.zeroTasksUnassigned = phases.tasksInUnassigned === 0;
    c.everyTaskInItsPhase = phases.everyTaskStamped;
    c.d1WelcomeDue = evidence.dueDateSpotChecks.d1Welcome.ok;
    c.d5SignOffDue = evidence.dueDateSpotChecks.d5SignOff.ok;
    c.idempotentNoSecondProject =
      again.skippedExisting && again.projectId === prov.projectId;
    // PSG-604: the org/person link ARRAY body round-tripped — the created project reads
    // back the exact org id + person id the won deal carried (populated, not empty).
    c.projectOrgIdsPopulated =
      won.orgId != null && project.org_ids.includes(won.orgId);
    c.projectPersonIdsPopulated =
      won.personId != null && project.person_ids.includes(won.personId);
    evidence.allChecksPass = Object.values(c).every(Boolean);

    return evidence;
  } finally {
    // 6) Cleanup — always. Mutates the shared `cleanup` object already embedded in
    //    `evidence.cleanup`. Bounded re-scan absorbs a late deal-won webhook that could
    //    re-create the board after our first delete. Deletes are marker-guarded, and the
    //    re-scan matches on the deterministic `projectTitle` only, so nothing else is touched.
    if (projectTitle) {
      for (let attempt = 0; attempt < 4; attempt++) {
        let found: QaProject | null = null;
        try {
          const page = await rest.listProjectsPage(500);
          found = page.items.find((p) => p.title === projectTitle) ?? null;
        } catch {
          found = null;
        }
        if (!found) break;
        try {
          assertDeletable("project", found.id, found.title);
          await rest.deleteProject(found.id);
          if (attempt === 0) cleanup.projectDeleted = true;
          else cleanup.lateReprovisionsDeleted += 1;
        } catch {
          // fall through; residual reported below
        }
        // Give a late webhook a moment to (possibly) re-create, then re-scan.
        await sleep(1500);
      }
    }
    if (dealId) {
      try {
        const d = await rest.getDeal(dealId);
        assertDeletable("deal", dealId, d.title || dealTitle);
        await rest.deleteDeal(dealId);
        cleanup.dealDeleted = true;
      } catch {
        cleanup.dealDeleted = false;
      }
    }
    // Delete the throwaway person + org (best-effort; ids are ones we created this run).
    // Person before org (person belongs to the org).
    if (personId) {
      try {
        await rest.deletePerson(personId);
      } catch {
        /* best-effort */
      }
    }
    if (orgId) {
      try {
        await rest.deleteOrganization(orgId);
      } catch {
        /* best-effort */
      }
    }
    try {
      const page = await rest.listProjectsPage(500);
      cleanup.residualTestProjectRemains = projectTitle
        ? page.items.some((p) => p.title === projectTitle)
        : false;
    } catch {
      cleanup.residualTestProjectRemains = false;
    }
  }
}
