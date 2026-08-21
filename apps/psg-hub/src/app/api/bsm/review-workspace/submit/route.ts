export const runtime = "nodejs";

import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import {
  ReviewWorkspaceInputError,
  bsmReviewWorkspaceInternalEnabled,
  submitAssignedReviewerRound,
  submitGuestReviewRound,
} from "@/lib/bsm/review-workspace";

export async function POST(request: Request): Promise<Response> {
  if (!bsmReviewWorkspaceInternalEnabled()) {
    return NextResponse.json({ error: "Review workspace internal slice is not enabled." }, { status: 404 });
  }

  const payload = (await request.json().catch(() => null)) as Record<string, unknown> | null;
  if (!payload) return NextResponse.json({ error: "The request body was not readable." }, { status: 400 });

  try {
    const decisions = Array.isArray(payload.decisions) ? payload.decisions.map((decision) => decision as never) : [];
    let result;
    if (typeof payload.projectId === "string") {
      const supabase = await createClient();
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
      result = await submitAssignedReviewerRound({ projectId: payload.projectId, actorProfileId: user.id, decisions });
    } else {
      result = await submitGuestReviewRound({ sessionHash: payload.sessionHash as string, decisions });
    }
    return NextResponse.json({ result }, { status: 201, headers: { "Cache-Control": "private, no-store" } });
  } catch (error) {
    if (error instanceof ReviewWorkspaceInputError) {
      return NextResponse.json({ error: error.message }, { status: error.status });
    }
    return NextResponse.json({ error: "Could not submit this review round." }, { status: 500 });
  }
}
