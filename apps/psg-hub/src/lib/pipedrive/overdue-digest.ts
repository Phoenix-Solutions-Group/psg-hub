// PSG-643 — Cross-client weekly "who's behind?" overdue digest.
//
// Business outcome: staff should never have to open 88 client boards by hand to find
// out which clients are behind on their monthly maintenance work. This module reads
// every task across all client projects from the Pipedrive Projects API (v2),
// keeps only the ones that are BEHIND (not done + past their due date), groups them
// by client → which step is behind, and hands the composed digest to a deliverer
// (operator log lines + staff email). Read-only: it only issues GET requests and
// never writes to Pipedrive.
//
// Design split (so the accuracy of the filter is unit-testable — this digest is a
// pilot QA check for Tess):
//   • createOverdueDigestClient — the thin read-only v2 adapter (GET tasks/projects).
//   • isTaskOverdue / buildOverdueDigestReport — PURE functions, no I/O, no clock.
//   • formatDigest{Text,Html,Subject} — pure rendering of a report.
//   • buildDigestDeliverer — composes log + (injected) email sender; no server-only
//     imports, so the whole module unit-tests without a real mail client.
//   • runOverdueDigest — the orchestrator the cron route calls.
//
// v2 Tasks API note: Pipedrive Projects API v2 (shipped 2026-05-21) is the correct,
// future-proof target (legacy v1 `projects/*` is removed 2026-07-31). Tasks are
// cursor-paginated and expose `project_id`, `parent_task_id`, `due_date`, and `done`.
// We fetch tasks GLOBALLY (one paginated sweep, no per-project fan-out) and join to
// project titles, which is far cheaper than N+1 calls across ~88 boards.

import type { MailMessage } from "@/lib/mail/types";
import {
  PipedriveProjectsError,
  pipedriveBaseUrl,
  resolvePipedriveToken,
} from "./projects";

// ── thin read-only v2 adapter ─────────────────────────────────────────────────────

/** A Pipedrive project task, narrowed to the fields the digest needs. */
export interface DigestTask {
  id: number;
  title: string;
  /** Project the task belongs to (null only on malformed rows). */
  projectId: number | null;
  /** The phase parent task, when the task is a leaf step under a D-phase. */
  parentTaskId: number | null;
  /** `YYYY-MM-DD` or null when the task has no due date. */
  dueDate: string | null;
  /** Whether the task is complete. v2 sends a boolean; 0/1 are coerced defensively. */
  done: boolean;
}

/** A Pipedrive project (client delivery board), narrowed to what the digest needs. */
export interface DigestProject {
  id: number;
  title: string;
  boardId: number | null;
}

export interface OverdueDigestClient {
  /** Every task across all projects (cursor-paginated GET /api/v2/tasks). */
  listAllTasks(): Promise<DigestTask[]>;
  /** Every project (cursor-paginated GET /api/v2/projects), for id→title mapping. */
  listAllProjects(): Promise<DigestProject[]>;
}

