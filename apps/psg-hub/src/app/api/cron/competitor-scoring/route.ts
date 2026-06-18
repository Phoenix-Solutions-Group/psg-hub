import { timingSafeEqual } from "node:crypto";
import { NextResponse } from "next/server";
import { createServiceClient } from "@/lib/supabase/service";
import { syncCompetitorScores } from "@/lib/intel/competitor/sync";

/**
 * 16-02: nightly competitor-scoring trigger. Vercel Cron fires GET (with
 * `Authorization: Bearer ${CRON_SECRET}`); POST is supported for manual/operator
 * triggers under the same gate, which runs BEFORE any work. This pass scores
 * competitors already in `competitors` and spends nothing — it is safe to run
 * before G5 clears. Live discovery of new competitors (web_grounded/Yext) is a
 * separate G5-gated step and is NOT invoked here.
 */

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
  const result = await syncCompetitorScores(service);
  return NextResponse.json(result);
}

export async function GET(request: Request): Promise<NextResponse> {
  return handle(request);
}

export async function POST(request: Request): Promise<NextResponse> {
  return handle(request);
}
