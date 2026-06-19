import { describe, it, expect } from "vitest";
import type Stripe from "stripe";
import {
  idOf,
  invoiceSubscriptionId,
  invoicePaymentIntentId,
  paymentIntentInvoiceId,
  mapInvoiceRow,
  mapPaymentRow,
} from "../stripe-mirror";

describe("idOf", () => {
  it("returns a bare string id", () => {
    expect(idOf("cus_123")).toBe("cus_123");
  });
  it("returns id from an expanded object", () => {
    expect(idOf({ id: "sub_9" })).toBe("sub_9");
  });
  it("returns null for null/undefined/missing id", () => {
    expect(idOf(null)).toBeNull();
    expect(idOf(undefined)).toBeNull();
    expect(idOf({ id: null })).toBeNull();
  });
});

describe("Basil relocations — invoice subscription id", () => {
  it("reads the Basil location: parent.subscription_details.subscription", () => {
    const inv = {
      parent: { subscription_details: { subscription: "sub_basil" } },
    } as unknown as Stripe.Invoice;
    expect(invoiceSubscriptionId(inv)).toBe("sub_basil");
  });

  it("falls back to the legacy top-level subscription field", () => {
    const inv = { subscription: "sub_legacy" } as unknown as Stripe.Invoice;
    expect(invoiceSubscriptionId(inv)).toBe("sub_legacy");
  });

  it("prefers the Basil location over the legacy field", () => {
    const inv = {
      parent: { subscription_details: { subscription: { id: "sub_basil" } } },
      subscription: "sub_legacy",
    } as unknown as Stripe.Invoice;
    expect(invoiceSubscriptionId(inv)).toBe("sub_basil");
  });

  it("is null for a one-off invoice with no subscription anywhere", () => {
    const inv = { parent: null } as unknown as Stripe.Invoice;
    expect(invoiceSubscriptionId(inv)).toBeNull();
  });
});

describe("Basil relocations — invoice payment intent id", () => {
  it("reads the Basil location: payments.data[].payment.payment_intent", () => {
    const inv = {
      payments: {
        data: [
          { payment: { payment_intent: null } },
          { payment: { payment_intent: "pi_basil" } },
        ],
      },
    } as unknown as Stripe.Invoice;
    expect(invoicePaymentIntentId(inv)).toBe("pi_basil");
  });

  it("falls back to the legacy top-level payment_intent field", () => {
    const inv = { payment_intent: "pi_legacy" } as unknown as Stripe.Invoice;
    expect(invoicePaymentIntentId(inv)).toBe("pi_legacy");
  });
});

describe("mapInvoiceRow", () => {
  const inv = {
    id: "in_1",
    customer: "cus_1",
    parent: { subscription_details: { subscription: "sub_1" } },
    number: "ABCD-0001",
    status: "open",
    amount_due: 19900,
    amount_paid: 0,
    currency: "usd",
    hosted_invoice_url: "https://pay.stripe.com/i/in_1",
    invoice_pdf: "https://pay.stripe.com/i/in_1/pdf",
    period_start: 1_700_000_000,
    period_end: 1_702_592_000,
    created: 1_700_000_000,
    // Payer identity that must NOT survive into the mirrored row / raw.
    customer_email: "owner@shop.test",
    customer_name: "Jane Owner",
    customer_address: { line1: "1 Main St" },
  } as unknown as Stripe.Invoice;

  it("maps the financial record keyed by stripe_invoice_id", () => {
    const row = mapInvoiceRow(inv, "shop_1");
    expect(row.stripe_invoice_id).toBe("in_1");
    expect(row.shop_id).toBe("shop_1");
    expect(row.stripe_customer_id).toBe("cus_1");
    expect(row.stripe_subscription_id).toBe("sub_1");
    expect(row.number).toBe("ABCD-0001");
    expect(row.status).toBe("open");
    expect(row.amount_due).toBe(19900);
    expect(row.hosted_invoice_url).toBe("https://pay.stripe.com/i/in_1");
    expect(row.period_start).toBe(new Date(1_700_000_000 * 1000).toISOString());
  });

  it("does NOT persist payer identity (no name/email/address) anywhere", () => {
    const row = mapInvoiceRow(inv, "shop_1");
    const serialized = JSON.stringify(row);
    expect(serialized).not.toContain("owner@shop.test");
    expect(serialized).not.toContain("Jane Owner");
    expect(serialized).not.toContain("1 Main St");
    // raw is an allowlist of financial fields only.
    expect(Object.keys(row.raw)).not.toContain("customer_email");
    expect(Object.keys(row.raw)).not.toContain("customer_name");
  });
});

describe("mapPaymentRow", () => {
  it("maps keyed by stripe_payment_intent_id with brand+last4 when charge is expanded", () => {
    const pi = {
      id: "pi_1",
      customer: "cus_1",
      amount: 19900,
      amount_received: 19900,
      currency: "usd",
      status: "succeeded",
      latest_charge: {
        id: "ch_1",
        payment_method_details: { card: { brand: "visa", last4: "4242" } },
      },
      metadata: { invoice_id: "in_1" },
    } as unknown as Stripe.PaymentIntent;

    const row = mapPaymentRow(pi, "shop_1");
    expect(row.stripe_payment_intent_id).toBe("pi_1");
    expect(row.shop_id).toBe("shop_1");
    expect(row.stripe_invoice_id).toBe("in_1");
    expect(row.stripe_charge_id).toBe("ch_1");
    expect(row.status).toBe("succeeded");
    expect(row.payment_method_brand).toBe("visa");
    expect(row.payment_method_last4).toBe("4242");
  });

  it("leaves brand/last4 null when latest_charge is just an id string (the common webhook case)", () => {
    const pi = {
      id: "pi_2",
      customer: "cus_1",
      amount: 19900,
      amount_received: 0,
      currency: "usd",
      status: "requires_payment_method",
      latest_charge: "ch_2",
    } as unknown as Stripe.PaymentIntent;

    const row = mapPaymentRow(pi, "shop_1");
    expect(row.payment_method_brand).toBeNull();
    expect(row.payment_method_last4).toBeNull();
    expect(row.stripe_charge_id).toBe("ch_2");
  });

  it("never stores a PAN — only brand + last4 in the financial record", () => {
    const pi = {
      id: "pi_3",
      customer: "cus_1",
      amount: 100,
      amount_received: 100,
      currency: "usd",
      status: "succeeded",
      latest_charge: {
        id: "ch_3",
        payment_method_details: { card: { brand: "visa", last4: "4242" } },
      },
    } as unknown as Stripe.PaymentIntent;
    const row = mapPaymentRow(pi, "shop_1");
    const serialized = JSON.stringify(row);
    expect(serialized).not.toMatch(/\b\d{13,19}\b/); // no full PAN
  });
});

describe("paymentIntentInvoiceId", () => {
  it("prefers the legacy invoice field, then metadata.invoice_id", () => {
    expect(
      paymentIntentInvoiceId({ invoice: "in_a" } as unknown as Stripe.PaymentIntent)
    ).toBe("in_a");
    expect(
      paymentIntentInvoiceId({
        metadata: { invoice_id: "in_b" },
      } as unknown as Stripe.PaymentIntent)
    ).toBe("in_b");
    expect(
      paymentIntentInvoiceId({} as unknown as Stripe.PaymentIntent)
    ).toBeNull();
  });
});
