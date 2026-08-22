export const runtime = "nodejs";

import { NextResponse } from "next/server";
import { requireOpsFn, requireSuperadmin } from "@/lib/auth/ops-access";
import { createServiceClient } from "@/lib/supabase/service";
import {
  ReviewWorkspaceInputError,
  addReviewWorkspaceCollaborator,
  addStaffReviewAnnotation,
  addStaffThreadReply,
  closeReviewWorkspaceRoundEarly,
  getStaffReviewWorkspaceResult,
  removeReviewWorkspaceProject,
  revokeReviewWorkspaceInvitation,
  setStaffThreadStatus,
  updateReviewWorkspaceProject,
} from "@/lib/bsm/review-workspace";

export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }): Promise<Response> {
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

export async function PATCH(request: Request, { params }: { params: Promise<{ id: string }> }): Promise<Response> {
  const gate = await requireOpsFn("manage_bsm_content_approvals");
  if (!gate.ok) return gate.response;

  const { id } = await params;
  const payload = (await request.json().catch(() => null)) as Record<string, unknown> | null;
  try {
    if (payload?.action === "add_collaborator") {
      const email = typeof payload.email === "string" ? payload.email.trim().toLowerCase() : "";
      if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
        throw new ReviewWorkspaceInputError(400, "Enter a valid PSG collaborator email");
      }
      const service = createServiceClient();
      // ponytail: one auth page covers current PSG scale; paginate when the account directory exceeds 1,000 users.
      const { data, error } = await service.auth.admin.listUsers({ page: 1, perPage: 1000 });
      if (error) throw new Error(`Could not resolve PSG collaborator: ${error.message}`);
      const user = data.users.find((candidate) => candidate.email?.trim().toLowerCase() === email);
      if (!user) throw new ReviewWorkspaceInputError(404, "PSG collaborator not found");
      const collaborator = await addReviewWorkspaceCollaborator({
        projectId: id,
        collaboratorProfileId: user.id,
        actorProfileId: gate.userId,
        actorRole: gate.access.role,
      });
      return NextResponse.json({ collaborator }, { status: 201, headers: { "Cache-Control": "private, no-store" } });
    }
    if (payload?.action === "update_workspace") {
      const workspace = await updateReviewWorkspaceProject({
        projectId: id,
        title: payload.title as string,
        description: payload.description as string | null | undefined,
        actorProfileId: gate.userId,
        actorRole: gate.access.role,
      });
      return NextResponse.json({ workspace }, { headers: { "Cache-Control": "private, no-store" } });
    }
    if (payload?.action === "revoke_invitation") {
      const revocation = await revokeReviewWorkspaceInvitation({
        projectId: id,
        invitationId: payload.invitationId as string,
        actorProfileId: gate.userId,
        actorRole: gate.access.role,
        reason: typeof payload.reason === "string" ? payload.reason : "",
      });
      return NextResponse.json({ revocation }, { headers: { "Cache-Control": "private, no-store" } });
    }
    if (payload?.action === "reply_thread") {
      const comment = await addStaffThreadReply({
        projectId: id,
        threadId: payload.threadId as string,
        body: payload.body as string,
        actorProfileId: gate.userId,
        actorRole: gate.access.role,
      });
      return NextResponse.json({ comment }, { status: 201, headers: { "Cache-Control": "private, no-store" } });
    }
    if (payload?.action === "add_annotation") {
      const comment = await addStaffReviewAnnotation({
        projectId: id,
        reviewItemId: payload.reviewItemId as string,
        versionId: payload.versionId as string,
        body: payload.body as string,
        viewport: payload.viewport === "pdf_page" ? "pdf_page" : "desktop",
        xRatio: Number(payload.xRatio),
        yRatio: Number(payload.yRatio),
        actorProfileId: gate.userId,
        actorRole: gate.access.role,
      });
      return NextResponse.json({ comment }, { status: 201, headers: { "Cache-Control": "private, no-store" } });
    }
    if (payload?.action === "set_thread_status") {
      const thread = await setStaffThreadStatus({
        projectId: id,
        threadId: payload.threadId as string,
        status: payload.status as "open" | "resolved" | "declined" | "needs_clarification",
        actorProfileId: gate.userId,
        actorRole: gate.access.role,
      });
      return NextResponse.json({ thread }, { headers: { "Cache-Control": "private, no-store" } });
    }
    if (payload?.action !== "close_early") {
      return NextResponse.json({ error: "Unsupported review workspace action" }, { status: 400 });
    }
    const closure = await closeReviewWorkspaceRoundEarly({
      projectId: id,
      actorProfileId: gate.userId,
      actorRole: gate.access.role,
      reason: typeof payload.reason === "string" ? payload.reason : "",
    });
    return NextResponse.json({ closure }, { headers: { "Cache-Control": "private, no-store" } });
  } catch (error) {
    if (error instanceof ReviewWorkspaceInputError) {
      return NextResponse.json({ error: error.message }, { status: error.status });
    }
    console.error(
      "[ops/bsm/review-workspace/projects] update failed:",
      error instanceof Error ? error.message : error,
    );
    return NextResponse.json({ error: "Could not update the review workspace." }, { status: 500 });
  }
}
