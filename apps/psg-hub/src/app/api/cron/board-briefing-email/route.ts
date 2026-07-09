import { randomUUID, timingSafeEqual } from "node:crypto";
import { NextResponse } from "next/server";
import {
  BoardBriefingConfigError,
  BoardBriefingInputError,
  parseBoardBriefingPayload,
  sendBoardBriefing,
} from "@/lib/board-briefing/briefing";
import {
  claimBoardBriefingOutbox,
  markBoardBriefingOutboxSent,
} from "@/lib/board-briefing/outbox";
import { createServiceClient } from "@/lib/supabase/service";

// PSG-973 — Vercel-owned daily board briefing delivery.
//
// Vercel Cron fires GET with `Authorization: Bearer ${CRON_SECRET}`; POST is a
// manual/operator trigger on the same gate. The route reads pre-staged briefing
// content from Supabase, reuses the existing board-briefing renderer/sender, and
// never requires an agent-held copy of CRON_SECRET.
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

async function handle(request: Request): Promise<NextResponse> {
  if (!authorized(request)) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const service = createServiceClient();
  const claimToken = randomUUID();

  try {
    const row = await claimBoardBriefingOutbox(service, { claimToken });
    if (!row) {
      console.error("[board-briefing-email] no unsent briefing row available");
      return NextResponse.json({ error: "no_board_briefing_ready" }, { status: 503 });
    }

    const payload = parseBoardBriefingPayload({
      body: row.bodyMarkdown,
      briefingUrl: row.briefingUrl,
      subject: row.subject,
      generatedAt: row.generatedAt,
    });
    const result = await sendBoardBriefing(payload);
    await markBoardBriefingOutboxSent(service, row.id, claimToken, {
      messageId: result.messageId,
    });

    return NextResponse.json({
      ok: true,
      briefingDate: row.briefingDate,
      recipientCount: result.recipientCount,
      messageId: result.messageId,
    });
  } catch (error) {
    if (error instanceof BoardBriefingConfigError) {
      return NextResponse.json({ error: "board_briefing_not_configured" }, { status: 503 });
    }
    if (error instanceof BoardBriefingInputError) {
      console.error("[board-briefing-email] staged briefing row is invalid:", error);
      return NextResponse.json(
        { error: "invalid_staged_briefing", message: error.message },
        { status: 502 },
      );
    }

    console.error("[board-briefing-email] send failed:", error);
    return NextResponse.json({ error: "send_failed" }, { status: 502 });
  }
}

export async function GET(request: Request): Promise<NextResponse> {
  return handle(request);
}

export async function POST(request: Request): Promise<NextResponse> {
  return handle(request);
}
