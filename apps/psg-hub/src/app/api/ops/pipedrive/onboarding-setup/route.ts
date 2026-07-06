import { timingSafeEqual } from "node:crypto";
import { NextResponse } from "next/server";
import {
  createProjectsClient,
  createWebhooksClient,
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
// Secret hygiene (security-critical): never return or log the Pipedrive token, the webhook
// HTTP-Basic password, or any Pipedrive URL (they carry `?api_token=`). The Projects/
// webhooks clients already strip URLs from errors; we additionally scrub any reason we
// surface. runtime=nodejs is REQUIRED for node:crypto timingSafeEqual.
export const runtime = "nodejs";

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
