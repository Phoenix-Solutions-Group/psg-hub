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
//   Pipedrive Projects has Boards → Phases → Projects → Tasks. A *project* lives in ONE
//   board phase as a kanban card (`CreateProjectInput.phase_id`, e.g. "Not started").
//   SEPARATELY, the SAME board phases also organise the tasks inside a project's Tasks
//   view — a task carries its own `phase_id` (a board phase) and everything unstamped
//   piles into "Phase unassigned".
//
//   PSG-722 fix (was the "Phase unassigned" bug): the first version WRONGLY assumed
//   project tasks had no phase field, so it modelled each D-phase as a PARENT TASK with
//   its tasks as subtasks (`parent_task_id`). That left every task in "Phase unassigned"
//   and the board showing Pipedrive's factory phase columns. We now (a) ensure the target
//   board carries one phase per template phase — by name, idempotently — and (b) stamp
//   each task into its template phase after create. The redundant phase-PARENT tasks are
//   dropped: real phase columns replace them, so tasks are created FLAT (no parent) and
//   each gets a `phase_id`. The board/phase the project card sits in is still
//   configurable (`boardId`/`phaseId`) and discoverable via `listBoards`/`listPhases`.
//
//   Two API facts this relies on (confirmed live, PSG-715 research):
//     • Board phases are created via v2 `POST /phases` `{ name, board_id, order_nr? }`.
//     • A task's phase is set AFTER create via v1 `PUT /projects/{id}/plan/tasks/{taskId}`
//       `{ phase_id }` — v2 `POST /tasks` silently ignores `phase_id`.

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
export interface PipedriveDealPerson {
  id: number;
  name: string | null;
  email: string | null;
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
  // NB: v2 `POST /tasks` silently IGNORES `phase_id` (confirmed live, PSG-715) — a task's
  // phase is stamped AFTER create via `setTaskPhase` (v1 plan endpoint). `parent_task_id`
  // is retained for the legacy subtask shape but the provisioner no longer sends one:
  // tasks are created FLAT and phased (see file header + PSG-722).
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

/** Patch fields on an existing Pipedrive deal. Custom-field keys are allowed. */
export type UpdateDealInput = Record<string, string | number | boolean | null>;

/** Patch fields on an existing Pipedrive organization. Custom-field keys are allowed. */
export type UpdateOrganizationInput = Record<string, string | number | boolean | null>;

export const HANDOFF_COMPLETE_FIELD_KEY_ENV = "PIPEDRIVE_HANDOFF_COMPLETE_FIELD_KEY";

export const HANDOFF_COMPLETE_REQUIRED_FIELDS = [
  {
    label: "Invoiced Customer / Billing Link",
    fieldId: "12553",
    env: "PIPEDRIVE_INVOICED_CUSTOMER_BILLING_LINK_FIELD_KEY",
  },
  {
    label: "Google Shared Drive Folder Link",
    fieldId: "12557",
    env: "PIPEDRIVE_GOOGLE_SHARED_DRIVE_FOLDER_LINK_FIELD_KEY",
  },
  {
    label: "Delivery Owner",
    fieldId: "12558",
    env: "PIPEDRIVE_DELIVERY_OWNER_FIELD_KEY",
  },
  {
    label: "Backup Delivery Owner",
    fieldId: "12559",
    env: "PIPEDRIVE_BACKUP_DELIVERY_OWNER_FIELD_KEY",
  },
  {
    label: "Pipedrive Delivery Project Link",
    fieldId: "12560",
    env: "PIPEDRIVE_DELIVERY_PROJECT_LINK_FIELD_KEY",
  },
] as const;

function envValue(envName: string): string | null {
  const raw = process.env[envName];
  return typeof raw === "string" && raw.trim() !== "" ? raw.trim() : null;
}

function handoffCompleteFieldKeys(): string[] {
  return [
    envValue(HANDOFF_COMPLETE_FIELD_KEY_ENV),
    "handoff_complete",
    "Handoff Complete",
  ].filter((v): v is string => Boolean(v));
}

function handoffCompleteYesValues(): string[] {
  const configured = (process.env.PIPEDRIVE_HANDOFF_COMPLETE_YES_VALUES ?? "")
    .split(",")
    .map((v) => v.trim())
    .filter(Boolean);
  return [...configured, "yes", "Yes", "true", "1"];
}

function requiredHandoffFieldKey(
  field: (typeof HANDOFF_COMPLETE_REQUIRED_FIELDS)[number],
): string {
  return envValue(field.env) ?? field.fieldId;
}

function isBlankPipedriveValue(value: unknown): boolean {
  if (value == null) return true;
  if (typeof value === "string") return value.trim() === "";
  if (Array.isArray(value)) return value.length === 0 || value.every(isBlankPipedriveValue);
  if (typeof value === "object") {
    return Object.values(value as Record<string, unknown>).every(isBlankPipedriveValue);
  }
  return false;
}

function isHandoffCompleteYes(value: unknown): boolean {
  if (typeof value === "boolean") return value;
  if (typeof value === "number") return handoffCompleteYesValues().includes(String(value));
  if (typeof value === "string") {
    const normalized = value.trim();
    return handoffCompleteYesValues().some(
      (allowed) => allowed.toLocaleLowerCase() === normalized.toLocaleLowerCase(),
    );
  }
  if (value && typeof value === "object") {
    const candidate =
      (value as Record<string, unknown>).label ??
      (value as Record<string, unknown>).name ??
      (value as Record<string, unknown>).value;
    return isHandoffCompleteYes(candidate);
  }
  return false;
}

export function validateHandoffCompleteDealPatch(
  patch: UpdateDealInput,
  currentDeal: Record<string, unknown> = {},
): void {
  if (!patchSetsHandoffCompleteYes(patch)) return;

  const mergedDeal = { ...currentDeal, ...patch };
  const missing = HANDOFF_COMPLETE_REQUIRED_FIELDS.filter((field) => {
    const key = requiredHandoffFieldKey(field);
    return isBlankPipedriveValue(mergedDeal[key]);
  }).map((field) => field.label);

  if (missing.length > 0) {
    throw new PipedriveProjectsError(
      `Cannot mark Handoff Complete as Yes until these fields are filled: ${missing.join(", ")}.`,
      400,
    );
  }
}

export function patchSetsHandoffCompleteYes(patch: UpdateDealInput): boolean {
  return Object.entries(patch).some(([key, value]) =>
    handoffCompleteFieldKeys().includes(key) && isHandoffCompleteYes(value),
  );
}

/**
 * PSG-668 — one line item on a won deal, as needed by the template selector. The SKU is
 * how a deal is mapped to a net-new one-time template (e.g. Website Design & Build →
 * `PSG_P_026`); `name` is the human fallback match. Read-only; nothing here is written.
 */
export interface DealProduct {
  /** Line-item / product name as it reads on the deal. */
  name: string;
  /** Product SKU / code (Pipedrive `sku`/`code`), when present — the primary match key. */
  sku: string | null;
  /** Pipedrive product id, when present (diagnostic only). */
  productId: number | null;
  /** Quantity sold on this line item, when Pipedrive returns it. */
  quantity?: number | null;
  /** Line total from Pipedrive (`sum`), used for Won-gate fee autofill. */
  sum?: number | null;
  /** Pipedrive billing cadence for the line item (`one-time`, `monthly`, etc.). */
  billingFrequency?: string | null;
}

export interface PipedriveUserConnections {
  /** Pipedrive currently returns `{ google: "email@domain" }` for Nick's connected Google account. */
  google?: unknown;
  [key: string]: unknown;
}

export interface DealActivitySummary {
  id: number;
  subject: string;
  type: string | null;
  dueDate: string | null;
  dueTime?: string | null;
  done: boolean;
}

export interface CreateActivityInput extends Record<string, unknown> {
  subject: string;
  type: string;
  owner_id?: number;
  deal_id?: number;
  person_id?: number;
  org_id?: number;
  due_date?: string;
  due_time?: string;
  duration?: string;
  busy?: boolean;
  done?: boolean;
  note?: string;
}

export interface PipedriveProjectsClient {
  listBoards(): Promise<ProjectBoard[]>;
  listPhases(boardId: number): Promise<ProjectPhase[]>;
  /** List account users so a role owner can be matched to a Pipedrive user id. */
  listUsers(): Promise<PipedriveUser[]>;
  /**
   * PSG-668 — read the line items sold on a deal (v1 `GET /deals/{id}/products`) so the
   * template selector can map a won deal to the right one-time template. Optional on the
   * interface so existing test fakes stay valid; the concrete client always implements it.
   */
  listDealProducts?(dealId: number): Promise<DealProduct[]>;
  /** Deal-linked people with primary email addresses, used for proposal draft recipients. */
  listDealPersons?(dealId: number): Promise<PipedriveDealPerson[]>;
  /** Read connected account state before calendar/mail automations write anything. */
  listUserConnections?(): Promise<PipedriveUserConnections>;
  /** Lightweight mailbox probe, used to confirm Nick's Pipedrive mailbox drafts folder is reachable. */
  listMailboxThreads?(folder: "drafts", limit?: number): Promise<Array<{ id: number }>>;
  /** Deal-linked open activities, used as the replay/idempotency guard for webhook-created work. */
  listDealActivities?(dealId: number): Promise<DealActivitySummary[]>;
  /** Create a deal-linked activity. Activities sync to calendar when the user has calendar sync enabled. */
  createActivity?(input: CreateActivityInput): Promise<{ id: number }>;
  /** Delete an activity when a proposal follow-up sequence should stop. */
  deleteActivity?(activityId: number): Promise<void>;
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
  /**
   * PSG-1472 — patch a deal-level field, primarily the First Contact Date custom field.
   * Optional so older test fakes stay valid; the concrete client always implements it.
   */
  updateDeal?(dealId: number, patch: UpdateDealInput): Promise<{ id: number }>;
  /**
   * Patch organization fields when an external source has better contact data.
   * Optional so older test fakes stay valid; the concrete client always implements it.
   */
  updateOrganization?(
    organizationId: number,
    patch: UpdateOrganizationInput,
  ): Promise<{ id: number }>;
  /**
   * PSG-644 — list a project's tasks (v2 `GET /tasks?project_id`). Optional so existing
   * test fakes stay valid. Backs the Asana-import marker-guard: a re-run reads the tasks
   * already in the target project, extracts their `[asana:<gid>]` markers, and skips any
   * open Asana task already migrated — so a re-run never double-writes. Returns id + title
   * + description (the description is where the marker lives).
   */
  listProjectTasks?(
    projectId: number,
  ): Promise<Array<{ id: number; title: string; description: string }>>;
  /**
   * PSG-722 — create a board phase by name (v2 `POST /phases` `{ board_id, name, order_nr? }`).
   * Optional so existing test fakes stay valid; the concrete client always implements it.
   * Backs `ensureBoardPhases` — the idempotent "give this board the template's phase
   * columns" step that fixes the "Phase unassigned" defect.
   */
  createPhase?(
    boardId: number,
    name: string,
    orderNr?: number,
  ): Promise<{ id: number }>;
  /**
   * PSG-722 — stamp a task into a board phase (v1 `PUT /projects/{id}/plan/tasks/{taskId}`
   * `{ phase_id }`). This is the ONLY way to set a task's phase: v2 `POST /tasks` ignores
   * `phase_id`. Optional on the interface (test-fake friendliness); always implemented by
   * the concrete client so every provisioned task lands in its template phase.
   */
  setTaskPhase?(
    projectId: number,
    taskId: number,
    phaseId: number,
  ): Promise<void>;
}

/**
 * Translate our internal task input (which carries a single `assignee_id`) to the v2
 * Tasks wire body. The ONLY transform: `assignee_id` (singular) → `assignee_ids: [id]`
 * (the array field the v2 API actually reads — the singular one is silently dropped,
 * PSG-680). Every other field passes through untouched. Omits the assignee entirely when
 * unset so an unmapped role stays unassigned (rather than sending an empty array).
 */
export function toV2TaskBody(
  input: CreateTaskInput | UpdateTaskInput,
): Record<string, unknown> {
  const { assignee_id, ...rest } = input;
  const body: Record<string, unknown> = { ...rest };
  if (assignee_id != null) body.assignee_ids = [assignee_id];
  return body;
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
    method: "GET" | "POST" | "PATCH" | "PUT" | "DELETE",
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
    async listDealProducts(dealId) {
      // Deal line items live on v1 (`/api/v1/deals/{id}/products`) — no v2 equivalent.
      // Read-only. The SKU is exposed as `sku` on newer responses; older ones nest the
      // catalog `code` under `product` — accept either so the selector always sees a SKU.
      const data = await call<
        Array<{
          product_id?: number | null;
          name?: string | null;
          sku?: string | null;
          code?: string | null;
          quantity?: number | string | null;
          sum?: number | string | null;
          billing_frequency?: string | null;
          product?: { code?: string | null; name?: string | null } | null;
        }>
      >("GET", "v1", `deals/${dealId}/products`);
      return (data ?? []).map((p) => {
        const sku =
          (typeof p.sku === "string" && p.sku.trim() !== "" ? p.sku.trim() : null) ??
          (typeof p.code === "string" && p.code.trim() !== "" ? p.code.trim() : null) ??
          (typeof p.product?.code === "string" && p.product.code.trim() !== ""
            ? p.product.code.trim()
            : null);
        return {
          name: String(p.name ?? p.product?.name ?? ""),
          sku,
          productId: p.product_id != null ? Number(p.product_id) : null,
          quantity:
            p.quantity != null && Number.isFinite(Number(p.quantity))
              ? Number(p.quantity)
              : null,
          sum: p.sum != null && Number.isFinite(Number(p.sum)) ? Number(p.sum) : null,
          billingFrequency:
            typeof p.billing_frequency === "string" && p.billing_frequency.trim() !== ""
              ? p.billing_frequency.trim()
              : null,
        };
      });
    },
    async listDealPersons(dealId) {
      const data = await call<
        Array<{
          id?: number | null;
          name?: string | null;
          email?: string | Array<{ value?: string | null; primary?: boolean | null }> | null;
        }>
      >("GET", "v2", "persons", { deal_id: String(dealId), limit: "500" });
      return (data ?? []).map((person) => {
        const email =
          typeof person.email === "string"
            ? person.email
            : Array.isArray(person.email)
              ? ((person.email.find((e) => e.primary)?.value ?? person.email[0]?.value) ?? null)
              : null;
        return {
          id: Number(person.id),
          name: typeof person.name === "string" && person.name.trim() !== "" ? person.name : null,
          email: typeof email === "string" && email.trim() !== "" ? email.trim() : null,
        };
      });
    },
    async listUserConnections() {
      const data = await call<PipedriveUserConnections>("GET", "v1", "userConnections");
      return data ?? {};
    },
    async listMailboxThreads(folder, limit = 1) {
      const data = await call<Array<{ id?: number }>>(
        "GET",
        "v1",
        "mailbox/mailThreads",
        { folder, start: "0", limit: String(limit) },
      );
      return (data ?? []).map((thread) => ({ id: Number(thread.id) }));
    },
    async listDealActivities(dealId) {
      const data = await call<
        Array<{
          id?: number;
          subject?: string | null;
          type?: string | null;
          due_date?: string | null;
          due_time?: string | null;
          done?: boolean | number | null;
        }>
      >("GET", "v2", "activities", { deal_id: String(dealId), limit: "100" });
      return (data ?? []).map((activity) => ({
        id: Number(activity.id),
        subject: String(activity.subject ?? ""),
        type: typeof activity.type === "string" ? activity.type : null,
        dueDate: typeof activity.due_date === "string" ? activity.due_date : null,
        dueTime: typeof activity.due_time === "string" ? activity.due_time : null,
        done: activity.done === true || activity.done === 1,
      }));
    },
    async createActivity(input) {
      const activity = await call<{ id: number }>("POST", "v2", "activities", {}, input);
      return { id: Number(activity.id) };
    },
    async deleteActivity(activityId) {
      await call<unknown>("DELETE", "v2", `activities/${activityId}`);
    },
    async createProject(input) {
      const proj = await call<{ id: number }>("POST", "v2", "projects", {}, {
        ...input,
      });
      return { id: Number(proj.id) };
    },
    async createTask(input) {
      // WIRE MAPPING (PSG-680): the v2 Tasks API assigns via `assignee_ids: number[]`, NOT
      // the singular `assignee_id`. Sending the singular field is SILENTLY IGNORED (proven
      // live: task returns `assignee_ids: []`), so provisioned boards land unassigned. We
      // keep the singular `assignee_id` as the internal contract (every call site passes
      // one owner) and translate to the array here — the one place the wire shape lives.
      const body = toV2TaskBody(input);
      const task = await call<{ id: number }>("POST", "v2", "tasks", {}, body);
      return { id: Number(task.id) };
    },
    async updateTask(taskId, patch) {
      // v2 `PATCH /tasks/{id}` — beta; this call site is the one place the shape lives.
      // Same `assignee_id` → `assignee_ids: [id]` translation as createTask (PSG-680).
      const task = await call<{ id: number }>(
        "PATCH",
        "v2",
        `tasks/${taskId}`,
        {},
        toV2TaskBody(patch),
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
    async updateDeal(dealId, patch) {
      // v1 `PUT /deals/{id}` is the stable deal-update endpoint already used by our
      // Pipedrive smoke path. Patch carries only the changed custom field.
      if (patchSetsHandoffCompleteYes(patch)) {
        const currentDeal = await call<Record<string, unknown>>(
          "GET",
          "v1",
          `deals/${dealId}`,
        );
        validateHandoffCompleteDealPatch(patch, currentDeal ?? {});
      }
      const deal = await call<{ id: number }>("PUT", "v1", `deals/${dealId}`, {}, patch);
      return { id: Number(deal.id) };
    },
    async updateOrganization(organizationId, patch) {
      // v1 `PUT /organizations/{id}` is the stable organization-update endpoint.
      const organization = await call<{ id: number }>(
        "PUT",
        "v1",
        `organizations/${organizationId}`,
        {},
        patch,
      );
      return { id: Number(organization.id) };
    },
    async createPhase(boardId, name, orderNr) {
      // v2 `POST /phases` (PSG-722). Board phases double as the project-card kanban columns
      // AND the task-grouping columns in a project's Tasks view — so creating the template's
      // phases here is what replaces Pipedrive's factory columns. `order_nr` is optional
      // (1..existing+1); omitted ⇒ Pipedrive appends. Idempotency is the caller's job
      // (`ensureBoardPhases` only creates a phase whose name is missing).
      const body: Record<string, unknown> = { board_id: boardId, name };
      if (orderNr != null) body.order_nr = orderNr;
      const phase = await call<{ id: number }>("POST", "v2", "phases", {}, body);
      return { id: Number(phase.id) };
    },
    async setTaskPhase(projectId, taskId, phaseId) {
      // v1 `PUT /projects/{id}/plan/tasks/{taskId}` `{ phase_id }` (PSG-722). This is the
      // ONLY way to set a task's phase — v2 `POST /tasks` ignores `phase_id`. Token rides
      // in the query string only (never logged); errors carry PATH + status, never the URL.
      await call<unknown>(
        "PUT",
        "v1",
        `projects/${projectId}/plan/tasks/${taskId}`,
        {},
        { phase_id: phaseId },
      );
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
    async listProjectTasks(projectId) {
      // v2 `GET /tasks?project_id` — the marker-guard read for the Asana import (PSG-644).
      const data = await call<
        Array<{ id: number; title?: string; description?: string }>
      >("GET", "v2", "tasks", { project_id: String(projectId), limit: "500" });
      return (data ?? []).map((t) => ({
        id: Number(t.id),
        title: String(t.title ?? ""),
        description: String(t.description ?? ""),
      }));
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
  /**
   * PSG-668 — override the project title. Defaults to `onboardingProjectTitle(deal)`
   * (the `Onboarding — …` prefix). The template selector passes a template-appropriate
   * title (e.g. `New Website Build — …`) so a non-onboarding board is not mislabeled.
   * Still deterministic per deal, so idempotency (title-based no-op on retry) is intact.
   */
  projectTitle?: string;
}

export interface ProvisionResult {
  created: boolean;
  projectId: number;
  phaseCount: number;
  taskCount: number;
  /** True when an existing project with the same title was found (no-op). */
  skippedExisting: boolean;
}

/**
 * Deterministic delivery-project title (`{prefix} — {client} (deal {id})`) so
 * re-delivery of the same won deal is a title-based no-op. `prefix` names the template
 * family (e.g. `Onboarding`, `New Website Build`); the deal id keeps it unique per deal.
 */
export function deliveryProjectTitle(prefix: string, deal: WonDeal): string {
  const client = (deal.orgName ?? "").trim() || deal.title.trim();
  return `${prefix.trim()} — ${client} (deal ${deal.id})`;
}

/** Deterministic onboarding project title (back-compat wrapper over `deliveryProjectTitle`). */
export function onboardingProjectTitle(deal: WonDeal): string {
  return deliveryProjectTitle("Onboarding", deal);
}

/**
 * PSG-722 — ensure a board carries one phase for each name in `phaseNames`, returning a
 * name → phaseId map. Existing phases are matched by exact (trimmed) name via `listPhases`;
 * any missing phase is created via `createPhase` (appended in template order). IDEMPOTENT:
 * a re-run finds every phase already present and creates nothing.
 *
 * Board-scoped by design (phases belong to a board, PSG-715): when several templates share
 * one fallback board, the board accumulates the union of their phases — each project's tasks
 * still land only in their own template's phases, and separate per-template boards (the
 * registry's `boardIdEnv`) give each a clean column set. Template phase names carry their
 * `P1 —`/`D1 —` prefix, so two templates on a shared board never collide on a name.
 *
 * Degrades gracefully for minimal test fakes: a client without `createPhase` simply returns
 * the map of whatever phases already exist (missing ones are skipped, not thrown).
 */
export async function ensureBoardPhases(
  client: PipedriveProjectsClient,
  boardId: number,
  phaseNames: readonly string[],
): Promise<Map<string, number>> {
  const existing = await client.listPhases(boardId);
  const byName = new Map<string, number>();
  for (const p of existing) {
    const key = p.name.trim();
    if (key !== "" && !byName.has(key)) byName.set(key, p.id);
  }
  let nextOrder = existing.length + 1;
  for (const raw of phaseNames) {
    const name = raw.trim();
    if (name === "" || byName.has(name)) continue;
    if (typeof client.createPhase !== "function") continue;
    const created = await client.createPhase(boardId, name, nextOrder);
    byName.set(name, created.id);
    nextOrder += 1;
  }
  return byName;
}

/**
 * Create the full onboarding delivery board for a won deal: one project, and each template
 * task created FLAT and stamped into its template phase (due dates = wonDate + offset). The
 * board's phase columns are ensured to match the template first (PSG-722 — this is what
 * replaces Pipedrive's factory columns and empties "Phase unassigned"). Idempotent: if a
 * project with the deterministic title already exists it is a no-op (`skippedExisting:true`)
 * so a webhook retry never double-creates; phase creation is idempotent by name.
 */
export async function provisionOnboardingBoard(
  opts: ProvisionOptions,
): Promise<ProvisionResult> {
  const { client, deal, boardId, phaseId } = opts;
  const template = opts.template ?? WHM_ONBOARDING_TEMPLATE;
  const roleUserMap = opts.roleUserMap ?? {};
  const title = opts.projectTitle ?? onboardingProjectTitle(deal);

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

  // Give the board this template's phase columns (idempotent by name), then stamp each task.
  const phaseMap = await ensureBoardPhases(
    client,
    boardId,
    template.map((p) => p.name),
  );

  let taskCount = 0;
  for (const phase of template) {
    const targetPhaseId = phaseMap.get(phase.name.trim());
    for (const t of phase.tasks) {
      const assignee = roleUserMap[t.owner];
      const task = await client.createTask({
        title: t.title,
        project_id: project.id,
        due_date: dueDateFor(deal.wonDate, t.dayOffset),
        description: `Owner: ${ROLE_LABELS[t.owner]} (${t.owner})${t.gate ? " · GATE" : ""}`,
        ...(assignee != null ? { assignee_id: assignee } : {}),
      });
      // Stamp into the template phase. Skipped only when the phase could not be resolved
      // (minimal test fake without createPhase) — prod always has a resolved id.
      if (targetPhaseId != null && typeof client.setTaskPhase === "function") {
        await client.setTaskPhase(project.id, task.id, targetPhaseId);
      }
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
