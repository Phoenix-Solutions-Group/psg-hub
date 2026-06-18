import { NextResponse } from "next/server";
import Stripe from "stripe";
import { getStripe, retrieveSubscription } from "@/lib/stripe";
import { createServiceClient } from "@/lib/supabase/service";
import { idOf, mapInvoiceRow, mapPaymentRow } from "@/lib/billing/stripe-mirror";

// Webhook is signature-verified, not session-authed; it must read the raw body.
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

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

  // ── Idempotency gate (research §1.1, §3). Stripe delivers at-least-once.
  // Record the event with ON CONFLICT (event_id) DO NOTHING. An empty result means
  // a prior delivery already recorded it. We then skip side effects ONLY if that
  // prior delivery also FINISHED (processed_at set); if it recorded but failed
  // mid-processing, processed_at is null and we fall through to reprocess so a
  // transient failure is not silently deduped away (no dropped subscription state).
  const { data: claimed, error: claimError } = await supabase
    .from("stripe_webhook_events")
    .upsert(
      {
        event_id: event.id,
        type: event.type,
        api_version: event.api_version ?? null,
        created: new Date(event.created * 1000).toISOString(),
        payload: event as unknown as Record<string, unknown>,
      },
      { onConflict: "event_id", ignoreDuplicates: true }
    )
    .select("event_id");

  if (claimError) {
    // Could not record the event — return 5xx so Stripe retries.
    return NextResponse.json({ error: "event log failed" }, { status: 500 });
  }

  if (!claimed || claimed.length === 0) {
    const { data: prior } = await supabase
      .from("stripe_webhook_events")
      .select("processed_at")
      .eq("event_id", event.id)
      .single();
    if (prior?.processed_at) {
      // Already fully processed — duplicate redelivery, zero side effects.
      return NextResponse.json({ received: true, duplicate: true });
    }
    // Recorded but unprocessed (prior attempt failed) — fall through and reprocess.
  }

  try {
    await handleEvent(event, supabase);
  } catch {
    // Side-effect failure — leave processed_at null so Stripe's retry reprocesses.
    return NextResponse.json({ error: "processing failed" }, { status: 500 });
  }

  await supabase
    .from("stripe_webhook_events")
    .update({ processed_at: new Date().toISOString() })
    .eq("event_id", event.id);

  return NextResponse.json({ received: true });
}

type ServiceClient = ReturnType<typeof createServiceClient>;

async function handleEvent(
  event: Stripe.Event,
  supabase: ServiceClient
): Promise<void> {
  switch (event.type) {
    case "checkout.session.completed": {
      const session = event.data.object as Stripe.Checkout.Session;
      const { user_id, tier } = session.metadata || {};
      const customerId = session.customer as string;
      const subscriptionId = session.subscription as string;

      if (!user_id || !tier) break;

      const { data: membership } = await supabase
        .from("shop_users")
        .select("shop_id")
        .eq("user_id", user_id)
        .limit(1)
        .single();

      if (!membership) break;

      // Link the Stripe customer to the shop.
      const { error: shopError } = await supabase
        .from("shops")
        .update({ stripe_customer_id: customerId })
        .eq("id", membership.shop_id);
      if (shopError) throw shopError;

      // S3 fix: UPSERT, not bare INSERT. shop_id is UNIQUE and the MoR model is
      // one shop ↔ one subscription, so a re-subscribe or tier change updates the
      // shop's single row in place rather than raising a silently-swallowed
      // duplicate-key. (Refines research §1.2's onConflict=stripe_subscription_id:
      // shop_id is the row's real uniqueness for this 1:1 model.) Error is checked.
      const { error: subError } = await supabase.from("subscriptions").upsert(
        {
          shop_id: membership.shop_id,
          stripe_customer_id: customerId,
          stripe_subscription_id: subscriptionId,
          tier,
          status: "active",
          updated_at: new Date().toISOString(),
        },
        { onConflict: "shop_id" }
      );
      if (subError) throw subError;
      break;
    }

    case "customer.subscription.updated": {
      const sub = event.data.object as Stripe.Subscription;
      // Basil fix (research §2): current_period_end moved to the item level.
      // Re-fetch the canonical subscription (out-of-order safe, §3) under the
      // shared retry + breaker, then read items.data[0].current_period_end.
      const fresh = await retrieveSubscription(sub.id);
      const itemPeriodEnd = fresh.items?.data?.[0]?.current_period_end;
      const periodEnd = itemPeriodEnd
        ? new Date(itemPeriodEnd * 1000).toISOString()
        : null;

      const { error } = await supabase
        .from("subscriptions")
        .update({
          status: String(fresh.status),
          current_period_end: periodEnd,
          updated_at: new Date().toISOString(),
        })
        .eq("stripe_subscription_id", sub.id);
      if (error) throw error;
      break;
    }

    case "customer.subscription.deleted": {
      const subscription = event.data.object as Stripe.Subscription;
      const { error } = await supabase
        .from("subscriptions")
        .update({
          status: "canceled",
          updated_at: new Date().toISOString(),
        })
        .eq("stripe_subscription_id", subscription.id);
      if (error) throw error;
      break;
    }

    // ── PSG-59: Stripe-native invoice mirroring. created→finalized→paid (or
    // payment_failed) all carry the full Invoice; we upsert by stripe_invoice_id so
    // any order / redelivery converges to the latest state. Customer is resolved to
    // a shop via shops.stripe_customer_id; an unmapped customer (e.g. a non-shop
    // Stripe customer) is a no-op, not an error. ──
    case "invoice.created":
    case "invoice.finalized":
    case "invoice.paid":
    case "invoice.payment_failed": {
      const invoice = event.data.object as Stripe.Invoice;
      if (!invoice.id) break;
      const shopId = await resolveShopIdByCustomer(
        supabase,
        idOf(invoice.customer as string | { id?: string | null } | null)
      );
      if (!shopId) break;

      const { error } = await supabase
        .from("invoices")
        .upsert(mapInvoiceRow(invoice, shopId), {
          onConflict: "stripe_invoice_id",
        });
      if (error) throw error;
      break;
    }

    // ── PSG-59: Stripe-native payment mirroring. Upsert by stripe_payment_intent_id;
    // the invoice linkage (when present) is set on the row so a shop's invoice detail
    // can show its settlement attempts. ──
    case "payment_intent.succeeded":
    case "payment_intent.payment_failed": {
      const pi = event.data.object as Stripe.PaymentIntent;
      const shopId = await resolveShopIdByCustomer(
        supabase,
        idOf(pi.customer as string | { id?: string | null } | null)
      );
      if (!shopId) break;

      const { error } = await supabase
        .from("payments")
        .upsert(mapPaymentRow(pi, shopId), {
          onConflict: "stripe_payment_intent_id",
        });
      if (error) throw error;
      break;
    }
  }
}

/** Resolve the shop that owns a Stripe customer, via shops.stripe_customer_id. */
async function resolveShopIdByCustomer(
  supabase: ServiceClient,
  customerId: string | null
): Promise<string | null> {
  if (!customerId) return null;
  const { data } = await supabase
    .from("shops")
    .select("id")
    .eq("stripe_customer_id", customerId)
    .maybeSingle();
  return (data?.id as string | undefined) ?? null;
}
