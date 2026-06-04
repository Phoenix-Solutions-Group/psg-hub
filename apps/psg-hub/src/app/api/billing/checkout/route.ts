import { NextResponse } from "next/server";
import { getStripe } from "@/lib/stripe";
import { createClient } from "@/lib/supabase/server";

export async function POST(request: Request) {
  const stripe = getStripe();

  const PRICE_IDS: Record<string, string | undefined> = {
    essentials: process.env.STRIPE_ESSENTIALS_PRICE_ID,
    growth: process.env.STRIPE_GROWTH_PRICE_ID,
    performance: process.env.STRIPE_PERFORMANCE_PRICE_ID,
  };

  const formData = await request.formData();
  const tier = formData.get("tier") as string;

  if (!tier || !(tier in PRICE_IDS)) {
    return NextResponse.json({ error: "Invalid tier" }, { status: 400 });
  }

  const priceId = PRICE_IDS[tier];
  if (!priceId) {
    console.error(`[checkout] tier "${tier}" missing price id env var`);
    return NextResponse.json(
      { error: `Price not configured for tier: ${tier}` },
      { status: 500 }
    );
  }

  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();

  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const session = await stripe.checkout.sessions.create({
    mode: "subscription",
    line_items: [{ price: priceId, quantity: 1 }],
    customer_email: user.email,
    metadata: { user_id: user.id, tier },
    success_url: `${process.env.NEXT_PUBLIC_APP_URL}/dashboard/billing?success=true`,
    cancel_url: `${process.env.NEXT_PUBLIC_APP_URL}/dashboard/billing`,
  });

  return NextResponse.redirect(session.url!, 303);
}
