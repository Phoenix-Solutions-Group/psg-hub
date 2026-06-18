import { describe, it, expect, vi, beforeEach } from "vitest";

// ── Mock the Stripe lib (constructEvent + the resilience-wrapped retrieve) ──
const constructEvent = vi.fn();
const retrieveSubscriptionMock = vi.fn();
vi.mock("@/lib/stripe", () => ({
  getStripe: () => ({
    webhooks: { constructEvent: (...a: unknown[]) => constructEvent(...a) },
  }),
  retrieveSubscription: (...a: unknown[]) => retrieveSubscriptionMock(...a),
}));

// ── Mock the service client. Builders read the mutable state below at call
//    time (each route call constructs fresh builders), mirroring the
//    google-ads/__tests__/routes.test.ts idiom. ──
let claimRows: Array<{ event_id: string }> = [{ event_id: "evt_1" }];
let claimError: unknown = null;
let priorProcessedAt: string | null = null;
let membership: { shop_id: string } | null = { shop_id: "shop_1" };
let shopUpdateError: unknown = null;
let subUpsertError: unknown = null;
let subUpdateError: unknown = null;
// PSG-59 — invoice/payment mirroring state.
let shopByCustomer: { id: string } | null = { id: "shop_1" };
let invoiceUpsertError: unknown = null;
let paymentUpsertError: unknown = null;

const subUpsert = vi.fn();
const subUpdate = vi.fn();
const eventProcessedUpdate = vi.fn();
const invoiceUpsert = vi.fn();
const paymentUpsert = vi.fn();

function webhookEventsBuilder() {
  return {
    upsert: vi.fn().mockReturnValue({
      select: vi.fn().mockResolvedValue({ data: claimRows, error: claimError }),
    }),
    select: vi.fn().mockReturnValue({
      eq: vi.fn().mockReturnValue({
        single: vi
          .fn()
          .mockResolvedValue({ data: { processed_at: priorProcessedAt }, error: null }),
      }),
    }),
    update: vi.fn().mockImplementation((vals: Record<string, unknown>) => {
      eventProcessedUpdate(vals);
      return { eq: vi.fn().mockResolvedValue({ data: null, error: null }) };
    }),
  };
}

function shopUsersBuilder() {
  return {
    select: vi.fn().mockReturnThis(),
    eq: vi.fn().mockReturnThis(),
    limit: vi.fn().mockReturnThis(),
    single: vi.fn().mockResolvedValue({ data: membership, error: null }),
  };
}

function shopsBuilder() {
  return {
    update: vi.fn().mockReturnValue({
      eq: vi.fn().mockResolvedValue({ error: shopUpdateError }),
    }),
    // PSG-59: resolveShopIdByCustomer — .select("id").eq(...).maybeSingle()
    select: vi.fn().mockReturnValue({
      eq: vi.fn().mockReturnValue({
        maybeSingle: vi
          .fn()
          .mockResolvedValue({ data: shopByCustomer, error: null }),
      }),
    }),
  };
}

function invoicesBuilder() {
  return {
    upsert: vi
      .fn()
      .mockImplementation((vals: Record<string, unknown>, opts: unknown) => {
        invoiceUpsert(vals, opts);
        return Promise.resolve({ error: invoiceUpsertError });
      }),
  };
}

function paymentsBuilder() {
  return {
    upsert: vi
      .fn()
      .mockImplementation((vals: Record<string, unknown>, opts: unknown) => {
        paymentUpsert(vals, opts);
        return Promise.resolve({ error: paymentUpsertError });
      }),
  };
}

function subscriptionsBuilder() {
  return {
    upsert: vi.fn().mockImplementation((vals: Record<string, unknown>, opts: unknown) => {
      subUpsert(vals, opts);
      return Promise.resolve({ error: subUpsertError });
    }),
    update: vi.fn().mockImplementation((vals: Record<string, unknown>) => {
      subUpdate(vals);
      return { eq: vi.fn().mockResolvedValue({ error: subUpdateError }) };
    }),
  };
}

vi.mock("@/lib/supabase/service", () => ({
  createServiceClient: () => ({
    from: (table: string) => {
      if (table === "stripe_webhook_events") return webhookEventsBuilder();
      if (table === "shop_users") return shopUsersBuilder();
      if (table === "shops") return shopsBuilder();
      if (table === "subscriptions") return subscriptionsBuilder();
      if (table === "invoices") return invoicesBuilder();
      if (table === "payments") return paymentsBuilder();
      throw new Error(`unexpected table: ${table}`);
    },
  }),
}));