export interface OverdueDigestClientConfig {
  /** Read token; defaults to resolvePipedriveToken() (PIPEDRIVE_API_TOKEN + aliases). */
  apiKey?: string;
  companyDomain?: string | null;
  /** Injectable fetch (defaults to global fetch) — the seam unit tests mock. */
  fetchImpl?: typeof fetch;
  /** Hard cap on paginated pages (defensive; 88 boards × ~30 tasks fit well under this). */
  maxPages?: number;
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
/** Coerce Pipedrive's `done` (boolean, or legacy 0/1/"1") to a strict boolean. */
function bool(v: unknown): boolean {
  if (typeof v === "boolean") return v;
  if (typeof v === "number") return v !== 0;
  if (typeof v === "string") return v === "1" || v.toLowerCase() === "true";
  return false;
}

function toDigestTask(t: unknown): DigestTask {
  const r = asRecord(t);
  return {
    id: num(r.id) ?? 0,
    title: str(r.title) ?? "",
    projectId: num(r.project_id),
    // NB: num(null) is 0 (finite); preserve null so leaf/parent grouping stays honest.
    parentTaskId: r.parent_task_id == null ? null : num(r.parent_task_id),
    // Pipedrive returns full ISO timestamps or plain dates — keep the date only.
    dueDate: (str(r.due_date) ?? "").slice(0, 10) || null,
    done: bool(r.done),
  };
}

function toDigestProject(p: unknown): DigestProject {
  const r = asRecord(p);
  return {
    id: num(r.id) ?? 0,
    title: str(r.title) ?? "",
    boardId: num(r.board_id),
  };
}

export function createOverdueDigestClient(
  config: OverdueDigestClientConfig = {},
): OverdueDigestClient {
  const apiKey = config.apiKey ?? resolvePipedriveToken();
  if (!apiKey) {
    throw new PipedriveProjectsError("Missing Pipedrive token for overdue digest");
  }
  const base = pipedriveBaseUrl(config.companyDomain);
  const doFetch = config.fetchImpl ?? fetch;
  const maxPages = config.maxPages ?? 200;

  function url(path: string, params: Record<string, string>): string {
    const u = new URL(`${base}/api/v2/${path}`);
    for (const [k, v] of Object.entries(params)) u.searchParams.set(k, v);
    u.searchParams.set("api_token", apiKey);
    return u.toString();
  }

  /** GET a cursor-paginated v2 list, mapping each row. Read-only; never logs the URL. */
  async function listAll<T>(path: string, map: (row: unknown) => T): Promise<T[]> {
    const out: T[] = [];
    let cursor: string | null = null;
    for (let page = 0; page < maxPages; page++) {
      const params: Record<string, string> = { limit: "500" };
      if (cursor) params.cursor = cursor;
      const res = await doFetch(url(path, params), { headers: { Accept: "application/json" } });
      if (!res.ok) {
        // NEVER include the URL (carries ?api_token=) in the error message.
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
      for (const row of (payload.data as unknown[]) ?? []) out.push(map(row));
      cursor = str(asRecord(payload.additional_data).next_cursor);
      if (!cursor) break;
    }
    return out;
  }

  return {
    listAllTasks: () => listAll("tasks", toDigestTask),
    listAllProjects: () => listAll("projects", toDigestProject),
  };
}

// ── pure filter + report builder ──────────────────────────────────────────────────

/** One behind-schedule step under a client, in the composed digest. */
export interface OverdueStep {
  taskId: number;
  /** The task title — the step that is behind. */
  step: string;
  /** The past due date (`YYYY-MM-DD`). */
  dueDate: string;
  /** Whole days between the due date and `asOf` (>= 1 for anything overdue). */
  daysOverdue: number;
}

/** One client (project) with its behind steps, in the composed digest. */
export interface ClientOverdue {
  projectId: number;
  client: string;
  /** Behind steps, most-overdue first. */
  steps: OverdueStep[];
  /** Largest daysOverdue in the group — used to rank clients. */
  worstDaysOverdue: number;
}

export interface OverdueDigestReport {
  /** The reference date the digest was computed against (`YYYY-MM-DD`). */
  asOf: string;
  totalOverdue: number;
  clientsBehind: number;
  /** Clients with behind work, worst-behind first. */
  clients: ClientOverdue[];
  /** True when nothing is overdue — drives the "all caught up" (no-spam) path. */
  allCaughtUp: boolean;
}

/** Parse a `YYYY-MM-DD` (or ISO timestamp) to a UTC-midnight epoch ms, or null. */
function dateMs(value: string | null): number | null {
  if (!value) return null;
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(value);
  if (!m) return null;
  return Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
}

/** `Date` → `YYYY-MM-DD` in UTC (matches how Pipedrive dates compare). */
export function toIsoDate(d: Date): string {
  return d.toISOString().slice(0, 10);
}

/**
 * The single, explicit overdue predicate (the pilot-QA-critical rule): a task is
 * behind iff it is NOT done AND has a due date that falls strictly before `asOf`.
 * A task with no due date, or due today/in the future, is not overdue. Kept pure and
 * exported so Tess can test the boundary directly.
 */
export function isTaskOverdue(task: DigestTask, asOf: Date): boolean {
  if (task.done) return false;
  const due = dateMs(task.dueDate);
  if (due == null) return false;
  return due < dateMs(toIsoDate(asOf))!;
}

const DAY_MS = 86_400_000;

/**
 * Compose the digest from a flat task list + the project catalog. Pure: no I/O, no
 * clock — the caller supplies `asOf`. Tasks whose project is unknown are still
 * surfaced (labelled `Project #<id>`) so no behind work is silently dropped; tasks
 * with no project id at all are skipped (they are not client delivery work).
 */
export function buildOverdueDigestReport(
  tasks: DigestTask[],
  projects: DigestProject[],
  asOf: Date,
): OverdueDigestReport {
  const asOfIso = toIsoDate(asOf);
  const asOfMs = dateMs(asOfIso)!;
  const titleById = new Map<number, string>();
  for (const p of projects) titleById.set(p.id, p.title);

  const byProject = new Map<number, OverdueStep[]>();
  for (const task of tasks) {
    if (task.projectId == null) continue;
    if (!isTaskOverdue(task, asOf)) continue;
    const dueMs = dateMs(task.dueDate)!;
    const step: OverdueStep = {
      taskId: task.id,
      step: task.title || `Task #${task.id}`,
      dueDate: task.dueDate!.slice(0, 10),
      daysOverdue: Math.floor((asOfMs - dueMs) / DAY_MS),
    };
    const list = byProject.get(task.projectId);
    if (list) list.push(step);
    else byProject.set(task.projectId, [step]);
  }

  const clients: ClientOverdue[] = [];
  let totalOverdue = 0;
  for (const [projectId, steps] of byProject) {
    steps.sort((a, b) => b.daysOverdue - a.daysOverdue || a.step.localeCompare(b.step));
    totalOverdue += steps.length;
    clients.push({
      projectId,
      client: titleById.get(projectId) || `Project #${projectId}`,
      steps,
      worstDaysOverdue: steps[0]?.daysOverdue ?? 0,
    });
  }
  // Worst-behind clients first; tie-break by name so ordering is deterministic.
  clients.sort(
    (a, b) => b.worstDaysOverdue - a.worstDaysOverdue || a.client.localeCompare(b.client),
  );

  return {
    asOf: asOfIso,
    totalOverdue,
    clientsBehind: clients.length,
    clients,
    allCaughtUp: clients.length === 0,
  };
}

// ── rendering ─────────────────────────────────────────────────────────────────────

const ALL_CAUGHT_UP_LINE = "✅ All caught up — no clients are behind on their monthly work.";

export function formatDigestSubject(report: OverdueDigestReport): string {
  if (report.allCaughtUp) return `Weekly overdue digest (${report.asOf}) — all caught up`;
  const clientWord = report.clientsBehind === 1 ? "client" : "clients";
  return `Weekly overdue digest (${report.asOf}) — ${report.clientsBehind} ${clientWord} behind, ${report.totalOverdue} step(s)`;
}

export function formatDigestText(report: OverdueDigestReport): string {
  const lines: string[] = [];
  lines.push(`Weekly overdue digest — as of ${report.asOf}`);
  lines.push("");
  if (report.allCaughtUp) {
    lines.push(ALL_CAUGHT_UP_LINE);
    return lines.join("\n");
  }
  lines.push(
    `${report.clientsBehind} client(s) behind on ${report.totalOverdue} monthly step(s):`,
  );
  lines.push("");
  for (const c of report.clients) {
    lines.push(`• ${c.client} — ${c.steps.length} step(s) behind:`);
    for (const s of c.steps) {
      const dayWord = s.daysOverdue === 1 ? "day" : "days";
      lines.push(`    - ${s.step} (due ${s.dueDate}, ${s.daysOverdue} ${dayWord} overdue)`);
    }
  }
  return lines.join("\n");
}

function esc(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

export function formatDigestHtml(report: OverdueDigestReport): string {
  if (report.allCaughtUp) {
    return `<h2>Weekly overdue digest — ${esc(report.asOf)}</h2><p>${esc(ALL_CAUGHT_UP_LINE)}</p>`;
  }
  const parts: string[] = [];
  parts.push(`<h2>Weekly overdue digest — ${esc(report.asOf)}</h2>`);
  parts.push(
    `<p><strong>${report.clientsBehind}</strong> client(s) behind on <strong>${report.totalOverdue}</strong> monthly step(s):</p>`,
  );
  for (const c of report.clients) {
    parts.push(`<h3>${esc(c.client)} — ${c.steps.length} step(s) behind</h3>`);
    parts.push("<ul>");
    for (const s of c.steps) {
      const dayWord = s.daysOverdue === 1 ? "day" : "days";
      parts.push(
        `<li>${esc(s.step)} — due ${esc(s.dueDate)}, <strong>${s.daysOverdue} ${dayWord} overdue</strong></li>`,
      );
    }
    parts.push("</ul>");
  }
  return parts.join("\n");
}

// ── delivery + orchestration ──────────────────────────────────────────────────────

/** Delivers a composed digest to staff. Returns the list of channels used. */
export type DigestDeliverer = (report: OverdueDigestReport) => Promise<string[]>;

/** Split a comma/whitespace-separated recipient env string into clean addresses. */
export function parseRecipients(raw: string | undefined | null): string[] {
  if (!raw) return [];
  return raw
    .split(/[,;\s]+/)
    .map((s) => s.trim())
    .filter((s) => s.includes("@"));
}

export interface DelivererDeps {
  /**
   * Injected mail sender (the route passes the real SendGrid `sendEmail`). When
   * omitted, delivery degrades to log-only — the digest is never lost.
   */
  sendEmail?: (message: MailMessage) => Promise<unknown>;
  /** Staff recipients; when empty, email is skipped (log-only, no noisy misfires). */
  recipients: string[];
  /** Structured log sink (defaults to console). Matches the analytics-health pattern. */
  log?: (line: string) => void;
  /** Sender identity; defaults to SENDGRID_FROM_EMAIL at the mail layer. */
  from?: string;
}

/**
 * Compose the operator-log + email deliverer. Always emits operator-visible
 * `[overdue-digest]` lines (the established staff-notification pattern the analytics
 * crons use); additionally sends a staff email when a sender + recipients are wired.
 * A failed email does NOT throw — the log lines are the durable signal and the cron
 * must not flap on a mail outage.
 */
export function buildDigestDeliverer(deps: DelivererDeps): DigestDeliverer {
  const log = deps.log ?? ((line: string) => console.log(line));
  return async (report) => {
    const channels: string[] = [];

    // 1) Operator-visible log lines (always).
    if (report.allCaughtUp) {
      log(`[overdue-digest] ok ${report.asOf}: all caught up, 0 clients behind`);
    } else {
      log(
        `[overdue-digest] ALERT ${report.asOf}: ${report.clientsBehind} client(s) behind, ${report.totalOverdue} step(s)`,
      );
      for (const c of report.clients) {
        log(
          `[overdue-digest] BEHIND ${c.client}: ${c.steps.length} step(s), worst ${c.worstDaysOverdue}d — ${c.steps
            .map((s) => `${s.step} (${s.daysOverdue}d)`)
            .join("; ")}`,
        );
      }
    }
    channels.push("log");

    // 2) Staff email (only when wired). Never spam an empty "all caught up" blast
    //    to a large list is acceptable here — a weekly "all clear" is a feature, not
    //    noise — but we still require an explicit recipient list to send anything.
    if (deps.sendEmail && deps.recipients.length > 0) {
      try {
        await deps.sendEmail({
          to: deps.recipients,
          from: deps.from,
          subject: formatDigestSubject(report),
          text: formatDigestText(report),
          html: formatDigestHtml(report),
          // Digest has no click-through links; leave account tracking default untouched.
        });
        channels.push("email");
      } catch (error) {
        // Log-only fallback: the operator lines above already carry the full digest.
        const msg = error instanceof Error ? error.message : String(error);
        log(`[overdue-digest] email delivery failed (log-only fallback): ${msg}`);
      }
    }

    return channels;
  };
}

export interface RunOverdueDigestResult {
  ok: boolean;
  asOf: string;
  totalOverdue: number;
  clientsBehind: number;
  allCaughtUp: boolean;
  /** Channels the digest was delivered on (e.g. ["log", "email"]). */
  delivered: string[];
  /** Present only on a captured failure (Pipedrive read error). */
  error?: string;
}

export interface RunOverdueDigestOptions {
  client: OverdueDigestClient;
  /** Reference "today" for the overdue math; defaults to the current date. */
  asOf?: Date;
  deliver: DigestDeliverer;
}

/**
 * End-to-end weekly digest run the cron route invokes: read all tasks + projects,
 * compose the report, deliver it. A Pipedrive read failure is captured into a
 * `{ ok: false }` result (the route maps that to a 502 so the cron alerts) rather
 * than thrown, so partial delivery state is always reported.
 */
export async function runOverdueDigest(
  opts: RunOverdueDigestOptions,
): Promise<RunOverdueDigestResult> {
  const asOf = opts.asOf ?? new Date();
  try {
    const [tasks, projects] = await Promise.all([
      opts.client.listAllTasks(),
      opts.client.listAllProjects(),
    ]);
    const report = buildOverdueDigestReport(tasks, projects, asOf);
    const delivered = await opts.deliver(report);
    return {
      ok: true,
      asOf: report.asOf,
      totalOverdue: report.totalOverdue,
      clientsBehind: report.clientsBehind,
      allCaughtUp: report.allCaughtUp,
      delivered,
    };
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    return {
      ok: false,
      asOf: toIsoDate(asOf),
      totalOverdue: 0,
      clientsBehind: 0,
      allCaughtUp: false,
      delivered: [],
      error: msg,
    };
  }
}
