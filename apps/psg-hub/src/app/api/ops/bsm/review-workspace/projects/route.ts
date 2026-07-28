export const runtime = "nodejs";

import { NextResponse } from "next/server";
import { requireOpsFn } from "@/lib/auth/ops-access";
import {
  ReviewWorkspaceInputError,
  bsmReviewWorkspaceInternalEnabled,
  createInternalReviewWorkspaceSlice,
} from "@/lib/bsm/review-workspace";

export async function POST(request: Request): Promise<Response> {
  if (!bsmReviewWorkspaceInternalEnabled()) {
    return NextResponse.json({ error: "Review workspace internal slice is not enabled." }, { status: 404 });
  }

  const gate = await requireOpsFn("manage_bsm_content_approvals");
  if (!gate.ok) return gate.response;

  const payload = (await request.json().catch(() => null)) as Record<string, unknown> | null;
  if (!payload) return NextResponse.json({ error: "The request body was not readable." }, { status: 400 });

  try {
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
    return NextResponse.json({ error: "Could not create the internal review workspace." }, { status: 500 });
  }
}
