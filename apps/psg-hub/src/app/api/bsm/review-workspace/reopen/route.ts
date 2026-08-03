export const runtime = "nodejs";

import { NextResponse } from "next/server";
import {
  ReviewWorkspaceInputError,
  bsmReviewWorkspaceInternalEnabled,
  reopenGuestReviewRound,
} from "@/lib/bsm/review-workspace";

export async function POST(request: Request): Promise<Response> {
  if (!bsmReviewWorkspaceInternalEnabled()) {
    return NextResponse.json({ error: "Review workspace internal slice is not enabled." }, { status: 404 });
  }

  const payload = (await request.json().catch(() => null)) as Record<string, unknown> | null;
  if (!payload) return NextResponse.json({ error: "The request body was not readable." }, { status: 400 });

  try {
    const result = await reopenGuestReviewRound({
      sessionHash: payload.sessionHash as string,
    });
    return NextResponse.json({ result }, { headers: { "Cache-Control": "private, no-store" } });
  } catch (error) {
    if (error instanceof ReviewWorkspaceInputError) {
      return NextResponse.json({ error: error.message }, { status: error.status });
    }
    return NextResponse.json({ error: "Could not reopen this review round." }, { status: 500 });
  }
}
