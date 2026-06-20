import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { discoverShopProfile } from "@/lib/onboarding/discovery";

type DiscoverBody = {
  shopName?: string;
  address?: string;
  city?: string;
  state?: string;
};

/**
 * Smart onboarding auto-discovery (PSG-144).
 *
 * Read-only enrichment: given a shop name (+ optional address), return an
 * EnrichedShopProfile of suggested fields the wizard pre-fills. Performs NO
 * database writes, so it is idempotent and adds no RLS surface — auth is still
 * required so it can't be used as an open enrichment endpoint.
 */
export async function POST(request: Request) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  let body: DiscoverBody;
  try {
    body = (await request.json()) as DiscoverBody;
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const shopName = (body.shopName ?? "").trim();
  if (!shopName) {
    return NextResponse.json({ error: "shopName required" }, { status: 400 });
  }

  try {
    const profile = await discoverShopProfile({
      shopName,
      addressStreet: body.address,
      city: body.city,
      state: body.state,
    });
    return NextResponse.json({ profile });
  } catch (err) {
    console.error(
      "[onboarding/discover] failed:",
      err instanceof Error ? err.message : err
    );
    return NextResponse.json({ error: "Discovery failed" }, { status: 500 });
  }
}
