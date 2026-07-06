import { timingSafeEqual } from "node:crypto";
import { NextResponse } from "next/server";
import {
  createProjectsClient,
  provisionOnboardingBoard,
  isDealWonTransition,
  type WonDeal,
} from "@/lib/pipedrive/projects";

// PSG-584 / PSG-576 Move 1 — Pipedrive deal-won webhook → auto-create delivery board.
//
// This is the NON-BROWSER path that unblocks Move 1: Pipedrive fires this webhook on
// every deal update; when the deal transitions INTO "won", we build the client's
// onboarding delivery board (project + phases + tasks from Noelle's confirmed template)
// straight through the Projects REST API. No Pipedrive UI, no browser tool.
//
// Security: the webhook is registered (via the API) with HTTP Basic auth
// (`http_auth_user`/`http_auth_password`). We verify that pair here with a timing-safe
// compare BEFORE doing any work — an unauthenticated call spends zero Pipedrive quota.
// Fail closed if the auth pair or write token is unconfigured.
//
// Ack policy: we return 200 for anything we successfully classify (including non-won
// updates) so Pipedrive does not retry-storm; only misconfiguration (500) and bad auth
// (401) are non-2xx. A provisioning error returns 502 so it surfaces in logs/retries.
//
// runtime=nodejs is REQUIRED for node:crypto timingSafeEqual.
export const runtime = "nodejs";

function basicAuthOk(request: Request): boolean {
  const user = process.env.PIPEDRIVE_WEBHOOK_USER;
  const pass = process.env.PIPEDRIVE_WEBHOOK_PASS;
  if (!user || !pass) return false; // unconfigured = locked
  const header = request.headers.get("authorization") ?? "";
  const expected = `Basic ${Buffer.from(`${user}:${pass}`).toString("base64")}`;
  const a = Buffer.from(header);
  const b = Buffer.from(expected);
  return a.length === b.length && timingSafeEqual(a, b);
}

/** Pipedrive v1 relates objects as a bare id or a nested `{ value, name }`. */
function relId(v: unknown): number | null {
  if (v == null) return null;
  if (typeof v === "object") {
    const n = Number((v as Record<string, unknown>).value);
    return Number.isFinite(n) ? n : null;
  }
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}
function relName(v: unknown): string | null {
  if (v && typeof v === "object") {
    const name = (v as Record<string, unknown>).name;
    return typeof name === "string" ? name : null;
  }
  return null;
}

/** Map the webhook's `current` deal object onto the WonDeal the builder needs. */
function toWonDeal(current: Record<string, unknown>): WonDeal | null {
  const id = Number(current.id);
  if (!Number.isFinite(id)) return null;
  const wonTime =
    typeof current.won_time === "string" && current.won_time.trim() !== ""
      ? current.won_time
      : typeof current.update_time === "string"
        ? current.update_time
        : null;
  return {
    id,
    title: typeof current.title === "string" ? current.title : `Deal ${id}`,
    orgName:
      (typeof current.org_name === "string" ? current.org_name : null) ??
      relName(current.org_id),
    orgId: relId(current.org_id),
    personId: relId(current.person_id),
    // Day 0 = won date; fall back to today (UTC) only if Pipedrive omits both stamps.
    wonDate: (wonTime ?? new Date().toISOString()).slice(0, 10),
  };
}

export async function POST(request: Request): Promise<NextResponse> {
  if (!basicAuthOk(request)) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  if (!process.env.PIPEDRIVE_API_KEY) {
    return NextResponse.json({ error: "pipedrive_not_configured" }, { status: 503 });
  }
  const boardId = Number(process.env.PIPEDRIVE_ONBOARDING_BOARD_ID);
  const phaseId = Number(process.env.PIPEDRIVE_ONBOARDING_PHASE_ID);
  if (!Number.isFinite(boardId) || !Number.isFinite(phaseId)) {
    // Board/phase must be discovered once (listBoards/listPhases) and set in env.
    console.error("[pipedrive-webhook] onboarding board/phase env not set");
    return NextResponse.json({ error: "board_not_configured" }, { status: 503 });
  }

  let payload: {
    current?: Record<string, unknown> | null;
    previous?: { status?: string } | null;
    event?: string;
    meta?: Record<string, unknown>;
  };
  try {
    payload = await request.json();
  } catch {
    return NextResponse.json({ error: "bad_json" }, { status: 400 });
  }

  if (!isDealWonTransition(payload)) {
    // Not a won transition — ack so Pipedrive does not retry.
    return NextResponse.json({ ok: true, skipped: "not_won_transition" });
  }

  const deal = payload.current ? toWonDeal(payload.current) : null;
  if (!deal) {
    return NextResponse.json({ ok: true, skipped: "no_deal" });
  }

  try {
    const client = createProjectsClient({
      companyDomain: process.env.PIPEDRIVE_COMPANY_DOMAIN ?? null,
    });
    const result = await provisionOnboardingBoard({ client, deal, boardId, phaseId });
    return NextResponse.json({ ok: true, ...result });
  } catch (err) {
    // Never log the error's cause verbatim (Pipedrive URLs carry the token); the
    // client already strips URLs from its messages, but be defensive here too.
    console.error(
      "[pipedrive-webhook] provisioning failed for deal",
      deal.id,
      err instanceof Error ? err.message : "unknown",
    );
    return NextResponse.json({ error: "provisioning_failed" }, { status: 502 });
  }
}
