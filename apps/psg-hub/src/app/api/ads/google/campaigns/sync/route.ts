import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createServiceClient } from "@/lib/supabase/service";
import { assertAdsTier } from "@/lib/google-ads/tier";
import { fetchCampaignMetrics } from "@/lib/google-ads/campaigns";
import { AdsApiError } from "@/lib/google-ads/types";

type Body = { shop_id?: string };

export async function POST(request: Request) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  let body: Body;
  try {
    body = (await request.json()) as Body;
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const shopId = body.shop_id;
  if (!shopId) {
    return NextResponse.json({ error: "shop_id required" }, { status: 400 });
  }

  try {
    await assertAdsTier(shopId);
  } catch (err) {
    if (err instanceof AdsApiError && err.code === "tier_required") {
      return NextResponse.json({ error: err.message }, { status: 402 });
    }
    throw err;
  }

  const { data: membership } = await supabase
    .from("shop_members")
    .select("role")
    .eq("profile_id", user.id)
    .eq("shop_id", shopId)
    .maybeSingle();

  if (!membership) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }
  if (membership.role !== "owner" && membership.role !== "manager") {
    return NextResponse.json(
      { error: "Owners or managers only" },
      { status: 403 }
    );
  }

  const service = createServiceClient();
  const { data: campaigns, error: listErr } = await service
    .from("google_ads_campaigns")
    .select("id, external_id")
    .eq("shop_id", shopId)
    .in("status", ["enabled", "paused"]);

  if (listErr) {
    return NextResponse.json({ error: listErr.message }, { status: 500 });
  }

  const synced: Array<{ id: string; metrics: unknown }> = [];
  const errors: Array<{ id: string; code: string; message: string }> = [];

  for (const c of campaigns ?? []) {
    try {
      const metrics = await fetchCampaignMetrics({
        shopId,
        userId: user.id,
        externalId: c.external_id as string,
      });
      const { error: updErr } = await service
        .from("google_ads_campaigns")
        .update({
          metrics,
          metrics_synced_at: new Date().toISOString(),
        })
        .eq("id", c.id);
      if (updErr) {
        errors.push({
          id: c.id as string,
          code: "persist_failed",
          message: updErr.message,
        });
      } else {
        synced.push({ id: c.id as string, metrics });
      }
    } catch (err) {
      if (err instanceof AdsApiError) {
        errors.push({
          id: c.id as string,
          code: err.code,
          message: err.message,
        });
      } else {
        errors.push({
          id: c.id as string,
          code: "error",
          message: err instanceof Error ? err.message : String(err),
        });
      }
    }
  }

  const partial = errors.length > 0;
  return NextResponse.json(
    { synced, errors, partial },
    { status: partial ? 207 : 200 }
  );
}
