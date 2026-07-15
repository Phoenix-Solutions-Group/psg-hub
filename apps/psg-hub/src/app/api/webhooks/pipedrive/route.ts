import { timingSafeEqual } from "node:crypto";
import { NextResponse } from "next/server";
import {
  createProjectsClient,
  isDealWonTransition,
  isDealPipelineInScope,
  dealPipelineId,
  resolvePipedriveToken,
  type WonDeal,
} from "@/lib/pipedrive/projects";
import { createPipedriveClient } from "@/lib/pipedrive/client";
import { provisionForDeal } from "@/lib/pipedrive/template-registry";
import { loadRoleUserMap } from "@/lib/pipedrive/role-user-map";
import { createServiceClient } from "@/lib/supabase/service";
import { enrollNurturePath } from "@/lib/nurture/enrollment";

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

function stageId(current: Record<string, unknown> | null | undefined): number | null {
  if (!current) return null;
  return relId(current.stage_id);
}

function dateFromDealTimestamp(current: Record<string, unknown>): string {
  const stamp =
    typeof current.update_time === "string" && current.update_time.trim() !== ""
      ? current.update_time
      : typeof current.add_time === "string" && current.add_time.trim() !== ""
        ? current.add_time
        : new Date().toISOString();
  return stamp.slice(0, 10);
}

function firstContactFieldKey(): string {
  return (process.env.PIPEDRIVE_FIRST_CONTACT_DATE_FIELD_KEY ?? "first_contact_date").trim();
}

function discoveryStageId(): number {
  const parsed = Number(process.env.PIPEDRIVE_DISCOVERY_STAGE_ID ?? "57");
  return Number.isFinite(parsed) ? parsed : 57;
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
    pipelineId: relId(current.pipeline_id),
    // Day 0 = won date; fall back to today (UTC) only if Pipedrive omits both stamps.
    wonDate: (wonTime ?? new Date().toISOString()).slice(0, 10),
  };
}

export async function POST(request: Request): Promise<NextResponse> {
  if (!basicAuthOk(request)) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  if (!resolvePipedriveToken()) {
    return NextResponse.json({ error: "pipedrive_not_configured" }, { status: 503 });
  }

  let payload: {
    current?: Record<string, unknown> | null;
    previous?: { status?: string; stage_id?: unknown } | null;
    event?: string;
    meta?: Record<string, unknown>;
  };
  try {
    payload = await request.json();
  } catch {
    return NextResponse.json({ error: "bad_json" }, { status: 400 });
  }

  // PSG-1472 — stamp First Contact Date the first time a sales deal reaches Discovery.
  // Idempotent: only writes when the configured field is blank in the webhook payload,
  // and a replay writes the same date value.
  const salesPipelineId = process.env.PIPEDRIVE_SALES_PIPELINE_ID
    ? Number(process.env.PIPEDRIVE_SALES_PIPELINE_ID)
    : null;
  const current = payload.current ?? null;
  const dealId = Number(current?.id);
  const firstContactKey = firstContactFieldKey();
  const currentStageId = stageId(current);
  const priorStageId = stageId(payload.previous ?? null);
  const shouldStampFirstContact =
    Number.isFinite(dealId) &&
    firstContactKey !== "" &&
    currentStageId === discoveryStageId() &&
    priorStageId !== currentStageId &&
    isDealPipelineInScope(current, salesPipelineId) &&
    (current?.[firstContactKey] == null || String(current[firstContactKey]).trim() === "");

  let firstContactStamp: "stamped" | "skipped" | "failed" = "skipped";
  if (shouldStampFirstContact) {
    try {
      const client = createProjectsClient({
        companyDomain: process.env.PIPEDRIVE_COMPANY_DOMAIN ?? null,
      });
      if (typeof client.updateDeal !== "function") {
        throw new Error("Pipedrive deal update client is unavailable");
      }
      await client.updateDeal(dealId, {
        [firstContactKey]: dateFromDealTimestamp(current!),
      });
      firstContactStamp = "stamped";
    } catch (stampErr) {
      firstContactStamp = "failed";
      console.error(
        "[pipedrive-webhook] first contact date stamp failed for deal",
        dealId,
        stampErr instanceof Error ? stampErr.message : "unknown",
      );
    }
  }

  if (!isDealWonTransition(payload)) {
    // Not a won transition — ack so Pipedrive does not retry.
    return NextResponse.json({
      ok: true,
      skipped: "not_won_transition",
      firstContactStamp,
    });
  }

  // Scope to the sales pipeline (pipeline 8, per Nick's PSG-584 pointer). PSG runs
  // multiple pipelines; only won deals in the sales pipeline should build a delivery
  // board. Env unset ⇒ scoping OFF (every won deal passes) — a safe default.
  if (!isDealPipelineInScope(payload.current ?? null, salesPipelineId)) {
    return NextResponse.json({
      ok: true,
      skipped: "out_of_scope_pipeline",
      pipelineId: dealPipelineId(payload.current ?? null),
      firstContactStamp,
    });
  }

  const deal = payload.current ? toWonDeal(payload.current) : null;
  if (!deal) {
    return NextResponse.json({ ok: true, skipped: "no_deal", firstContactStamp });
  }

  try {
    const boardId = Number(process.env.PIPEDRIVE_ONBOARDING_BOARD_ID);
    const phaseId = Number(process.env.PIPEDRIVE_ONBOARDING_PHASE_ID);
    if (!Number.isFinite(boardId) || !Number.isFinite(phaseId)) {
      // Board/phase must be discovered once (listBoards/listPhases) and set in env.
      console.error("[pipedrive-webhook] onboarding board/phase env not set");
      return NextResponse.json({ error: "board_not_configured" }, { status: 503 });
    }
    const client = createProjectsClient({
      companyDomain: process.env.PIPEDRIVE_COMPANY_DOMAIN ?? null,
    });
    const contactClient = createPipedriveClient({
      companyDomain: process.env.PIPEDRIVE_COMPANY_DOMAIN ?? null,
    });
    // Role→user map from env: any confirmed role auto-assigns its tasks; unmapped
    // roles stay unassigned (role in the title). Never throws on missing/bad values.
    const roleUserMap = loadRoleUserMap();
    // PSG-668 / PSG-678: build the RIGHT one-time board(s) from the deal's line items —
    // one project per DISTINCT delivery template sold. Falls back to a single onboarding
    // board (boardId/phaseId above) when the deal sold no delivery template or the product
    // read fails — no regression on today's onboarding behavior.
    const summary = await provisionForDeal({
      client,
      deal,
      defaultBoardId: boardId,
      defaultPhaseId: phaseId,
      roleUserMap,
    });
    let nurtureEnrollment: "enrolled" | "failed" = "enrolled";
    try {
      await enrollNurturePath(createServiceClient(), {
        trigger: "deal_won",
        triggerRef: `pipedrive:deal:${deal.id}:won`,
        contact: {},
        pipedriveDealId: deal.id,
        pipedrivePersonId: deal.personId,
        pipedriveOrgId: deal.orgId,
        pipedriveClient: contactClient,
      });
    } catch (nurtureErr) {
      nurtureEnrollment = "failed";
      console.error(
        "[pipedrive-webhook] nurture enrollment failed for won deal",
        deal.id,
        nurtureErr instanceof Error ? nurtureErr.message : "unknown",
      );
    }
    return NextResponse.json({ ok: true, ...summary, nurtureEnrollment, firstContactStamp });
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
