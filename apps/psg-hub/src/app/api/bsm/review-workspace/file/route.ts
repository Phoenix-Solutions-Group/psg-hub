export const runtime = "nodejs";

import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import {
  ReviewWorkspaceInputError,
  bsmReviewWorkspaceInternalEnabled,
  getAssignedReviewerWorkspaceFileDownload,
  getGuestReviewWorkspaceFileDownload,
} from "@/lib/bsm/review-workspace";

function safeFilename(value: string): string {
  return (
    value
      .trim()
      .replace(/[/\\"]/g, "-")
      .replace(/[^\w.-]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 160) || "review-file"
  );
}

function inlineContentType(contentType: string): string {
  if (contentType === "text/html") return "text/html; charset=utf-8";
  if (contentType === "text/markdown" || contentType === "text/plain") return `${contentType}; charset=utf-8`;
  return contentType;
}

export async function GET(request: Request): Promise<Response> {
  if (!bsmReviewWorkspaceInternalEnabled()) {
    return NextResponse.json({ error: "Review workspace internal slice is not enabled." }, { status: 404 });
  }

  const url = new URL(request.url);
  const sessionHash = url.searchParams.get("sessionHash") ?? "";
  const projectId = url.searchParams.get("projectId") ?? "";
  const reviewItemId = url.searchParams.get("reviewItemId") ?? "";
  const versionId = url.searchParams.get("versionId") ?? "";

  try {
    let file;
    if (projectId) {
      const supabase = await createClient();
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
      file = await getAssignedReviewerWorkspaceFileDownload({ projectId, actorProfileId: user.id, reviewItemId, versionId });
    } else {
      file = await getGuestReviewWorkspaceFileDownload({ sessionHash, reviewItemId, versionId });
    }
    return new Response(file.data, {
      status: 200,
      headers: {
        "Content-Type": inlineContentType(file.contentType),
        "Content-Length": String(file.byteSize),
        "Content-Disposition": `inline; filename="${safeFilename(file.originalFilename)}"`,
        "Cache-Control": "private, no-store",
        "Content-Security-Policy":
          file.contentType === "text/html"
            ? "sandbox allow-same-origin; default-src 'none'; script-src 'none'; connect-src 'none'; object-src 'none'; frame-src 'none'; form-action 'none'; base-uri 'none'; img-src https: data: blob:; style-src 'unsafe-inline'; font-src data:;"
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
