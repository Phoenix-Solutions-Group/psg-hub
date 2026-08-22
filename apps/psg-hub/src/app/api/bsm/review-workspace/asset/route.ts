export const runtime = "nodejs";

import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import {
  ReviewWorkspaceInputError,
  bsmReviewWorkspaceInternalEnabled,
  getAssignedReviewerWorkspaceAssetDownload,
  getGuestReviewWorkspaceAssetDownload,
} from "@/lib/bsm/review-workspace";

function safeFilename(value: string): string {
  return value.trim().replace(/[/\\"]/g, "-").replace(/[^\w.-]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 160) || "content-asset";
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
  const assetId = url.searchParams.get("assetId") ?? "";

  try {
    let asset;
    if (projectId) {
      const supabase = await createClient();
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
      asset = await getAssignedReviewerWorkspaceAssetDownload({ projectId, actorProfileId: user.id, reviewItemId, versionId, assetId });
    } else {
      asset = await getGuestReviewWorkspaceAssetDownload({ sessionHash, reviewItemId, versionId, assetId });
    }
    return new Response(asset.data, {
      headers: {
        "Cache-Control": "private, no-store",
        "Content-Type": asset.contentType,
        "Content-Length": String(asset.byteSize),
        "Content-Disposition": `inline; filename="${safeFilename(asset.originalFilename)}"`,
        "Content-Security-Policy": "default-src 'none'",
        "X-Content-Type-Options": "nosniff",
      },
    });
  } catch (error) {
    if (error instanceof ReviewWorkspaceInputError) {
      return NextResponse.json({ error: error.message }, { status: error.status });
    }
    return NextResponse.json({ error: "Could not load this Content Asset." }, { status: 500 });
  }
}
