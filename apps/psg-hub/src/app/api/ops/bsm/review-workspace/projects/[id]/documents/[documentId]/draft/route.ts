export const runtime = "nodejs";

import { NextResponse } from "next/server";
import { requireOpsFn } from "@/lib/auth/ops-access";
import { ReviewWorkspaceInputError } from "@/lib/bsm/review-workspace";
import {
  CONTENT_DRAFT_MAX_BYTES,
  ContentDraftConflictError,
  ContentDraftPublishError,
  createReviewContentDraft,
  deleteReviewContentAsset,
  getAdminContentAsset,
  getReviewContentDraftWorkspace,
  publishReviewContentDraft,
  saveContentDraft,
  uploadReviewContentAsset,
} from "@/lib/bsm/review-content-drafts";

type Context = { params: Promise<{ id: string; documentId: string }> };

function noStore<T>(body: T, init: ResponseInit = {}) {
  const headers = new Headers(init.headers);
  headers.set("Cache-Control", "private, no-store");
  return NextResponse.json(body, { ...init, headers });
}

function errorResponse(error: unknown): Response {
  if (error instanceof ContentDraftConflictError) {
    return noStore({
      error: error.message,
      conflict: { localMarkdown: error.localMarkdown, latest: error.latest },
    }, { status: 409 });
  }
  if (error instanceof ContentDraftPublishError) {
    return noStore({
      error: error.message,
      diagnostics: error.diagnostics,
      feedbackStatuses: error.feedbackStatuses,
    }, { status: error.status });
  }
  if (error instanceof ReviewWorkspaceInputError) {
    return noStore({ error: error.message }, { status: error.status });
  }
  if (error instanceof Error && error.name === "ApprovalUploadInputError") {
    return noStore({ error: error.message }, { status: 400 });
  }
  console.error("[content-draft] request failed:", error instanceof Error ? error.message : error);
  return noStore({ error: "Could not complete the Content Draft request." }, { status: 500 });
}

async function jsonPayload(request: Request): Promise<Record<string, unknown>> {
  const contentLength = Number(request.headers.get("content-length") ?? 0);
  if (contentLength > CONTENT_DRAFT_MAX_BYTES + 8192) {
    throw new ReviewWorkspaceInputError(413, "Markdown must be 256 KiB or smaller");
  }
  const text = await request.text();
  if (new TextEncoder().encode(text).byteLength > CONTENT_DRAFT_MAX_BYTES + 8192) {
    throw new ReviewWorkspaceInputError(413, "Markdown must be 256 KiB or smaller");
  }
  try {
    const value = JSON.parse(text) as unknown;
    if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("invalid");
    return value as Record<string, unknown>;
  } catch {
    throw new ReviewWorkspaceInputError(400, "A valid JSON request is required");
  }
}

export async function GET(request: Request, { params }: Context): Promise<Response> {
  const gate = await requireOpsFn("manage_bsm_content_approvals");
  if (!gate.ok) return gate.response;
  const { id: projectId, documentId } = await params;
  const url = new URL(request.url);
  try {
    const assetId = url.searchParams.get("assetId");
    if (assetId) {
      const asset = await getAdminContentAsset({
        projectId,
        documentId,
        assetId,
        actorProfileId: gate.userId,
        actorRole: gate.access.role,
      });
      return new Response(asset.data, {
        headers: {
          "Cache-Control": "private, no-store",
          "Content-Type": asset.contentType,
          "Content-Disposition": `inline; filename="${asset.fileName.replaceAll('"', "")}"`,
          "X-Content-Type-Options": "nosniff",
        },
      });
    }
    const workspace = await getReviewContentDraftWorkspace({
      projectId,
      documentId,
      actorProfileId: gate.userId,
      actorRole: gate.access.role,
    });
    if (url.searchParams.get("export") === "markdown") {
      if (!workspace.draft) return noStore({ error: "Content Draft not found" }, { status: 404 });
      return new Response(workspace.draft.markdown, {
        headers: {
          "Cache-Control": "private, no-store",
          "Content-Type": "text/markdown; charset=utf-8",
          "Content-Disposition": `attachment; filename="content-draft-r${workspace.draft.revision}.md"`,
          "X-Content-Type-Options": "nosniff",
        },
      });
    }
    return noStore({ workspace });
  } catch (error) {
    return errorResponse(error);
  }
}

