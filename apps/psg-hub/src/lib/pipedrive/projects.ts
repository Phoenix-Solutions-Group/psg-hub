// PSG-584 / PSG-576 Move 1 — Pipedrive Projects API client + deal-won board builder.
//
// Business outcome (PSG-584 case (a), the NON-BROWSER path): when a deal is won, a
// delivery board — one Pipedrive **project** with the 5 D-phases and their tasks from
// Noelle's confirmed template — is created for that client, entirely via the REST API.
// No Pipedrive browser UI is involved: this is what unblocks the twice-stalled Move 1.
//
// Auth: the write-capable personal API token — resolved via `resolvePipedriveToken()`
// from `PIPEDRIVE_API_TOKEN` (canonical, same admin token the inbound-lead intake path
// uses) with `PIPEDRIVE_API_KEY` accepted as an alias. Endpoints carry the token in the
// query string (`api_token`, accepted by both API versions); it is NEVER logged (errors
// never include the URL).
//
// API version / base path (PSG-588 — the go-live transport fix):
//   Every request goes to `https://{domain}.pipedrive.com/api/{version}/{resource}`.
//   The `/api/` segment is REQUIRED — omitting it 404s silently, which for a webhook
//   means zero onboarding boards on real wins. Projects live in **API v2** under FLAT
//   resource paths (`projects`, `boards`, `phases`, `tasks`) — NOT nested under
//   `projects/…` and NOT v1. (Pipedrive shipped Projects API v2 on 2026-05-21; the
//   legacy v1 `projects/*` endpoints are being removed on 2026-07-31, so v2 is both the
//   correct and the future-proof target.) `users` has no v2 and stays on v1. Per-request
//   version is explicit at each call site below and asserted by transport unit tests so
//   this can never silently regress.
//
// Pipedrive data-model note (important, and the one non-obvious mapping):
//   Pipedrive Projects has Boards → (kanban) Phases → Projects → Tasks. A *project*
//   lives in ONE board phase (a kanban column like "Not started"), so Pipedrive's
//   "phases" are NOT our D1–D5 delivery phases. We therefore model each D-phase as a
//   PARENT TASK inside the project, with that phase's tasks as its subtasks
//   (`parent_task_id`). This gives a clean "phases + nested tasks" board without
//   abusing kanban columns. The exact board/phase to drop the project into is
//   configurable (`boardId`/`phaseId`) and discoverable via `listBoards`/`listPhases`.

import {
  WHM_ONBOARDING_TEMPLATE,
  ROLE_LABELS,
  dueDateFor,
  type OnboardingPhase,
  type OnboardingRole,
} from "./onboarding-template";

export class PipedriveProjectsError extends Error {
  readonly status?: number;
  constructor(message: string, status?: number) {
    super(message);
    this.name = "PipedriveProjectsError";
    this.status = status;
  }
}

/**
 * Env var names that may hold the write-capable Pipedrive token, tried in order.
 * Kept in sync with `crm/pipedrive/config.ts` so this Move 1 path resolves the token
 * the SAME way as the rest of the codebase: the canonical name the operator actually
 * configured in Vercel is `PIPEDRIVE_API_TOKEN`; `PIPEDRIVE_API_KEY` is an accepted
 * alias. Listing both avoids storing the same secret under two names in Vercel.
 * (Duplicated here on purpose — this module stays self-contained so it is
 * independently mergeable/deployable, per the file header.)
 */
export const PIPEDRIVE_TOKEN_ENV_CANDIDATES = [
  "PIPEDRIVE_API_TOKEN",
  "PIPEDRIVE_TOKEN",
  "PIPEDRIVE_API_KEY",
] as const;

/**
 * First non-empty (trimmed) Pipedrive token value among the accepted env names, or
 * `""` when none is set. Never logs or echoes the value.
 */
export function resolvePipedriveToken(
  env: Record<string, string | undefined> = process.env,
): string {
  for (const name of PIPEDRIVE_TOKEN_ENV_CANDIDATES) {
    const raw = env[name];
    if (typeof raw === "string" && raw.trim() !== "") return raw.trim();
  }
  return "";
}

