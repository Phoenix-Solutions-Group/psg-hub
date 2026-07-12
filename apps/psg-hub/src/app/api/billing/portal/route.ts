import { NextResponse } from "next/server";
import { getStripe } from "@/lib/stripe";
import { createClient } from "@/lib/supabase/server";

export async function POST(request: Request) {
  const stripe = getStripe();
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();

  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const formData = await request.formData();
  const shopId = formData.get("shop_id") as string;

  if (!shopId) {
    return NextResponse.json({ error: "Missing shop_id" }, { status: 400 });
  }

  // Find stripe customer ID from the selected shop membership.
  const { data: membership } = await supabase
    .from("shop_users")
    .select("shops(stripe_customer_id)")
    .eq("user_id", user.id)
    .eq("shop_id", shopId)
    .maybeSingle();

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const shopData = membership?.shops as any;
  const customerId = Array.isArray(shopData)
    ? shopData[0]?.stripe_customer_id
    : shopData?.stripe_customer_id;

  if (!customerId) {
    return NextResponse.json(
      { error: "No billing account found" },
      { status: 404 }
    );
  }

  const session = await stripe.billingPortal.sessions.create({
    customer: customerId,
    return_url: `${process.env.NEXT_PUBLIC_APP_URL}/dashboard/billing?shop_id=${shopId}`,
  });

  return NextResponse.redirect(session.url, 303);
}