export async function PUT(request: Request, { params }: Context): Promise<Response> {
  const gate = await requireOpsFn("manage_bsm_content_approvals");
  if (!gate.ok) return gate.response;
  const { id: projectId, documentId } = await params;
  try {
    const payload = await jsonPayload(request);
    if (typeof payload.markdown === "string" && new TextEncoder().encode(payload.markdown).byteLength > CONTENT_DRAFT_MAX_BYTES) {
      throw new ReviewWorkspaceInputError(413, "Markdown must be 256 KiB or smaller");
    }
    const draft = await saveContentDraft({
      projectId,
      documentId,
      actorProfileId: gate.userId,
      actorRole: gate.access.role,
      expectedRevision: Number(payload.expectedRevision),
      markdown: payload.markdown as string,
    });
    return noStore({ draft });
  } catch (error) {
    return errorResponse(error);
  }
}

export async function POST(request: Request, { params }: Context): Promise<Response> {
  const gate = await requireOpsFn("manage_bsm_content_approvals");
  if (!gate.ok) return gate.response;
  const { id: projectId, documentId } = await params;
  try {
    if (request.headers.get("content-type")?.toLowerCase().startsWith("multipart/form-data")) {
      const form = await request.formData();
      const file = form.get("file");
      if (!(file instanceof File)) throw new ReviewWorkspaceInputError(400, "Choose one Content Asset to upload");
      const upload = await uploadReviewContentAsset({
        projectId,
        documentId,
        actorProfileId: gate.userId,
        actorRole: gate.access.role,
        fileName: file.name,
        contentType: file.type,
        bytes: new Uint8Array(await file.arrayBuffer()),
      });
      return noStore({ upload }, { status: 201 });
    }

    const payload = await jsonPayload(request);
    if (payload.action === "create" || payload.action === "import" || payload.action === "clone") {
      if (typeof payload.markdown === "string" && new TextEncoder().encode(payload.markdown).byteLength > CONTENT_DRAFT_MAX_BYTES) {
        throw new ReviewWorkspaceInputError(413, "Markdown must be 256 KiB or smaller");
      }
      const draft = await createReviewContentDraft({
        projectId,
        documentId,
        actorProfileId: gate.userId,
        actorRole: gate.access.role,
        source: payload.action === "create" ? "blank" : payload.action,
        markdown: payload.markdown as string | undefined,
        cloneVersionId: payload.cloneVersionId as string | null | undefined,
      });
      return noStore({ draft }, { status: 201 });
    }
    if (payload.action === "publish") {
      const publication = await publishReviewContentDraft({
        projectId,
        documentId,
        actorProfileId: gate.userId,
        actorRole: gate.access.role,
        expectedRevision: Number(payload.expectedRevision),
        versionId: payload.versionId as string,
        versionNote: payload.versionNote as string,
      });
      return noStore({ publication }, { status: 201 });
    }
    throw new ReviewWorkspaceInputError(400, "Unsupported Content Draft action");
  } catch (error) {
    return errorResponse(error);
  }
}

export async function DELETE(request: Request, { params }: Context): Promise<Response> {
  const gate = await requireOpsFn("manage_bsm_content_approvals");
  if (!gate.ok) return gate.response;
  const { id: projectId, documentId } = await params;
  try {
    const assetId = new URL(request.url).searchParams.get("assetId");
    if (!assetId) throw new ReviewWorkspaceInputError(400, "assetId is required");
    const deletion = await deleteReviewContentAsset({
      projectId,
      documentId,
      assetId,
      actorProfileId: gate.userId,
      actorRole: gate.access.role,
    });
    return noStore({ deletion });
  } catch (error) {
    return errorResponse(error);
  }
}
