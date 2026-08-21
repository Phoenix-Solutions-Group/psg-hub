export const runtime = "nodejs";

import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import {
  ReviewWorkspaceInputError,
  addAssignedReviewerAnnotation,
  addAssignedReviewerThreadReply,
  addGuestReviewAnnotation,
  addGuestThreadReply,
  bsmReviewWorkspaceInternalEnabled,
  setGuestThreadStatus,
} from "@/lib/bsm/review-workspace";

export async function POST(request: Request): Promise<Response> {
  if (!bsmReviewWorkspaceInternalEnabled()) {
    return NextResponse.json({ error: "Review workspace internal slice is not enabled." }, { status: 404 });
  }

  const payload = (await request.json().catch(() => null)) as Record<string, unknown> | null;
  if (!payload) return NextResponse.json({ error: "The request body was not readable." }, { status: 400 });

  try {
    if (typeof payload.projectId === "string") {
      const supabase = await createClient();
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
      const comment = payload.action === "reply"
        ? await addAssignedReviewerThreadReply({
            projectId: payload.projectId,
            actorProfileId: user.id,
            threadId: payload.threadId as string,
            body: payload.body as string,
          })
        : await addAssignedReviewerAnnotation({
            projectId: payload.projectId,
            actorProfileId: user.id,
            reviewItemId: payload.reviewItemId as string,
            versionId: payload.versionId as string,
            body: payload.body as string,
            pinNumber: Number(payload.pinNumber),
            pageNumber: payload.pageNumber == null ? null : Number(payload.pageNumber),
            viewport: payload.viewport === "mobile" || payload.viewport === "pdf_page" ? payload.viewport : "desktop",
            anchorKind: payload.anchorKind === "highlight" ? "highlight" : "pin",
            xRatio: typeof payload.xRatio === "number" ? payload.xRatio : null,
            yRatio: typeof payload.yRatio === "number" ? payload.yRatio : null,
            selection: typeof payload.selection === "object" && payload.selection ? payload.selection as Record<string, unknown> : null,
          });
      return NextResponse.json({ comment }, { status: 201, headers: { "Cache-Control": "private, no-store" } });
    }
    if (payload.action === "reply") {
      const comment = await addGuestThreadReply({
        sessionHash: payload.sessionHash as string,
        threadId: payload.threadId as string,
        body: payload.body as string,
      });
      return NextResponse.json({ comment }, { status: 201, headers: { "Cache-Control": "private, no-store" } });
    }
    const comment = await addGuestReviewAnnotation({
      sessionHash: payload.sessionHash as string,
      reviewItemId: payload.reviewItemId as string,
      versionId: payload.versionId as string,
      body: payload.body as string,
      pinNumber: Number(payload.pinNumber),
      pageNumber: payload.pageNumber == null ? null : Number(payload.pageNumber),
      viewport: payload.viewport === "mobile" || payload.viewport === "pdf_page" ? payload.viewport : "desktop",
      anchorKind: payload.anchorKind === "highlight" ? "highlight" : "pin",
      xRatio: typeof payload.xRatio === "number" ? payload.xRatio : null,
      yRatio: typeof payload.yRatio === "number" ? payload.yRatio : null,
      selection: typeof payload.selection === "object" && payload.selection ? payload.selection as Record<string, unknown> : null,
    });
    return NextResponse.json({ comment }, { status: 201, headers: { "Cache-Control": "private, no-store" } });
  } catch (error) {
    if (error instanceof ReviewWorkspaceInputError) {
      return NextResponse.json({ error: error.message }, { status: error.status });
    }
    return NextResponse.json({ error: "Could not save this reviewer comment." }, { status: 500 });
  }
}

export async function PATCH(request: Request): Promise<Response> {
  if (!bsmReviewWorkspaceInternalEnabled()) {
    return NextResponse.json({ error: "Review workspace internal slice is not enabled." }, { status: 404 });
  }
  const payload = (await request.json().catch(() => null)) as Record<string, unknown> | null;
  if (!payload) return NextResponse.json({ error: "The request body was not readable." }, { status: 400 });

  if (typeof payload.projectId === "string") {
    const supabase = await createClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    return NextResponse.json({ error: "Assigned reviewers cannot resolve or reopen comment threads." }, { status: 403 });
  }

  try {
    const thread = await setGuestThreadStatus({
      sessionHash: payload.sessionHash as string,
      threadId: payload.threadId as string,
      status: payload.status as "open" | "resolved",
    });
    return NextResponse.json({ thread }, { headers: { "Cache-Control": "private, no-store" } });
  } catch (error) {
    if (error instanceof ReviewWorkspaceInputError) {
      return NextResponse.json({ error: error.message }, { status: error.status });
    }
    return NextResponse.json({ error: "Could not update this review comment thread." }, { status: 500 });
  }
}