import { POST } from "../route";

function makeReq(sig: string | null): Request {
  return {
    text: async () => "raw-body",
    headers: { get: (k: string) => (k === "stripe-signature" ? sig : null) },
  } as unknown as Request;
}

const checkoutEvent = {
  id: "evt_1",
  type: "checkout.session.completed",
  api_version: "2026-05-27.dahlia",
  created: 1_700_000_000,
  data: {
    object: {
      metadata: { user_id: "user_1", tier: "growth" },
      customer: "cus_1",
      subscription: "sub_1",
    },
  },
};

beforeEach(() => {
  vi.clearAllMocks();
  claimRows = [{ event_id: "evt_1" }];
  claimError = null;
  priorProcessedAt = null;
  membership = { shop_id: "shop_1" };
  shopUpdateError = null;
  subUpsertError = null;
  subUpdateError = null;
  shopByCustomer = { id: "shop_1" };
  invoiceUpsertError = null;
  paymentUpsertError = null;
});

describe("stripe webhook route", () => {
  it("returns 400 with no signature", async () => {
    const res = await POST(makeReq(null));
    expect(res.status).toBe(400);
  });

  it("returns 400 on invalid signature", async () => {
    constructEvent.mockImplementation(() => {
      throw new Error("bad sig");
    });
    const res = await POST(makeReq("sig"));
    expect(res.status).toBe(400);
  });

  // AC-1: duplicate redelivery of an already-processed event → zero side effects.
  it("skips an already-processed duplicate event (zero side effects)", async () => {
    constructEvent.mockReturnValue(checkoutEvent);
    claimRows = []; // ON CONFLICT DO NOTHING returned no row → not the first delivery
    priorProcessedAt = "2026-06-18T00:00:00.000Z"; // and it was already finished

    const res = await POST(makeReq("sig"));
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.duplicate).toBe(true);
    expect(subUpsert).not.toHaveBeenCalled(); // no subscription write
    expect(eventProcessedUpdate).not.toHaveBeenCalled();
  });

  // AC-1 robustness: recorded-but-unprocessed (prior attempt failed) → reprocess.
  it("reprocesses an event recorded but not yet processed", async () => {
    constructEvent.mockReturnValue(checkoutEvent);
    claimRows = []; // already recorded
    priorProcessedAt = null; // but never finished

    const res = await POST(makeReq("sig"));

    expect(res.status).toBe(200);
    expect(subUpsert).toHaveBeenCalled(); // side effects ran
    expect(eventProcessedUpdate).toHaveBeenCalled();
  });

  // AC-2: first delivery upserts the subscription in place (no bare insert).
  it("upserts the subscription on checkout.session.completed (S3 fix)", async () => {
    constructEvent.mockReturnValue(checkoutEvent);

    const res = await POST(makeReq("sig"));

    expect(res.status).toBe(200);
    expect(subUpsert).toHaveBeenCalledTimes(1);
    const [vals, opts] = subUpsert.mock.calls[0];
    expect(vals).toMatchObject({ shop_id: "shop_1", tier: "growth", status: "active" });
    expect(opts).toEqual({ onConflict: "shop_id" }); // updates the shop's single row in place
    expect(eventProcessedUpdate).toHaveBeenCalled(); // processed_at set after success
  });

  // AC-2: a write error is surfaced (500), not silently swallowed; processed_at stays null.
  it("surfaces a subscription write error as 500 and leaves the event unprocessed", async () => {
    constructEvent.mockReturnValue(checkoutEvent);
    subUpsertError = new Error("duplicate key");

    const res = await POST(makeReq("sig"));

    expect(res.status).toBe(500);
    expect(eventProcessedUpdate).not.toHaveBeenCalled(); // so Stripe's retry reprocesses
  });

  // AC-3: Basil — period end is read from items.data[0].current_period_end of the
  // freshly retrieved subscription, NOT the (now-undefined) subscription-level field.
  it("reads the Basil item-level current_period_end on subscription.updated", async () => {
    const periodEndUnix = 1_800_000_000;
    constructEvent.mockReturnValue({
      id: "evt_2",
      type: "customer.subscription.updated",
      api_version: "2026-05-27.dahlia",
      created: 1_700_000_500,
      data: { object: { id: "sub_1" } }, // NB: no top-level current_period_end
    });
    retrieveSubscriptionMock.mockResolvedValue({
      id: "sub_1",
      status: "active",
      items: { data: [{ current_period_end: periodEndUnix }] },
    });

    const res = await POST(makeReq("sig"));

    expect(res.status).toBe(200);
    expect(retrieveSubscriptionMock).toHaveBeenCalledWith("sub_1");
    expect(subUpdate).toHaveBeenCalledTimes(1);
    const [vals] = subUpdate.mock.calls[0];
    expect(vals.current_period_end).toBe(new Date(periodEndUnix * 1000).toISOString());
    expect(vals.status).toBe("active");
  });

  // ── PSG-59: invoice mirroring ──────────────────────────────────────────────
  const invoicePaidEvent = {
    id: "evt_inv",
    type: "invoice.paid",
    api_version: "2026-05-27.dahlia",
    created: 1_700_000_100,
    data: {
      object: {
        id: "in_1",
        customer: "cus_1",
        number: "ABCD-0001",
        status: "paid",
        amount_due: 19900,
        amount_paid: 19900,
        currency: "usd",
        hosted_invoice_url: "https://pay.stripe.com/i/in_1",
        parent: { subscription_details: { subscription: "sub_1" } },
      },
    },
  };

  it("upserts an invoice (by stripe_invoice_id) on invoice.paid, resolving shop via customer", async () => {
    constructEvent.mockReturnValue(invoicePaidEvent);

    const res = await POST(makeReq("sig"));

    expect(res.status).toBe(200);
    expect(invoiceUpsert).toHaveBeenCalledTimes(1);
    const [vals, opts] = invoiceUpsert.mock.calls[0];
    expect(vals).toMatchObject({
      stripe_invoice_id: "in_1",
      shop_id: "shop_1",
      status: "paid",
      amount_paid: 19900,
      stripe_subscription_id: "sub_1", // Basil relocation resolved
    });
    expect(opts).toEqual({ onConflict: "stripe_invoice_id" });
    expect(eventProcessedUpdate).toHaveBeenCalled();
  });

  it("no-ops (no error) when the invoice customer maps to no shop", async () => {
    constructEvent.mockReturnValue(invoicePaidEvent);
    shopByCustomer = null; // unmapped Stripe customer

    const res = await POST(makeReq("sig"));

    expect(res.status).toBe(200);
    expect(invoiceUpsert).not.toHaveBeenCalled();
    expect(eventProcessedUpdate).toHaveBeenCalled(); // processed, just nothing to mirror
  });

  it("surfaces an invoice upsert error as 500 and leaves the event unprocessed", async () => {
    constructEvent.mockReturnValue(invoicePaidEvent);
    invoiceUpsertError = new Error("db down");

    const res = await POST(makeReq("sig"));

    expect(res.status).toBe(500);
    expect(eventProcessedUpdate).not.toHaveBeenCalled();
  });

  // ── PSG-59: payment mirroring ──────────────────────────────────────────────
  it("upserts a payment (by stripe_payment_intent_id) on payment_intent.succeeded", async () => {
    constructEvent.mockReturnValue({
      id: "evt_pi",
      type: "payment_intent.succeeded",
      api_version: "2026-05-27.dahlia",
      created: 1_700_000_200,
      data: {
        object: {
          id: "pi_1",
          customer: "cus_1",
          amount: 19900,
          amount_received: 19900,
          currency: "usd",
          status: "succeeded",
          latest_charge: "ch_1",
          metadata: { invoice_id: "in_1" },
        },
      },
    });

    const res = await POST(makeReq("sig"));

    expect(res.status).toBe(200);
    expect(paymentUpsert).toHaveBeenCalledTimes(1);
    const [vals, opts] = paymentUpsert.mock.calls[0];
    expect(vals).toMatchObject({
      stripe_payment_intent_id: "pi_1",
      shop_id: "shop_1",
      stripe_invoice_id: "in_1",
      status: "succeeded",
      amount_received: 19900,
    });
    expect(opts).toEqual({ onConflict: "stripe_payment_intent_id" });
  });
});
