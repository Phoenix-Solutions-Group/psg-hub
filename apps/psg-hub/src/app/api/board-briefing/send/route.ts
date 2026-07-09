import { timingSafeEqual } from "node:crypto";
import { NextResponse } from "next/server";
import {
  BoardBriefingConfigError,
  BoardBriefingInputError,
  parseBoardBriefingPayload,
  sendBoardBriefing,
} from "@/lib/board-briefing/briefing";

export const runtime = "nodejs";

function authorized(request: Request): boolean {
  const secret = process.env.CRON_SECRET;
  if (!secret) return false;

  const header = request.headers.get("authorization") ?? "";
  const expected = `Bearer ${secret}`;
  const a = Buffer.from(header);
  const b = Buffer.from(expected);
  return a.length === b.length && timingSafeEqual(a, b);
}

export async function POST(request: Request): Promise<NextResponse> {
  if (!authorized(request)) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  let payload: unknown;
  try {
    payload = await request.json();
  } catch {
    return NextResponse.json({ error: "invalid_json" }, { status: 400 });
  }

  try {
    const result = await sendBoardBriefing(parseBoardBriefingPayload(payload));
    return NextResponse.json({ ok: true, ...result });
  } catch (error) {
    if (error instanceof BoardBriefingInputError) {
      return NextResponse.json({ error: "invalid_payload", message: error.message }, { status: 400 });
    }
    if (error instanceof BoardBriefingConfigError) {
      return NextResponse.json({ error: "board_briefing_not_configured" }, { status: 503 });
    }

    console.error("[board-briefing] send failed:", error);
    return NextResponse.json({ error: "send_failed" }, { status: 502 });
  }
}