/** Base REST URL for a company domain (or the shared API host when unknown). */
export function pipedriveBaseUrl(companyDomain?: string | null): string {
  const domain = (companyDomain ?? "").trim();
  if (!domain) return "https://api.pipedrive.com";
  const sub = domain.replace(/^https?:\/\//, "").replace(/\.pipedrive\.com.*$/, "");
  return `https://${sub}.pipedrive.com`;
}

// ── low-level client ────────────────────────────────────────────────────────────────

/** Pipedrive REST API version segment used in the `/api/{version}/` path. */
export type ApiVersion = "v1" | "v2";

export interface ProjectsClientConfig {
  /** Admin write token. Defaults to `resolvePipedriveToken()` (PIPEDRIVE_API_TOKEN, alias PIPEDRIVE_API_KEY). */
  apiKey?: string;
  companyDomain?: string | null;
  /** Injectable fetch (defaults to global `fetch`) — the seam unit tests mock. */
  fetchImpl?: typeof fetch;
}

export interface ProjectBoard {
  id: number;
  name: string;
}
export interface ProjectPhase {
  id: number;
  name: string;
  board_id: number;
}
/** A Pipedrive account user — the "team record" a role→user map is sourced from. */
export interface PipedriveUser {
  id: number;
  name: string;
  email: string;
  /** Whether the user is active (deactivated users should not be assigned work). */
  active: boolean;
}
export interface CreateProjectInput {
  title: string;
  board_id: number;
  phase_id: number;
  description?: string;
  owner_id?: number;
  start_date?: string; // YYYY-MM-DD
  deal_ids?: number[];
  // v2 relates orgs/persons as ARRAYS (`org_ids`/`person_ids`); the old singular
  // `org_id`/`person_id` are silently dropped (or rejected under v2's stricter
  // validation) — see PSG-588.
  org_ids?: number[];
  person_ids?: number[];
}
export interface CreateTaskInput {
  title: string;
  project_id: number;
  // NB: v2 `POST /tasks` has NO `phase_id` — D-phases are modelled as parent tasks
  // (`parent_task_id`), so we never send one. (See file header + PSG-588.)
  parent_task_id?: number;
  assignee_id?: number;
  due_date?: string; // YYYY-MM-DD
  description?: string;
}

/**
 * PSG-642 — fields patchable on an existing task via v2 `PATCH /tasks/{id}`. The v2 Tasks
 * API is still beta, so this thin type is the ONE place a field rename lands. Every field
 * is optional: send only what changes. `description` is the attachment-SOP write target
 * (paste a Google Drive share link into a task — see MONTHLY-RECURRING-ATTACHMENTS-SOP.md).
 */
export interface UpdateTaskInput {
  title?: string;
  assignee_id?: number;
  due_date?: string; // YYYY-MM-DD
  description?: string;
  /** Some workflows mark a task done via the v2 status field; kept for one-place mapping. */
  status?: string;
}

/**
 * PSG-642 — a project-level file attach (v1 `POST /files`) for the RARE true-file case.
 * Pipedrive cannot attach a file to an individual TASK (confirmed in PSG-610 §2d), so the
 * default SOP is a Drive link in the task description; this is the escape hatch for a file
 * that must physically live in Pipedrive, attached to the whole project.
 */
export interface AttachProjectFileInput {
  projectId: number;
  fileName: string;
  /** File bytes (or text). A raw `Blob` is passed through as-is. */
  content: Blob | Uint8Array | ArrayBuffer | string;
  contentType?: string;
}

export interface PipedriveProjectsClient {
  listBoards(): Promise<ProjectBoard[]>;
  listPhases(boardId: number): Promise<ProjectPhase[]>;
  /** List account users so a role owner can be matched to a Pipedrive user id. */
  listUsers(): Promise<PipedriveUser[]>;
  createProject(input: CreateProjectInput): Promise<{ id: number }>;
  createTask(input: CreateTaskInput): Promise<{ id: number }>;
  /** Find an existing project whose title matches (idempotency guard). */
  findProjectByTitle(title: string): Promise<{ id: number } | null>;
  // ── PSG-642 thin v2-Tasks adapter (optional so existing test fakes stay valid) ──
  // Both are always present on the concrete client below; they are the one-place fix for a
  // beta v2 Tasks field/endpoint change and back the attachment SOP + future overdue digest.
  /** Update an existing task (v2 `PATCH /tasks/{id}`). Send only the fields that change. */
  updateTask?(taskId: number, patch: UpdateTaskInput): Promise<{ id: number }>;
  /** Attach a file at PROJECT level (v1 `POST /files`) for the rare true-file case. */
  attachProjectFile?(input: AttachProjectFileInput): Promise<{ id: number }>;
}

/**
 * Default HTTP client for the Pipedrive Projects API (v2 flat paths, personal-token auth).
 * Self-contained on purpose so this module is independently mergeable to `main`
 * (and therefore deployable to production) without the unmerged read-sync client.
 */
export function createProjectsClient(
  config: ProjectsClientConfig = {},
): PipedriveProjectsClient {
  const apiKey = config.apiKey ?? resolvePipedriveToken();
  if (!apiKey) {
    // Fail closed; message carries no token material.
    throw new PipedriveProjectsError(
      `Missing Pipedrive token (set one of: ${PIPEDRIVE_TOKEN_ENV_CANDIDATES.join(", ")})`,
    );
  }
  const base = pipedriveBaseUrl(config.companyDomain);
  const doFetch = config.fetchImpl ?? fetch;

  /**
   * Build a fully-qualified Pipedrive URL: `{base}/api/{version}/{resource}` with the
   * token in the query string (never logged). The `/api/` segment and the per-endpoint
   * version are the whole point of PSG-588 — see the file header.
   */
  function url(
    version: ApiVersion,
    path: string,
    params: Record<string, string> = {},
  ): string {
    const u = new URL(`${base}/api/${version}/${path}`);
    for (const [k, v] of Object.entries(params)) u.searchParams.set(k, v);
    u.searchParams.set("api_token", apiKey);
    return u.toString();
  }

  async function call<T>(
    method: "GET" | "POST" | "PATCH",
    version: ApiVersion,
    path: string,
    params: Record<string, string> = {},
    jsonBody?: Record<string, unknown>,
  ): Promise<T> {
    const res = await doFetch(url(version, path, params), {
      method,
      headers: jsonBody
        ? { Accept: "application/json", "Content-Type": "application/json" }
        : { Accept: "application/json" },
      body: jsonBody ? JSON.stringify(jsonBody) : undefined,
    });
    if (!res.ok) {
      // NEVER include the URL (it carries the token) in the error.
      throw new PipedriveProjectsError(
        `Pipedrive ${method} /api/${version}/${path} returned HTTP ${res.status}`,
        res.status,
      );
    }
    const payload = (await res.json()) as { success?: boolean; data?: unknown };
    if (payload.success === false) {
      throw new PipedriveProjectsError(
        `Pipedrive ${method} /api/${version}/${path} returned success=false`,
      );
    }
    return payload.data as T;
  }

  return {
    async listBoards() {
      const data = await call<ProjectBoard[]>("GET", "v2", "boards");
      return (data ?? []).map((b) => ({ id: Number(b.id), name: String(b.name ?? "") }));
    },
    async listPhases(boardId) {
      const data = await call<ProjectPhase[]>("GET", "v2", "phases", {
        board_id: String(boardId),
      });
      return (data ?? []).map((p) => ({
        id: Number(p.id),
        name: String(p.name ?? ""),
        board_id: Number(p.board_id),
      }));
    },
    async listUsers() {
      // Users has no v2 endpoint — stays on v1 (not part of the Projects v2 set).
      const data = await call<
        Array<{ id: number; name?: string; email?: string; active_flag?: boolean }>
      >("GET", "v1", "users");
      return (data ?? []).map((u) => ({
        id: Number(u.id),
        name: String(u.name ?? ""),
        email: String(u.email ?? ""),
        active: u.active_flag !== false,
      }));
    },
    async createProject(input) {
      const proj = await call<{ id: number }>("POST", "v2", "projects", {}, {
        ...input,
      });
      return { id: Number(proj.id) };
    },
    async createTask(input) {
      const task = await call<{ id: number }>("POST", "v2", "tasks", {}, { ...input });
      return { id: Number(task.id) };
    },
    async updateTask(taskId, patch) {
      // v2 `PATCH /tasks/{id}` — beta; this call site is the one place the shape lives.
      const task = await call<{ id: number }>(
        "PATCH",
        "v2",
        `tasks/${taskId}`,
        {},
        { ...patch },
      );
      return { id: Number(task.id) };
    },
    async attachProjectFile(input) {
      // v1 `POST /files` (multipart) — the rare true-file case (PSG-610 §2d). Content-Type
      // is NOT set by hand: `fetch` derives the multipart boundary from the FormData body.
      // Token rides in the query string only, exactly like every other call (never logged).
      const blob =
        input.content instanceof Blob
          ? input.content
          : new Blob([input.content as BlobPart], {
              type: input.contentType ?? "application/octet-stream",
            });
      const form = new FormData();
      form.append("file", blob, input.fileName);
      form.append("project_id", String(input.projectId));
      const res = await doFetch(url("v1", "files"), {
        method: "POST",
        headers: { Accept: "application/json" },
        body: form,
      });
      if (!res.ok) {
        // NEVER include the URL (it carries the token) in the error.
        throw new PipedriveProjectsError(
          `Pipedrive POST /api/v1/files returned HTTP ${res.status}`,
          res.status,
        );
      }
      const payload = (await res.json()) as { success?: boolean; data?: { id?: number } };
      if (payload.success === false) {
        throw new PipedriveProjectsError(
          "Pipedrive POST /api/v1/files returned success=false",
        );
      }
      return { id: Number(payload.data?.id) };
    },
    async findProjectByTitle(title) {
      // Projects list is small for a single company; page defensively and match exact.
      const data = await call<Array<{ id: number; title?: string }>>(
        "GET",
        "v2",
        "projects",
        { limit: "500" },
      );
      const hit = (data ?? []).find((p) => (p.title ?? "").trim() === title.trim());
      return hit ? { id: Number(hit.id) } : null;
    },
  };
}

// ── webhooks helper (Move 1 go-live: register the deal-won webhook) ───────────────────
//
// The Projects client above covers boards/phases/projects/tasks but NOT webhooks. The
// go-live setup route (`/api/ops/pipedrive/onboarding-setup`) needs to (a) list existing
// webhooks so registration is idempotent and (b) create the deal-won webhook. Webhooks
// live on Pipedrive **v1** (`/api/v1/webhooks`), token in the query string — same auth +
// URL-never-logged discipline as the Projects client. Kept as a small self-contained
// factory so the Projects client interface (and its existing fake in tests) is untouched.

export interface PipedriveWebhook {
  id: number;
  /** The endpoint Pipedrive calls — this is OUR app URL, never carries a token. */
  subscription_url: string;
}

export interface RegisterWebhookInput {
  /** Our public endpoint, e.g. `${NEXT_PUBLIC_APP_URL}/api/webhooks/pipedrive`. */
  subscriptionUrl: string;
  eventAction: string;
  eventObject: string;
  /** HTTP Basic pair Pipedrive sends on each call — NEVER logged/returned. */
  httpAuthUser?: string | null;
  httpAuthPass?: string | null;
  version?: string;
}

export interface PipedriveWebhooksClient {
  /** All webhooks on the account (id + subscription_url only). */
  list(): Promise<PipedriveWebhook[]>;
  /** Create a webhook. Returns its new id. */
  create(input: RegisterWebhookInput): Promise<{ id: number }>;
}

/**
 * Self-contained v1 webhooks client. Token resolved via `resolvePipedriveToken()` and
 * carried ONLY in the query string; errors never include the URL (which carries the
 * token) or the HTTP Basic password. Mirrors `createProjectsClient`'s hygiene.
 */
export function createWebhooksClient(
  config: ProjectsClientConfig = {},
): PipedriveWebhooksClient {
  const apiKey = config.apiKey ?? resolvePipedriveToken();
  if (!apiKey) {
    throw new PipedriveProjectsError(
      `Missing Pipedrive token (set one of: ${PIPEDRIVE_TOKEN_ENV_CANDIDATES.join(", ")})`,
    );
  }
  const base = pipedriveBaseUrl(config.companyDomain);
  const doFetch = config.fetchImpl ?? fetch;

  function url(): string {
    const u = new URL(`${base}/api/v1/webhooks`);
    u.searchParams.set("api_token", apiKey);
    return u.toString();
  }

  async function call<T>(
    method: "GET" | "POST",
    jsonBody?: Record<string, unknown>,
  ): Promise<T> {
    const res = await doFetch(url(), {
      method,
      headers: jsonBody
        ? { Accept: "application/json", "Content-Type": "application/json" }
        : { Accept: "application/json" },
      body: jsonBody ? JSON.stringify(jsonBody) : undefined,
    });
    if (!res.ok) {
      // NEVER include the URL (it carries the token) in the error.
      throw new PipedriveProjectsError(
        `Pipedrive ${method} /api/v1/webhooks returned HTTP ${res.status}`,
        res.status,
      );
    }
    const payload = (await res.json()) as { success?: boolean; data?: unknown };
    if (payload.success === false) {
      throw new PipedriveProjectsError("Pipedrive /api/v1/webhooks returned success=false");
    }
    return payload.data as T;
  }

  return {
    async list() {
      const data = await call<Array<{ id: number; subscription_url?: string }>>("GET");
      return (data ?? []).map((w) => ({
        id: Number(w.id),
        subscription_url: String(w.subscription_url ?? ""),
      }));
    },
    async create(input) {
      const body: Record<string, unknown> = {
        subscription_url: input.subscriptionUrl,
        event_action: input.eventAction,
        event_object: input.eventObject,
        version: input.version ?? "1.0",
      };
      if (input.httpAuthUser) body.http_auth_user = input.httpAuthUser;
      if (input.httpAuthPass) body.http_auth_password = input.httpAuthPass;
      const created = await call<{ id: number }>("POST", body);
      return { id: Number(created.id) };
    },
  };
}

// ── deal-won board builder (the orchestrator the webhook calls) ──────────────────────

/** Minimal shape of a won deal we need to name and link the delivery board. */
export interface WonDeal {
  id: number;
  title: string;
  /** Client / organization name, used for the project title when present. */
  orgName?: string | null;
  orgId?: number | null;
  personId?: number | null;
  /** Pipeline the deal was won in; used to scope which won deals build a board. */
  pipelineId?: number | null;
  /** Day-0 date (deal-won date), `YYYY-MM-DD`. */
  wonDate: string;
}

export interface ProvisionOptions {
  client: PipedriveProjectsClient;
  deal: WonDeal;
  /** Board + kanban phase to drop the new project into. */
  boardId: number;
  phaseId: number;
  template?: readonly OnboardingPhase[];
  /**
   * Optional role→Pipedrive-user-id map. When a role is present, its tasks are
   * assigned to that user; otherwise tasks are left UNASSIGNED (role stays in the
   * title). PSG must confirm who fills each role before we hard-assign — see PSG-584.
   */
  roleUserMap?: Partial<Record<OnboardingRole, number>>;
}

export interface ProvisionResult {
  created: boolean;
  projectId: number;
  phaseCount: number;
  taskCount: number;
  /** True when an existing project with the same title was found (no-op). */
  skippedExisting: boolean;
}

/** Deterministic project title so re-delivery of the same won deal is idempotent. */
export function onboardingProjectTitle(deal: WonDeal): string {
  const client = (deal.orgName ?? "").trim() || deal.title.trim();
  return `Onboarding — ${client} (deal ${deal.id})`;
}

/**
 * Create the full onboarding delivery board for a won deal: one project, one parent
 * task per D-phase, and each phase's tasks as subtasks with due dates = wonDate +
 * offset. Idempotent: if a project with the deterministic title already exists, it is
 * a no-op (returns `skippedExisting: true`) so a webhook retry never double-creates.
 */
export async function provisionOnboardingBoard(
  opts: ProvisionOptions,
): Promise<ProvisionResult> {
  const { client, deal, boardId, phaseId } = opts;
  const template = opts.template ?? WHM_ONBOARDING_TEMPLATE;
  const roleUserMap = opts.roleUserMap ?? {};
  const title = onboardingProjectTitle(deal);

  const existing = await client.findProjectByTitle(title);
  if (existing) {
    return {
      created: false,
      projectId: existing.id,
      phaseCount: 0,
      taskCount: 0,
      skippedExisting: true,
    };
  }

  const project = await client.createProject({
    title,
    board_id: boardId,
    phase_id: phaseId,
    description:
      `WHM new-client onboarding (Day 0 = ${deal.wonDate}). ` +
      `Auto-created on deal-won from deal #${deal.id}.`,
    start_date: deal.wonDate,
    deal_ids: [deal.id],
    // v2 takes ARRAYS; omit entirely when absent (v2 rejects empty `[]`).
    ...(deal.orgId != null ? { org_ids: [deal.orgId] } : {}),
    ...(deal.personId != null ? { person_ids: [deal.personId] } : {}),
  });

  let taskCount = 0;
  for (const phase of template) {
    // Parent task = the D-phase; due date is the phase's last task offset (phase end).
    const phaseEndOffset = phase.tasks.reduce((m, t) => Math.max(m, t.dayOffset), 0);
    const parent = await client.createTask({
      title: phase.name,
      project_id: project.id,
      due_date: dueDateFor(deal.wonDate, phaseEndOffset),
      description: `Phase ${phase.key} — ${phase.tasks.length} task(s).`,
    });

    for (const t of phase.tasks) {
      const assignee = roleUserMap[t.owner];
      await client.createTask({
        title: t.title,
        project_id: project.id,
        parent_task_id: parent.id,
        due_date: dueDateFor(deal.wonDate, t.dayOffset),
        description: `Owner: ${ROLE_LABELS[t.owner]} (${t.owner})${t.gate ? " · GATE" : ""}`,
        ...(assignee != null ? { assignee_id: assignee } : {}),
      });
      taskCount += 1;
    }
  }

  return {
    created: true,
    projectId: project.id,
    phaseCount: template.length,
    taskCount,
    skippedExisting: false,
  };
}

// ── deal-won detection (shared by the webhook route + tests) ─────────────────────────

/**
 * A Pipedrive v1 webhook payload for a deal update carries `current` + `previous`.
 * A "deal won" event is the transition INTO status `won` — we require the previous
 * status to differ so an idempotent re-send of an already-won deal is not re-fired.
 */
export function isDealWonTransition(payload: {
  current?: { status?: string } | null;
  previous?: { status?: string } | null;
}): boolean {
  const current = payload.current?.status;
  const previous = payload.previous?.status;
  return current === "won" && previous !== "won";
}

/**
 * Extract the deal's pipeline id from a webhook `current` object. Pipedrive relates
 * the pipeline as either a bare id or a nested `{ value, name }` object.
 */
export function dealPipelineId(
  current: Record<string, unknown> | null | undefined,
): number | null {
  if (!current) return null;
  const v = current.pipeline_id;
  if (v == null) return null;
  if (typeof v === "object") {
    const n = Number((v as Record<string, unknown>).value);
    return Number.isFinite(n) ? n : null;
  }
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

/**
 * Scope which won deals build an onboarding board to a single sales pipeline.
 * PSG runs more than one Pipedrive pipeline; only deals won in the sales pipeline
 * (pipeline 8 — the one Nick pointed us at) should spin up a delivery board. Won
 * deals in other pipelines are out of scope. When `allowedPipelineId` is null (env
 * unset), scoping is OFF and every won deal passes — a deliberately safe default.
 */
export function isDealPipelineInScope(
  current: Record<string, unknown> | null | undefined,
  allowedPipelineId: number | null | undefined,
): boolean {
  if (allowedPipelineId == null || !Number.isFinite(allowedPipelineId)) return true;
  return dealPipelineId(current) === allowedPipelineId;
}
