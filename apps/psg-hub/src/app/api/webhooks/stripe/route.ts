import { NextResponse } from "next/server";
import Stripe from "stripe";
import { createServiceClient } from "@/lib/supabase/service";
import { getStripe } from "@/lib/stripe";

/**
 * Stripe webhook — subscriptions (BSM, shipped) + one-off invoice payments (v0.4).
 *
 * Idempotency (PLANNING.md "idempotent via event_id"): every event is first claimed in
 * public.stripe_events via an ignoreDuplicates upsert. A replayed event id inserts nothing,
 * so we short-circuit before touching subscriptions/invoices — Stripe retries are safe no-ops.
 *
 * v0.4 additions:
 *  - One-off invoice payments coexist with subscriptions: a Checkout Session in `payment` mode
 *    (or a PaymentIntent) carrying metadata.invoice_id marks that invoice paid.
 *  - S3 (v0.2-deferred): the subscription write is INSERT -> UPSERT(onConflict stripe_subscription_id)
 *    so a replayed/duplicated checkout.session.completed no longer creates duplicate subscription rows.
 */
export async function POST(request: Request) {
  const stripe = getStripe();
  const supabase = createServiceClient();

  const body = await request.text();
  const signature = request.headers.get("stripe-signature");

  if (!signature) {
    return NextResponse.json({ error: "No signature" }, { status: 400 });
  }

  let event: Stripe.Event;
  try {
    event = stripe.webhooks.constructEvent(
      body,
      signature,
      process.env.STRIPE_WEBHOOK_SECRET!
    );
  } catch {
    return NextResponse.json({ error: "Invalid signature" }, { status: 400 });
  }

  // Idempotency claim. ignoreDuplicates => a replay inserts no row; .select() then returns
  // an empty array and we stop before reprocessing.
  const { data: claimed, error: claimError } = await supabase
    .from("stripe_events")
    .upsert(
      { event_id: event.id, event_type: event.type, payload: event as unknown },
      { onConflict: "event_id", ignoreDuplicates: true }
    )
    .select("event_id");

  if (claimError) {
    // Couldn't record the event — 500 so Stripe retries (the unique key keeps retries safe).
    console.error("[stripe-webhook] ledger write failed:", claimError.message);
    return NextResponse.json({ error: "Persist failed" }, { status: 500 });
  }
  if (!claimed || claimed.length === 0) {
    // Already processed this event id — idempotent no-op.
    return NextResponse.json({ received: true, duplicate: true });
  }

  switch (event.type) {
    case "checkout.session.completed": {
      const session = event.data.object as Stripe.Checkout.Session;
      const metadata = session.metadata || {};

      // One-off invoice payment (v0.4) — distinguished by metadata.invoice_id / payment mode.
      if (metadata.invoice_id || session.mode === "payment") {
        if (metadata.invoice_id) {
          await markInvoicePaid(supabase, metadata.invoice_id, {
            paymentIntentId:
              typeof session.payment_intent === "string"
                ? session.payment_intent
                : null,
            checkoutSessionId: session.id,
          });
        }
        break;
      }

      // Subscription checkout (BSM, shipped).
      const { user_id, tier } = metadata;
      const customerId = session.customer as string;
      const subscriptionId = session.subscription as string;

      if (user_id && tier) {
        const { data: membership } = await supabase
          .from("shop_users")
          .select("shop_id")
          .eq("user_id", user_id)
          .limit(1)
          .single();

        if (membership) {
          await supabase
            .from("shops")
            .update({ stripe_customer_id: customerId })
            .eq("id", membership.shop_id);

          // S3 fix: UPSERT (was INSERT) keyed on stripe_subscription_id — replay-safe.
          await supabase.from("subscriptions").upsert(
            {
              shop_id: membership.shop_id,
              stripe_customer_id: customerId,
              stripe_subscription_id: subscriptionId,
              tier,
              status: "active",
              updated_at: new Date().toISOString(),
            },
            { onConflict: "stripe_subscription_id" }
          );
        }
      }
      break;
    }

    // PaymentIntent path covers payment links / PIs not driven through Checkout.
    case "payment_intent.succeeded": {
      const pi = event.data.object as Stripe.PaymentIntent;
      const invoiceId = pi.metadata?.invoice_id;
      if (invoiceId) {
        await markInvoicePaid(supabase, invoiceId, {
          paymentIntentId: pi.id,
          checkoutSessionId: null,
        });
      }
      break;
    }

    case "customer.subscription.updated": {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const subscription = event.data.object as any;
      const periodEnd = subscription.current_period_end
        ? new Date(subscription.current_period_end * 1000).toISOString()
        : null;
      await supabase
        .from("subscriptions")
        .update({
          status: String(subscription.status),
          current_period_end: periodEnd,
          updated_at: new Date().toISOString(),
        })
        .eq("stripe_subscription_id", subscription.id);
      break;
    }

    case "customer.subscription.deleted": {
      const subscription = event.data.object as Stripe.Subscription;
      await supabase
        .from("subscriptions")
        .update({
          status: "canceled",
          updated_at: new Date().toISOString(),
        })
        .eq("stripe_subscription_id", subscription.id);
      break;
    }
  }

  return NextResponse.json({ received: true });
}

/** Mark a mirrored invoice paid + record the Stripe linkage. Service-role write (RLS-bypassing). */
async function markInvoicePaid(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  supabase: any,
  invoiceId: string,
  links: { paymentIntentId: string | null; checkoutSessionId: string | null }
) {
  const update: Record<string, unknown> = {
    status: "paid",
    paid_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
  };
  if (links.paymentIntentId) update.stripe_payment_intent_id = links.paymentIntentId;
  if (links.checkoutSessionId)
    update.stripe_checkout_session_id = links.checkoutSessionId;

  const { error } = await supabase
    .from("invoices")
    .update(update)
    .eq("id", invoiceId);
  if (error) {
    console.error("[stripe-webhook] invoice paid update failed:", error.message);
  }
}
