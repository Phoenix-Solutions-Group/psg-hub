import { timingSafeEqual } from "node:crypto";
import { NextResponse } from "next/server";
import { createServiceClient } from "@/lib/supabase/service";
import { syncSemrushSnapshots } from "@/lib/semrush/sync";

/**
 * 09-03: SEMrush ingest trigger. Vercel Cron fires GET (with
 * `Authorization: Bearer ${CRON_SECRET}` when CRON_SECRET is set); POST is
 * supported for manual/operator triggers with the same gate. The gate runs
 * BEFORE any client construction — an unauthorized call spends zero API units.
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

  const apiKey = process.env.SEMRUSH_API_KEY;
  if (!apiKey) {
    // Designed not-configured state — the prod key lands at the Phase-9 gate batch.
    return NextResponse.json(
      { error: "semrush_not_configured" },
      { status: 503 }
    );
  }

  const service = createServiceClient();
  const result = await syncSemrushSnapshots(service, { apiKey });
  return NextResponse.json(result);
}

export async function GET(request: Request): Promise<NextResponse> {
  return handle(request);
}

export async function POST(request: Request): Promise<NextResponse> {
  return handle(request);
}
