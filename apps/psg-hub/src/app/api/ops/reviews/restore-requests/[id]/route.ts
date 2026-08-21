import { type NextRequest, NextResponse } from "next/server";
import { recordAuditEvent } from "@/lib/audit/access-audit";
import { requireOpsFn } from "@/lib/auth/ops-access";
import { createServiceClient } from "@/lib/supabase/service";

type DecisionBody = {
  action?: "approve" | "reject";
  note?: string;
};

const UUID_RE = /^[0-9a-fA-F-]{36}$/;

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  if (!UUID_RE.test(id)) {
    return NextResponse.json({ error: "Bad request" }, { status: 400 });
  }

  const gate = await requireOpsFn("manage_production");
  if (!gate.ok) return gate.response;

  let body: DecisionBody;
  try {
    body = (await request.json()) as DecisionBody;
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  if (body.action !== "approve" && body.action !== "reject") {
    return NextResponse.json({ error: "action must be approve or reject" }, { status: 400 });
  }

  const service = createServiceClient();
  const { data: restoreRequest, error: requestErr } = await service
    .from("review_response_restore_requests")
    .select(
      "id, review_response_id, review_item_id, shop_id, requested_version, status, requested_by",
    )
    .eq("id", id)
    .maybeSingle();

  if (requestErr) return NextResponse.json({ error: requestErr.message }, { status: 500 });
  if (!restoreRequest) return NextResponse.json({ error: "Not found" }, { status: 404 });
  if (restoreRequest.status !== "pending") {
    return NextResponse.json({ error: "Restore request has already been decided" }, { status: 409 });
  }

  const decisionNote = typeof body.note === "string" ? body.note.trim().slice(0, 1000) : null;
  const decidedAt = new Date().toISOString();

  if (body.action === "reject") {
    const { data: rejected, error: rejectErr } = await service
      .from("review_response_restore_requests")
      .update({
        status: "rejected",
        decided_by: gate.userId,
        decided_at: decidedAt,
        decision_note: decisionNote,
      })
      .eq("id", id)
      .eq("status", "pending")
      .select(
        "id, review_response_id, review_item_id, shop_id, requested_version, status, reason, requested_by, requested_at, decided_by, decided_at, decision_note",
      )
      .maybeSingle();

    if (rejectErr) return NextResponse.json({ error: rejectErr.message }, { status: 500 });
    if (!rejected) return NextResponse.json({ error: "Restore request changed. Reload and try again." }, { status: 409 });

    await recordAuditEvent({
      actorProfileId: gate.userId,
      targetShopId: restoreRequest.shop_id as string,
      action: "review_response_restore.reject",
      payload: {
        requestId: id,
        reviewItemId: restoreRequest.review_item_id,
        requestedVersion: restoreRequest.requested_version,
      },
    });

    return NextResponse.json({ request: rejected });
  }

  const { data: version, error: versionErr } = await service
    .from("review_response_versions")
    .select(
      "review_response_id, review_item_id, shop_id, version, body:draft_text, status, tone_preset, model_id, prompt_version, safety_flags, safety_overridden",
    )
    .eq("review_response_id", restoreRequest.review_response_id)
    .eq("version", restoreRequest.requested_version)
    .maybeSingle();

  if (versionErr) return NextResponse.json({ error: versionErr.message }, { status: 500 });
  if (!version) return NextResponse.json({ error: "Requested version no longer exists" }, { status: 404 });

  const { data: active, error: activeErr } = await service
    .from("review_responses")
    .select("id, version")
    .eq("id", restoreRequest.review_response_id)
    .maybeSingle();

  if (activeErr) return NextResponse.json({ error: activeErr.message }, { status: 500 });
  if (!active) return NextResponse.json({ error: "Active response not found" }, { status: 404 });

  const nextVersion = Number(active.version) + 1;
  const restoredStatus = version.status === "approved" ? "approved" : "draft";
  const { data: restored, error: restoreErr } = await service
    .from("review_responses")
    .update({
      draft_text: version.body,
      status: restoredStatus,
      tone_preset: version.tone_preset,
      model_id: version.model_id,
      prompt_version: version.prompt_version,
      safety_flags: version.safety_flags ?? [],
      safety_overridden: version.safety_overridden ?? false,
      approved_by: restoredStatus === "approved" ? gate.userId : null,
      approved_at: restoredStatus === "approved" ? decidedAt : null,
      restored_from_request_id: id,
      restored_from_version: version.version,
      restored_by: gate.userId,
      restored_at: decidedAt,
      version: nextVersion,
      updated_at: decidedAt,
    })
    .eq("id", active.id)
    .eq("version", active.version)
    .select(
      "id, review_id:review_item_id, shop_id, body:draft_text, status, tone_preset, model_id, prompt_version, version, safety_flags, safety_overridden, approved_by, approved_at, restored_from_request_id, restored_from_version, restored_by, restored_at, created_at, updated_at",
    )
    .maybeSingle();

  if (restoreErr) return NextResponse.json({ error: restoreErr.message }, { status: 500 });
  if (!restored) return NextResponse.json({ error: "Response was modified by another user. Reload and try again." }, { status: 409 });

  const { data: approved, error: approveErr } = await service
    .from("review_response_restore_requests")
    .update({
      status: "approved",
      decided_by: gate.userId,
      decided_at: decidedAt,
      decision_note: decisionNote,
    })
    .eq("id", id)
    .eq("status", "pending")
    .select(
      "id, review_response_id, review_item_id, shop_id, requested_version, status, reason, requested_by, requested_at, decided_by, decided_at, decision_note",
    )
    .maybeSingle();

  if (approveErr) return NextResponse.json({ error: approveErr.message }, { status: 500 });
  if (!approved) return NextResponse.json({ error: "Restore request changed. Reload and try again." }, { status: 409 });

  await recordAuditEvent({
    actorProfileId: gate.userId,
    targetShopId: restoreRequest.shop_id as string,
    action: "review_response_restore.approve",
    payload: {
      requestId: id,
      reviewItemId: restoreRequest.review_item_id,
      requestedVersion: restoreRequest.requested_version,
      restoredVersion: nextVersion,
      restoredStatus,
    },
  });

  return NextResponse.json({ request: approved, response: restored });
}
