export const runtime = "nodejs";

import { timingSafeEqual } from "node:crypto";
import { NextResponse } from "next/server";
import {
  runNurturePublisher,
  supabaseNurturePublisherStore,
} from "@/lib/nurture/publisher";
import { createServiceClient } from "@/lib/supabase/service";

function secretMatches(presented: string, expected: string | undefined): boolean {
  if (!expected) return false;
  const a = Buffer.from(presented);
  const b = Buffer.from(expected);
  return a.length === b.length && timingSafeEqual(a, b);
}

function authorized(request: Request): boolean {
  const header = request.headers.get("authorization") ?? "";
  return secretMatches(
    header,
    process.env.CRON_SECRET ? `Bearer ${process.env.CRON_SECRET}` : undefined
  );
}

function parseLimit(request: Request): number | undefined {
  const raw = new URL(request.url).searchParams.get("limit");
  if (!raw) return undefined;
  const n = Number.parseInt(raw, 10);
  if (!Number.isFinite(n)) return undefined;
  return Math.min(Math.max(n, 1), 100);
}

async function handle(request: Request): Promise<NextResponse> {
  if (!authorized(request)) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  const service = createServiceClient();
  const result = await runNurturePublisher({
    store: supabaseNurturePublisherStore(service),
    limit: parseLimit(request),
  });
  return NextResponse.json({ ok: true, ...result });
}

export async function GET(request: Request): Promise<NextResponse> {
  return handle(request);
}

export async function POST(request: Request): Promise<NextResponse> {
  return handle(request);
}
