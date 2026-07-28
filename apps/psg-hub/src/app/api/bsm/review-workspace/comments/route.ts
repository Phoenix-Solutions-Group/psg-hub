export const runtime = "nodejs";

import { NextResponse } from "next/server";
import {
  ReviewWorkspaceInputError,
  addGuestReviewPinComment,
  bsmReviewWorkspaceInternalEnabled,
} from "@/lib/bsm/review-workspace";

export async function POST(request: Request): Promise<Response> {
  if (!bsmReviewWorkspaceInternalEnabled()) {
    return NextResponse.json({ error: "Review workspace internal slice is not enabled." }, { status: 404 });
  }

  const payload = (await request.json().catch(() => null)) as Record<string, unknown> | null;
  if (!payload) return NextResponse.json({ error: "The request body was not readable." }, { status: 400 });

  try {
    const comment = await addGuestReviewPinComment({
      sessionHash: payload.sessionHash as string,
      reviewItemId: payload.reviewItemId as string,
      versionId: payload.versionId as string,
      body: payload.body as string,
      pinNumber: Number(payload.pinNumber),
      pageNumber: payload.pageNumber == null ? null : Number(payload.pageNumber),
      viewport: payload.viewport === "mobile" || payload.viewport === "pdf_page" ? payload.viewport : "desktop",
      xRatio: typeof payload.xRatio === "number" ? payload.xRatio : 0.5,
      yRatio: typeof payload.yRatio === "number" ? payload.yRatio : 0.5,
      selection: typeof payload.selection === "object" && payload.selection ? payload.selection as Record<string, unknown> : {},
    });
    return NextResponse.json({ comment }, { status: 201, headers: { "Cache-Control": "private, no-store" } });
  } catch (error) {
    if (error instanceof ReviewWorkspaceInputError) {
      return NextResponse.json({ error: error.message }, { status: error.status });
    }
    return NextResponse.json({ error: "Could not save this reviewer comment." }, { status: 500 });
  }
}
