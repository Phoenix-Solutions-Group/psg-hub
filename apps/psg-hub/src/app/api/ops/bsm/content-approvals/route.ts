export const runtime = "nodejs";

import { NextResponse } from "next/server";
import { recordAuditEvent } from "@/lib/audit/access-audit";
import { requireOpsFn } from "@/lib/auth/ops-access";
import {
  ApprovalUploadInputError,
  createBsmGeneratedPageApproval,
  createBsmContentApprovalUpload,
  listBsmContentApprovals,
} from "@/lib/bsm/content-approvals";
import { createServiceClient } from "@/lib/supabase/service";

type UploadPayload = {
  sourceKind?: unknown;
  shopId?: unknown;
  customerProfileId?: unknown;
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
    return NextResponse.json(
      { approvals },
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
      },
    });

    return NextResponse.json(result, { status: 201 });
  } catch (error) {
    if (error instanceof ApprovalUploadInputError) {
      return NextResponse.json({ error: error.message }, { status: 400 });
    }
    return NextResponse.json(
      { error: "Could not start the upload. The file was not saved; please try again." },
      { status: 500 },
    );
  }
}
