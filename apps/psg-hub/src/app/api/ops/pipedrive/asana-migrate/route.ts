import { timingSafeEqual } from "node:crypto";
import { NextResponse } from "next/server";
import {
  createProjectsClient,
  resolvePipedriveToken,
  PipedriveProjectsError,
} from "@/lib/pipedrive/projects";
import { createAsanaClient, resolveAsanaToken, AsanaClientError } from "@/lib/pipedrive/asana-client";
import { migrateClientOpenTasks } from "@/lib/pipedrive/asana-migrate";
import type { AssigneeMap } from "@/lib/pipedrive/asana-migration";

// PSG-644 — agent-runnable Asana → Pipedrive migration for ONE client at a time.
//
// The migration needs BOTH the Asana read token and the Pipedrive write token, which live
// in Vercel as SENSITIVE vars no agent can read. Rather than hand a human a local runbook,
// this server-side route uses the in-env tokens to run the migration end-to-end. It is the
// same fail-closed, secret-hygienic shape as the onboarding-setup route (PSG-591):
//   • Auth FIRST — a dedicated bearer secret `ASANA_MIGRATION_SECRET`, timing-safe.
//   • Never return/log either token, or any URL (they carry `?api_token=`).
//
// Actions (all take `asanaProjectGid` + `pipedriveProjectId`, plus optional `assigneeMap`):
//   • "dry-run"  → plan + archive only; ZERO writes. Returns exactly what WOULD be created.
//   • "migrate"  → real run: create open tasks (idempotent, marker-guarded), return evidence
//                  + the history-archive CSV for the caller to upload to Drive.
// runtime=nodejs is REQUIRED for node:crypto timingSafeEqual; a fleet client can have
// hundreds of open tasks + subtask/comment fan-out, so give the function timeout headroom.
export const runtime = "nodejs";
export const maxDuration = 300;

/** Timing-safe bearer check against ASANA_MIGRATION_SECRET. Unconfigured = locked. */
function authOk(request: Request): boolean {
  const secret = process.env.ASANA_MIGRATION_SECRET;
  if (!secret) return false; // fail closed
  const expected = `Bearer ${secret}`;
  const a = Buffer.from(request.headers.get("authorization") ?? "");
  const b = Buffer.from(expected);
  return a.length === b.length && timingSafeEqual(a, b);
}

/** Strip anything that could carry a secret (URLs, api_token) from a surfaced message. */
function scrub(message: string): string {
  return message
    .replace(/https?:\/\/\S+/gi, "[url]")
    .replace(/api_token=[^&\s"']*/gi, "api_token=[redacted]");
}

/** Coerce a JSON value to an array of non-empty trimmed strings (drops non-strings/blanks). */
function parseStringList(raw: unknown): string[] {
  if (!Array.isArray(raw)) return [];
  return raw
    .map((v) => (typeof v === "string" ? v.trim() : ""))
    .filter((v) => v.length > 0);
}

/** Coerce a JSON `assigneeMap` (asanaUserGid → pipedrive user id) to positive-int values. */
function parseAssigneeMap(raw: unknown): AssigneeMap {
  const map: AssigneeMap = {};
  if (raw && typeof raw === "object") {
    for (const [k, v] of Object.entries(raw as Record<string, unknown>)) {
      const id = Number(v);
      if (Number.isInteger(id) && id > 0) map[k] = id;
    }
  }
  return map;
}

export async function POST(request: Request): Promise<NextResponse> {
  // 1) Auth BEFORE reading any secret.
  if (!authOk(request)) {
    return NextResponse.json({ ok: false, reason: "unauthorized" }, { status: 401 });
  }
  // 2) Both tokens must be present (never returned/logged).
  if (!resolveAsanaToken()) {
    return NextResponse.json({ ok: false, reason: "asana_not_configured" }, { status: 503 });
  }
  if (!resolvePipedriveToken()) {
    return NextResponse.json({ ok: false, reason: "pipedrive_not_configured" }, { status: 503 });
  }

  let body: {
    action?: string;
    asanaProjectGid?: string;
    pipedriveProjectId?: number | string;
    assigneeMap?: Record<string, unknown>;
    clientLabel?: string;
    includeHistoryCsv?: boolean;
    excludeStaleRemnants?: boolean;
    excludeStaleTitles?: unknown;
    excludeGids?: unknown;
  };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ ok: false, reason: "bad_json" }, { status: 400 });
  }

  const action = body.action;
  if (action !== "dry-run" && action !== "migrate") {
    return NextResponse.json({ ok: false, reason: "unknown_action" }, { status: 400 });
  }

  const asanaProjectGid = (body.asanaProjectGid ?? "").toString().trim();
  const pipedriveProjectId = Number(body.pipedriveProjectId);
  if (!asanaProjectGid || !Number.isFinite(pipedriveProjectId)) {
    return NextResponse.json(
      { ok: false, reason: "asanaProjectGid_and_pipedriveProjectId_required" },
      { status: 400 },
    );
  }

  const companyDomain = process.env.PIPEDRIVE_COMPANY_DOMAIN ?? null;

  try {
    const asana = createAsanaClient();
    const pipedrive = createProjectsClient({ companyDomain });
    const result = await migrateClientOpenTasks({
      asana,
      pipedrive,
      asanaProjectGid,
      pipedriveProjectId,
      assigneeMap: parseAssigneeMap(body.assigneeMap),
      dryRun: action === "dry-run",
      clientLabel: (body.clientLabel ?? "").toString().trim() || null,
      excludeStaleRemnants: body.excludeStaleRemnants === true,
      excludeStaleTitles: parseStringList(body.excludeStaleTitles),
      excludeGids: parseStringList(body.excludeGids),
    });

    // The CSV can be large; include it only when asked (default: yes, so the archive
    // artifact is available to upload to Drive). Callers doing repeated dry-runs can omit.
    const includeCsv = body.includeHistoryCsv !== false;
    const payload = includeCsv ? result : { ...result, historyCsv: "[omitted]" };
    return NextResponse.json({ ok: true, result: payload });
  } catch (err) {
    const status =
      err instanceof PipedriveProjectsError || err instanceof AsanaClientError
        ? err.status
        : undefined;
    const reason =
      err instanceof AsanaClientError
        ? "asana_error"
        : err instanceof PipedriveProjectsError
          ? "pipedrive_error"
          : "internal_error";
    const detail = scrub(err instanceof Error ? err.message : "unknown");
    return NextResponse.json({ ok: false, reason, status, detail }, { status: 502 });
  }
}
