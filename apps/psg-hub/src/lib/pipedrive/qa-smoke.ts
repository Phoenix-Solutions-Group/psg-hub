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
}
export interface QaTask {
  id: number;
  title: string;
  parent_task_id: number | null;
  due_date: string | null;
}

export interface QaRestClient {
  createDeal(title: string, pipelineId: number): Promise<QaDeal>;
  winDeal(dealId: number): Promise<void>;
  getDeal(dealId: number): Promise<QaDeal>;
  deleteDeal(dealId: number): Promise<void>;
  getProject(projectId: number): Promise<QaProject>;
  listProjectTasks(projectId: number): Promise<QaTask[]>;
  deleteProject(projectId: number): Promise<void>;
  /** Raw v2 projects page + whether more pages exist (idempotency scale signal). */
  listProjectsPage(limit: number): Promise<{ items: QaProject[]; hasMore: boolean }>;
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
    };
  }

  return {
    async createDeal(title, pipelineId) {
      const { data } = await call<unknown>("POST", "v1", "deals", {}, {
        title,
        pipeline_id: pipelineId,
      });
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
  };
  tree: {
    totalTasks: number;
    parentTasks: number;
    leafTasks: number;
    gateTasks: number;
    gateTitles: string[];
    parentTitles: string[];
  };
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
    // 1) Create + 2) win a real deal in the sales pipeline.
    const created = await rest.createDeal(dealTitle, opts.salesPipelineId);
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

    // 4) Read back the project + task tree.
    const project = await rest.getProject(prov.projectId);
    const tasks = await rest.listProjectTasks(prov.projectId);
    const parents = tasks.filter((t) => t.parent_task_id == null);
    const leaves = tasks.filter((t) => t.parent_task_id != null);
    const gates = tasks.filter((t) => t.title.toUpperCase().includes("GATE"));

    const d1 = leaves.find((t) => t.title.toLowerCase().includes("welcome email"));
    // NB: "sign-off" also appears in the D5 pre-launch GATE (offset 39); match the
    // *client* sign-off (offset 55) specifically so the spot-check is unambiguous.
    const d5 = leaves.find((t) => t.title.toLowerCase().includes("client sign-off"));
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
      },
      tree: {
        totalTasks: tasks.length,
        parentTasks: parents.length,
        leafTasks: leaves.length,
        gateTasks: gates.length,
        gateTitles: gates.map((t) => t.title),
        parentTitles: parents.map((t) => t.title),
      },
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
    c.fiveParentTasks = parents.length === 5;
    c.twentyFiveLeafTasks = leaves.length === templateTaskCount();
    c.totalIsThirty = tasks.length === 5 + templateTaskCount();
    c.phaseCountFromTemplate = WHM_ONBOARDING_TEMPLATE.length === 5;
    c.d1WelcomeDue = evidence.dueDateSpotChecks.d1Welcome.ok;
    c.d5SignOffDue = evidence.dueDateSpotChecks.d5SignOff.ok;
    c.idempotentNoSecondProject =
      again.skippedExisting && again.projectId === prov.projectId;
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
