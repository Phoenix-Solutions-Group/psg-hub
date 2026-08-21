export const runtime = "nodejs";

import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import {
  ReviewWorkspaceInputError,
  bsmReviewWorkspaceInternalEnabled,
  getAssignedReviewerWorkspace,
  getGuestReviewWorkspace,
} from "@/lib/bsm/review-workspace";

export async function POST(request: Request): Promise<Response> {
  if (!bsmReviewWorkspaceInternalEnabled()) {
    return NextResponse.json({ error: "Review workspace internal slice is not enabled." }, { status: 404 });
  }

  const payload = (await request.json().catch(() => null)) as { projectId?: unknown; sessionHash?: unknown } | null;
  if (!payload) return NextResponse.json({ error: "The request body was not readable." }, { status: 400 });

  try {
    let workspace;
    if (typeof payload.projectId === "string") {
      const supabase = await createClient();
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
      workspace = await getAssignedReviewerWorkspace(payload.projectId, user.id);
    } else {
      workspace = await getGuestReviewWorkspace(payload.sessionHash as string);
    }
    return NextResponse.json({ workspace }, { headers: { "Cache-Control": "private, no-store" } });
  } catch (error) {
    if (error instanceof ReviewWorkspaceInputError) {
      return NextResponse.json({ error: error.message }, { status: error.status });
    }
    return NextResponse.json({ error: "Could not load the review workspace." }, { status: 500 });
  }
}
