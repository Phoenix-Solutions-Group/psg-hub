import { NextResponse } from "next/server";
import { getStripe } from "@/lib/stripe";
import { createClient } from "@/lib/supabase/server";
import { createServiceClient } from "@/lib/supabase/service";

/**
 * Generate a Stripe-hosted payment link for one invoice and redirect the payer to it (v0.4).
 *
 * Authorization is RLS-enforced: we read the invoice through the user-session client, so the
 * SELECT only returns it when the caller is a member of the invoice's shop (invoices_select
 * policy). A non-member gets no row -> 404, never another shop's invoice (IDOR-safe).
 *
 * The Checkout Session carries metadata.invoice_id; the Stripe webhook's one-off path reconciles
 * the payment back onto this invoice. We persist the link + session id via service role so a
 * customer (read-only on invoices) doesn't need write access.
 */
export async function POST(
  _request: Request,
  { params }: { params: Promise<{ shopId: string; id: string }> }
) {
  const { shopId, id } = await params;

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  // RLS-clamped read: returns the row only if the user belongs to its shop.
  const { data: invoice } = await supabase
    .from("invoices")
    .select(
      "id, shop_id, number, amount_cents, currency, status, payment_link_url"
    )
    .eq("id", id)
    .eq("shop_id", shopId)
    .maybeSingle();

  if (!invoice) {
    return NextResponse.json({ error: "Invoice not found" }, { status: 404 });
  }
  if (invoice.status === "paid") {
    return NextResponse.json({ error: "Invoice already paid" }, { status: 409 });
  }
  if (!invoice.amount_cents || invoice.amount_cents <= 0) {
    return NextResponse.json(
      { error: "Invoice has no payable amount" },
      { status: 400 }
    );
  }

  const appUrl = process.env.NEXT_PUBLIC_APP_URL ?? "";
  const stripe = getStripe();
  const session = await stripe.checkout.sessions.create({
    mode: "payment",
    line_items: [
      {
        price_data: {
          currency: invoice.currency || "usd",
          unit_amount: invoice.amount_cents,
          product_data: {
            name: invoice.number
              ? `Invoice ${invoice.number}`
              : "Invoice payment",
          },
        },
        quantity: 1,
      },
    ],
    customer_email: user.email,
    metadata: { invoice_id: invoice.id, shop_id: invoice.shop_id },
    payment_intent_data: {
      metadata: { invoice_id: invoice.id, shop_id: invoice.shop_id },
    },
    success_url: `${appUrl}/dashboard/invoices/${invoice.id}?paid=true`,
    cancel_url: `${appUrl}/dashboard/invoices/${invoice.id}`,
  });

  if (!session.url) {
    return NextResponse.json(
      { error: "Could not create payment link" },
      { status: 502 }
    );
  }

  // Persist the link for the invoice detail CTA (service role: customers are read-only on invoices).
  await createServiceClient()
    .from("invoices")
    .update({
      payment_link_url: session.url,
      stripe_checkout_session_id: session.id,
      updated_at: new Date().toISOString(),
    })
    .eq("id", invoice.id);

  return NextResponse.redirect(session.url, 303);
}
