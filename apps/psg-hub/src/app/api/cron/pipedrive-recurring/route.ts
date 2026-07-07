import { timingSafeEqual } from "node:crypto";
import { NextResponse } from "next/server";
import { createServiceClient } from "@/lib/supabase/service";
import { createProjectsClient, resolvePipedriveToken } from "@/lib/pipedrive/projects";
import { loadRoleUserMap } from "@/lib/pipedrive/role-user-map";
import type { MirrorSupabase } from "@/lib/pipedrive/mirror";
import {
  firstOfCurrentMonthUTC,
  resolveRecurringBoardConfig,
  runRecurringCycle,
  selectRecurringAccounts,
} from "@/lib/pipedrive/recurring-accounts";

// PSG-607 — WHM monthly recurring-service trigger (builder = PSG-582).
// Vercel Cron fires GET monthly (`0 6 1 * *`) with `Authorization: Bearer ${CRON_SECRET}`;
// POST is the documented MANUAL cycle-1 path (same gate). The auth gate runs BEFORE any
// client construction or Pipedrive read — an unauthorized call spends zero API calls and
// never touches the token. Mirrors cron/pipedrive-sync/route.ts exactly.
//
// What it does per run: read the active client accounts from the durable deals mirror,
// then create one monthly recurring-service board per account (idempotent on the
// deterministic client+month title, so a re-fire is a safe no-op). Board/phase come from
// the recurring env pair, defaulting to the onboarding board (Ada's PSG-606 decision).
// Per-account failures are captured, not fatal: a non-zero `errored` returns 502 so cron
// alerts while still recording the accounts that succeeded.
//
// runtime=nodejs is REQUIRED: node:crypto timingSafeEqual + the service-role client.
export const runtime = "nodejs";
// Enumerates every active account and makes ~11 Pipedrive writes each — give headroom
// beyond the default function timeout.
export const maxDuration = 60;

function authorized(request: Request): boolean {
  const secret = process.env.CRON_SECRET;
  if (!secret) return false; // unconfigured = locked
  const header = request.headers.get("authorization") ?? "";
  const expected = `Bearer ${secret}`;
  const a = Buffer.from(header);
  const b = Buffer.from(expected);
  return a.length === b.length && timingSafeEqual(a, b);
}

async function handle(request: Request): Promise<NextResponse> {
  if (!authorized(request)) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  if (!resolvePipedriveToken()) {
    // Designed not-configured state — the write token lands via the operator task.
    return NextResponse.json({ error: "pipedrive_not_configured" }, { status: 503 });
  }

  const config = resolveRecurringBoardConfig();
  if (!config) {
    // Neither the recurring nor the onboarding board/phase env pair is set.
    return NextResponse.json({ error: "board_not_configured" }, { status: 503 });
  }

  // Service-role client reads the mirror (RLS bypassed for the cron job); narrow it to the
  // read seam the reader needs.
  const db = createServiceClient() as unknown as MirrorSupabase;
  // PSG-817: apply the pinned maintenance roster (Option A). When RECURRING_MAINTENANCE_ROSTER
  // is unset this is a no-op and the full derived fleet is provisioned exactly as before.
  // PSG-825: additionally union the no-won-deal supplement (RECURRING_MAINTENANCE_SUPPLEMENT).
  const selection = await selectRecurringAccounts(db);
  const roster = {
    rosterApplied: selection.rosterApplied,
    derivedTotal: selection.derivedTotal,
    selected: selection.accounts.length,
    excluded: selection.excluded.length,
    supplementApplied: selection.supplementApplied,
    supplementAdded: selection.supplementAdded.length,
  };
  // Audit trail (no silent truncation): record what the roster gate dropped and what the
  // supplement added this run.
  console.log("[pipedrive-recurring] roster gate", roster);

  const client = createProjectsClient({
    companyDomain: process.env.PIPEDRIVE_COMPANY_DOMAIN ?? null,
  });
  const cycleStart = firstOfCurrentMonthUTC();
  const result = await runRecurringCycle({
    client,
    accounts: selection.accounts,
    cycleStart,
    boardId: config.boardId,
    phaseId: config.phaseId,
    roleUserMap: loadRoleUserMap(),
  });

  // Any per-account failure is a 502 (not a 200) so the monthly cron alerts.
  return NextResponse.json({ ...result, roster }, { status: result.errored > 0 ? 502 : 200 });
}

export async function GET(request: Request): Promise<NextResponse> {
  return handle(request);
}

export async function POST(request: Request): Promise<NextResponse> {
  return handle(request);
}
