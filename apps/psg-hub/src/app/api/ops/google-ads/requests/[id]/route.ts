import { type NextRequest, NextResponse } from "next/server";
import { ZodError } from "zod";
import { recordAuditEvent } from "@/lib/audit/access-audit";
import { requireOpsFn } from "@/lib/auth/ops-access";
import {
  GOOGLE_ADS_REQUEST_SELECT,
  isTerminalGoogleAdsRequestStatus,
  updateGoogleAdsRequestSchema,
} from "@/lib/google-ads/customer-requests";
import { createServiceClient } from "@/lib/supabase/service";

export const runtime = "nodejs";

const UUID_RE = /^[0-9a-fA-F-]{36}$/;

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
): Promise<Response> {
  const { id } = await params;
  if (!UUID_RE.test(id)) {
    return NextResponse.json({ error: "Bad request" }, { status: 400 });
  }

  const gate = await requireOpsFn("ads_mutations");
  if (!gate.ok) return gate.response;

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  try {
    const parsed = updateGoogleAdsRequestSchema.parse(body);
    const service = createServiceClient();

    const { data: existing, error: readError } = await service
      .from("google_ads_customer_requests")
      .select("id, shop_id, status")
      .eq("id", id)
      .maybeSingle();

    if (readError) {
      console.error("[ops/google-ads/requests PATCH] lookup failed:", readError.message);
      return NextResponse.json({ error: "Request lookup failed" }, { status: 500 });
    }
    if (!existing) {
      return NextResponse.json({ error: "Not found" }, { status: 404 });
    }

    const update: Record<string, unknown> = {
      updated_by_profile_id: gate.userId,
    };
    if (parsed.status) update.status = parsed.status;
    if (parsed.response) update.psg_response = parsed.response;
    if (parsed.declineReason) update.decline_reason = parsed.declineReason;
    if (isTerminalGoogleAdsRequestStatus(parsed.status)) update.resolved_at = new Date().toISOString();

    const { data, error } = await service
      .from("google_ads_customer_requests")
      .update(update)
      .eq("id", id)
      .select(GOOGLE_ADS_REQUEST_SELECT)
      .single();

    if (error) {
      console.error("[ops/google-ads/requests PATCH] update failed:", error.message);
      return NextResponse.json({ error: "Request update failed" }, { status: 500 });
    }

    await recordAuditEvent({
      actorProfileId: gate.userId,
      targetShopId: existing.shop_id as string,
      action: "google_ads_request.update",
      payload: {
        requestId: id,
        previousStatus: existing.status,
        status: parsed.status ?? existing.status,
        replied: Boolean(parsed.response),
        declined: parsed.status === "declined",
        executesGoogleAdsChange: false,
      },
    });

    return NextResponse.json({ request: data });
  } catch (err) {
    if (err instanceof ZodError) {
      return NextResponse.json(
        { error: "Validation failed", issues: err.flatten() },
        { status: 422 },
      );
    }
    throw err;
  }
}
