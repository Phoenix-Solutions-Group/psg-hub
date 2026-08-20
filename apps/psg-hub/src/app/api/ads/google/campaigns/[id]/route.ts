import { NextResponse } from "next/server";
import { createServiceClient } from "@/lib/supabase/service";
import { assertAdsTier } from "@/lib/google-ads/tier";
import { updateCampaign } from "@/lib/google-ads/campaigns";
import { AdsApiError } from "@/lib/google-ads/types";
import { requireOpsFn } from "@/lib/auth/ops-access";

function errorFromAdsApi(err: AdsApiError): NextResponse {
  const map: Record<string, number> = {
    rate_limited: 429,
    auth_failed: 401,
    timeout: 504,
    bad_request: 400,
    tier_required: 402,
    budget_exceeded: 400,
    shop_preflight_failed: 400,
  };
  return NextResponse.json(
    { error: err.message, code: err.code },
    { status: map[err.code] ?? 500 }
  );
}

type PutBody = {
  status?: "paused" | "enabled" | "removed";
  daily_budget_micros?: number;
};

export async function PUT(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const gate = await requireOpsFn("ads_mutations");
  if (!gate.ok) return gate.response;
  const { id: campaignId } = await params;

  let body: PutBody;
  try {
    body = (await request.json()) as PutBody;
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  if (typeof body.daily_budget_micros === "number") {
    return NextResponse.json(
      { error: "Direct budget changes are unsupported; use Ads Mutation Studio" },
      { status: 400 }
    );
  }

  const service = createServiceClient();
  const { data: existing, error: exErr } = await service
    .from("google_ads_campaigns")
    .select(
      "id, shop_id, external_resource_name, external_id, status, daily_budget_micros"
    )
    .eq("id", campaignId)
    .maybeSingle();

  if (exErr) {
    return NextResponse.json({ error: exErr.message }, { status: 500 });
  }
  if (!existing) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  try {
    await assertAdsTier(existing.shop_id as string);
  } catch (err) {
    if (err instanceof AdsApiError && err.code === "tier_required") {
      return NextResponse.json({ error: err.message }, { status: 402 });
    }
    throw err;
  }

  try {
    await updateCampaign({
      shopId: existing.shop_id as string,
      userId: gate.userId,
      externalResourceName: existing.external_resource_name as string,
      status: body.status,
    });
  } catch (err) {
    if (err instanceof AdsApiError) return errorFromAdsApi(err);
    throw err;
  }

  const patch: Record<string, unknown> = {
    updated_at: new Date().toISOString(),
  };
  if (body.status) patch.status = body.status;

  const { data: updated, error: upErr } = await service
    .from("google_ads_campaigns")
    .update(patch)
    .eq("id", campaignId)
    .select(
      "id, shop_id, external_resource_name, external_id, status, daily_budget_micros, updated_at"
    )
    .single();

  if (upErr) {
    return NextResponse.json({ error: upErr.message }, { status: 500 });
  }

  return NextResponse.json({ campaign: updated });
}

export async function DELETE(
  _request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const gate = await requireOpsFn("ads_mutations");
  if (!gate.ok) return gate.response;
  const { id: campaignId } = await params;

  const service = createServiceClient();
  const { data: existing, error: exErr } = await service
    .from("google_ads_campaigns")
    .select("id, shop_id, external_resource_name")
    .eq("id", campaignId)
    .maybeSingle();

  if (exErr) {
    return NextResponse.json({ error: exErr.message }, { status: 500 });
  }
  if (!existing) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  try {
    await assertAdsTier(existing.shop_id as string);
  } catch (err) {
    if (err instanceof AdsApiError && err.code === "tier_required") {
      return NextResponse.json({ error: err.message }, { status: 402 });
    }
    throw err;
  }

  try {
    await updateCampaign({
      shopId: existing.shop_id as string,
      userId: gate.userId,
      externalResourceName: existing.external_resource_name as string,
      status: "removed",
    });
  } catch (err) {
    if (err instanceof AdsApiError) return errorFromAdsApi(err);
    throw err;
  }

  const { error: upErr } = await service
    .from("google_ads_campaigns")
    .update({ status: "removed", updated_at: new Date().toISOString() })
    .eq("id", campaignId);

  if (upErr) {
    return NextResponse.json({ error: upErr.message }, { status: 500 });
  }

  return NextResponse.json({ removed: true });
}
