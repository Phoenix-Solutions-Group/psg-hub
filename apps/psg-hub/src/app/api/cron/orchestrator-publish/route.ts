// v1.x / Wave 2 (G-a) — autonomous orchestrator: publish-approved cron.
// Vercel Cron fires GET (with `Authorization: Bearer ${CRON_SECRET}`); POST is
// supported for manual/operator triggers under the SAME gate, which runs BEFORE
// any work — an unauthorized call does zero DB reads and zero vendor spend.
//
// This pass publishes the items a human has ALREADY approved (approval_queue rows
// with status `approved`) through the registered publisher for each action_type.
// It touches ONLY `approved` rows, so an un-approved (`pending`) proposal can
// never be published by the loop. The pass is budget-capped and auto-pauses at
// the cap. The default publisher records the publish internally (no external
// send); real GBP / content publishers are injected by the G-b/c capabilities.
//
// runtime=nodejs: the orchestrator + approval-queue store are server-only.
export const runtime = "nodejs";

import { timingSafeEqual } from "node:crypto";
import { NextResponse } from "next/server";
import { createServiceClient } from "@/lib/supabase/service";
import { runPublishApproved } from "@/lib/agents/orchestrator";

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
  const service = createServiceClient();
  const result = await runPublishApproved(service);
  return NextResponse.json(result);
}

export async function GET(request: Request): Promise<NextResponse> {
  return handle(request);
}

export async function POST(request: Request): Promise<NextResponse> {
  return handle(request);
}
