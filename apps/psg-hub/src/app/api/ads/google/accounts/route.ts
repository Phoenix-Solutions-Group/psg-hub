import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { assertAdsTier } from "@/lib/google-ads/tier";
import { AdsApiError } from "@/lib/google-ads/types";

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

  // RLS enforces tenancy.
  const { data, error } = await supabase
    .from("google_ads_accounts")
    .select("id, shop_id, customer_id, status, linked_at, revoked_at, last_error")
    .eq("shop_id", shopId)
    .order("linked_at", { ascending: false });

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ accounts: data ?? [] });
}
