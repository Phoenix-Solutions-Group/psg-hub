import Stripe from "stripe";
import { CircuitBreaker, withRetry } from "@/lib/resilience";

let stripeInstance: Stripe | null = null;

export function getStripe(): Stripe {
  if (!stripeInstance) {
    stripeInstance = new Stripe(process.env.STRIPE_SECRET_KEY!, {
      apiVersion: "2026-05-27.dahlia",
    });
  }
  return stripeInstance;
}

// Shared module-level breaker for outbound Stripe calls (mirrors the SendGrid /
// Twilio / Google adapters — one breaker per service, NOT per call).
const defaultStripeBreaker = new CircuitBreaker({
  failureThreshold: 5,
  resetTimeoutMs: 30_000,
});

/**
 * Retrieve a subscription fresh, under retry + the shared circuit breaker.
 * Webhook payloads arrive out-of-order and can be stale (research §3), so the
 * canonical object is re-fetched rather than trusting the embedded snapshot.
 */
export async function retrieveSubscription(
  subscriptionId: string
): Promise<Stripe.Subscription> {
  const stripe = getStripe();
  return defaultStripeBreaker.execute(() =>
    withRetry(() => stripe.subscriptions.retrieve(subscriptionId))
  );
}
