import { timingSafeEqual } from "node:crypto";
import { NextResponse } from "next/server";
import {
  createProjectsClient,
  createWebhooksClient,
  provisionOnboardingBoard,
  resolvePipedriveToken,
  PipedriveProjectsError,
} from "@/lib/pipedrive/projects";

// PSG-591 Move 1 go-live helper — agent-runnable Pipedrive onboarding setup.
//
// Go-live (PSG-586) needs two Pipedrive API steps that require the write token, which
// lives in Vercel as a SENSITIVE var (`PIPEDRIVE_API_TOKEN`) no agent can read. Rather
// than hand a human a local-curl runbook (rule #1: never hand a human what an agent can
// do), this server-side route uses the in-env token to do both:
//   1. "discover" → list delivery boards and (optionally) a board's phases, so we can
//      pick the onboarding board + starting kanban phase to wire into env.
//   2. "register" → idempotently register the deal-won webhook that drives PSG-584.
//
// Auth (fail-closed, checked BEFORE any secret is read): a dedicated 32-byte bearer
// secret (`ONBOARDING_SETUP_SECRET`) compared timing-safe — same discipline as the
// Pipedrive webhook route's HTTP Basic check. This is deliberately NOT `requireSuperadmin`
// so an agent can trigger it by curl. The route does exactly this one onboarding setup.
//
//   3. "verify-e2e" (PSG-602) → the last QA sign-off step, run entirely server-side:
//      create a clearly-labelled throwaway deal in the sales pipeline, mark it Won, build
//      the onboarding board through the REAL Projects-v2 write path, prove idempotency,
//      read the project + task tree back for evidence, then delete the throwaway project
//      and deal. This is the one path that needs Pipedrive WRITE — only the in-env token
//      can do it, and QA (Tess) can neither read the token nor open a Pipedrive UI session.
//      It deletes ONLY the ids it just created in the same request (never an id from the
//      request body), so there is no new destructive surface an attacker could aim.
//
// Secret hygiene (security-critical): never return or log the Pipedrive token, the webhook
// HTTP-Basic password, or any Pipedrive URL (they carry `?api_token=`). The Projects/
// webhooks clients already strip URLs from errors; we additionally scrub any reason we
// surface. runtime=nodejs is REQUIRED for node:crypto timingSafeEqual.
export const runtime = "nodejs";
// verify-e2e makes ~65 sequential Pipedrive calls (deal + 2× 30-task provision + reads +
// cleanup); give it headroom beyond the default function timeout. (Ignored by the other
// actions, which are a handful of calls each.)
export const maxDuration = 60;

