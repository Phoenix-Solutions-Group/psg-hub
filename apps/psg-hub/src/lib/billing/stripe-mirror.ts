// v0.4 / Phase 17 (PSG-59) — pure Stripe → DB mirroring for invoices + payments.
//
// These are deliberately PURE functions: the webhook route resolves shop_id and
// performs the upsert, but every field mapping (and every Basil/dahlia field
// relocation) lives here so the casts are quarantined in one place and unit-tested
// directly, without the heavy service-client mock.
//
// Basil relocations handled (per PSG-59 scope):
//   * subscription id:  invoice.parent.subscription_details.subscription
//                       (legacy: invoice.subscription)
//   * payment intent:   invoice.payments.data[].payment.payment_intent
//                       (legacy: invoice.payment_intent)
//
// PII-at-rest (PSG-58 design, operator decision 2026-06-18): we mirror the financial
// RECORD only (amounts/currency/dates/status, card brand+last4 — none of which is PAN).
// Billing IDENTITY (name/email/address/phone/tax id) is NOT persisted — the Stripe
// hosted page renders it — so `raw` is an explicit allowlist, never the whole object.
// This is stricter than encrypt-at-rest: there is no identity column to encrypt.

import type Stripe from "stripe";

/** A Stripe ref is either an expanded object ({id}) or the bare id string. */
type Ref = string | { id?: string | null } | null | undefined;

/** Normalize a Stripe reference (string id or expanded object) to its id. */
export function idOf(ref: Ref): string | null {
  if (!ref) return null;
  return typeof ref === "string" ? ref : ref.id ?? null;
}

function unixToIso(ts: number | null | undefined): string | null {
  return typeof ts === "number" ? new Date(ts * 1000).toISOString() : null;
}

// ── Basil/dahlia relocation readers ───────────────────────────────────────────
// The installed SDK's static types do not surface the relocated fields uniformly
// across the dahlia apiVersion, so we read them through a single narrow shape.

type InvoiceRelocations = {
  parent?: {
    subscription_details?: { subscription?: Ref } | null;
  } | null;
  payments?: {
    data?: Array<{ payment?: { payment_intent?: Ref } | null } | null> | null;
  } | null;
  // Pre-Basil locations (kept as fallbacks for replayed/older events).
  subscription?: Ref;
  payment_intent?: Ref;
};

/** Subscription id for an invoice — Basil location first, legacy fallback. */
export function invoiceSubscriptionId(inv: Stripe.Invoice): string | null {
  const i = inv as Stripe.Invoice & InvoiceRelocations;
  return (
    idOf(i.parent?.subscription_details?.subscription) ?? idOf(i.subscription)
  );
}

/** Settling PaymentIntent id for an invoice — Basil location first, legacy fallback. */
export function invoicePaymentIntentId(inv: Stripe.Invoice): string | null {
  const i = inv as Stripe.Invoice & InvoiceRelocations;
  const fromPayments = i.payments?.data?.find((p) => p?.payment?.payment_intent)
    ?.payment?.payment_intent;
  return idOf(fromPayments) ?? idOf(i.payment_intent);
}

// ── Row mappers ────────────────────────────────────────────────────────────────

export type InvoiceRow = {
  stripe_invoice_id: string;
  shop_id: string;
  stripe_customer_id: string | null;
  stripe_subscription_id: string | null;
  number: string | null;
  status: string;
  amount_due: number;
  amount_paid: number;
  currency: string;
  hosted_invoice_url: string | null;
  invoice_pdf: string | null;
  period_start: string | null;
  period_end: string | null;
  created: string | null;
  raw: Record<string, unknown>;
  updated_at: string;
};

/** Minimized invoice payload for `raw` — financial fields only, no payer identity. */
function minimizeInvoice(inv: Stripe.Invoice): Record<string, unknown> {
  return {
    id: inv.id,
    number: inv.number ?? null,
    status: inv.status ?? null,
    amount_due: inv.amount_due ?? null,
    amount_paid: inv.amount_paid ?? null,
    currency: inv.currency ?? null,
    subscription: invoiceSubscriptionId(inv),
    payment_intent: invoicePaymentIntentId(inv),
    hosted_invoice_url: inv.hosted_invoice_url ?? null,
    invoice_pdf: inv.invoice_pdf ?? null,
    period_start: inv.period_start ?? null,
    period_end: inv.period_end ?? null,
    created: inv.created ?? null,
  };
}

