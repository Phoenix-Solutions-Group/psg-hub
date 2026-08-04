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

function inlineContentType(contentType: string, originalFilename: string): string {
  const filename = originalFilename.trim().toLowerCase();
  if (contentType === "text/html" || filename.endsWith(".html") || filename.endsWith(".htm")) {
    return "text/html; charset=utf-8";
  }
  if (contentType === "text/markdown" || contentType === "text/plain") return `${contentType}; charset=utf-8`;
  return contentType;
}

function inlineContentSecurityPolicy(contentType: string, originalFilename: string): string {
  const resolvedContentType = inlineContentType(contentType, originalFilename);
  if (resolvedContentType.startsWith("text/html")) {
    return [
      "sandbox allow-popups allow-popups-to-escape-sandbox",
      "default-src 'none'",
      "img-src data: blob: https:",
      "style-src 'unsafe-inline' https:",
      "font-src data: https:",
      "script-src 'none'",
      "base-uri 'none'",
      "form-action 'none'",
    ].join("; ");
  }
  if (resolvedContentType === "application/pdf") {
    return "default-src 'self' blob: data:; object-src 'self' blob: data:; frame-src 'self' blob: data:";
  }
  return "default-src 'none'";
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
        "Content-Type": inlineContentType(file.contentType, file.originalFilename),
        "Content-Length": String(file.byteSize),
        "Content-Disposition": `inline; filename="${safeFilename(file.originalFilename)}"`,
        "Cache-Control": "private, no-store",
        "Content-Security-Policy": inlineContentSecurityPolicy(file.contentType, file.originalFilename),
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