/** Timing-safe bearer check against ONBOARDING_SETUP_SECRET. Unconfigured = locked. */
function authOk(request: Request): boolean {
  const secret = process.env.ONBOARDING_SETUP_SECRET;
  if (!secret) return false; // unconfigured = locked (fail closed)
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

export async function POST(request: Request): Promise<NextResponse> {
  // 1) Auth FIRST, before reading any secret.
  if (!authOk(request)) {
    return NextResponse.json({ ok: false, reason: "unauthorized" }, { status: 401 });
  }
  // 2) Token guard (never returns/logs the token itself).
  if (!resolvePipedriveToken()) {
    return NextResponse.json(
      { ok: false, reason: "pipedrive_not_configured" },
      { status: 503 },
    );
  }

  let body: {
    action?: string;
    boardId?: number | string;
    phaseId?: number | string;
  };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ ok: false, reason: "bad_json" }, { status: 400 });
  }

  const companyDomain = process.env.PIPEDRIVE_COMPANY_DOMAIN ?? null;

  try {
    if (body.action === "verify-e2e") {
      // Board/phase/pipeline come from the SAME env the live webhook uses, so we exercise
      // the real production configuration. All three are required — 503 if any is unset.
      const boardId = Number(process.env.PIPEDRIVE_ONBOARDING_BOARD_ID);
      const phaseId = Number(process.env.PIPEDRIVE_ONBOARDING_PHASE_ID);
      const pipelineId = Number(process.env.PIPEDRIVE_SALES_PIPELINE_ID);
      if (
        !Number.isFinite(boardId) ||
        !Number.isFinite(phaseId) ||
        !Number.isFinite(pipelineId)
      ) {
        return NextResponse.json(
          { ok: false, reason: "verify_env_not_configured" },
          { status: 503 },
        );
      }

      // Day 0 = server today (UTC), matching the deal-won builder's date convention.
      const wonDate = new Date().toISOString().slice(0, 10);
      const client = createProjectsClient({ companyDomain });

      // Create + win the throwaway deal FIRST, then track its id so cleanup only ever
      // targets what THIS request created — never an id supplied by the caller.
      const dealTitle = `ZZZ QA E2E ${wonDate} — delete me`;
      const { id: dealId } = await client.createDeal({
        title: dealTitle,
        pipeline_id: pipelineId,
      });

      const deal = {
        id: dealId,
        title: dealTitle,
        orgName: "QA E2E Test",
        wonDate,
        pipelineId,
      };

      const cleanup = { projectDeleted: false, dealDeleted: false };
      let projectId = 0;
      let evidence:
        | {
            project: {
              id: number;
              title: string;
              board_id: number;
              phase_id: number;
              start_date: string;
            };
            counts: { phases: number; tasks: number; gates: number };
            idempotent: boolean;
            tasks: Array<{
              title: string;
              due_date: string | null;
              parent_task_id: number | null;
            }>;
          }
        | undefined;

      try {
        await client.updateDealStatus(dealId, "won");

        // Build the board through the real write path, then prove idempotency: a 2nd
        // provision of the SAME deal must be a no-op returning the same project.
        const first = await provisionOnboardingBoard({ client, deal, boardId, phaseId });
        projectId = first.projectId;
        const second = await provisionOnboardingBoard({ client, deal, boardId, phaseId });
        const idempotent =
          second.skippedExisting === true && second.projectId === first.projectId;

        // Read the built board back for QA evidence.
        const project = await client.getProject(projectId);
        const tasks = await client.listProjectTasks(projectId);
        const leaf = tasks.filter((t) => t.parent_task_id != null);
        const gates = tasks.filter((t) => t.title.includes("GATE")).length;

        evidence = {
          project: {
            id: project.id,
            title: project.title,
            board_id: project.board_id,
            phase_id: project.phase_id,
            start_date: project.start_date,
          },
          counts: { phases: first.phaseCount, tasks: first.taskCount, gates },
          idempotent,
          tasks: leaf.map((t) => ({
            title: t.title,
            due_date: t.due_date,
            parent_task_id: t.parent_task_id,
          })),
        };
      } finally {
        // ALWAYS runs — even if a read/assert above threw. Delete ONLY the ids this
        // request created; a failed delete is reported via its flag, never re-thrown
        // (so cleanup can't mask the real error, and a leaked artifact is visible).
        if (projectId) {
          try {
            await client.deleteProject(projectId);
            cleanup.projectDeleted = true;
          } catch {
            /* reported via cleanup.projectDeleted = false */
          }
        }
        try {
          await client.deleteDeal(dealId);
          cleanup.dealDeleted = true;
        } catch {
          /* reported via cleanup.dealDeleted = false */
        }
      }

      return NextResponse.json({ ok: true, ...evidence, cleanup });
    }

    if (body.action === "discover") {
      const client = createProjectsClient({ companyDomain });
      const boards = await client.listBoards();
      const boardId = body.boardId != null ? Number(body.boardId) : null;
      if (boardId != null && Number.isFinite(boardId)) {
        const phases = await client.listPhases(boardId);
        return NextResponse.json({ ok: true, boards, phases });
      }
      return NextResponse.json({ ok: true, boards });
    }

    if (body.action === "register") {
      const boardId = Number(body.boardId);
      const phaseId = Number(body.phaseId);
      if (!Number.isFinite(boardId) || !Number.isFinite(phaseId)) {
        return NextResponse.json(
          { ok: false, reason: "boardId_and_phaseId_required" },
          { status: 400 },
        );
      }
      const appUrl = (process.env.NEXT_PUBLIC_APP_URL ?? "").replace(/\/+$/, "");
      if (!appUrl) {
        return NextResponse.json(
          { ok: false, reason: "app_url_not_configured" },
          { status: 503 },
        );
      }
      const subscriptionUrl = `${appUrl}/api/webhooks/pipedrive`;
      const hooks = createWebhooksClient({ companyDomain });

      // Idempotent: reuse an existing webhook already pointed at our endpoint.
      const existing = (await hooks.list()).find(
        (w) => w.subscription_url === subscriptionUrl,
      );
      if (existing) {
        return NextResponse.json({
          ok: true,
          alreadyRegistered: true,
          id: existing.id,
          boardId,
          phaseId,
        });
      }

      const created = await hooks.create({
        subscriptionUrl,
        eventAction: "updated",
        eventObject: "deal",
        httpAuthUser: process.env.PIPEDRIVE_WEBHOOK_USER ?? null,
        httpAuthPass: process.env.PIPEDRIVE_WEBHOOK_PASS ?? null,
        version: "1.0",
      });
      return NextResponse.json({
        ok: true,
        alreadyRegistered: false,
        id: created.id,
        boardId,
        phaseId,
      });
    }

    return NextResponse.json(
      { ok: false, reason: "unknown_action" },
      { status: 400 },
    );
  } catch (err) {
    // Secret-free error surface: stable reason + upstream status, scrubbed message only.
    const status = err instanceof PipedriveProjectsError ? err.status : undefined;
    const reason =
      err instanceof PipedriveProjectsError ? "pipedrive_error" : "internal_error";
    const detail = scrub(err instanceof Error ? err.message : "unknown");
    return NextResponse.json({ ok: false, reason, status, detail }, { status: 502 });
  }
}
