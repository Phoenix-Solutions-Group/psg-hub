export const runtime = "nodejs";

import { NextResponse } from "next/server";
import { recordAuditEvent } from "@/lib/audit/access-audit";
import { requireOpsFn } from "@/lib/auth/ops-access";
import {
  ApprovalUploadInputError,
  archiveBsmContentApproval,
  createBsmGeneratedPageApproval,
  createBsmContentApprovalUpload,
  listBsmContentApprovals,
  listBsmContentApprovalWorkspaces,
  updateBsmContentApproval,
} from "@/lib/bsm/content-approvals";
import { createServiceClient } from "@/lib/supabase/service";

type UploadPayload = {
  sourceKind?: unknown;
  shopId?: unknown;
  customerProfileId?: unknown;
  reviewWorkspaceProjectId?: unknown;
  title?: unknown;
  contextNote?: unknown;
  fileName?: unknown;
  contentType?: unknown;
  byteSize?: unknown;
  generatedPagePath?: unknown;
  previewUrl?: unknown;
  sourceContentItemId?: unknown;
  snapshot?: unknown;
};

export async function GET(request: Request): Promise<Response> {
  const gate = await requireOpsFn("manage_bsm_content_approvals");
  if (!gate.ok) return gate.response;

  const url = new URL(request.url);
  const shopId = url.searchParams.get("shopId");

  try {
    const approvals = await listBsmContentApprovals(createServiceClient(), { shopId });
    const workspaces = await listBsmContentApprovalWorkspaces(createServiceClient(), {
      shopId,
      actorProfileId: gate.userId,
    });
    return NextResponse.json(
      { approvals, workspaces },
      { headers: { "Cache-Control": "private, no-store" } },
    );
  } catch {
    return NextResponse.json(
      { error: "Could not load the content approval library. Try again in a minute." },
      { status: 500 },
    );
  }
}

export async function POST(request: Request): Promise<Response> {
  const gate = await requireOpsFn("manage_bsm_content_approvals");
  if (!gate.ok) return gate.response;

  let payload: UploadPayload;
  try {
    payload = (await request.json()) as UploadPayload;
  } catch {
    return NextResponse.json({ error: "The upload request was not readable." }, { status: 400 });
  }

  try {
    const sourceKind = payload.sourceKind === "generated_page" ? "generated_page" : "uploaded_file";
    const result = sourceKind === "generated_page"
      ? await createBsmGeneratedPageApproval({
          shopId: payload.shopId as string,
          customerProfileId: payload.customerProfileId as string | null | undefined,
          reviewWorkspaceProjectId: payload.reviewWorkspaceProjectId as string | null | undefined,
          title: payload.title as string,
          contextNote: payload.contextNote as string,
          generatedPagePath: payload.generatedPagePath as string,
          previewUrl: payload.previewUrl as string | null | undefined,
          sourceContentItemId: payload.sourceContentItemId as string | null | undefined,
          snapshot: payload.snapshot && typeof payload.snapshot === "object"
            ? (payload.snapshot as Record<string, unknown>)
            : null,
          actorProfileId: gate.userId,
        })
      : await createBsmContentApprovalUpload({
          shopId: payload.shopId as string,
          customerProfileId: payload.customerProfileId as string | null | undefined,
          reviewWorkspaceProjectId: payload.reviewWorkspaceProjectId as string | null | undefined,
          title: payload.title as string,
          contextNote: payload.contextNote as string,
          fileName: payload.fileName as string,
          contentType: payload.contentType as string,
          byteSize: payload.byteSize as number,
          actorProfileId: gate.userId,
        });

    const uploadPath =
      "upload" in result
        ? (result.upload as { path: string }).path
        : null;

    await recordAuditEvent({
      actorProfileId: gate.userId,
      action: "bsm_content_approval.create",
      targetShopId: result.item.shopId,
      targetProfileId: result.item.customerProfileId,
      payload: {
        reviewItemId: result.item.id,
        sourceKind: result.item.sourceKind,
        storagePath: uploadPath,
        generatedPagePath: result.item.currentVersion?.sourceMetadata.generatedPagePath ?? null,
        title: result.item.title,
        status: result.item.status,
        reviewWorkspaceProjectId: result.item.reviewWorkspace?.projectId ?? null,
        reviewWorkspaceRoundId: result.item.reviewWorkspace?.roundId ?? null,
      },
    });

    return NextResponse.json(result, { status: 201 });
  } catch (error) {
    if (error instanceof ApprovalUploadInputError) {
      return NextResponse.json({ error: error.message }, { status: 400 });
    }
    console.error("bsm_content_approval_upload_failed", error);
    return NextResponse.json(
      { error: "Could not start the upload. The file was not saved; please try again." },
      { status: 500 },
    );
  }
}

export async function PATCH(request: Request): Promise<Response> {
  const gate = await requireOpsFn("manage_bsm_content_approvals");
  if (!gate.ok) return gate.response;

  let payload: UploadPayload & { itemId?: unknown };
  try {
    payload = (await request.json()) as UploadPayload & { itemId?: unknown };
  } catch {
    return NextResponse.json({ error: "The edit request was not readable." }, { status: 400 });
  }

  try {
    const result = await updateBsmContentApproval({
      itemId: payload.itemId as string,
      title: payload.title as string,
      contextNote: payload.contextNote as string,
      fileName: payload.fileName as string | null | undefined,
      contentType: payload.contentType as string | null | undefined,
      byteSize: payload.byteSize as number | null | undefined,
      actorProfileId: gate.userId,
    });

    await recordAuditEvent({
      actorProfileId: gate.userId,
      action: "bsm_content_approval.update",
      targetShopId: result.item.shopId,
      targetProfileId: result.item.customerProfileId,
      payload: {
        reviewItemId: result.item.id,
        storagePath: result.upload?.path ?? null,
        title: result.item.title,
        status: result.item.status,
        reviewWorkspaceProjectId: result.item.reviewWorkspace?.projectId ?? null,
        reviewWorkspaceRoundId: result.item.reviewWorkspace?.roundId ?? null,
      },
    });

    return NextResponse.json(result);
  } catch (error) {
    if (error instanceof ApprovalUploadInputError) {
      return NextResponse.json({ error: error.message }, { status: 400 });
    }
    return NextResponse.json(
      { error: "Could not save the review item edits. Please try again." },
      { status: 500 },
    );
  }
}

export async function DELETE(request: Request): Promise<Response> {
  const gate = await requireOpsFn("manage_bsm_content_approvals");
  if (!gate.ok) return gate.response;

  const url = new URL(request.url);
  const itemId = url.searchParams.get("itemId");

  try {
    const result = await archiveBsmContentApproval({
      itemId: itemId ?? "",
      actorProfileId: gate.userId,
    });

    await recordAuditEvent({
      actorProfileId: gate.userId,
      action: "bsm_content_approval.archive",
      targetShopId: result.shopId,
      payload: {
        reviewItemId: result.id,
        title: result.title,
        status: result.status,
      },
    });

    return NextResponse.json({ item: result });
  } catch (error) {
    if (error instanceof ApprovalUploadInputError) {
      return NextResponse.json({ error: error.message }, { status: 400 });
    }
    return NextResponse.json(
      { error: "Could not remove the review item from the active library. Please try again." },
      { status: 500 },
    );
  }
}
