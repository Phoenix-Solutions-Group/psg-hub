import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createServiceClient } from "@/lib/supabase/service";
import { assertAdsTier } from "@/lib/google-ads/tier";
import { updateCampaign } from "@/lib/google-ads/campaigns";
import { AdsApiError } from "@/lib/google-ads/types";

const DEFAULT_MAX_MICROS = 500_000_000;

function envMaxMicros(): number {
  const v = process.env.ADS_MAX_DAILY_MICROS;
  if (!v) return DEFAULT_MAX_MICROS;
  const n = parseInt(v, 10);
  return Number.isFinite(n) && n > 0 ? n : DEFAULT_MAX_MICROS;
}

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
  const { id: campaignId } = await params;

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  let body: PutBody;
  try {
    body = (await request.json()) as PutBody;
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
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

  const { data: membership } = await supabase
    .from("shop_users")
    .select("role")
    .eq("user_id", user.id)
    .eq("shop_id", existing.shop_id)
    .maybeSingle();

  if (!membership) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const role = membership.role as "owner" | "manager" | "viewer";
  if (role !== "owner" && role !== "manager") {
    return NextResponse.json(
      { error: "Owners or managers only" },
      { status: 403 }
    );
  }

  // First-enable gate: paused → enabled requires owner
  if (
    body.status === "enabled" &&
    existing.status === "paused" &&
    role !== "owner"
  ) {
    return NextResponse.json(
      { error: "Enabling a campaign requires owner role" },
      { status: 403 }
    );
  }

  // Budget change constraints
  if (typeof body.daily_budget_micros === "number") {
    const cur = existing.daily_budget_micros as number;
    if (cur > 0) {
      const delta = Math.abs(body.daily_budget_micros - cur) / cur;
      if (delta > 0.5) {
        return NextResponse.json(
          {
            error: "Daily budget change exceeds 50% in 24h window",
            current: cur,
            requested: body.daily_budget_micros,
          },
          { status: 409 }
        );
      }
    }

    const cap = envMaxMicros();
    if (body.daily_budget_micros > cap) {
      return NextResponse.json(
        { error: `daily_budget_micros exceeds cap ${cap}`, cap },
        { status: 400 }
      );
    }
  }

  try {
    await updateCampaign({
      shopId: existing.shop_id as string,
      userId: user.id,
      externalResourceName: existing.external_resource_name as string,
      status: body.status,
      dailyBudgetMicros: body.daily_budget_micros,
      budgetResourceName: null,
    });
  } catch (err) {
    if (err instanceof AdsApiError) return errorFromAdsApi(err);
    throw err;
  }

  const patch: Record<string, unknown> = {
    updated_at: new Date().toISOString(),
  };
  if (body.status) patch.status = body.status;
  if (typeof body.daily_budget_micros === "number")
    patch.daily_budget_micros = body.daily_budget_micros;

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
  const { id: campaignId } = await params;

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

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

  const { data: membership } = await supabase
    .from("shop_users")
    .select("role")
    .eq("user_id", user.id)
    .eq("shop_id", existing.shop_id)
    .maybeSingle();

  if (!membership) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }
  if (membership.role !== "owner") {
    return NextResponse.json(
      { error: "Only owners can delete campaigns" },
      { status: 403 }
    );
  }

  try {
    await updateCampaign({
      shopId: existing.shop_id as string,
      userId: user.id,
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
