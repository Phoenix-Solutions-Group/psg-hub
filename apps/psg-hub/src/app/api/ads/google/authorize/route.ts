import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { buildAuthorizeUrl } from "@/lib/google-ads/oauth";
import { assertAdsTier } from "@/lib/google-ads/tier";
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

  // Only owners can link ad accounts
  const { data: membership } = await supabase
    .from("shop_members")
    .select("role")
    .eq("profile_id", user.id)
    .eq("shop_id", shopId)
    .maybeSingle();

  if (!membership) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }
  if (membership.role !== "owner") {
    return NextResponse.json(
      { error: "Only shop owners can link ad accounts" },
      { status: 403 }
    );
  }

  // Tier gate
  try {
    await assertAdsTier(shopId);
  } catch (err) {
    if (err instanceof AdsApiError && err.code === "tier_required") {
      return NextResponse.json({ error: err.message }, { status: 402 });
    }
    throw err;
  }

  try {
    const { url } = await buildAuthorizeUrl({
      userId: user.id,
      shopId,
    });
    return NextResponse.json({ url });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
