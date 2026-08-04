export const runtime = "nodejs";

import { NextResponse } from "next/server";
import {
  ReviewWorkspaceInputError,
  bsmReviewWorkspaceInternalEnabled,
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
  const reviewItemId = url.searchParams.get("reviewItemId") ?? "";
  const versionId = url.searchParams.get("versionId") ?? "";

  try {
    const file = await getGuestReviewWorkspaceFileDownload({ sessionHash, reviewItemId, versionId });
    return new Response(file.data, {
      status: 200,
      headers: {
        "Content-Type": inlineContentType(file.contentType),
        "Content-Length": String(file.byteSize),
        "Content-Disposition": `inline; filename="${safeFilename(file.originalFilename)}"`,
        "Cache-Control": "private, no-store",
        "Content-Security-Policy":
          file.contentType === "text/html"
            ? "sandbox; default-src 'none'; img-src data: blob:; style-src 'unsafe-inline'; font-src data:;"
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
