import { timingSafeEqual } from "node:crypto";
import { NextResponse } from "next/server";
import {
  createProjectsClient,
  createWebhooksClient,
  resolvePipedriveToken,
  PipedriveProjectsError,
} from "@/lib/pipedrive/projects";
import { runQaSmoke } from "@/lib/pipedrive/qa-smoke";
import { runRecurringQaSmoke } from "@/lib/pipedrive/recurring-qa-smoke";
import { runWebBuildQaSmoke } from "@/lib/pipedrive/web-build-qa-smoke";
import { runAssigneeAudit } from "@/lib/pipedrive/assignee-audit";
import { runAssigneeBackfill } from "@/lib/pipedrive/assignee-backfill";
import { runFlipDealsWon } from "@/lib/pipedrive/flip-deals-won";
import {
  activeRecurringAccounts,
  firstOfCurrentMonthUTC,
  resolveRecurringBoardConfig,
  runRecurringCycle,
} from "@/lib/pipedrive/recurring-accounts";
import { loadRoleUserMap } from "@/lib/pipedrive/role-user-map";
import { createServiceClient } from "@/lib/supabase/service";
import type { MirrorSupabase } from "@/lib/pipedrive/mirror";

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
// Secret hygiene (security-critical): never return or log the Pipedrive token, the webhook
// HTTP-Basic password, or any Pipedrive URL (they carry `?api_token=`). The Projects/
// webhooks clients already strip URLs from errors; we additionally scrub any reason we
// surface. runtime=nodejs is REQUIRED for node:crypto timingSafeEqual.
//
//   3. "qa-smoke" (PSG-597) → run the full live write-path E2E: create a clearly-labelled
//      test deal in the sales pipeline, win it, build the onboarding board through the REAL
//      Projects-v2 write path, verify the project + task tree, prove idempotency, then
//      delete the test project + deal. Returns structured evidence for QA sign-off. This is
//      the one code path that needs Pipedrive WRITE, which only the in-env token can do.
export const runtime = "nodejs";
// The qa-smoke path makes ~35 sequential Pipedrive calls plus a bounded cleanup re-scan;
// give it headroom beyond the default function timeout. (Ignored by discover/register.)
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
    runTag?: string;
    /** recurring-run: the org id of the single account to spawn a cycle-1 board for. */
    orgId?: number | string;
    /** backfill-assignees: false/absent ⇒ dry-run; true ⇒ actually PATCH assignees. */
    apply?: boolean;
    /** backfill-assignees: optional extra scope guard — only these project ids. */
    projectIds?: number[];
  };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ ok: false, reason: "bad_json" }, { status: 400 });
  }

  const companyDomain = process.env.PIPEDRIVE_COMPANY_DOMAIN ?? null;

  try {
    if (body.action === "qa-smoke") {
      // Board/phase to build the test board into come from the SAME env the live
      // webhook uses, so we exercise the real production configuration. The sales
      // pipeline defaults to 8 (Nick's pointer) when the scoping env is unset.
      const boardId = Number(process.env.PIPEDRIVE_ONBOARDING_BOARD_ID);
      const phaseId = Number(process.env.PIPEDRIVE_ONBOARDING_PHASE_ID);
      if (!Number.isFinite(boardId) || !Number.isFinite(phaseId)) {
        return NextResponse.json(
          { ok: false, reason: "board_not_configured" },
          { status: 503 },
        );
      }
      const salesPipelineId = process.env.PIPEDRIVE_SALES_PIPELINE_ID
        ? Number(process.env.PIPEDRIVE_SALES_PIPELINE_ID)
        : 8;
      const runTag =
        (typeof body.runTag === "string" && body.runTag.trim()) || `run-${Date.now()}`;
      const evidence = await runQaSmoke({
        boardId,
        phaseId,
        salesPipelineId,
        companyDomain,
        runTag,
      });
      return NextResponse.json({ ok: true, evidence });
    }

    if (body.action === "web-build-qa-smoke") {
      // PSG-673 / PSG-668 — live write-path smoke for the SHARED PROVISIONING ENGINE on
      // the New Website Build path. Fires a won deal with an injected web-build line item
      // through the REAL selector (`provisionForDeal`), proving the RIGHT board (4 phases /
      // 22 tasks, UX+QA owners → real users, day-offsets) is built. Board/phase come from
      // the SAME env the live webhook uses (onboarding fallback + optional WEBBUILD override).
      const boardId = Number(process.env.PIPEDRIVE_ONBOARDING_BOARD_ID);
      const phaseId = Number(process.env.PIPEDRIVE_ONBOARDING_PHASE_ID);
      if (!Number.isFinite(boardId) || !Number.isFinite(phaseId)) {
        return NextResponse.json(
          { ok: false, reason: "board_not_configured" },
          { status: 503 },
        );
      }
      const salesPipelineId = process.env.PIPEDRIVE_SALES_PIPELINE_ID
        ? Number(process.env.PIPEDRIVE_SALES_PIPELINE_ID)
        : 8;
      const runTag =
        (typeof body.runTag === "string" && body.runTag.trim()) || `run-${Date.now()}`;
      const evidence = await runWebBuildQaSmoke({
        defaultBoardId: boardId,
        defaultPhaseId: phaseId,
        salesPipelineId,
        companyDomain,
        // Prod role→user map (UX/QA env-backed, PSG-589/PSG-668) — proves live assignment.
        roleUserMap: loadRoleUserMap(),
        runTag,
      });
      return NextResponse.json({ ok: evidence.allChecksPass, evidence });
    }

    if (body.action === "recurring-qa-smoke") {
      // PSG-607 — live write-path smoke for the WHM monthly recurring board. Board/phase
      // come from the recurring env pair, defaulting to the onboarding board (PSG-606).
      const config = resolveRecurringBoardConfig();
      if (!config) {
        return NextResponse.json(
          { ok: false, reason: "board_not_configured" },
          { status: 503 },
        );
      }
      const runTag =
        (typeof body.runTag === "string" && body.runTag.trim()) || `run-${Date.now()}`;
      const evidence = await runRecurringQaSmoke({
        boardId: config.boardId,
        phaseId: config.phaseId,
        companyDomain,
        runTag,
      });
      return NextResponse.json({ ok: true, evidence });
    }

    if (body.action === "recurring-run") {
      // PSG-607 — manual cycle-1 spawn for ONE account by org id. Reads the active-accounts
      // set from the durable mirror, provisions just the matched account's monthly board.
      const orgId = Number(body.orgId);
      if (!Number.isFinite(orgId)) {
        return NextResponse.json(
          { ok: false, reason: "orgId_required" },
          { status: 400 },
        );
      }
      const config = resolveRecurringBoardConfig();
      if (!config) {
        return NextResponse.json(
          { ok: false, reason: "board_not_configured" },
          { status: 503 },
        );
      }
      const db = createServiceClient() as unknown as MirrorSupabase;
      const account = (await activeRecurringAccounts(db)).find((a) => a.orgId === orgId);
      if (!account) {
        return NextResponse.json(
          { ok: false, reason: "account_not_found" },
          { status: 404 },
        );
      }
      const client = createProjectsClient({ companyDomain });
      const result = await runRecurringCycle({
        client,
        accounts: [account],
        cycleStart: firstOfCurrentMonthUTC(),
        boardId: config.boardId,
        phaseId: config.phaseId,
        roleUserMap: loadRoleUserMap(),
      });
      return NextResponse.json(
        { ok: result.errored === 0, result },
        { status: result.errored > 0 ? 502 : 200 },
      );
    }

    if (body.action === "scan-assignees") {
      // PSG-686 — READ-ONLY audit. Until `80a14d5` (PSG-680) every auto-created delivery-
      // board task landed with no owner (v2 assigns via `assignee_ids: number[]`; the old
      // code sent the ignored singular `assignee_id`). This scans every live project's tasks
      // and reports any real (non-QA) board whose open leaf tasks have empty `assignee_ids`,
      // so we know whether any client board built during the unassigned window needs a
      // back-fill. It writes NOTHING — issues only GET requests.
      const evidence = await runAssigneeAudit({ companyDomain });
      return NextResponse.json({ ok: true, evidence });
    }

    if (body.action === "backfill-assignees") {
      // PSG-686 — GUARDED back-fill of task owners on delivery boards our provisioner built
      // during the pre-`80a14d5` unassigned window. Default is a DRY-RUN (plans the writes,
      // writes nothing); pass `{"apply": true}` to actually PATCH. Layered scope guards mean
      // only `(deal N)`-titled provisioner boards with role-tokened, ownerless, open leaf
      // tasks (whose role maps to a user) are ever touched — never a legacy/migrated board.
      // Optional `projectIds` narrows the scope further. Uses the provisioner's own
      // `loadRoleUserMap`. See PSG-687 evidence for why the broad scan must be scoped down.
      const projectIds = Array.isArray(body.projectIds)
        ? body.projectIds.map((n) => Number(n)).filter((n) => Number.isFinite(n))
        : undefined;
      const evidence = await runAssigneeBackfill({
        companyDomain,
        apply: body.apply === true,
        projectIds,
        roleUserMap: loadRoleUserMap(),
      });
      return NextResponse.json({ ok: evidence.failedCount === 0, evidence });
    }

    if (body.action === "flip-deals-won") {
      // PSG-824 (Group A of PSG-819, Nick-approved) — one-time records fix. Flips FIVE
      // hard-coded, mis-marked WHM monthly-maintenance deals to "won" so the recurring
      // engine can see them. The target deal ids live in the lib as a fixed allowlist —
      // this route passes NO deal ids from the request body, so it can only ever touch
      // those five deals. Idempotent (already-won deals are skipped), org-guarded, and it
      // writes ONLY the status (never the value — no inflated amounts).
      const evidence = await runFlipDealsWon({ companyDomain });
      return NextResponse.json(
        { ok: evidence.errored === 0, evidence },
        { status: evidence.errored > 0 ? 502 : 200 },
      );
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
