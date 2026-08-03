export const runtime = "nodejs";

import { NextResponse } from "next/server";
import { requireOpsFn } from "@/lib/auth/ops-access";
import {
  ReviewWorkspaceInputError,
  createReviewWorkspaceProject,
  createInternalReviewWorkspaceSlice,
  listStaffReviewWorkspaces,
  startReviewWorkspaceRound,
} from "@/lib/bsm/review-workspace";

export async function GET(): Promise<Response> {
  const gate = await requireOpsFn("manage_bsm_content_approvals");
  if (!gate.ok) return gate.response;

  try {
    const workspaces = await listStaffReviewWorkspaces(gate.userId, gate.access.role);
    return NextResponse.json({ workspaces }, { headers: { "Cache-Control": "private, no-store" } });
  } catch (error) {
    console.error(
      "[ops/bsm/review-workspace/projects] list failed:",
      error instanceof Error ? error.message : error,
    );
    return NextResponse.json({ error: "Could not list review workspaces." }, { status: 500 });
  }
}

export async function POST(request: Request): Promise<Response> {
  const gate = await requireOpsFn("manage_bsm_content_approvals");
  if (!gate.ok) return gate.response;

  const payload = (await request.json().catch(() => null)) as Record<string, unknown> | null;
  if (!payload) return NextResponse.json({ error: "The request body was not readable." }, { status: 400 });

  try {
    if (payload.action === "create_workspace") {
      const workspace = await createReviewWorkspaceProject({
        shopId: payload.shopId as string,
        title: payload.title as string,
        description: payload.description as string | null | undefined,
        actorProfileId: gate.userId,
        metadata: { feature: "content_approvals_workspace_first" },
      });
      return NextResponse.json({ workspace }, { status: 201, headers: { "Cache-Control": "private, no-store" } });
    }

    if (payload.action === "start_review") {
      const review = await startReviewWorkspaceRound({
        projectId: payload.projectId as string,
        actorProfileId: gate.userId,
        actorRole: gate.access.role,
        reviewers: Array.isArray(payload.reviewers)
          ? payload.reviewers.map((reviewer) => reviewer as { email: string; name?: string | null })
          : [],
      });
      return NextResponse.json({ review }, { status: 201, headers: { "Cache-Control": "private, no-store" } });
    }

    const slice = await createInternalReviewWorkspaceSlice({
      shopId: payload.shopId as string,
      title: payload.title as string,
      description: payload.description as string | null | undefined,
      actorProfileId: gate.userId,
      reviewerEmail: payload.reviewerEmail as string,
      reviewerName: payload.reviewerName as string | null | undefined,
      documents: Array.isArray(payload.documents)
        ? payload.documents.map((doc) => doc as never)
        : [],
    });

    return NextResponse.json({ slice }, { status: 201, headers: { "Cache-Control": "private, no-store" } });
  } catch (error) {
    if (error instanceof ReviewWorkspaceInputError) {
      return NextResponse.json({ error: error.message }, { status: error.status });
    }
    console.error(
      "[ops/bsm/review-workspace/projects] create failed:",
      error instanceof Error ? error.message : error,
    );
    return NextResponse.json({ error: "Could not create the internal review workspace." }, { status: 500 });
  }
}
