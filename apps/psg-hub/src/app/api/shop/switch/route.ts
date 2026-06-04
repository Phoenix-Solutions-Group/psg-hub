import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { getUserShops, ACTIVE_SHOP_COOKIE } from "@/lib/shop/context";

type SwitchBody = { shop_id?: string };

export async function POST(request: Request) {
  // Auth via the user session; membership is the ONLY authority for the switch.
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  let body: SwitchBody;
  try {
    body = (await request.json()) as SwitchBody;
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const shopId = (body.shop_id ?? "").trim();
  if (!shopId) {
    return NextResponse.json({ error: "shop_id required" }, { status: 400 });
  }

  // The cookie never authorizes — only a current membership permits the switch.
  const shops = await getUserShops(user.id);
  if (!shops.some((s) => s.id === shopId)) {
    return NextResponse.json({ error: "Not a member of that shop" }, { status: 403 });
  }

  const response = NextResponse.json({ shop_id: shopId });
  response.cookies.set(ACTIVE_SHOP_COOKIE, shopId, {
    httpOnly: true,
    secure: true,
    sameSite: "lax",
    path: "/",
  });
  return response;
}
