import { NextResponse } from "next/server";
import { requireOpsFn } from "@/lib/auth/ops-access";
import { recordAuditEvent, type AuditAction } from "@/lib/audit/access-audit";
import { createServiceClient } from "@/lib/supabase/service";

type RestoreDecisionBody = {
  action?: unknown;
  note?: unknown;
};

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const gate = await requireOpsFn("manage_bsm_content_approvals");
  if (!gate.ok) return gate.response;

  const { id } = await params;
  const body = (await request.json().catch(() => null)) as RestoreDecisionBody | null;
  const action = body?.action === "approve" || body?.action === "reject" ? body.action : null;
  if (!action) {
    return NextResponse.json({ error: "action must be approve or reject" }, { status: 400 });
  }

  const note = typeof body?.note === "string" ? body.note.trim().slice(0, 1000) : null;
  const service = createServiceClient();
  const now = new Date().toISOString();

  const { data: restoreRequest, error: requestError } = await service
    .from("review_response_restore_requests")
    .update({
      status: action === "approve" ? "approved" : "rejected",
      decided_by: gate.userId,
      decided_at: now,
      decision_note: note,
    })
    .eq("id", id)
    .eq("status", "pending")
    .select(
      "id, review_response_id, review_item_id, shop_id, requested_version, status, reason, requested_by, requested_at, decided_by, decided_at, decision_note",
    )
    .maybeSingle();

  if (requestError) return NextResponse.json({ error: requestError.message }, { status: 500 });
  if (!restoreRequest) return NextResponse.json({ error: "Restore request not found" }, { status: 404 });

  let restoredVersion: number | null = null;
  if (action === "approve") {
    const { data: version, error: versionError } = await service
      .from("review_response_versions")
      .select(
        "review_response_id, review_item_id, shop_id, version, body, status, tone_preset, model_id, prompt_version, safety_flags, safety_overridden",
      )
      .eq("review_response_id", restoreRequest.review_response_id)
      .eq("version", restoreRequest.requested_version)
      .maybeSingle();
    if (versionError) return NextResponse.json({ error: versionError.message }, { status: 500 });
    if (!version) return NextResponse.json({ error: "Version not found" }, { status: 404 });

    const { data: activeResponse, error: activeError } = await service
      .from("review_responses")
      .select("id, version")
      .eq("id", restoreRequest.review_response_id)
      .maybeSingle();
    if (activeError) return NextResponse.json({ error: activeError.message }, { status: 500 });
    restoredVersion = Number(activeResponse?.version ?? 0) + 1;

    const { error: responseError } = await service
      .from("review_responses")
      .update({
        draft_text: version.body,
        status: version.status,
        tone_preset: version.tone_preset,
        model_id: version.model_id,
        prompt_version: version.prompt_version,
        safety_flags: version.safety_flags,
        safety_overridden: version.safety_overridden,
        version: restoredVersion,
        restored_from_request_id: restoreRequest.id,
        restored_from_version: restoreRequest.requested_version,
        restored_by: gate.userId,
        restored_at: now,
      })
      .eq("id", restoreRequest.review_response_id);
    if (responseError) return NextResponse.json({ error: responseError.message }, { status: 500 });
  }

  await recordAuditEvent({
    actorProfileId: gate.userId,
    action: `review_response_restore.${action}` as AuditAction,
    targetShopId: restoreRequest.shop_id,
    payload: {
      restoreRequestId: id,
      reviewResponseId: restoreRequest.review_response_id,
      reviewItemId: restoreRequest.review_item_id,
      requestedVersion: restoreRequest.requested_version,
      restoredVersion,
    },
  });

  return NextResponse.json({ request: restoreRequest }, { headers: { "Cache-Control": "private, no-store" } });
}
