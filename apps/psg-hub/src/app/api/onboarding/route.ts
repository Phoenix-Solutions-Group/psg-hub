import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createServiceClient } from "@/lib/supabase/service";

type OnboardingBody = {
  shopName?: string;
  address?: string;
  city?: string;
  state?: string;
  websiteUrl?: string;
  phone?: string;
};

function slugify(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");
}

export async function POST(request: Request) {
  // Auth via the user session; the caller's id is the ONLY source of user_id.
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  let body: OnboardingBody;
  try {
    body = (await request.json()) as OnboardingBody;
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const shopName = (body.shopName ?? "").trim();
  if (!shopName) {
    return NextResponse.json({ error: "shopName required" }, { status: 400 });
  }

  // All privileged writes go through service-role: shop_users INSERT is RLS-gated
  // by with_check user_is_shop_owner(shop_id), which is false for a brand-new shop,
  // so the first-owner bootstrap cannot run under the user-session client.
  const service = createServiceClient();
  const websiteUrl = body.websiteUrl?.trim() || null;

  // 1. Create the owning client (shops.client_id is NOT NULL, FK -> clients).
  const { data: client, error: clientErr } = await service
    .from("clients")
    .insert({ name: shopName, website_url: websiteUrl, created_by: user.id })
    .select("id")
    .single();

  if (clientErr || !client) {
    if (clientErr) console.error("[onboarding] client insert failed:", clientErr.message);
    return NextResponse.json({ error: "Client creation failed" }, { status: 500 });
  }

  // 2. Create the shop using LIVE shops columns (no website_url/phone/city/state/address).
  // On failure, compensate by deleting the orphan client.
  const { data: shop, error: shopErr } = await service
    .from("shops")
    .insert({
      client_id: client.id,
      name: shopName,
      slug: slugify(shopName),
      address_street: body.address?.trim() || null,
      address_locality: body.city?.trim() || null,
      address_region: body.state?.trim() || null,
      url: websiteUrl,
      telephone: body.phone?.trim() || null,
    })
    .select("id")
    .single();

  if (shopErr || !shop) {
    await service.from("clients").delete().eq("id", client.id);
    if (shopErr) console.error("[onboarding] shop insert failed:", shopErr.message);
    return NextResponse.json({ error: "Shop creation failed" }, { status: 500 });
  }

  // 3. First-owner membership. On failure, compensate by deleting shop + client.
  const { error: memberErr } = await service.from("shop_users").insert({
    user_id: user.id,
    shop_id: shop.id,
    role: "owner",
  });

  if (memberErr) {
    await service.from("shops").delete().eq("id", shop.id);
    await service.from("clients").delete().eq("id", client.id);
    console.error("[onboarding] member insert failed:", memberErr.message);
    return NextResponse.json({ error: "Onboarding failed" }, { status: 500 });
  }

  // 4. Ensure a customer role exists WITHOUT downgrading an existing staff role.
  const { data: existingRole } = await service
    .from("app_user_roles")
    .select("profile_id")
    .eq("profile_id", user.id)
    .maybeSingle();

  if (!existingRole) {
    await service
      .from("app_user_roles")
      .insert({ profile_id: user.id, role: "customer" });
  }

  return NextResponse.json({ shop_id: shop.id });
}
