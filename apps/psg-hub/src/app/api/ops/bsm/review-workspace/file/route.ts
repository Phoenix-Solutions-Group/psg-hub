export const runtime = "nodejs";

import { NextResponse } from "next/server";
import { requireOpsFn } from "@/lib/auth/ops-access";
import {
  ReviewWorkspaceInputError,
  bsmReviewWorkspaceInternalEnabled,
  getStaffReviewWorkspaceFileDownload,
} from "@/lib/bsm/review-workspace";

function safeFilename(value: string): string {
  return value.trim().replace(/[/\\"]/g, "-").replace(/[^\w.-]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 160) || "review-file";
}

export async function GET(request: Request): Promise<Response> {
  if (!bsmReviewWorkspaceInternalEnabled()) {
    return NextResponse.json({ error: "Review workspace internal slice is not enabled." }, { status: 404 });
  }
  const gate = await requireOpsFn("manage_bsm_content_approvals");
  if (!gate.ok) return gate.response;

  const url = new URL(request.url);
  try {
    const file = await getStaffReviewWorkspaceFileDownload({
      projectId: url.searchParams.get("projectId") ?? "",
      reviewItemId: url.searchParams.get("reviewItemId") ?? "",
      versionId: url.searchParams.get("versionId") ?? "",
      actorProfileId: gate.userId,
      actorRole: gate.access.role,
    });
    const contentType = file.contentType === "text/html" ? "text/html; charset=utf-8" : file.contentType;
    return new Response(file.data, {
      headers: {
        "Content-Type": contentType,
        "Content-Length": String(file.byteSize),
        "Content-Disposition": `inline; filename="${safeFilename(file.originalFilename)}"`,
        "Cache-Control": "private, no-store",
        "Content-Security-Policy": file.contentType === "text/html"
          ? "sandbox; default-src 'none'; img-src https: data: blob:; style-src 'unsafe-inline'; font-src data:;"
          : "default-src 'none'",
        "X-Content-Type-Options": "nosniff",
      },
    });
  } catch (error) {
    if (error instanceof ReviewWorkspaceInputError) {
      return NextResponse.json({ error: error.message }, { status: error.status });
    }
    return NextResponse.json({ error: "Could not load this review document file." }, { status: 500 });
  }
}