/** Map a Stripe Invoice to the `invoices` upsert row (keyed by stripe_invoice_id). */
export function mapInvoiceRow(inv: Stripe.Invoice, shopId: string): InvoiceRow {
  return {
    stripe_invoice_id: inv.id as string,
    shop_id: shopId,
    stripe_customer_id: idOf(inv.customer as Ref),
    stripe_subscription_id: invoiceSubscriptionId(inv),
    number: inv.number ?? null,
    status: inv.status ?? "draft",
    amount_due: inv.amount_due ?? 0,
    amount_paid: inv.amount_paid ?? 0,
    currency: inv.currency ?? "usd",
    hosted_invoice_url: inv.hosted_invoice_url ?? null,
    invoice_pdf: inv.invoice_pdf ?? null,
    period_start: unixToIso(inv.period_start),
    period_end: unixToIso(inv.period_end),
    created: unixToIso(inv.created),
    raw: minimizeInvoice(inv),
    updated_at: new Date().toISOString(),
  };
}

export type PaymentRow = {
  stripe_payment_intent_id: string;
  shop_id: string;
  stripe_invoice_id: string | null;
  stripe_charge_id: string | null;
  amount: number;
  amount_received: number;
  currency: string;
  status: string;
  payment_method_brand: string | null;
  payment_method_last4: string | null;
  raw: Record<string, unknown>;
  updated_at: string;
};

type ChargeLike = {
  id?: string | null;
  payment_method_details?: {
    card?: { brand?: string | null; last4?: string | null } | null;
  } | null;
};

/**
 * Card brand + last4 from a PaymentIntent — ONLY when the latest charge is expanded
 * on the event object. We do not store PAN/CVV (Stripe-hosted Checkout, PCI SAQ A);
 * brand + last4 are a safe financial-record detail. Returns nulls when not expanded
 * (the common webhook case), which is acceptable — the hosted receipt is canonical.
 */
function cardFromPaymentIntent(
  pi: Stripe.PaymentIntent
): { brand: string | null; last4: string | null } {
  const charge = pi.latest_charge as ChargeLike | string | null | undefined;
  if (!charge || typeof charge === "string") return { brand: null, last4: null };
  const card = charge.payment_method_details?.card;
  return { brand: card?.brand ?? null, last4: card?.last4 ?? null };
}

function minimizePaymentIntent(
  pi: Stripe.PaymentIntent
): Record<string, unknown> {
  return {
    id: pi.id,
    status: pi.status,
    amount: pi.amount ?? null,
    amount_received: pi.amount_received ?? null,
    currency: pi.currency ?? null,
    invoice: paymentIntentInvoiceId(pi),
    latest_charge: idOf(pi.latest_charge as Ref),
  };
}

/** Invoice id a PaymentIntent settles — legacy `invoice` field or metadata fallback. */
export function paymentIntentInvoiceId(pi: Stripe.PaymentIntent): string | null {
  const withInvoice = pi as Stripe.PaymentIntent & { invoice?: Ref };
  return idOf(withInvoice.invoice) ?? pi.metadata?.invoice_id ?? null;
}

/** Map a Stripe PaymentIntent to the `payments` upsert row (keyed by stripe_payment_intent_id). */
export function mapPaymentRow(
  pi: Stripe.PaymentIntent,
  shopId: string
): PaymentRow {
  const card = cardFromPaymentIntent(pi);
  return {
    stripe_payment_intent_id: pi.id,
    shop_id: shopId,
    stripe_invoice_id: paymentIntentInvoiceId(pi),
    stripe_charge_id: idOf(pi.latest_charge as Ref),
    amount: pi.amount ?? 0,
    amount_received: pi.amount_received ?? 0,
    currency: pi.currency ?? "usd",
    status: pi.status,
    payment_method_brand: card.brand,
    payment_method_last4: card.last4,
    raw: minimizePaymentIntent(pi),
    updated_at: new Date().toISOString(),
  };
}
