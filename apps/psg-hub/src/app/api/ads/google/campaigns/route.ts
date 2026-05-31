import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createServiceClient } from "@/lib/supabase/service";
import { assertAdsTier } from "@/lib/google-ads/tier";
import { getTemplate } from "@/lib/google-ads/templates";
import { createCampaign } from "@/lib/google-ads/campaigns";
import { AdsApiError } from "@/lib/google-ads/types";

const DEFAULT_MAX_MICROS = 500_000_000;

function envMaxMicros(): number {
  const v = process.env.ADS_MAX_DAILY_MICROS;
  if (!v) return DEFAULT_MAX_MICROS;
  const n = parseInt(v, 10);
  return Number.isFinite(n) && n > 0 ? n : DEFAULT_MAX_MICROS;
}

export async function GET(request: Request) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const url = new URL(request.url);
  const shopId = url.searchParams.get("shop_id");
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

  const { data, error } = await supabase
    .from("google_ads_campaigns")
    .select(
      "id, shop_id, account_id, external_resource_name, external_id, name, template_id, campaign_type, status, daily_budget_micros, metrics, metrics_synced_at, created_at, updated_at"
    )
    .eq("shop_id", shopId)
    .neq("status", "removed")
    .order("created_at", { ascending: false });

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ campaigns: data ?? [] });
}

type CreateBody = {
  shop_id?: string;
  template_id?: string;
  daily_budget_micros?: number;
  name?: string;
};

export async function POST(request: Request) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  let body: CreateBody;
  try {
    body = (await request.json()) as CreateBody;
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const shopId = body.shop_id;
  const templateId = body.template_id;
  const dailyBudget = body.daily_budget_micros;
  if (!shopId || !templateId || typeof dailyBudget !== "number") {
    return NextResponse.json(
      {
        error:
          "shop_id, template_id, daily_budget_micros (number) are required",
      },
      { status: 400 }
    );
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
      { error: "Only owners or managers can create campaigns" },
      { status: 403 }
    );
  }

  const service = createServiceClient();
  const { data: shop, error: shopErr } = await service
    .from("shops")
    .select(
      "id, name, address, city, state, website_url, max_daily_ad_budget_micros"
    )
    .eq("id", shopId)
    .maybeSingle();

  if (shopErr || !shop) {
    return NextResponse.json({ error: "Shop lookup failed" }, { status: 500 });
  }

  // Shop preflight
  const missing: string[] = [];
  if (!shop.address || String(shop.address).trim() === "") missing.push("address");
  // service_radius_miles is expected but may not exist in schema yet — treat null as missing.
  const radius = (shop as unknown as { service_radius_miles?: number | null })
    .service_radius_miles;
  if (radius === undefined || radius === null)
    missing.push("service_radius_miles");
  if (!shop.website_url || String(shop.website_url).trim() === "")
    missing.push("website_url");
  else if (!String(shop.website_url).startsWith("https://"))
    missing.push("website_url_https");

  if (missing.length > 0) {
    return NextResponse.json(
      { error: "Shop preflight failed", missing },
      { status: 400 }
    );
  }

  // Budget ceiling
  const cap =
    shop.max_daily_ad_budget_micros &&
    typeof shop.max_daily_ad_budget_micros === "number"
      ? shop.max_daily_ad_budget_micros
      : envMaxMicros();
  if (dailyBudget > cap) {
    return NextResponse.json(
      { error: `daily_budget_micros exceeds cap ${cap}`, cap },
      { status: 400 }
    );
  }

  // Template
  const template = getTemplate(templateId);
  if (!template) {
    return NextResponse.json({ error: "Unknown template_id" }, { status: 400 });
  }

  const campaignName = (body.name ?? `${shop.name} — ${template.name}`).slice(
    0,
    255
  );
  if (campaignName.length === 0) {
    return NextResponse.json({ error: "campaign name empty" }, { status: 400 });
  }

  // Create at Google
  try {
    const result = await createCampaign({
      shopId,
      userId: user.id,
      template,
      campaignName,
      dailyBudgetMicros: dailyBudget,
      finalUrl: shop.website_url as string,
      geoTargeting: {
        address: shop.address as string,
        city: (shop.city as string | null) ?? null,
        state: (shop.state as string | null) ?? null,
        radiusMiles: radius as number,
      },
    });

    const { data: row, error: insErr } = await service
      .from("google_ads_campaigns")
      .insert({
        shop_id: shopId,
        account_id: result.accountId,
        external_resource_name: result.externalResourceName,
        external_id: result.externalId,
        name: campaignName,
        template_id: templateId,
        campaign_type: "SEARCH",
        status: "paused",
        daily_budget_micros: dailyBudget,
      })
      .select(
        "id, shop_id, account_id, external_resource_name, external_id, name, template_id, status, daily_budget_micros"
      )
      .single();

    if (insErr) {
      return NextResponse.json({ error: insErr.message }, { status: 500 });
    }

    return NextResponse.json({ campaign: row });
  } catch (err) {
    if (err instanceof AdsApiError) {
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
    throw err;
  }
}
