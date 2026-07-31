export const runtime = "nodejs";

import { NextResponse } from "next/server";
import { requireOpsFn, requireSuperadmin } from "@/lib/auth/ops-access";
import {
  ReviewWorkspaceInputError,
  bsmReviewWorkspaceInternalEnabled,
  getStaffReviewWorkspaceResult,
  removeReviewWorkspaceProject,
} from "@/lib/bsm/review-workspace";

export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }): Promise<Response> {
  if (!bsmReviewWorkspaceInternalEnabled()) {
    return NextResponse.json({ error: "Review workspace internal slice is not enabled." }, { status: 404 });
  }

  const gate = await requireOpsFn("manage_bsm_content_approvals");
  if (!gate.ok) return gate.response;

  const { id } = await params;
  try {
    const result = await getStaffReviewWorkspaceResult(id, gate.userId, { actorRole: gate.access.role });
    return NextResponse.json({ result }, { headers: { "Cache-Control": "private, no-store" } });
  } catch (error) {
    if (error instanceof ReviewWorkspaceInputError) {
      return NextResponse.json({ error: error.message }, { status: error.status });
    }
    return NextResponse.json({ error: "Could not load the review workspace result." }, { status: 500 });
  }
}

export async function DELETE(request: Request, { params }: { params: Promise<{ id: string }> }): Promise<Response> {
  if (!bsmReviewWorkspaceInternalEnabled()) {
    return NextResponse.json({ error: "Review workspace internal slice is not enabled." }, { status: 404 });
  }

  const gate = await requireSuperadmin();
  if (!gate.ok) return gate.response;

  const { id } = await params;
  const payload = (await request.json().catch(() => null)) as Record<string, unknown> | null;

  try {
    const removal = await removeReviewWorkspaceProject({
      projectId: id,
      actorProfileId: gate.userId,
      actorRole: gate.access.role,
      reason: typeof payload?.reason === "string" ? payload.reason : null,
    });
    return NextResponse.json({ removal }, { headers: { "Cache-Control": "private, no-store" } });
  } catch (error) {
    if (error instanceof ReviewWorkspaceInputError) {
      return NextResponse.json({ error: error.message }, { status: error.status });
    }
    console.error(
      "[ops/bsm/review-workspace/projects] remove failed:",
      error instanceof Error ? error.message : error,
    );
    return NextResponse.json({ error: "Could not remove the review workspace." }, { status: 500 });
  }
}
